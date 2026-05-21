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

    return new Response("Not Found", { status: 404 });
  },
};

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

  // ElevenLabs uses different field names depending on call source (Twilio vs
  // SIP vs direct). Try them all — added more candidates after observing
  // payloads in the wild.
  const callerPhone: string =
    payload?.caller_id ||
    payload?.from_phone_number ||
    payload?.from ||
    payload?.From ||
    payload?.caller_phone ||
    payload?.phone_number ||
    payload?.caller_number ||
    payload?.metadata?.phone_call?.external_number ||
    payload?.metadata?.from ||
    payload?.metadata?.caller_id ||
    payload?.metadata?.phone_number ||
    payload?.dynamic_variables?.system__caller_id ||
    "";

  console.log(`[init] extracted caller=${callerPhone || "(none)"} agent=${payload?.agent_id || "?"}`);

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

  // Don't block the webhook on the writes — fire-and-forget but log failures.
  // Two side effects: backup note + 'blake-called' tag (so the team can build
  // smart lists / filters in GHL: tag = blake-called → every contact Blake
  // has ever talked to).
  ctx.waitUntil(
    Promise.all([
      addNote(env.BLAKE_GHL_PIT, contactId, noteBody).then(
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
