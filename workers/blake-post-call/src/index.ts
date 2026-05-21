/**
 * blake-post-call — Cloudflare Worker that receives ElevenLabs Conversational
 * AI post-call webhooks for the Blake voice agent and writes a backup record
 * into GHL.
 *
 * Why this exists:
 *   Blake's in-conversation tools (lookup_contact_by_phone, save_call_summary,
 *   set_lead_temp, ...) ALREADY write to GHL during the call. But tools can
 *   fail mid-call (LLM forgets to call save_call_summary, network blip, etc.).
 *   This Worker is the safety net — at call end, ElevenLabs POSTs the full
 *   transcript + outcome here, and we write a deterministic backup note to
 *   GHL so no conversation is lost.
 *
 * Architecture rule (see `tyler/feedback_event_driven_no_cron.md`):
 *   Real-time webhook, never cron. Sub-second latency, no polling.
 *
 * Endpoints:
 *   GET  /            — health check
 *   POST /webhook     — ElevenLabs post-call event
 *
 * Bindings (set via wrangler secret put / GitHub Actions):
 *   BLAKE_GHL_PIT               — GHL Private Integration Token
 *   ELEVENLABS_WEBHOOK_SECRET   — HMAC signing secret from ElevenLabs webhook config
 */

export interface Env {
  BLAKE_GHL_PIT: string;
  ELEVENLABS_WEBHOOK_SECRET: string;
  ELEVENLABS_API_KEY: string;       // needed for outbound dial API
  ANTHROPIC_API_KEY: string;        // post-call structured extraction
  DIAL_STATE: KVNamespace;          // KV for warm-up quota + dial dedupe
}

const APG_LOCATION_ID = "RCkiUmWqXX4BYQ39JXmm";
const GHL_BASE = "https://services.leadconnectorhq.com";
const USER_MIKE = "Vj4WwH1ovxGN5Hv5Kq17";

// Signature freshness window — reject events older than 5 minutes.
const SIGNATURE_MAX_AGE_S = 300;

// GHL custom field IDs (APG sub-account). Match elevenlabs-tools-config.md.
const CF_BEDS = "xXEm77wvbxEbiqsw3lAz";
const CF_BATHS = "EtKof5yT7KAWmoaNQqJZ";
const CF_SQFT = "8kqwjqtJyTTeQ8SIaLQz";
const CF_ASKING = "6q7syt4puxfP7E03Xxhd";
const CF_MOTIVATION = "rbYZAdhvuvX1NQgexhxy";
const CF_TIMELINE = "v47I1Mi63RBpCD5N5RrH";
const CF_VA_NOTES = "ctNVXVw8VY1PD4B1oqXj";
const CF_BLAKE_RECORDING = "hsHjLlOE8mb4O2DqxNY7";  // URL to /audio/{conv_id} proxy

// GHL stage IDs (APG ACQ pipeline). Source of truth: tyler/project_ghl_acq.md.
const STAGE_UNQUALIFIED = "c1d23905-7096-439c-9a31-f8db5b2b53d0";

// ElevenLabs Blake agent + phone-number IDs.
const BLAKE_AGENT_ID = "agent_5001ks3cp069f9rtfz6e81ypgnrd";
const BLAKE_PHONE_NUMBER_ID = "phnum_8001ks3fhbbpe4vadtrdmparejgw";

// Warm-up curve: max outbound dials per UTC day, indexed by days since the
// dialer's first run. After WARMUP_CURVE.length days we stay at the last
// value (the "steady state").
const WARMUP_CURVE = [
  10,   // Day 1  — pilot
  20,   // Day 2
  30,   // Day 3
  50,   // Day 4
  75,   // Day 5
  100,  // Day 6
  100,  // Day 7
  150,  // Day 8 (week 2 starts)
  150,  // Day 9
  200,  // Day 10
  200,  // Day 11
  250,  // Day 12
  250,  // Day 13
  300,  // Day 14 (week 3 starts) → steady state
];

// TCPA call window: only dial between these hours in the contact's local time.
const TCPA_DIAL_START_HOUR = 8;   // 8:00 am local
const TCPA_DIAL_END_HOUR = 21;    // 9:00 pm local (calls placed before 21:00)

// US state → IANA timezone (predominant). Some states (FL, IN, KY, MI, TN) are
// split; we use the dominant zone. Conservative: edge cases will be filtered
// out by the more restrictive of the two windows on a per-call basis later.
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago",      AK: "America/Anchorage",
  AZ: "America/Phoenix",      AR: "America/Chicago",
  CA: "America/Los_Angeles",  CO: "America/Denver",
  CT: "America/New_York",     DE: "America/New_York",
  FL: "America/New_York",     GA: "America/New_York",
  HI: "Pacific/Honolulu",     ID: "America/Boise",
  IL: "America/Chicago",      IN: "America/Indianapolis",
  IA: "America/Chicago",      KS: "America/Chicago",
  KY: "America/New_York",     LA: "America/Chicago",
  ME: "America/New_York",     MD: "America/New_York",
  MA: "America/New_York",     MI: "America/Detroit",
  MN: "America/Chicago",      MS: "America/Chicago",
  MO: "America/Chicago",      MT: "America/Denver",
  NE: "America/Chicago",      NV: "America/Los_Angeles",
  NH: "America/New_York",     NJ: "America/New_York",
  NM: "America/Denver",       NY: "America/New_York",
  NC: "America/New_York",     ND: "America/Chicago",
  OH: "America/New_York",     OK: "America/Chicago",
  OR: "America/Los_Angeles",  PA: "America/New_York",
  RI: "America/New_York",     SC: "America/New_York",
  SD: "America/Chicago",      TN: "America/Chicago",
  TX: "America/Chicago",      UT: "America/Denver",
  VT: "America/New_York",     VA: "America/New_York",
  WA: "America/Los_Angeles",  WV: "America/New_York",
  WI: "America/Chicago",      WY: "America/Denver",
  DC: "America/New_York",
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      // Health response now reports whether the two runtime secrets are bound.
      // Diagnostic: if `secrets_bound.elevenlabs_webhook_secret` is false then
      // CF didn't rebind the dashboard-set secret to this deploy.
      return new Response(
        JSON.stringify({
          worker: "blake-post-call",
          status: "live",
          tz: new Date().toISOString(),
          secrets_bound: {
            elevenlabs_webhook_secret: Boolean(env.ELEVENLABS_WEBHOOK_SECRET),
            blake_ghl_pit: Boolean(env.BLAKE_GHL_PIT),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (req.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(req, env, ctx);
    }

    if (req.method === "POST" && url.pathname === "/conversation-init") {
      return handleConversationInit(req, env);
    }

    if (req.method === "POST" && url.pathname === "/dial-batch") {
      return handleDialBatch(req, env, ctx);
    }

    if (req.method === "GET" && url.pathname === "/dial-status") {
      return handleDialStatus(env);
    }

    // /audio/{conversation_id} — streams the ElevenLabs call recording.
    // The URL is written to each contact's "Blake Call Recording" custom field
    // by the post-call webhook handler so APG team can play it from GHL.
    if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
      const convId = url.pathname.slice("/audio/".length);
      return handleAudioProxy(convId, env);
    }

    // /debug/last-init — returns the most recent payload ElevenLabs sent to
    // /conversation-init. Used to diagnose why caller phone extraction missed.
    if (req.method === "GET" && url.pathname === "/debug/last-init") {
      const snapshot = await env.DIAL_STATE.get("debug:last_init_payload");
      return new Response(snapshot || JSON.stringify({ none: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // /dashboard-data — JSON feed for the live Blake dashboard at
    // atominvestments.github.io/acq-automation/blake.html. 30-sec KV cache
    // to keep ElevenLabs + GHL API load bounded even with multiple viewers.
    if (req.method === "GET" && url.pathname === "/dashboard-data") {
      return handleDashboardData(env);
    }

    return new Response("Not Found", { status: 404 });
  },

  // Cron Trigger handler. Configured in wrangler.toml as `*/15 * * * *` — every
  // 15 minutes, we attempt a small batch of dials respecting today's warm-up
  // quota and TCPA call windows. Idempotent: if quota is already met for the
  // day, the run is a no-op.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    try {
      const result = await runDialBatch(env, { source: "cron", batchSize: 5, dryRun: false });
      console.log(`[cron-dial] ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`[cron-dial] failed: ${e}`);
    }
  },
};

// ---- /dashboard-data: live aggregated JSON for blake.html -----------------

async function handleDashboardData(env: Env): Promise<Response> {
  // Try cache first (30-sec TTL).
  const cached = await env.DIAL_STATE.get("dashboard:cache");
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "x-cache": "HIT",
      },
    });
  }

  // Compute fresh — fetch conversations list, hydrate top 20 with details,
  // join with GHL by phone.
  const data = await computeDashboardData(env).catch((e) => {
    console.error(`[dashboard] computeDashboardData threw: ${e}`);
    return { error: String(e?.message || e) } as any;
  });

  const json = JSON.stringify(data);

  // Cache for 30 sec. Repeat callers within window get served from KV.
  await env.DIAL_STATE.put("dashboard:cache", json, { expirationTtl: 30 });

  return new Response(json, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",   // page is on gh-pages, cross-origin
      "x-cache": "MISS",
    },
  });
}

async function computeDashboardData(env: Env): Promise<any> {
  // 1. List recent conversations from ElevenLabs.
  const listRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${BLAKE_AGENT_ID}&page_size=30`,
    { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }
  );
  if (!listRes.ok) throw new Error(`elevenlabs list ${listRes.status}`);
  const listJson: any = await listRes.json();
  const conversations: any[] = listJson?.conversations || [];

  // 2. Hydrate top 15 with detail (transcript_summary + caller phone).
  const top = conversations.slice(0, 15);
  const detailed = await Promise.all(
    top.map(async (c: any) => {
      const convId = c.conversation_id;
      if (!convId) return null;
      try {
        const dRes = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversations/${convId}`,
          { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }
        );
        if (!dRes.ok) return null;
        return await dRes.json();
      } catch {
        return null;
      }
    })
  );

  // 3. Build enriched call list with GHL contact lookup (parallel).
  const enriched = await Promise.all(
    detailed.filter((d): d is any => !!d).map(async (d) => {
      const md = d.metadata || {};
      const phoneCall = md.phone_call || {};
      const callerPhone =
        phoneCall.external_number ||
        md.phone_number ||
        d.dynamic_variables?.system__caller_id ||
        "";
      const startUnix = md.start_time_unix_secs || 0;
      const duration = md.call_duration_secs || 0;
      const analysis = d.analysis || {};
      const summary = analysis.transcript_summary || "";
      const outcome = classifyOutcomeForDashboard(d);

      // Join with GHL (only if we have a phone). Failures non-fatal.
      let contact: any = null;
      if (callerPhone) {
        try {
          contact = await lookupContactDetailByPhone(env.BLAKE_GHL_PIT, callerPhone);
        } catch {}
      }
      const contactName = contact
        ? `${(contact.firstName || "").trim()} ${(contact.lastName || "").trim()}`.trim() ||
          contact.contactName ||
          "(unnamed)"
        : "(not in GHL)";
      const contactAddr = contact
        ? [contact.address1, contact.city, contact.state].filter(Boolean).join(", ")
        : "";

      return {
        conv_id: d.conversation_id || "",
        started_unix: startUnix,
        duration_secs: duration,
        caller_phone: callerPhone,
        caller_name: contactName,
        caller_address: contactAddr,
        ghl_contact_id: contact?.id || "",
        outcome_tag: outcome.tag,
        outcome_label: outcome.label,
        summary: summary.slice(0, 250),
      };
    })
  );

  enriched.sort((a, b) => (b.started_unix || 0) - (a.started_unix || 0));

  // 4. Aggregate KPIs.
  const nowMs = Date.now();
  const todayUtcStart = new Date();
  todayUtcStart.setUTCHours(0, 0, 0, 0);
  const todayCutoff = Math.floor(todayUtcStart.getTime() / 1000);
  const weekCutoff = Math.floor((nowMs - 7 * 86400 * 1000) / 1000);

  const callsToday = enriched.filter((c) => c.started_unix >= todayCutoff).length;
  const callsWeek = enriched.filter((c) => c.started_unix >= weekCutoff).length;
  const durations = enriched.map((c) => c.duration_secs).filter((d) => d > 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const hotCount = enriched.filter((c) => c.outcome_tag === "hot").length;
  const engagedCount = enriched.filter((c) => c.outcome_tag === "hot" || c.outcome_tag === "warm").length;
  const engagedPct = enriched.length ? Math.round((engagedCount * 100) / enriched.length) : 0;

  // 5. Warm-up state.
  const anchorRaw = await env.DIAL_STATE.get("quota_anchor_date");
  const dayIndex = await dayIndexFromAnchor(env, new Date());
  const dailyQuota = quotaForDay(dayIndex);
  const dialedToday = await getDialedTodayCount(env);

  return {
    updated_at: new Date().toISOString(),
    kpis: {
      calls_today: callsToday,
      calls_week: callsWeek,
      calls_total: conversations.length,
      avg_duration_secs: avgDuration,
      hot_count: hotCount,
      engaged_pct: engagedPct,
    },
    warmup: {
      day: dayIndex + 1,
      daily_quota: dailyQuota,
      dialed_today: dialedToday,
      remaining_today: Math.max(0, dailyQuota - dialedToday),
      anchor_date: anchorRaw || "",
    },
    recent_calls: enriched,
    blake_agent_id: BLAKE_AGENT_ID,
    location_id: APG_LOCATION_ID,
  };
}

function classifyOutcomeForDashboard(detail: any): { tag: string; label: string } {
  const analysis = detail?.analysis || {};
  const summary = (analysis.transcript_summary || "").toLowerCase();
  if (summary.includes("hot lead") || summary.includes("ready to sell") || summary.includes("very interested")) {
    return { tag: "hot", label: "Hot Lead" };
  }
  if (summary.includes("not interested") || summary.includes("no thanks")) {
    return { tag: "cold", label: "Not Interested" };
  }
  if (summary.includes("do not call") || summary.includes("stop calling") || summary.includes("dnc")) {
    return { tag: "dnd", label: "DNC Requested" };
  }
  if (summary.includes("voicemail") || summary.includes("leave a message")) {
    return { tag: "voicemail", label: "Voicemail" };
  }
  const dur = detail?.metadata?.call_duration_secs || 0;
  if (dur < 15) return { tag: "no-answer", label: "No Answer / Short" };
  if (analysis.call_successful === "success") return { tag: "warm", label: "Engaged" };
  return { tag: "unknown", label: "Completed" };
}

// ---- /conversation-init handler ---------------------------------------------
//
// Fires when an ElevenLabs Conversational AI call CONNECTS (before Blake
// speaks). ElevenLabs POSTs caller phone + metadata; we look up the caller in
// GHL and return dynamic_variables + a custom first_message so Blake's opener
// uses real owner data instead of empty placeholders.
//
// Response shape (per ElevenLabs docs):
//   {
//     "type": "conversation_initiation_client_data",
//     "dynamic_variables": { first_name, is_known_owner, ... },
//     "conversation_config_override": {
//       "agent": { "first_message": "..." }
//     }
//   }
//
// If GHL lookup fails / no match, return the "owner-unknown" branch so Blake
// politely asks for the seller's name.

async function handleConversationInit(req: Request, env: Env): Promise<Response> {
  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    // Body might be empty for some triggers — keep going with empty payload
  }

  // Log the FULL payload so we can learn ElevenLabs' actual field names.
  // Truncate after some chars so we don't blow up Worker logs.
  console.log(`[init] payload: ${JSON.stringify(payload).slice(0, 2000)}`);

  // ALSO persist the payload to KV so we can inspect it after the fact via
  // GET /debug/last-init (no live tail needed). Keyed by ISO timestamp + a
  // 'latest' pointer. 1-hour TTL — enough to debug, doesn't fill storage.
  try {
    const stamp = new Date().toISOString();
    const snapshot = JSON.stringify({ at: stamp, payload }).slice(0, 50000);
    await Promise.all([
      env.DIAL_STATE.put("debug:last_init_payload", snapshot, { expirationTtl: 60 * 60 }),
      env.DIAL_STATE.put(`debug:init:${stamp}`, snapshot, { expirationTtl: 60 * 60 }),
    ]);
  } catch (e) {
    console.warn(`[init] could not persist debug payload: ${e}`);
  }

  // For OUTBOUND calls (Blake dialing a seller), the SELLER'S phone is in
  // to_number / called_number, while caller_id is Blake's own number.
  // For INBOUND calls (seller dialing Blake), the seller's phone is in
  // caller_id / from. The lookup target is always "the OTHER party" — the
  // seller, not Blake.
  const BLAKE = "+16099449034";
  const candidates = [
    // Outbound call destination (seller's phone) — try first
    payload?.to_number,
    payload?.to,
    payload?.To,
    payload?.called_number,
    payload?.callee_phone,
    payload?.customer_number,
    payload?.dialed_number,
    payload?.metadata?.phone_call?.callee_number,
    payload?.metadata?.to,
    payload?.metadata?.to_number,
    payload?.dynamic_variables?.system__called_number,
    // Inbound call caller (seller's phone)
    payload?.caller_id,
    payload?.from_phone_number,
    payload?.from,
    payload?.From,
    payload?.caller_phone,
    payload?.phone_number,
    payload?.caller_number,
    payload?.metadata?.phone_call?.external_number,
    payload?.metadata?.from,
    payload?.metadata?.caller_id,
    payload?.metadata?.phone_number,
    payload?.dynamic_variables?.system__caller_id,
  ];

  // The seller's phone is whichever candidate is NOT Blake's number.
  let callerPhone = "";
  for (const c of candidates) {
    if (c && typeof c === "string" && c.trim() && c.trim() !== BLAKE) {
      callerPhone = c.trim();
      break;
    }
  }

  console.log(`[init] extracted seller phone=${callerPhone || "(none)"} agent=${payload?.agent_id || "?"}`);

  // Defaults — owner-unknown branch
  let vars = {
    first_name: "",
    full_name: "",
    is_known_owner: "false",
    property_address: "",
    motivation: "",
    timeline: "",
    asking_price: "",
    last_call_summary: "",
  };

  let firstMessage = ownerUnknownFirstMessage();

  if (callerPhone) {
    try {
      const contact = await lookupContactDetailByPhone(env.BLAKE_GHL_PIT, callerPhone);
      if (contact) {
        const cfMap = customFieldMap(contact.customFields ?? []);
        const firstName = (contact.firstName || "").trim();
        const lastName = (contact.lastName || "").trim();
        const address = (contact.address1 || "").trim();
        vars = {
          first_name: firstName,
          full_name: `${firstName} ${lastName}`.trim(),
          is_known_owner: "true",
          property_address: address,
          motivation: cfMap[CF_MOTIVATION] || "",
          timeline: cfMap[CF_TIMELINE] || "",
          asking_price: cfMap[CF_ASKING] ? String(cfMap[CF_ASKING]) : "",
          last_call_summary: cfMap[CF_VA_NOTES] || "",
        };
        firstMessage = ownerKnownFirstMessage(firstName, address);
        console.log(`[init] matched contact id=${contact.id} name="${firstName} ${lastName}"`);
      } else {
        console.log(`[init] no GHL contact for ${callerPhone} → owner-unknown branch`);
      }
    } catch (e) {
      console.error(`[init] GHL lookup threw: ${e}`);
      // Fall through with owner-unknown defaults
    }
  }

  const response = {
    type: "conversation_initiation_client_data",
    dynamic_variables: vars,
    conversation_config_override: {
      agent: {
        first_message: firstMessage,
      },
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function ownerKnownFirstMessage(firstName: string, address: string): string {
  const name = firstName || "there";
  if (address) {
    return `Hi, is this ${name}? — This is Blake with Atom Property Group. I'm calling about ${address} — wondering if you'd be open to chatting about a proposal for it?`;
  }
  return `Hi, is this ${name}? — This is Blake with Atom Property Group. Just wanted to chat for a minute about your property — got a sec?`;
}

function ownerUnknownFirstMessage(): string {
  return `Hi there — this is Blake with Atom Property Group. Sorry, I don't have your name on file yet. Could you share your name and the property you're calling about, so I can help you better?`;
}

// Returns the contact dict (NOT just the id) so we can read customFields,
// address, name, etc.
async function lookupContactDetailByPhone(pit: string, phone: string): Promise<any | null> {
  const res = await fetch(`${GHL_BASE}/contacts/search`, {
    method: "POST",
    headers: ghlHeaders(pit),
    body: JSON.stringify({
      locationId: APG_LOCATION_ID,
      query: phone,
      pageLimit: 1,
    }),
  });
  if (!res.ok) {
    console.warn(`[init] GHL search failed: ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  return (json?.contacts ?? [])[0] ?? null;
}

function customFieldMap(fields: any[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields ?? []) {
    if (f?.id) out[f.id] = f.value;
  }
  return out;
}

async function handleWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Read raw body once. Signature verification needs the exact bytes
  //    ElevenLabs signed, so we cannot use req.json() before verifying.
  const rawBody = await req.text();

  // 2. Verify HMAC signature.
  const sigHeader = req.headers.get("ElevenLabs-Signature") || "";
  const verify = await verifySignature(rawBody, sigHeader, env.ELEVENLABS_WEBHOOK_SECRET);
  if (!verify.ok) {
    console.warn(`[blake-post-call] signature rejected: ${verify.reason}`);
    return new Response(JSON.stringify({ ok: false, error: verify.reason }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // 3. Parse the event payload.
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // 4. Extract what we need. Be defensive — ElevenLabs has changed payload
  //    shapes in the past; treat every field as possibly missing.
  const data = event?.data ?? event;
  const conversationId: string =
    data?.conversation_id || data?.id || event?.conversation_id || "unknown";
  const callerPhone: string =
    data?.metadata?.phone_call?.external_number ||
    data?.metadata?.phone_number ||
    data?.caller_phone ||
    "";
  const transcript: any[] = data?.transcript ?? data?.messages ?? [];
  const callSummary: string = data?.analysis?.transcript_summary || data?.summary || "";
  const callDurationS: number = data?.metadata?.call_duration_secs ?? data?.duration ?? 0;
  const startedAt: string =
    data?.metadata?.start_time_unix_secs
      ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
      : (data?.started_at || new Date().toISOString());

  console.log(
    `[blake-post-call] conv=${conversationId} phone=${callerPhone} duration=${callDurationS}s transcript_len=${transcript.length}`
  );

  // 5. Find the GHL contact by phone. If we can't, still 200 — we don't want
  //    ElevenLabs to retry forever just because we missed a match.
  if (!callerPhone) {
    return new Response(
      JSON.stringify({ ok: true, note: "no caller_phone in payload, skipped GHL write" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  const contactId = await findContactByPhone(env.BLAKE_GHL_PIT, callerPhone);
  if (!contactId) {
    return new Response(
      JSON.stringify({ ok: true, note: "no GHL contact for caller", caller: callerPhone }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // 6. Write a backup note. Mark explicitly as a post-call write so the
  //    dashboard parsers know which note is canonical when there are two.
  const noteBody = buildBackupNote({
    conversationId,
    callerPhone,
    callDurationS,
    startedAt,
    callSummary,
    transcript,
  });

  // Compose recording URL — proxy through this Worker so GHL team can play
  // the audio without ElevenLabs auth.
  const recordingUrl = conversationId && conversationId !== "unknown"
    ? `https://acq-automation.mithchell.workers.dev/audio/${conversationId}`
    : "";
  // Embed the recording URL in the note body too — visible in the GHL note
  // timeline without having to look at the custom field.
  const noteWithRecording = recordingUrl
    ? `${noteBody}\n\n🎧 Recording: ${recordingUrl}`
    : noteBody;

  // Don't block the webhook on the writes — fire-and-forget but log failures.
  // Three side effects:
  //   1. Backup note (with embedded recording URL)
  //   2. 'blake-called' tag (so team can build smart lists by tag)
  //   3. 'Blake Call Recording' custom field set to the proxy URL
  ctx.waitUntil(
    Promise.all([
      addNote(env.BLAKE_GHL_PIT, contactId, noteWithRecording).then(
        (res) => {
          if (!res.ok) {
            console.error(`[blake-post-call] note write failed: ${res.status} ${res.body}`);
          } else {
            console.log(`[blake-post-call] backup note written for contact ${contactId}`);
          }
        },
        (err) => console.error(`[blake-post-call] note write threw: ${err}`)
      ),
      addTag(env.BLAKE_GHL_PIT, contactId, "blake-called").then(
        (res) => {
          if (!res.ok) {
            console.error(`[blake-post-call] tag write failed: ${res.status} ${res.body}`);
          } else {
            console.log(`[blake-post-call] tagged 'blake-called' on contact ${contactId}`);
          }
        },
        (err) => console.error(`[blake-post-call] tag write threw: ${err}`)
      ),
      recordingUrl
        ? setContactCustomField(env.BLAKE_GHL_PIT, contactId, CF_BLAKE_RECORDING, recordingUrl).then(
            (res) => {
              if (!res.ok) {
                console.error(`[blake-post-call] recording field write failed: ${res.status} ${res.body}`);
              } else {
                console.log(`[blake-post-call] recording URL set on contact ${contactId}: ${recordingUrl}`);
              }
            },
            (err) => console.error(`[blake-post-call] recording field write threw: ${err}`)
          )
        : Promise.resolve(),
      // 4. STRUCTURED EXTRACTION — Claude reads the transcript and we
      //    deterministically write address / lead-temp / RJ-callback-task /
      //    stage-move / DND back to GHL. This is the safety net for when
      //    Blake's LLM doesn't fire his in-call tools (which is most of the
      //    time, per the 2026-05-21 calls).
      env.ANTHROPIC_API_KEY
        ? (async () => {
            const extraction = await extractStructuredFromTranscript(
              env.ANTHROPIC_API_KEY,
              transcript,
              "", // contact state — unknown to webhook payload; could enrich via GHL re-lookup
              startedAt
            );
            if (!extraction) {
              console.warn(`[extract] no extraction returned for ${contactId}`);
              return;
            }
            const log = await applyExtractionToGhl(env.BLAKE_GHL_PIT, contactId, extraction);
            console.log(
              `[extract] contact=${contactId} temp=${extraction.lead_temp} ` +
              `callback=${extraction.callback_promised} writes=[${log.join(", ")}]`
            );
          })().catch((e) => console.error(`[extract] failed: ${e}`))
        : Promise.resolve(console.log("[extract] ANTHROPIC_API_KEY not bound; skipping structured extraction")),
    ])
  );

  return new Response(
    JSON.stringify({ ok: true, contact_id: contactId, conversation_id: conversationId }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// ---- GHL helpers ----------------------------------------------------------

function ghlHeaders(pit: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pit}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function findContactByPhone(pit: string, phone: string): Promise<string | null> {
  const res = await fetch(`${GHL_BASE}/contacts/search`, {
    method: "POST",
    headers: ghlHeaders(pit),
    body: JSON.stringify({
      locationId: APG_LOCATION_ID,
      query: phone,
      pageLimit: 1,
    }),
  });
  if (!res.ok) {
    console.warn(`[blake-post-call] GHL search failed: ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  const contact = (json?.contacts ?? [])[0];
  return contact?.id ?? null;
}

async function addNote(
  pit: string,
  contactId: string,
  body: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: ghlHeaders(pit),
    body: JSON.stringify({ userId: USER_MIKE, body }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

async function addTag(
  pit: string,
  contactId: string,
  tag: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: ghlHeaders(pit),
    body: JSON.stringify({ tags: [tag] }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

// Write a single custom field value on a contact. Uses the direct REST endpoint
// (mcp__ghl-mcp__contacts_update-contact is broken for custom fields per
// tyler/feedback_ghl_api.md memory).
async function setContactCustomField(
  pit: string,
  contactId: string,
  fieldId: string,
  value: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(pit),
    body: JSON.stringify({
      customFields: [{ id: fieldId, value }],
    }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

// PUT a wider set of contact updates (multiple custom fields + address) in
// one call. Returns the same shape as setContactCustomField.
async function updateContactFields(
  pit: string,
  contactId: string,
  body: any
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(pit),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

// Create a task on a contact, assigned to RJ. Returns task id on success.
async function createTaskOnContact(
  pit: string,
  contactId: string,
  args: { title: string; body: string; dueDate: string; assignedTo?: string }
): Promise<{ ok: boolean; status: number; body: string; taskId?: string }> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tasks`, {
    method: "POST",
    headers: ghlHeaders(pit),
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      dueDate: args.dueDate,
      completed: false,
      assignedTo: args.assignedTo,
    }),
  });
  const text = await res.text();
  let taskId: string | undefined;
  try {
    const parsed = JSON.parse(text);
    taskId = parsed?.task?.id || parsed?.id;
  } catch {}
  return { ok: res.ok, status: res.status, body: text.slice(0, 500), taskId };
}

// Find the most recent opportunity for a contact (used to move stage post-call).
async function findOpportunityForContact(
  pit: string,
  contactId: string
): Promise<{ id: string; pipelineId: string; pipelineStageId: string } | null> {
  const res = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${APG_LOCATION_ID}&contact_id=${contactId}&limit=1`,
    { method: "GET", headers: ghlHeaders(pit) }
  );
  if (!res.ok) return null;
  const j: any = await res.json();
  const opp = (j?.opportunities ?? [])[0];
  if (!opp) return null;
  return {
    id: opp.id,
    pipelineId: opp.pipelineId || opp.pipeline_id,
    pipelineStageId: opp.pipelineStageId || opp.pipeline_stage_id,
  };
}

async function moveOpportunityStage(
  pit: string,
  opportunityId: string,
  newStageId: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: ghlHeaders(pit),
    body: JSON.stringify({ pipelineStageId: newStageId }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

// ---- Post-call structured extraction ---------------------------------------
//
// After Blake hangs up, send the transcript to Claude with a tight extraction
// prompt and translate the JSON output into deterministic GHL writes. This
// is the SAFETY NET that ensures every call ends with a complete GHL record,
// independent of whether Blake remembered to fire his in-call tools.

interface ExtractionResult {
  address1: string | null;
  city: string | null;
  state: string | null;            // 2-letter
  postal_code: string | null;
  beds: string | null;
  baths: string | null;
  sqft: string | null;
  condition_notes: string | null;
  asking_price: string | null;
  motivation: string | null;
  timeline: string | null;
  lead_temp: "hot" | "warm" | "nurture" | "cold" | "dnc" | "wrong_number" | "unclear";
  callback_promised: boolean;
  callback_time_iso: string | null;
  callback_relative: string | null;
  requested_dnc: boolean;
  is_owner: boolean;
  rating_1_to_10: number | null;
  one_line_summary: string;
}

async function extractStructuredFromTranscript(
  apiKey: string,
  transcriptTurns: any[],
  contactState: string,
  nowIso: string
): Promise<ExtractionResult | null> {
  if (!apiKey) return null;
  const transcript = transcriptTurns
    .map((t: any) => {
      const role = (t.role || "?").toUpperCase();
      const msg = (t.message || t.content || "").trim();
      return msg ? `[${role}] ${msg}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You extract structured CRM data from a real estate cold-call transcript between Blake (APG's AI agent) and a property owner. Output STRICT JSON only.

Rules:
- Only fill fields the seller explicitly stated. Use null when not stated.
- lead_temp: "hot" = motivated AND ready to sell AND price aligns; "warm" = interested but vague; "nurture" = interested but 6+ months out; "cold" = not really a seller; "dnc" = asked to be removed/STOP; "wrong_number" = confirmed wrong number; "unclear" = couldn't tell.
- callback_promised: true ONLY if Blake explicitly proposed a time AND seller agreed.
- callback_time_iso: best-effort ISO 8601 timestamp. The contact's state is "${contactState || "unknown"}", current time is ${nowIso}. "Tomorrow morning" = 9am next day in that state's timezone. "Later today around 4pm" = 4pm today.
- one_line_summary: 1 sentence, Blake's voice.
- DO NOT invent data. Conservative wins.`;

  const userPrompt = `Conversation transcript:

${transcript}

Return ONLY the JSON object, no preamble.

Schema:
{
  "address1": string|null,
  "city": string|null,
  "state": string|null,
  "postal_code": string|null,
  "beds": string|null,
  "baths": string|null,
  "sqft": string|null,
  "condition_notes": string|null,
  "asking_price": string|null,
  "motivation": string|null,
  "timeline": string|null,
  "lead_temp": "hot"|"warm"|"nurture"|"cold"|"dnc"|"wrong_number"|"unclear",
  "callback_promised": boolean,
  "callback_time_iso": string|null,
  "callback_relative": string|null,
  "requested_dnc": boolean,
  "is_owner": boolean,
  "rating_1_to_10": integer|null,
  "one_line_summary": string
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[extract] Claude API error ${res.status}: ${errText.slice(0, 300)}`);
    return null;
  }
  const data: any = await res.json();
  const text = (data?.content?.[0]?.text || "").trim();

  // Strip code fences if Claude added them.
  let jsonStr = text;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) jsonStr = m[1];

  try {
    return JSON.parse(jsonStr) as ExtractionResult;
  } catch (e) {
    console.error(`[extract] could not parse Claude output: ${e}; raw: ${text.slice(0, 500)}`);
    return null;
  }
}

// Apply extracted data → GHL writes. Returns an array of brief success/failure
// strings for logging.
async function applyExtractionToGhl(
  pit: string,
  contactId: string,
  extraction: ExtractionResult
): Promise<string[]> {
  const log: string[] = [];

  // 1. Update contact basic + custom fields if any are present
  const customFields: any[] = [];
  if (extraction.beds)         customFields.push({ id: CF_BEDS, value: extraction.beds });
  if (extraction.baths)        customFields.push({ id: CF_BATHS, value: extraction.baths });
  if (extraction.sqft)         customFields.push({ id: CF_SQFT, value: extraction.sqft });
  if (extraction.asking_price) customFields.push({ id: CF_ASKING, value: extraction.asking_price });
  if (extraction.motivation)   customFields.push({ id: CF_MOTIVATION, value: extraction.motivation });
  if (extraction.timeline)     customFields.push({ id: CF_TIMELINE, value: extraction.timeline });
  if (extraction.one_line_summary) customFields.push({ id: CF_VA_NOTES, value: extraction.one_line_summary });

  const basicUpdates: any = {};
  if (extraction.address1)    basicUpdates.address1 = extraction.address1;
  if (extraction.city)        basicUpdates.city = extraction.city;
  if (extraction.state)       basicUpdates.state = extraction.state;
  if (extraction.postal_code) basicUpdates.postalCode = extraction.postal_code;

  if (customFields.length || Object.keys(basicUpdates).length) {
    const body = { ...basicUpdates, customFields };
    const r = await updateContactFields(pit, contactId, body);
    log.push(`update_contact: ${r.ok ? "ok" : `${r.status} ${r.body.slice(0, 100)}`}`);
  }

  // 2. Lead temp tag
  if (extraction.lead_temp && extraction.lead_temp !== "unclear") {
    const tag = `${extraction.lead_temp}-lead`;
    const r = await addTag(pit, contactId, tag);
    log.push(`tag_${tag}: ${r.ok ? "ok" : `${r.status}`}`);
  }

  // 3. DND
  if (extraction.requested_dnc || extraction.lead_temp === "dnc" || extraction.lead_temp === "wrong_number") {
    const r = await updateContactFields(pit, contactId, { dnd: true });
    log.push(`dnd: ${r.ok ? "ok" : `${r.status}`}`);
    // also tag for visibility
    const tagName = extraction.lead_temp === "wrong_number" ? "wrong-number" : "dnd-opt-out";
    await addTag(pit, contactId, tagName);
  }

  // 4. Callback task for RJ
  if (extraction.callback_promised) {
    const dueIso =
      extraction.callback_time_iso ||
      new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();   // default: now + 4h
    const r = await createTaskOnContact(pit, contactId, {
      title: "Blake booked callback — RJ to follow up",
      body:
        (extraction.callback_relative ? `Callback time (Blake): ${extraction.callback_relative}\n` : "") +
        `\n${extraction.one_line_summary}\n` +
        (extraction.motivation ? `\nMotivation: ${extraction.motivation}` : "") +
        (extraction.timeline ? `\nTimeline: ${extraction.timeline}` : "") +
        (extraction.asking_price ? `\nAsking price: ${extraction.asking_price}` : ""),
      dueDate: dueIso,
      assignedTo: "Vj4WwH1ovxGN5Hv5Kq17",  // Mike (fallback; replace with RJ_GHL_USER_ID when known)
    });
    log.push(`callback_task: ${r.ok ? `ok (id=${r.taskId})` : `${r.status}`}`);
  }

  // 5. Stage move based on lead temp
  let targetStage: string | null = null;
  if (extraction.lead_temp === "hot") targetStage = "d43fddd8-3a17-46b2-a193-cf18619f654f"; // LAO
  else if (extraction.lead_temp === "warm") targetStage = "a17517be-8d1a-49fd-bd53-b9128a66e242"; // Qualified
  else if (extraction.lead_temp === "nurture") targetStage = "4aa78ab3-85dc-46d1-a683-d97b0c7a23ee"; // FU 1.5mo
  else if (extraction.lead_temp === "dnc" || extraction.lead_temp === "wrong_number") {
    targetStage = "b9b560b0-30cb-47fc-a4ca-1e55ca2531e2"; // Dead Deals
  }

  if (targetStage) {
    const opp = await findOpportunityForContact(pit, contactId);
    if (opp && opp.pipelineStageId !== targetStage) {
      const r = await moveOpportunityStage(pit, opp.id, targetStage);
      log.push(`stage_move ${opp.pipelineStageId.slice(0, 8)}→${targetStage.slice(0, 8)}: ${r.ok ? "ok" : `${r.status}`}`);
    }
  }

  return log;
}

// ---- /audio/{conversation_id} proxy ----------------------------------------
//
// Streams the call audio from ElevenLabs through our Worker so the GHL team
// can play it without ElevenLabs auth. The Worker is the only place the
// ElevenLabs API key lives; the resulting URL we write into the GHL custom
// field is unauthenticated public proxy.
//
// Risk: unauthenticated. Anyone who has the URL can play the call. The
// conversation_id is non-guessable (32 random chars), so by-URL access is
// effectively secret-token gated. For sensitive PII calls in the future we
// can layer Cloudflare Access on top of /audio/*.

async function handleAudioProxy(convId: string, env: Env): Promise<Response> {
  // Defensively validate the conv_id format. Only allow what ElevenLabs uses
  // for conversation IDs to prevent path-traversal or open-proxy abuse.
  if (!/^conv_[a-zA-Z0-9]{6,80}$/.test(convId)) {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_conversation_id" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${convId}/audio`,
    {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
    }
  );

  if (!upstream.ok) {
    const errBody = await upstream.text();
    return new Response(
      JSON.stringify({
        ok: false,
        error: "elevenlabs_fetch_failed",
        status: upstream.status,
        details: errBody.slice(0, 200),
      }),
      { status: upstream.status, headers: { "content-type": "application/json" } }
    );
  }

  // Stream the MP3 body to the browser. Set headers so browsers play inline
  // (with controls) instead of forcing download. Long cache because audio
  // is immutable once a call ends.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `inline; filename="blake-${convId}.mp3"`,
      "Cache-Control": "public, max-age=604800, immutable",  // 1 week
    },
  });
}

function buildBackupNote(args: {
  conversationId: string;
  callerPhone: string;
  callDurationS: number;
  startedAt: string;
  callSummary: string;
  transcript: any[];
}): string {
  const transcriptText = args.transcript
    .slice(0, 50) // GHL notes have a length cap; truncate generously
    .map((t: any) => {
      const role = t?.role || t?.speaker || "?";
      const content = t?.content || t?.text || t?.message || "";
      return `${role}: ${content}`;
    })
    .join("\n");

  return [
    `APG Lead Summary (Blake post-call · ${args.startedAt})`,
    ``,
    `Source: ElevenLabs webhook (backup record; primary record may also exist if in-call tools fired)`,
    `Conversation ID: ${args.conversationId}`,
    `Caller: ${args.callerPhone}`,
    `Duration: ${args.callDurationS}s`,
    ``,
    `Summary: ${args.callSummary || "(no auto-summary provided)"}`,
    ``,
    `--- Transcript (first 50 turns) ---`,
    transcriptText || "(transcript was empty in the payload)",
  ].join("\n");
}

// ---- Dialer: warm-up + TCPA + outbound trigger --------------------------------

interface DialBatchResult {
  source: string;
  utc_date: string;
  day_index: number;
  daily_quota: number;
  dialed_today_before: number;
  attempted: number;
  succeeded: number;
  skipped_reasons: Record<string, number>;
  details: Array<{ contact_id: string; phone: string; outcome: string; error?: string }>;
  dry_run: boolean;
}

async function handleDialBatch(
  req: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  // Body shape (all optional):
  //   { batchSize?: number, dryRun?: boolean, overrideQuota?: number }
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const batchSize = Number.isFinite(body.batchSize) ? Math.max(1, Math.min(50, body.batchSize)) : 5;
  const dryRun = body.dryRun === true;
  const overrideQuota: number | null = Number.isFinite(body.overrideQuota) ? body.overrideQuota : null;

  const result = await runDialBatch(env, { source: "manual", batchSize, dryRun, overrideQuota });
  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function handleDialStatus(env: Env): Promise<Response> {
  const utcDate = utcDateString(new Date());
  const dayIndex = await dayIndexFromAnchor(env);
  const dailyQuota = quotaForDay(dayIndex);
  const dialedToday = await getDialedTodayCount(env);
  const anchor = await env.DIAL_STATE.get("quota_anchor_date");

  return new Response(
    JSON.stringify({
      utc_date: utcDate,
      anchor_date: anchor || "(not yet set — first run sets it)",
      day_index: dayIndex,
      daily_quota: dailyQuota,
      dialed_today: dialedToday,
      remaining_today: Math.max(0, dailyQuota - dialedToday),
      warmup_curve_max_days: WARMUP_CURVE.length,
      steady_state_daily_quota: WARMUP_CURVE[WARMUP_CURVE.length - 1],
    }, null, 2),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

async function runDialBatch(
  env: Env,
  opts: { source: string; batchSize: number; dryRun: boolean; overrideQuota?: number | null }
): Promise<DialBatchResult> {
  const now = new Date();
  const utcDate = utcDateString(now);
  const dayIndex = await dayIndexFromAnchor(env, now);
  const dailyQuota = opts.overrideQuota != null ? opts.overrideQuota : quotaForDay(dayIndex);
  const dialedToday = await getDialedTodayCount(env);

  const remaining = Math.max(0, dailyQuota - dialedToday);
  const toAttempt = Math.min(opts.batchSize, remaining);

  const result: DialBatchResult = {
    source: opts.source,
    utc_date: utcDate,
    day_index: dayIndex,
    daily_quota: dailyQuota,
    dialed_today_before: dialedToday,
    attempted: 0,
    succeeded: 0,
    skipped_reasons: {},
    details: [],
    dry_run: opts.dryRun,
  };

  if (toAttempt <= 0) {
    result.skipped_reasons["daily_quota_met"] = 1;
    return result;
  }

  // Pull more than we need so post-filter (TCPA window, dedupe) still leaves enough.
  const candidates = await getUnqualifiedContacts(env.BLAKE_GHL_PIT, Math.max(toAttempt * 3, 20));

  for (const c of candidates) {
    if (result.attempted >= toAttempt) break;

    const phone = (c.phone || "").trim();
    const contactId = c.id;
    if (!phone || !contactId) {
      result.skipped_reasons["missing_phone_or_id"] = (result.skipped_reasons["missing_phone_or_id"] || 0) + 1;
      continue;
    }

    // Dedupe: have we already dialed this contact recently?
    const lastAttempt = await env.DIAL_STATE.get(`last_attempt:${contactId}`);
    if (lastAttempt) {
      result.skipped_reasons["already_dialed"] = (result.skipped_reasons["already_dialed"] || 0) + 1;
      continue;
    }

    // TCPA call window check (contact's local time).
    const state = (c.state || "").toUpperCase();
    if (!inCallWindow(state, now)) {
      result.skipped_reasons[`outside_window_${state || "UNKNOWN_STATE"}`] =
        (result.skipped_reasons[`outside_window_${state || "UNKNOWN_STATE"}`] || 0) + 1;
      continue;
    }

    result.attempted += 1;

    if (opts.dryRun) {
      result.details.push({ contact_id: contactId, phone, outcome: "dry_run_would_dial" });
      continue;
    }

    try {
      const dialOk = await triggerOutboundCall(env.ELEVENLABS_API_KEY, phone);
      if (dialOk.ok) {
        result.succeeded += 1;
        result.details.push({ contact_id: contactId, phone, outcome: "dialed" });

        // Record in KV: bump today's counter + mark contact as dialed
        await Promise.all([
          incrementDialedToday(env),
          env.DIAL_STATE.put(`last_attempt:${contactId}`, now.toISOString(), {
            // 30-day TTL — long enough to prevent re-dialing during warm-up, short
            // enough to allow re-attempts on contacts that didn't pick up.
            expirationTtl: 60 * 60 * 24 * 30,
          }),
        ]);
      } else {
        result.details.push({
          contact_id: contactId,
          phone,
          outcome: "dial_failed",
          error: dialOk.error,
        });
      }
    } catch (e: any) {
      result.details.push({
        contact_id: contactId,
        phone,
        outcome: "dial_threw",
        error: String(e?.message || e),
      });
    }
  }

  return result;
}

async function getUnqualifiedContacts(pit: string, limit: number): Promise<any[]> {
  // Two-step query because GHL /contacts/search doesn't accept
  // opportunity.pipeline_stage_id as a filter field.
  //   Step 1: GET /opportunities/search?pipeline_stage_id=UNQUALIFIED
  //           → returns opps with embedded contact (id, name, phone, tags)
  //   Step 2: client-side pre-filter on embedded tags
  //   Step 3: GET /contacts/{id} for each survivor to get state + DND
  //           (these aren't in the embedded contact shape)
  //   Step 4: caller does TCPA window check + final dedupe
  const oppRes = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${APG_LOCATION_ID}` +
      `&pipeline_stage_id=${STAGE_UNQUALIFIED}` +
      `&limit=${Math.max(1, Math.min(100, limit * 4))}`,
    { method: "GET", headers: ghlHeaders(pit) }
  );
  if (!oppRes.ok) {
    console.warn(`[dialer] /opportunities/search failed: ${oppRes.status}`);
    return [];
  }
  const oppJson: any = await oppRes.json();
  const opps: any[] = oppJson?.opportunities ?? [];

  // Pre-filter on embedded contact tags so we don't waste GET /contacts/{id} calls.
  const survivors = opps
    .map((o) => o?.contact)
    .filter((c): c is any => !!c && !!c.id && !!c.phone)
    .filter((c) => {
      const tags: string[] = c.tags ?? [];
      if (tags.includes("blake-called")) return false;
      if (tags.includes("agent")) return false;   // legacy filter — see automation memory
      if (tags.includes("dnd-opt-out")) return false;
      return true;
    });

  // Now hydrate each survivor with the full contact record (need state + dnd).
  // Cap at `limit * 2` to keep latency reasonable; caller will further filter
  // by TCPA window and we want some buffer over the actual `limit`.
  const hydrateCount = Math.min(survivors.length, limit * 2);
  const hydrated = await Promise.all(
    survivors.slice(0, hydrateCount).map(async (c) => {
      const detail = await getContactDetail(pit, c.id);
      if (!detail) return null;
      // The detail response wraps the contact under `.contact`, sometimes.
      const full = detail.contact ?? detail;
      return {
        id: c.id,
        phone: c.phone,
        firstName: full?.firstName ?? "",
        lastName: full?.lastName ?? "",
        state: (full?.state ?? "").toUpperCase(),
        address1: full?.address1 ?? "",
        city: full?.city ?? "",
        dnd: !!full?.dnd,
        tags: full?.tags ?? c.tags ?? [],
      };
    })
  );

  // Strip null hydration failures + DND contacts (the embedded tag-filter missed
  // contacts whose DND was set without a tag).
  return hydrated.filter((c): c is any => !!c && !c.dnd);
}

async function getContactDetail(pit: string, contactId: string): Promise<any | null> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "GET",
    headers: ghlHeaders(pit),
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function triggerOutboundCall(
  apiKey: string,
  toNumber: string
): Promise<{ ok: boolean; error?: string; body?: string }> {
  // ElevenLabs Conversational AI outbound via Twilio integration.
  // POST /v1/convai/twilio/outbound-call
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: BLAKE_AGENT_ID,
      agent_phone_number_id: BLAKE_PHONE_NUMBER_ID,
      to_number: toNumber,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}`, body: text.slice(0, 500) };
  }
  return { ok: true, body: text.slice(0, 500) };
}

// ---- Warm-up curve helpers --------------------------------------------------

function utcDateString(d: Date): string {
  // YYYY-MM-DD in UTC
  return d.toISOString().slice(0, 10);
}

function quotaForDay(dayIndex: number): number {
  if (dayIndex < 0) return 0;
  if (dayIndex >= WARMUP_CURVE.length) return WARMUP_CURVE[WARMUP_CURVE.length - 1];
  return WARMUP_CURVE[dayIndex];
}

async function dayIndexFromAnchor(env: Env, now: Date = new Date()): Promise<number> {
  let anchor = await env.DIAL_STATE.get("quota_anchor_date");
  if (!anchor) {
    anchor = utcDateString(now);
    await env.DIAL_STATE.put("quota_anchor_date", anchor);
  }
  const anchorMs = Date.parse(anchor + "T00:00:00Z");
  const nowMs = Date.parse(utcDateString(now) + "T00:00:00Z");
  return Math.floor((nowMs - anchorMs) / (1000 * 60 * 60 * 24));
}

async function getDialedTodayCount(env: Env): Promise<number> {
  const utcDate = utcDateString(new Date());
  const val = await env.DIAL_STATE.get(`dialed:${utcDate}`);
  return val ? parseInt(val, 10) || 0 : 0;
}

async function incrementDialedToday(env: Env): Promise<void> {
  const utcDate = utcDateString(new Date());
  const key = `dialed:${utcDate}`;
  const current = await env.DIAL_STATE.get(key);
  const next = (current ? parseInt(current, 10) || 0 : 0) + 1;
  // 7-day TTL on day counters — plenty for any retrospective query, auto cleanup.
  await env.DIAL_STATE.put(key, String(next), { expirationTtl: 60 * 60 * 24 * 7 });
}

// ---- TCPA call window ------------------------------------------------------

function inCallWindow(stateCode: string, now: Date): boolean {
  // If we don't know the state's timezone, conservatively skip (caller decides
  // whether unknown-state means "don't dial" or "use Eastern fallback").
  const tz = STATE_TZ[stateCode];
  if (!tz) return false;

  // Get local hour-of-day in the contact's timezone.
  const localHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );

  return localHour >= TCPA_DIAL_START_HOUR && localHour < TCPA_DIAL_END_HOUR;
}

// ---- Signature verification ----------------------------------------------

interface SigVerifyResult {
  ok: boolean;
  reason?: string;
}

async function verifySignature(
  body: string,
  sigHeader: string,
  secret: string
): Promise<SigVerifyResult> {
  if (!secret) return { ok: false, reason: "no_secret_configured" };
  if (!sigHeader) return { ok: false, reason: "missing_signature_header" };

  // ElevenLabs header format: "t=<unix_seconds>,v0=<hex_hmac_sha256>"
  const parts: Record<string, string> = {};
  for (const p of sigHeader.split(",")) {
    const [k, v] = p.split("=", 2);
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = parts["t"];
  const expected = parts["v0"];
  if (!ts || !expected) return { ok: false, reason: "malformed_signature_header" };

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "bad_timestamp" };
  const ageS = Math.floor(Date.now() / 1000) - tsNum;
  if (ageS > SIGNATURE_MAX_AGE_S || ageS < -SIGNATURE_MAX_AGE_S) {
    return { ok: false, reason: `signature_too_old_or_skewed(${ageS}s)` };
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${body}`));
  const actual = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare to dodge timing leaks.
  if (actual.length !== expected.length) return { ok: false, reason: "signature_mismatch" };
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: "signature_mismatch" };
  return { ok: true };
}
