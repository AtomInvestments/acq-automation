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
  TWILIO_ACCOUNT_SID: string;       // Reserved: Blake outbound dial + future inbound-webhook signature validation
  TWILIO_AUTH_TOKEN: string;        // Reserved: same as above. (Listing-realtor SMS goes via GHL Conversations API, not direct Twilio.)
  SLACK_BOT_TOKEN: string;          // Pillar B: post new-listing alerts to #base1-sms-leadgen
  DASHBOARD_PASSWORD: string;       // Plaintext password for /login (single-tenant, single-user auth)
  DASHBOARD_SESSION_SECRET: string; // HMAC-SHA256 key for signing session cookies
  DIAL_STATE: KVNamespace;          // KV for warm-up quota + dial dedupe
}

const APG_LOCATION_ID = "RCkiUmWqXX4BYQ39JXmm";
const GHL_BASE = "https://services.leadconnectorhq.com";
const USER_MIKE = "Vj4WwH1ovxGN5Hv5Kq17";
const USER_RJ = "EvxJmnll1hlJtzpW14BE";   // Rene Fonseca (RJ) — callback assignee

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

// GHL ACQ pipeline + stage IDs. Source of truth: tyler/project_ghl_acq.md.
const ACQ_PIPELINE_ID = "O8wzIa6E3SgD8HLg6gh9";
const STAGE_UNQUALIFIED   = "c1d23905-7096-439c-9a31-f8db5b2b53d0";
const STAGE_QUALIFIED     = "a17517be-8d1a-49fd-bd53-b9128a66e242";
const STAGE_LAO           = "d43fddd8-3a17-46b2-a193-cf18619f654f";
const STAGE_DEAD          = "b9b560b0-30cb-47fc-a4ca-1e55ca2531e2";
const STAGE_FU_1_5MO      = "4aa78ab3-85dc-46d1-a683-d97b0c7a23ee";

// Realtor Listings pipeline (Pillar B). Created 2026-05-21.
const REALTOR_LISTINGS_PIPELINE_ID = "Br9cCXPJRNvtm3egHmwh";
const RL_STAGE_NEW_LISTING     = "344694da-14cf-4f09-b690-67f07b4e5e1b";
const RL_STAGE_OFFER_SENT      = "48f6d051-a906-4615-accb-7466930763ad";
const RL_STAGE_REALTOR_REPLIED = "3f6ff995-ab23-413f-9c54-5f355ddd8644";
const RL_STAGE_NEGOTIATING     = "5dec7a3f-3d8e-4e6c-888d-d2608e5332a1";
const RL_STAGE_UNDER_CONTRACT  = "8fb78edf-e2b1-4681-8420-44b2a04c4776";
const RL_STAGE_DEAD            = "3750430d-38da-4765-8069-827d1dc7daac";

// MAO formula constants (Adam can revise per market).
const MAO_ARV_MULTIPLIER = 0.70;
const MAO_REHAB_PER_SQFT = 30;     // flat assumption pending Apify/RentCast
const MAO_BUFFER         = 10000;  // negotiation buffer

// ElevenLabs Blake agent + phone-number IDs.
const BLAKE_AGENT_ID = "agent_5001ks3cp069f9rtfz6e81ypgnrd";
const BLAKE_PHONE_NUMBER_ID = "phnum_8001ks3fhbbpe4vadtrdmparejgw";

// Blake's outbound voice number (APG-owned, Twilio-registered, voice-only).
// NOT used for SMS — listing-realtor SMS goes via GHL Conversations API which
// auto-routes from GHL's location SMS number (+1 609-699-8437).
const BLAKE_VOICE_NUMBER = "+16099449034";
const GHL_SMS_NUMBER = "+16096998437";  // documentation only — GHL auto-uses this

// All 18 GHL/LeadConnector phone numbers in this APG sub-account. When one of
// these appears as the `external_number` on an inbound call to Blake, it means
// GHL forwarded the call (not a direct seller dial). GHL forwards trigger a
// "Press 1 to connect" whisper that Blake can't respond to verbally — we have
// to inject DTMF "1" via the Twilio API to accept the connection.
//
// Update this list if numbers are added/removed in GHL → Settings → Phone Numbers.
// Source: GHL /phone-system/numbers/ list as of 2026-05-22.
const GHL_FORWARD_NUMBERS = new Set([
  "+12676197270", // PA Market
  "+16095263418", // A2P 10DLC (utility)
  "+14707508168", // GA Market
  "+16098045017", // Wendy Chodes
  "+16096844472", // Mike Yasser
  "+16094388996", // Jef De los Santos
  "+16096306321", // John's number
  "+19013138258", // TN Market
  "+14406169376", // OH Market
  "+16095071176", // RJ
  "+16097987201", // Cherry Blossom
  "+12568006289", // AL Market
  "+12603193698", // IN Market
  "+16095961996", // Justus
  "+16095668320", // Adam Chodes
  "+18037843538", // SC Market
  "+16096047761", // Gyeo Steven
  "+14143489182", // WI Market
  "+16096998437", // Location primary (used for outbound SMS)
]);

// Slack channel for Pillar B listing alerts. APG bot (@apg_automations) must
// be /invite'd to this channel for chat.postMessage to succeed.
const SLACK_LISTINGS_CHANNEL = "#listed-leads";

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

    // --- Dashboard auth & gated pages ----------------------------------
    // Public asset routes (no auth) — needed so the login page can show the logo.
    // favicon.svg is INLINED in the Worker so the login page works without
    // depending on github.io's Pages publish cadence.
    if (req.method === "GET" && url.pathname === "/favicon.svg") {
      return new Response(INLINE_FAVICON_SVG, {
        status: 200,
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/logo.svg") {
      return proxyGithubPagesAsset("logo.svg", "image/svg+xml");
    }

    // /login — GET shows the form, POST validates the password.
    if (req.method === "GET" && url.pathname === "/login") {
      const next = url.searchParams.get("next") || "";
      // If already authed, skip the form — land on the hub by default.
      const auth = await requireAuth(req, env);
      if (auth.ok) {
        return new Response(null, {
          status: 302,
          headers: { Location: next || "/" },
        });
      }
      return new Response(loginPageHtml({ next }), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/login") {
      let password = "";
      let next = "";
      try {
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j: any = await req.json();
          password = String(j?.password || "");
          next = String(j?.next || "");
        } else {
          const form = await req.formData();
          password = String(form.get("password") || "");
          next = String(form.get("next") || "");
        }
      } catch {
        // fall through with empty password → error response
      }
      if (!env.DASHBOARD_PASSWORD) {
        return new Response(loginPageHtml({ error: "Server misconfigured: DASHBOARD_PASSWORD secret not set" }), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      // Constant-time string compare (don't reveal length via short-circuit)
      const a = password;
      const b = env.DASHBOARD_PASSWORD;
      let diff = a.length ^ b.length;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
      }
      if (diff !== 0) {
        return new Response(loginPageHtml({ error: "Incorrect password.", next }), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      const cookie = await signSessionCookie(env.DASHBOARD_SESSION_SECRET);
      // Default post-login destination is the landing hub at "/" — gives the
      // user a clear nav to all dashboards instead of dumping them on Blake.
      const safeNext = next && next.startsWith("/") ? next : "/";
      return new Response(null, {
        status: 302,
        headers: {
          Location: safeNext,
          "Set-Cookie": buildSessionCookieHeader(cookie),
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/login",
          "Set-Cookie": clearSessionCookieHeader(),
        },
      });
    }

    // Gated dashboard pages — proxy github.io HTML behind session check.
    // All paths must exist as files under site/ in gh-pages branch.
    // Both clean (/blake) and legacy (/blake.html) paths are routed because
    // the dashboard HTMLs' internal nav uses relative ".html" links — without
    // the .html aliases, every cross-dashboard click 404s with CF's error
    // page (the "multiple options error at the bottom" Mido saw).
    const gated: Record<string, string> = {
      "/blake": "blake.html",
      "/blake.html": "blake.html",
      "/progress": "progress.html",
      "/progress.html": "progress.html",
      "/weekly": "weekly.html",
      "/weekly.html": "weekly.html",
      "/priorities": "priorities.html",
      "/priorities.html": "priorities.html",
      "/markets": "markets.html",
      "/markets.html": "markets.html",
      "/deals": "deals.html",
      "/deals.html": "deals.html",
      "/followups": "index.html",   // dashboard_html.py outputs site/index.html
      "/followups.html": "index.html",
      "/index.html": "index.html",
      "/about": "about.html",
      "/about.html": "about.html",
      "/setup": "setup.html",
      "/setup.html": "setup.html",
      "/ai-agents-plan": "ai-agents-plan.html",
      "/ai-agents-plan.html": "ai-agents-plan.html",
    };
    if (req.method === "GET" && gated[url.pathname]) {
      const auth = await requireAuth(req, env);
      if (!auth.ok) {
        return new Response(null, {
          status: 302,
          headers: { Location: `/login?next=${encodeURIComponent(url.pathname)}` },
        });
      }
      return proxyGithubPagesHtml(gated[url.pathname]);
    }

    // Landing hub at "/" — if logged in, show the dashboard navigation page;
    // if not, redirect to /login. (Health JSON moves to /health only.)
    if (req.method === "GET" && url.pathname === "/") {
      const auth = await requireAuth(req, env);
      if (!auth.ok) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/login?next=/" },
        });
      }
      return new Response(landingHubHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (req.method === "GET" && url.pathname === "/health") {
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

    // /debug/last-dtmf — returns the most recent Twilio DTMF inject attempt
    // (only fires on GHL-forwarded calls). Used to verify the inject ran and
    // see what Twilio returned (success / error / which call SID).
    if (req.method === "GET" && url.pathname === "/debug/last-dtmf") {
      const snapshot = await env.DIAL_STATE.get("debug:last_dtmf");
      return new Response(snapshot || JSON.stringify({ none: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // /twiml-bridge — TwiML endpoint for the GHL-whisper-bypass intermediary
    // Twilio number. GHL forwards inbound calls to the intermediary number.
    // Twilio hits this URL on call connect; we return TwiML that:
    //   1. Pauses 2s so GHL's whisper has time to start playing
    //   2. Plays DTMF "1" via Twilio's RFC 2833 signaling (out-of-band — what
    //      GHL's whisper actually listens for, unlike in-band audio tones)
    //   3. Pauses 1s for GHL to bridge the real caller through
    //   4. Dials Blake's actual voice number → ElevenLabs picks up normally
    // This bypasses the GHL whisper completely without touching Blake's
    // direct ElevenLabs setup. If someone calls Blake's number directly,
    // they still hit ElevenLabs without going through this.
    if (req.method === "POST" && url.pathname === "/twiml-bridge") {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Play digits="1"/>
  <Pause length="1"/>
  <Dial answerOnBridge="false" timeout="30">
    <Number>+16099449034</Number>
  </Dial>
</Response>`;
      return new Response(twiml, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }

    // Same TwiML endpoint, but Twilio sometimes hits voice webhooks via GET
    // depending on number config. Support both verbs.
    if (req.method === "GET" && url.pathname === "/twiml-bridge") {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Play digits="1"/>
  <Pause length="1"/>
  <Dial answerOnBridge="false" timeout="30">
    <Number>+16099449034</Number>
  </Dial>
</Response>`;
      return new Response(twiml, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }

    // /dashboard-data — JSON feed for the live Blake dashboard. Auth-gated
    // (same session cookie as /blake) so a scraper can't pull it directly.
    // The dashboard's JS runs inside the authed session so cookie rides along.
    if (req.method === "GET" && url.pathname === "/dashboard-data") {
      const auth = await requireAuth(req, env);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "WWW-Authenticate": "Cookie" },
        });
      }
      return handleDashboardData(env);
    }

    // /listing-email — Pillar B endpoint. Accepts a parsed listing payload
    // (eventually wired to Cloudflare Email Routing for Zillow/Redfin alerts).
    // For now, manual POST works for testing. Computes MAO, upserts realtor
    // contact + creates opportunity in Realtor Listings pipeline.
    if (req.method === "POST" && url.pathname === "/listing-email") {
      return handleListingEmail(req, env);
    }

    // /listing-email-from-html — Accepts raw Zillow/Redfin email HTML, parses
    // out address/price/beds/baths/sqft/realtor fields, then delegates to
    // handleListingEmail. This is the endpoint n8n's Gmail trigger POSTs to.
    // Payload shape:
    //   { "raw_html": "<html>...</html>", "from": "noreply@convo.zillow.com", "subject": "Just listed: ..." }
    // Optional: { "dry_run": true } to parse only (no GHL/SMS/Slack side effects).
    if (req.method === "POST" && url.pathname === "/listing-email-from-html") {
      return handleListingEmailFromHtml(req, env);
    }

    // /admin/refresh-dashboard — manual trigger to populate the dashboard
    // cache on demand (instead of waiting for next call or cron tick).
    // No auth — the side effect is just reading public-ish data + writing
    // to KV. Worst case someone keeps the cache fresh for us.
    if (req.method === "POST" && url.pathname === "/admin/refresh-dashboard") {
      return (async () => {
        try {
          await refreshDashboardCache(env);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      })();
    }

    return new Response("Not Found", { status: 404 });
  },

  // Cron Trigger handler. Configured in wrangler.toml as `*/15 * * * *` — every
  // 15 minutes:
  //   1. Attempt a small batch of dials (warm-up quota + TCPA windows)
  //   2. Refresh the dashboard cache (so the dashboard never goes stale even
  //      if no calls have happened recently)
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    try {
      const result = await runDialBatch(env, { source: "cron", batchSize: 5, dryRun: false });
      console.log(`[cron-dial] ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`[cron-dial] failed: ${e}`);
    }
    try {
      await refreshDashboardCache(env);
    } catch (e) {
      console.error(`[cron-dashboard] failed: ${e}`);
    }
  },
};

// ---- /listing-email: Pillar B listing-pipeline handler --------------------
//
// Receives a parsed Zillow / Redfin listing alert (or a manual test payload)
// and:
//   1. Computes MAO = (asking ?? ARV) × 0.70 - sqft × $30 - $10k
//   2. Upserts the listing realtor as a GHL contact
//   3. Creates an opportunity in the Realtor Listings pipeline at
//      "1. New Listing"
//   4. (TODO when Twilio creds bound) Sends offer SMS to realtor
//   5. (TODO when Slack token bound) Posts to #base1-sms-leadgen
//
// Expected payload (all fields optional; we'll work with what we get):
//   {
//     "property_address": "123 Main St",
//     "city": "Camden",
//     "state": "NJ",
//     "postal_code": "08234",
//     "asking_price": 250000,
//     "sqft": 1500,
//     "beds": 3,
//     "baths": 2,
//     "listing_url": "https://www.zillow.com/...",
//     "listing_realtor_name": "Jane Smith",
//     "listing_realtor_phone": "+19085551234",
//     "listing_realtor_email": "jane@realty.com"
//   }

async function handleListingEmail(req: Request, env: Env): Promise<Response> {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const asking = Number(body.asking_price) || 0;
  const sqft = Number(body.sqft) || 0;
  const realtorPhone = (body.listing_realtor_phone || "").trim();
  const realtorName = (body.listing_realtor_name || "").trim();
  const realtorEmail = (body.listing_realtor_email || "").trim();

  if (!asking || !body.property_address) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_required_fields", details: "asking_price + property_address are required" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  // 1. MAO calculation. For MVP: treat asking_price as ARV proxy. Later when
  //    Apify/RentCast is wired we'll compute a real ARV from comps.
  const arvProxy = asking;
  const rehabEstimate = sqft * MAO_REHAB_PER_SQFT;
  const mao = Math.max(0, Math.round(arvProxy * MAO_ARV_MULTIPLIER - rehabEstimate - MAO_BUFFER));

  // 2. Upsert realtor contact.
  let realtorContactId = "";
  if (realtorPhone) {
    const existing = await lookupContactDetailByPhone(env.BLAKE_GHL_PIT, realtorPhone);
    realtorContactId = existing?.id || "";
  }
  if (!realtorContactId) {
    // Create
    const createRes = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: ghlHeaders(env.BLAKE_GHL_PIT),
      body: JSON.stringify({
        locationId: APG_LOCATION_ID,
        firstName: realtorName.split(" ")[0] || "Listing",
        lastName: realtorName.split(" ").slice(1).join(" ") || "Realtor",
        phone: realtorPhone || undefined,
        email: realtorEmail || undefined,
        source: "Zillow / Redfin Listing",
        tags: ["realtor", "listing-pipeline"],
      }),
    });
    const createText = await createRes.text();
    try {
      realtorContactId =
        JSON.parse(createText)?.contact?.id ||
        JSON.parse(createText)?.id ||
        "";
    } catch {}
    if (!realtorContactId) {
      console.error(`[listing] failed to upsert realtor contact: ${createRes.status} ${createText.slice(0, 200)}`);
      return new Response(
        JSON.stringify({ ok: false, error: "realtor_contact_create_failed", status: createRes.status, body: createText.slice(0, 300) }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  // 3. Create or update opportunity in Realtor Listings pipeline.
  //    New naming: "Realtor Name / Property Address / Realtor Phone"
  //    Dedup: if an opp already exists in this pipeline whose name contains
  //    the same property address, UPDATE it (don't create a duplicate).
  const oppName = buildListingOppName(realtorName, body.property_address, realtorPhone);

  let opportunityId = "";
  let oppAction: "created" | "updated" = "created";

  const existing = await findRealtorListingOppByAddress(env.BLAKE_GHL_PIT, body.property_address);
  if (existing) {
    opportunityId = existing.id;
    oppAction = "updated";
    const upd = await updateOpportunityNameValue(env.BLAKE_GHL_PIT, existing.id, oppName, mao);
    if (!upd.ok) {
      console.warn(`[listing] dedup update failed (id=${existing.id}): ${upd.status} ${upd.body.slice(0, 200)}`);
    }
  } else {
    const oppRes = await fetch(`${GHL_BASE}/opportunities/`, {
      method: "POST",
      headers: ghlHeaders(env.BLAKE_GHL_PIT),
      body: JSON.stringify({
        locationId: APG_LOCATION_ID,
        pipelineId: REALTOR_LISTINGS_PIPELINE_ID,
        pipelineStageId: RL_STAGE_NEW_LISTING,
        contactId: realtorContactId,
        name: oppName,
        monetaryValue: mao,
        status: "open",
        source: "Zillow / Redfin Listing",
      }),
    });
    const oppText = await oppRes.text();
    try {
      opportunityId = JSON.parse(oppText)?.opportunity?.id || JSON.parse(oppText)?.id || "";
    } catch {}
    if (!oppRes.ok || !opportunityId) {
      console.error(`[listing] opp create failed: ${oppRes.status} ${oppText.slice(0, 300)}`);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "opportunity_create_failed",
          status: oppRes.status,
          body: oppText.slice(0, 300),
          realtor_contact_id: realtorContactId,
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  // 4. SMS the listing realtor with the cash offer.
  //    Sent via GHL conversations API (NOT direct Twilio) so:
  //    - Uses GHL's registered SMS number (+1 609-699-8437), not Blake's
  //      voice-only number (+1 609-944-9034).
  //    - SMS gets recorded as a GHL conversation on the realtor contact.
  //    - Realtor replies thread back to the same conversation automatically
  //      (no separate Twilio inbound webhook plumbing required).
  const realtorFirst = (realtorName.split(" ")[0] || "there").trim();
  const fmtK = (n: number) => `$${Math.round(n / 1000)}k`;
  const beds = Number(body.beds) || 0;
  const baths = Number(body.baths) || 0;
  const smsBody =
    `Hi ${realtorFirst}, Mike with Atom Property Group — cash buyer, no contingencies. ` +
    `Saw your listing at ${body.property_address}. ` +
    `Best we can do is ${fmtK(mao)} cash, close in 14 days. ` +
    `Worth a quick chat? Reply Y.`;

  const sms = realtorContactId
    ? await sendGhlSms(env, realtorContactId, smsBody)
    : { ok: false, status: 0, body: "no_realtor_contact_id" };

  // 5. Write a structured listing brief as a NOTE on the realtor contact, so
  //    RJ/Adam can see the deal context when they open the contact card.
  const brief =
    `[Listing brief — ${new Date().toISOString().slice(0, 10)}]\n` +
    `Address: ${body.property_address}` +
    (body.city ? `, ${body.city}` : "") +
    (body.state ? `, ${body.state}` : "") +
    (body.postal_code ? ` ${body.postal_code}` : "") + `\n` +
    (beds || baths || sqft
      ? `Property: ${beds || "?"} bd / ${baths || "?"} ba / ${sqft ? sqft.toLocaleString() + " sqft" : "? sqft"}\n`
      : "") +
    `Asking: ${fmtK(asking)}\n` +
    `MAO: ${fmtK(mao)}  (= ${fmtK(arvProxy)} × 0.70 − rehab ${fmtK(rehabEstimate)} − ${fmtK(MAO_BUFFER)} buffer)\n` +
    `Offer sent via SMS: ${sms.ok ? "yes" : "FAILED — " + sms.body.slice(0, 80)}\n` +
    (body.listing_url ? `Listing URL: ${body.listing_url}\n` : "") +
    `Realtor: ${realtorName || "(unknown)"}` +
    (realtorPhone ? ` · ${realtorPhone}` : "") +
    (realtorEmail ? ` · ${realtorEmail}` : "");
  await addNote(env.BLAKE_GHL_PIT, realtorContactId, brief).catch(() => {});

  // 6. Update the realtor contact's VA Notes custom field with the latest
  //    one-liner so it shows up in the GHL contact list view.
  const vaNotesLine =
    `Listed ${body.property_address}${body.city ? ", " + body.city : ""}${body.state ? ", " + body.state : ""} at ${fmtK(asking)}. ` +
    `MAO ${fmtK(mao)} sent ${sms.ok ? "via SMS" : "(SMS failed)"} ${new Date().toISOString().slice(0, 10)}.`;
  await setContactCustomField(env.BLAKE_GHL_PIT, realtorContactId, CF_VA_NOTES, vaNotesLine).catch(() => {});

  // 7. Slack alert in #listed-leads. Now includes the property details line
  //    (beds / baths / sqft) — was missing in v1.
  const fullAddress =
    body.property_address +
    (body.city ? `, ${body.city}` : "") +
    (body.state ? `, ${body.state}` : "") +
    (body.postal_code ? ` ${body.postal_code}` : "");
  const propertyLine =
    (beds || baths || sqft)
      ? `> *${beds || "?"} bd · ${baths || "?"} ba · ${sqft ? sqft.toLocaleString() + " sqft" : "? sqft"}*\n`
      : "";
  const slackText =
    `:house: *New listing landed* — ${fullAddress}\n` +
    propertyLine +
    `> Asking *${fmtK(asking)}* · MAO *${fmtK(mao)}* (ARV ${fmtK(arvProxy)} × 0.70 − rehab ${fmtK(rehabEstimate)} − ${fmtK(MAO_BUFFER)} buffer)\n` +
    `> Realtor: ${realtorName || "(unknown)"} ${realtorPhone || ""} ${realtorEmail ? `<${realtorEmail}>` : ""}\n` +
    `> SMS to realtor: ${sms.ok ? ":white_check_mark: sent via GHL (conversation on contact)" : `:x: ${sms.status} ${sms.body.slice(0, 100)}`}\n` +
    (body.listing_url ? `> Listing: ${body.listing_url}\n` : "") +
    `> GHL opp: \`${opportunityId}\` (Realtor Listings → 1. New Listing) [${oppAction}]`;
  const slack = await postSlackMessage(env, SLACK_LISTINGS_CHANNEL, slackText);

  return new Response(
    JSON.stringify({
      ok: true,
      mao,
      asking_price: asking,
      rehab_estimate: rehabEstimate,
      buffer: MAO_BUFFER,
      property_address: body.property_address,
      city: body.city || "",
      state: body.state || "",
      realtor_contact_id: realtorContactId,
      opportunity_id: opportunityId,
      opportunity_name: oppName,
      opportunity_action: oppAction,   // "created" or "updated" (dedup hit)
      sms_to_realtor: sms.ok
        ? { ok: true, via: "ghl-conversations", conversation_id: sms.conversationId, message_id: sms.messageId }
        : { ok: false, status: sms.status, error: sms.body.slice(0, 200) },
      slack_notify: slack.ok
        ? { ok: true, ts: slack.ts, channel: slack.channel }
        : { ok: false, status: slack.status, error: slack.body.slice(0, 200) },
    }, null, 2),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// =============================================================================
// Zillow / Redfin email parser
// =============================================================================
//
// n8n's Gmail trigger POSTs the raw email body (HTML) to this endpoint. We
// detect platform by From address, parse out the structured fields, then
// delegate to handleListingEmail() which fires the MAO/SMS/Slack chain.
//
// Tolerant by design: tries multiple regex patterns for each field, falls back
// gracefully. If parsing fails on a critical field (address or asking price),
// returns 422 with the unparsed HTML preserved so we can iterate the regexes.

const NJ_PA_ALLOWED_STATES = new Set(["NJ", "PA"]);

interface ParsedListing {
  property_address?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  asking_price?: number;
  sqft?: number;
  beds?: number;
  baths?: number;
  listing_url?: string;
  listing_realtor_name?: string;
  listing_realtor_phone?: string;
  listing_realtor_email?: string;
  source?: "zillow" | "redfin" | "unknown";
}

// Strip HTML tags + decode common entities → text usable for regex on prose.
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// First match of any regex in the list, returning the first capture group.
function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return undefined;
}

function parseListingEmail(
  rawHtml: string,
  from: string,
  subject: string
): ParsedListing {
  const fromLower = (from || "").toLowerCase();
  const source: ParsedListing["source"] = fromLower.includes("zillow")
    ? "zillow"
    : fromLower.includes("redfin")
    ? "redfin"
    : "unknown";

  const text = htmlToText(rawHtml);
  const result: ParsedListing = { source };

  // --- Property address + city/state/zip ---
  // Patterns like "123 Main St, Springfield, NJ 07514" or in subject "Just listed: 123 Main St"
  const addrInText = text.match(
    /\b(\d+[A-Za-z]?\s+[\w\s\.'\-]{3,60}?),\s+([A-Za-z][\w\s\.'\-]{2,40}?),\s+([A-Z]{2})\s+(\d{5})/
  );
  if (addrInText) {
    result.property_address = addrInText[1].trim();
    result.city = addrInText[2].trim();
    result.state = addrInText[3];
    result.postal_code = addrInText[4];
  } else {
    // Subject line fallbacks: "Just listed: 123 Main St" / "New listing: 123 Main St in Paterson, NJ"
    const subjAddr = (subject || "").match(
      /(?:Just listed|New listing|Listing|Price change|Just sold|Coming soon)[:\s\-]+(.+)/i
    );
    if (subjAddr) result.property_address = subjAddr[1].trim();
  }

  // --- Asking price ---
  const priceStr = firstMatch(text, [
    /(?:asking|price|list price|listed at)[:\s]*\$([\d,]{4,})/i,
    /\$([\d,]{4,})(?:\s|\.|,)/,
  ]);
  if (priceStr) result.asking_price = Number(priceStr.replace(/,/g, ""));

  // --- Sqft ---
  const sqftStr = firstMatch(text, [
    /([\d,]+)\s*(?:sqft|sq\.?\s*ft\.?|square feet)/i,
  ]);
  if (sqftStr) result.sqft = Number(sqftStr.replace(/,/g, ""));

  // --- Beds ---
  const bedsStr = firstMatch(text, [
    /(\d+)\s*(?:bd|bed|bedroom|bedrooms)\b/i,
  ]);
  if (bedsStr) result.beds = Number(bedsStr);

  // --- Baths ---
  const bathsStr = firstMatch(text, [
    /(\d+(?:\.\d+)?)\s*(?:ba|bath|bathroom|bathrooms)\b/i,
  ]);
  if (bathsStr) result.baths = Number(bathsStr);

  // --- Listing URL (from anchor tags in raw HTML) ---
  const urlMatch = rawHtml.match(
    /https?:\/\/(?:www\.)?(?:zillow|redfin)\.com\/[^"'\s<>]+/i
  );
  if (urlMatch) result.listing_url = urlMatch[0];

  // --- Realtor info (listing agent / listed by block) ---
  // Patterns vary widely; try a few.
  // Zillow often has "Listed by Edna Krabappel" or "Courtesy of: Jane Smith, ABC Realty"
  const nameMatch = firstMatch(text, [
    /(?:Listed by|Listing agent|Courtesy of)[:\s]+([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,3})/,
  ]);
  if (nameMatch) result.listing_realtor_name = nameMatch.trim();

  // Phone: any (NNN) NNN-NNNN or NNN-NNN-NNNN or +1 NNN... in text
  const phoneMatch = text.match(
    /(?:\+1[\s\-\.]?)?\(?(\d{3})\)?[\s\-\.]?(\d{3})[\s\-\.]?(\d{4})/
  );
  if (phoneMatch) {
    result.listing_realtor_phone = `+1${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}`;
  }

  // Email: first @ address that isn't @zillow/@redfin (those are the sender)
  const emailMatches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
  const realtorEmail = emailMatches.find(
    (e) =>
      !e.toLowerCase().includes("@zillow") &&
      !e.toLowerCase().includes("@redfin") &&
      !e.toLowerCase().includes("noreply") &&
      !e.toLowerCase().includes("no-reply")
  );
  if (realtorEmail) result.listing_realtor_email = realtorEmail;

  return result;
}

async function handleListingEmailFromHtml(req: Request, env: Env): Promise<Response> {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const rawHtml = String(body.raw_html || "");
  const from = String(body.from || "");
  const subject = String(body.subject || "");
  const dryRun = body.dry_run === true || body.dry_run === "true";

  if (!rawHtml) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_raw_html" }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const parsed = parseListingEmail(rawHtml, from, subject);

  // Critical-fields check: must have an address AND an asking price to fire
  // the rest of the pipeline. If either is missing, return 422 with parse
  // result so the user (or n8n) can manually review.
  if (!parsed.property_address || !parsed.asking_price) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "parse_incomplete",
        details: "Could not extract property_address and/or asking_price from this email.",
        parsed,
        from, subject,
        html_excerpt: rawHtml.slice(0, 500),
      }, null, 2),
      { status: 422, headers: { "content-type": "application/json" } }
    );
  }

  // State allowlist: only NJ + PA listings fire the full pipeline. Anything
  // else gets parsed + returned but no SMS / Slack / GHL side effects (saves
  // Twilio + GHL cost on out-of-buy-box alerts).
  const inBuyBox = !!parsed.state && NJ_PA_ALLOWED_STATES.has(parsed.state);
  if (!inBuyBox && parsed.state) {
    // Notify Slack so we still see it, then return early.
    const note = `:no_entry: *Out-of-buy-box listing skipped* — ${parsed.property_address}, ${parsed.city || "?"}, ${parsed.state} (buy box = NJ + PA only)`;
    await postSlackMessage(env, SLACK_LISTINGS_CHANNEL, note).catch(() => {});
    return new Response(
      JSON.stringify({
        ok: true,
        skipped_reason: "out_of_buy_box",
        buy_box: ["NJ", "PA"],
        parsed,
      }, null, 2),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  if (dryRun) {
    return new Response(
      JSON.stringify({ ok: true, dry_run: true, parsed }, null, 2),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // Forward to the existing handler by re-invoking with a synthetic Request.
  const forwarded = new Request("https://internal/listing-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed),
  });
  return handleListingEmail(forwarded, env);
}

// --- Twilio DTMF injection on live call ---
// Used when a GHL number forwards an inbound call to Blake. GHL plays a
// "Press 1 to connect" whisper prompt that requires DTMF acknowledgement.
// Blake (AI) can't press a key with his voice, so we POST to Twilio's
// Calls API to inject TwiML <Play digits="1"/> on the live call SID,
// which sends the DTMF tone GHL needs to bridge the real caller through.
//
// Twilio docs: https://www.twilio.com/docs/voice/api/call-resource#update-a-call-resource
//   Modifying an in-progress call by setting Twiml param resets the call's
//   instructions mid-flight. Twilio plays the digits, then resumes whatever
//   it was doing (in our case, the ElevenLabs media stream).
async function injectDtmfOnTwilioCall(
  env: Env,
  callSid: string,
  digits: string
): Promise<{ ok: boolean; status: number; body: string }> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return { ok: false, status: 0, body: "twilio_creds_not_bound" };
  }
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const form = new URLSearchParams({
    Twiml: `<Response><Play digits="${digits}"/></Response>`,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

// --- GHL conversations SMS ---
// POST /conversations/messages with type=SMS + contactId.
// GHL auto-routes from the location's registered SMS number (+1 609-699-8437)
// and threads the conversation on the contact. Realtor replies land inbound
// on the same conversation automatically — no separate Twilio webhook needed.
//
// Why NOT direct Twilio:
//   - Blake's number (+1 609-944-9034) is voice-only, can't send SMS.
//   - Calling Twilio directly bypasses GHL conversation tracking.
//   - GHL's number list is the source of truth — if we add/change numbers
//     there, this code doesn't need updating.
async function sendGhlSms(
  env: Env,
  contactId: string,
  text: string
): Promise<{ ok: boolean; status: number; body: string; conversationId?: string; messageId?: string }> {
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST",
    headers: ghlHeaders(env.BLAKE_GHL_PIT),
    body: JSON.stringify({
      type: "SMS",
      contactId,
      message: text,
    }),
  });
  const respText = await res.text();
  let conversationId: string | undefined;
  let messageId: string | undefined;
  try {
    const j = JSON.parse(respText);
    conversationId = j?.conversationId;
    messageId = j?.messageId;
  } catch {}
  return { ok: res.ok, status: res.status, body: respText, conversationId, messageId };
}

// --- Slack chat.postMessage ---
// channel can be a #channel-name (Slack resolves) or a channel ID.
async function postSlackMessage(
  env: Env,
  channel: string,
  text: string
): Promise<{ ok: boolean; status: number; body: string; ts?: string; channel?: string }> {
  if (!env.SLACK_BOT_TOKEN) {
    return { ok: false, status: 0, body: "slack_token_not_bound" };
  }
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const respText = await res.text();
  let ts: string | undefined;
  let resolvedChannel: string | undefined;
  let slackOk = false;
  try {
    const j = JSON.parse(respText);
    slackOk = j?.ok === true;
    ts = j?.ts;
    resolvedChannel = j?.channel;
    if (!slackOk) return { ok: false, status: res.status, body: respText };
  } catch {}
  return { ok: slackOk, status: res.status, body: respText, ts, channel: resolvedChannel };
}

// Listing opp name format: "Realtor Name / Property Address / Realtor Phone"
// Matches the APG ACQ-pipeline naming convention. Phone is omitted if missing.
// Realtor name falls back to "Unknown Realtor" if the listing email didn't
// include one — this keeps the slash separators stable so dedup-by-substring
// on address keeps working.
function buildListingOppName(
  realtorName: string,
  address: string,
  realtorPhone: string
): string {
  const name = (realtorName || "").trim() || "Unknown Realtor";
  const phone = (realtorPhone || "").trim();
  return phone ? `${name} / ${address} / ${phone}` : `${name} / ${address}`;
}

// Normalize an address for fuzzy comparison — used by dedup search.
function normalizeAddress(a: string): string {
  return (a || "")
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Find an existing opportunity in the Realtor Listings pipeline whose name
// contains this address. Returns null if none. Prevents duplicate opps when
// the same listing comes in twice (e.g. Zillow re-sends a price-change alert).
async function findRealtorListingOppByAddress(
  pit: string,
  address: string
): Promise<{ id: string; name: string; pipelineStageId: string; contactId?: string } | null> {
  const needle = normalizeAddress(address);
  if (!needle) return null;

  // GHL search supports ?q= for fuzzy name match. Filter to the Realtor
  // Listings pipeline so we don't collide with ACQ opps.
  const url =
    `${GHL_BASE}/opportunities/search?location_id=${APG_LOCATION_ID}` +
    `&pipeline_id=${REALTOR_LISTINGS_PIPELINE_ID}` +
    `&q=${encodeURIComponent(address)}&limit=20`;
  const res = await fetch(url, { method: "GET", headers: ghlHeaders(pit) });
  if (!res.ok) return null;
  const j: any = await res.json();
  const opps = (j?.opportunities ?? []) as any[];
  // Exact-after-normalize match on address substring within name.
  const hit = opps.find((o) => normalizeAddress(o.name || "").includes(needle));
  if (!hit) return null;
  return {
    id: hit.id,
    name: hit.name,
    pipelineStageId: hit.pipelineStageId || hit.pipeline_stage_id,
    contactId: hit.contactId || hit.contact_id || hit?.contact?.id,
  };
}

// Update an existing opportunity's name + value (used when dedup hits).
async function updateOpportunityNameValue(
  pit: string,
  opportunityId: string,
  name: string,
  monetaryValue: number
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: ghlHeaders(pit),
    body: JSON.stringify({ name, monetaryValue }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

// ---- /dashboard-data: live aggregated JSON for blake.html -----------------

async function handleDashboardData(env: Env): Promise<Response> {
  // Read pre-computed cache. The cache is populated by:
  //   - Post-call webhook (after every call ends)
  //   - Cron scheduled handler (every 15 min)
  //
  // This keeps /dashboard-data CPU-cheap on the request path (just a KV get)
  // and avoids the CF error 1101 we hit doing on-demand ElevenLabs+GHL
  // aggregation on a cold cache.
  const cached = await env.DIAL_STATE.get("dashboard:cache");
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    });
  }
  // No cache yet — return empty placeholder. The first call end will populate.
  return new Response(
    JSON.stringify({
      updated_at: new Date().toISOString(),
      pending: true,
      message: "Dashboard cache empty. Will populate after the next call ends or the next cron tick.",
      kpis: { calls_today: 0, calls_week: 0, calls_total: 0, avg_duration_secs: 0, hot_count: 0, engaged_pct: 0 },
      warmup: null,
      recent_calls: [],
      blake_agent_id: BLAKE_AGENT_ID,
      location_id: APG_LOCATION_ID,
    }),
    { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
  );
}

// Refresh the dashboard cache by re-computing all data and writing to KV.
// Called from the post-call webhook (best: fires right after each call ends)
// and from the scheduled handler (every 15 min — covers idle periods).
async function refreshDashboardCache(env: Env): Promise<void> {
  try {
    const data = await computeDashboardData(env);
    await env.DIAL_STATE.put("dashboard:cache", JSON.stringify(data), { expirationTtl: 60 * 60 * 24 });
    console.log(`[dashboard-cache] refreshed: ${data.recent_calls?.length || 0} calls`);
  } catch (e) {
    console.error(`[dashboard-cache] refresh failed: ${e}`);
  }
}

async function computeDashboardData(env: Env): Promise<any> {
  // 1. List ALL conversations from ElevenLabs (up to 100 per page). Mido
  //    wants every Blake call visible, not just the recent few.
  const listRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${BLAKE_AGENT_ID}&page_size=100`,
    { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }
  );
  if (!listRes.ok) throw new Error(`elevenlabs list ${listRes.status}`);
  const listJson: any = await listRes.json();
  const conversations: any[] = listJson?.conversations || [];

  // 2. Hydrate the top 30 with full detail (transcript_summary + GHL contact
  //    join). Older calls in the list get sparse data from the list response
  //    only — no per-conv API call. Bumped from 8 → 30 since CF paid-plan
  //    CPU budget (50ms/request) easily covers 30 parallel I/O fetches.
  //    For full historical coverage we'd want per-conv-id KV caching of
  //    hydrated data so we don't re-fetch on every cache rebuild; deferred.
  const top = conversations.slice(0, 30);
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
  const detailedById = new Map<string, any>();
  for (const d of detailed) {
    if (d?.conversation_id) detailedById.set(d.conversation_id, d);
  }

  // 3. Build enriched call list. Hydrated calls get full detail + GHL join.
  //    Non-hydrated calls use the list-endpoint data only (no extra API calls).
  const enriched = await Promise.all(
    conversations.map(async (c: any) => {
      const convId = c.conversation_id || "";
      const d = detailedById.get(convId);
      const listStartUnix =
        c.start_time_unix_secs || c.start_time_unix || c.created_at_unix_secs || 0;
      const listDuration = c.call_duration_secs || c.duration_secs || 0;
      const listStatus = c.status || c.call_status || "";

      if (!d) {
        // Sparse — older call we didn't hydrate. Surface whatever the list
        // endpoint gave us so the row isn't useless; don't show developer-y
        // placeholder text like "(not hydrated)" to non-technical viewers.
        const listPhone =
          c?.metadata?.phone_call?.external_number ||
          c?.metadata?.phone_number ||
          c?.caller_id ||
          c?.from ||
          "";
        return {
          conv_id: convId,
          started_unix: listStartUnix,
          duration_secs: listDuration,
          caller_phone: listPhone,
          caller_name: listPhone || "—",
          caller_address: "",
          ghl_contact_id: "",
          outcome_tag: "unknown",
          outcome_label: listStatus === "done" || listStatus === "completed" ? "Completed" : (listStatus || "Completed"),
          summary: "",
          hydrated: false,
        };
      }

      const md = d.metadata || {};
      const phoneCall = md.phone_call || {};
      const callerPhone =
        phoneCall.external_number ||
        md.phone_number ||
        d.dynamic_variables?.system__caller_id ||
        "";
      const startUnix = md.start_time_unix_secs || listStartUnix;
      const duration = md.call_duration_secs || listDuration;
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
        conv_id: convId,
        started_unix: startUnix,
        duration_secs: duration,
        caller_phone: callerPhone,
        caller_name: contactName,
        caller_address: contactAddr,
        ghl_contact_id: contact?.id || "",
        outcome_tag: outcome.tag,
        outcome_label: outcome.label,
        summary: summary.slice(0, 250),
        hydrated: true,
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

  // --- DTMF AUTO-PRESS FOR GHL FORWARDS ---
  // If the "caller" is one of our 18 GHL numbers, this isn't a direct seller
  // call — it's a GHL forwarded call carrying a "Press 1 to connect" whisper.
  // Inject DTMF "1" on the live Twilio call SID so the whisper accepts and
  // bridges the real seller through. Fire-and-forget so it doesn't slow the
  // init response.
  const callSid =
    payload?.metadata?.phone_call?.call_sid ||
    payload?.call_sid ||
    payload?.CallSid;
  const isGhlForward = !!callerPhone && GHL_FORWARD_NUMBERS.has(callerPhone);
  if (isGhlForward && callSid) {
    console.log(`[init] GHL forward detected from ${callerPhone} → injecting DTMF "1" on call ${callSid}`);
    // Fire-and-forget — don't await, don't block init response.
    // ALSO persist the result to KV so /debug/last-dtmf can verify it ran.
    injectDtmfOnTwilioCall(env, callSid, "1")
      .then((r) => {
        const log = {
          at: new Date().toISOString(),
          callSid, callerPhone, digit: "1",
          ok: r.ok, status: r.status, body: r.body.slice(0, 800),
        };
        console.log(`[init] DTMF inject: ${r.ok ? "OK" : "FAIL"} ${r.status} ${r.body.slice(0, 200)}`);
        return env.DIAL_STATE.put("debug:last_dtmf", JSON.stringify(log), { expirationTtl: 3600 });
      })
      .catch((e) => {
        const log = { at: new Date().toISOString(), callSid, callerPhone, error: String(e) };
        console.warn(`[init] DTMF inject threw: ${e}`);
        return env.DIAL_STATE.put("debug:last_dtmf", JSON.stringify(log), { expirationTtl: 3600 });
      });
  } else if (isGhlForward && !callSid) {
    console.warn(`[init] GHL forward from ${callerPhone} but no call_sid in payload — can't inject DTMF`);
    await env.DIAL_STATE.put("debug:last_dtmf", JSON.stringify({
      at: new Date().toISOString(), callerPhone, error: "no_call_sid_in_payload"
    }), { expirationTtl: 3600 });
  }
  // For GHL forwards we DON'T know who the real seller is (the external_number
  // is the GHL number, not the original caller). Skip the contact lookup and
  // use the owner-unknown greeting — Blake will ask who's calling.
  if (isGhlForward) {
    console.log(`[init] GHL forward — skipping contact lookup, using owner-unknown branch`);
  }

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
    seller_file: "",   // Composed below from recent notes if contact exists
  };

  // Blake greets normally on every call type, including GHL forwards.
  // For forwards, the Worker-side DTMF inject runs in parallel and accepts
  // the whisper within ~500ms-1s, so by the time Blake finishes his greeting
  // the real seller is bridged through. (Earlier we tried blanking the
  // first_message to make Blake wait for the seller to speak, but that
  // created an awkward silence on connect — the seller didn't know anyone
  // was there. Better to greet normally; seller may miss first half-second
  // but hears the back half of the greeting which is enough to respond.)
  let firstMessage = ownerUnknownFirstMessage();

  // Only look up the caller in GHL if it's NOT a GHL-number forward.
  // (For forwards, the external_number is the GHL number itself, not the real
  // seller — the lookup would be guaranteed to miss.)
  if (callerPhone && !isGhlForward) {
    try {
      const contact = await lookupContactDetailByPhone(env.BLAKE_GHL_PIT, callerPhone);
      if (contact) {
        const cfMap = customFieldMap(contact.customFields ?? []);
        const firstName = (contact.firstName || "").trim();
        const lastName = (contact.lastName || "").trim();
        const address = (contact.address1 || "").trim();

        // SELLER FILE: compose a Markdown-flavored brief of everything we
        // know about this seller, so Blake walks into the call already
        // briefed instead of asking questions we already have answers to.
        // Pulls structured fields + last APG Lead Summary note (the
        // canonical record from prior Blake calls).
        const fullAddress = [contact.address1, contact.city, contact.state, contact.postalCode]
          .filter(Boolean).join(", ");
        let sellerFileLines = [
          `Name: ${firstName} ${lastName}`.trim() || "Name: (unknown)",
          fullAddress ? `Property: ${fullAddress}` : null,
          cfMap[CF_BEDS] ? `Beds: ${cfMap[CF_BEDS]}` : null,
          cfMap[CF_BATHS] ? `Baths: ${cfMap[CF_BATHS]}` : null,
          cfMap[CF_SQFT] ? `Sqft: ${cfMap[CF_SQFT]}` : null,
          cfMap[CF_ASKING] ? `Asking price: $${cfMap[CF_ASKING]}` : null,
          cfMap[CF_MOTIVATION] ? `Motivation: ${cfMap[CF_MOTIVATION]}` : null,
          cfMap[CF_TIMELINE] ? `Timeline: ${cfMap[CF_TIMELINE]}` : null,
        ].filter(Boolean) as string[];

        // Pull the latest APG Lead Summary note (Blake's own prior call notes)
        try {
          const lastSummary = await getLatestApgLeadSummary(env.BLAKE_GHL_PIT, contact.id);
          if (lastSummary) {
            sellerFileLines.push("");
            sellerFileLines.push("Last Blake call notes:");
            sellerFileLines.push(lastSummary);
          }
        } catch (e) {
          // best-effort; ignore failures
        }

        const sellerFile = sellerFileLines.join("\n");

        vars = {
          first_name: firstName,
          full_name: `${firstName} ${lastName}`.trim(),
          is_known_owner: "true",
          property_address: address,
          motivation: cfMap[CF_MOTIVATION] || "",
          timeline: cfMap[CF_TIMELINE] || "",
          asking_price: cfMap[CF_ASKING] ? String(cfMap[CF_ASKING]) : "",
          last_call_summary: cfMap[CF_VA_NOTES] || "",
          seller_file: sellerFile,
        };
        firstMessage = ownerKnownFirstMessage(firstName, address);
        console.log(`[init] matched contact id=${contact.id} name="${firstName} ${lastName}" seller_file_chars=${sellerFile.length}`);
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

// Fetch the latest "APG Lead Summary" note for a contact (Blake's prior-call
// canonical record). Returns the body text or null if none found. Used by
// /conversation-init to compose the seller_file dynamic variable.
async function getLatestApgLeadSummary(pit: string, contactId: string): Promise<string | null> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: "GET",
    headers: ghlHeaders(pit),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const notes: any[] = json?.notes || [];
  // Sort newest first
  const sorted = [...notes].sort((a, b) => (b?.dateAdded || "").localeCompare(a?.dateAdded || ""));
  const summary = sorted.find((n) => (n?.body || "").startsWith("APG Lead Summary"));
  if (!summary) return null;
  // Return the body but trim noise (boilerplate header lines we ourselves wrote)
  let body = String(summary.body || "");
  // Remove the proxied recording URL — Blake doesn't need to read it aloud
  body = body.replace(/🎧 Recording:.*$/m, "").trim();
  // Cap length so the prompt doesn't balloon
  return body.length > 2000 ? body.slice(0, 2000) + "...(truncated)" : body;
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
      // 5. Refresh the live dashboard cache so the SPA at /blake.html sees
      //    this call within ~10 sec (next poll). Without this, the dashboard
      //    only refreshes on the 15-min cron tick.
      refreshDashboardCache(env),
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

// Find the contact's opportunity IN THE ACQ PIPELINE specifically (so we
// don't accidentally try to move opps in the Realtor Listings or other
// pipelines using ACQ stage IDs).
async function findAcqOpportunityForContact(
  pit: string,
  contactId: string
): Promise<{ id: string; pipelineId: string; pipelineStageId: string; name?: string } | null> {
  // Search all opps on this contact, then filter client-side by pipeline.
  const res = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${APG_LOCATION_ID}&contact_id=${contactId}&limit=20`,
    { method: "GET", headers: ghlHeaders(pit) }
  );
  if (!res.ok) return null;
  const j: any = await res.json();
  const opps = (j?.opportunities ?? []) as any[];
  const acq = opps.find((o) => (o.pipelineId || o.pipeline_id) === ACQ_PIPELINE_ID);
  if (!acq) return null;
  return {
    id: acq.id,
    pipelineId: acq.pipelineId || acq.pipeline_id,
    pipelineStageId: acq.pipelineStageId || acq.pipeline_stage_id,
    name: acq.name,
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

async function updateOpportunityName(
  pit: string,
  opportunityId: string,
  name: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: ghlHeaders(pit),
    body: JSON.stringify({ name }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
}

async function createOpportunity(
  pit: string,
  contactId: string,
  args: { name: string; pipelineStageId: string }
): Promise<{ ok: boolean; status: number; body: string; oppId?: string }> {
  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: "POST",
    headers: ghlHeaders(pit),
    body: JSON.stringify({
      locationId: APG_LOCATION_ID,
      pipelineId: ACQ_PIPELINE_ID,
      pipelineStageId: args.pipelineStageId,
      contactId,
      name: args.name,
      status: "open",
      source: "Blake AI",
    }),
  });
  const text = await res.text();
  let oppId: string | undefined;
  try {
    oppId = JSON.parse(text)?.opportunity?.id || JSON.parse(text)?.id;
  } catch {}
  return { ok: res.ok, status: res.status, body: text.slice(0, 500), oppId };
}

// Build the opportunity name format: "FullName / Address / Phone"
function buildOpportunityName(
  fullName: string | null | undefined,
  addressFull: string | null | undefined,
  phone: string | null | undefined
): string {
  const parts = [fullName, addressFull, phone].map((p) => (p || "").trim()).filter(Boolean);
  return parts.join(" / ") || "Blake-handled contact";
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
      assignedTo: USER_RJ,   // Rene Fonseca (RJ) — owns all Blake-booked callbacks
    });
    log.push(`callback_task: ${r.ok ? `ok (id=${r.taskId})` : `${r.status}`}`);
  }

  // 5. Opportunity in ACQ pipeline. ALWAYS ensure one exists per Blake-called
  //    contact (so the call has a tracked record). Set its stage based on
  //    lead_temp and name it "FullName / Address / Phone" per APG convention.
  const targetStage =
    extraction.lead_temp === "hot"           ? STAGE_LAO
    : extraction.lead_temp === "warm"        ? STAGE_QUALIFIED
    : extraction.lead_temp === "nurture"     ? STAGE_FU_1_5MO
    : extraction.lead_temp === "dnc"         ? STAGE_DEAD
    : extraction.lead_temp === "wrong_number"? STAGE_DEAD
    : STAGE_UNQUALIFIED;  // cold + unclear default to Unqualified — RJ can review

  // Need contact data to format the opportunity name. Re-fetch for fresh
  // address (the basic-field update above just landed, so we want the
  // POST-update values — but since updateContactFields is fire-and-forget
  // and might not be visible yet, we use the extraction's address fields
  // directly + look up contact name).
  const contactDetail = await getContactDetail(pit, contactId);
  const fc = (contactDetail?.contact ?? contactDetail) || {};
  const fullName = `${(fc.firstName || "").trim()} ${(fc.lastName || "").trim()}`.trim();
  const phone = (fc.phone || "").trim();
  const addressFull = [
    extraction.address1 || fc.address1 || "",
    extraction.city || fc.city || "",
    extraction.state || fc.state || "",
  ].filter(Boolean).join(", ");
  const oppName = buildOpportunityName(fullName, addressFull, phone);

  const existing = await findAcqOpportunityForContact(pit, contactId);

  if (existing) {
    // Update name if different
    if (existing.name !== oppName) {
      const r = await updateOpportunityName(pit, existing.id, oppName);
      log.push(`opp_rename: ${r.ok ? "ok" : `${r.status}`}`);
    }
    // Move stage if different
    if (existing.pipelineStageId !== targetStage) {
      const r = await moveOpportunityStage(pit, existing.id, targetStage);
      log.push(`stage_move ${existing.pipelineStageId.slice(0, 8)}→${targetStage.slice(0, 8)}: ${r.ok ? "ok" : `${r.status}`}`);
    }
  } else {
    // Create new ACQ opportunity for this contact at the target stage
    const r = await createOpportunity(pit, contactId, { name: oppName, pipelineStageId: targetStage });
    log.push(`opp_create stage=${targetStage.slice(0, 8)}: ${r.ok ? `ok (id=${r.oppId})` : `${r.status} ${r.body.slice(0, 80)}`}`);
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

// =============================================================================
// Dashboard auth (login + session cookies)
// =============================================================================
//
// Single-tenant auth for the Blake dashboard, Progress tracker, and any other
// page the Worker serves. Pattern:
//
//   GET /login              → renders login form (APG-branded)
//   POST /login             → validates DASHBOARD_PASSWORD, sets session cookie,
//                             302s to ?next= or /blake
//   GET /logout             → clears cookie, 302s to /login
//   GET /blake, /progress   → require valid session cookie, else 302 to /login
//   GET /logo.svg, /favicon.svg  → public (no auth) so the login page can show them
//
// Session cookie format: `apg_session=<base64(payload)>.<base64(hmac)>`
// payload = JSON { u: "mido", exp: <unix_secs> }
// hmac = HMAC-SHA256(payload, DASHBOARD_SESSION_SECRET)
// Cookie attrs: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=86400 (24h)

const SESSION_COOKIE_NAME = "apg_session";
const SESSION_TTL_SECS = 60 * 60 * 24;   // 24 hours
const DASHBOARD_LOGIN_USER = "mido";

function b64urlEncode(bytes: Uint8Array | string): string {
  const arr =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : bytes;
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad.replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function signSessionCookie(secret: string): Promise<string> {
  const payload = JSON.stringify({
    u: DASHBOARD_LOGIN_USER,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECS,
  });
  const payloadB64 = b64urlEncode(payload);
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

async function verifySessionCookie(
  cookieValue: string,
  secret: string
): Promise<{ ok: boolean; user?: string; reason?: string }> {
  if (!cookieValue || !cookieValue.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = cookieValue.split(".");
  const expected = await hmacSha256(secret, payloadB64);
  const actual = b64urlDecode(sigB64);
  if (actual.length !== expected.length) return { ok: false, reason: "sig_length" };
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  if (diff !== 0) return { ok: false, reason: "sig_mismatch" };
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: "payload_parse" };
  }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, user: payload.u };
}

function getCookie(req: Request, name: string): string {
  const header = req.headers.get("cookie") || "";
  for (const pair of header.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

async function requireAuth(req: Request, env: Env): Promise<{ ok: boolean; user?: string }> {
  const cookie = getCookie(req, SESSION_COOKIE_NAME);
  if (!cookie) return { ok: false };
  const v = await verifySessionCookie(cookie, env.DASHBOARD_SESSION_SECRET);
  return v.ok ? { ok: true, user: v.user } : { ok: false };
}

// Login page HTML — APG-branded card on a clean background.
// Landing hub at GET / — shows after auth. Clean card grid linking to every
// dashboard. Future: unify all dashboards under this layout (shared top nav
// + same color palette + same card style).
function landingHubHtml(): string {
  const cards: Array<{ href: string; title: string; subtitle: string; live?: boolean }> = [
    { href: "/blake",     title: "Blake — Live Calls",     subtitle: "Voice agent dashboard, real-time transcripts + outcomes", live: true },
    { href: "/progress",  title: "Project Tracker",        subtitle: "Pillar A–D delivery status with checkboxes" },
    { href: "/followups", title: "Follow-ups",             subtitle: "SMS follow-up queue across all sellers" },
    { href: "/deals",     title: "Deals",                  subtitle: "Active acquisitions: stage, value, last touch" },
    { href: "/weekly",    title: "Weekly Docket",          subtitle: "Operator briefing — KPIs, charts, action items" },
    { href: "/priorities", title: "Priority Activity",     subtitle: "Daily priority queue with click-through to contacts" },
    { href: "/markets",   title: "Markets",                subtitle: "PA / TN / GA / OH per-market activity rollup" },
  ];
  const cardHtml = cards
    .map(
      (c) => `
      <a class="card" href="${c.href}">
        <div class="card-title">${c.title}${c.live ? '<span class="live-dot" title="real-time"></span>' : ""}</div>
        <div class="card-sub">${c.subtitle}</div>
        <div class="card-arrow">→</div>
      </a>`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG — Operations Console</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="#1A2840">
<style>
  :root {
    --ink: #1A2840;
    --ink-deep: #0A1428;
    --gold: #FFC72C;
    --paper: #F7F4EA;
    --line: #DDD6C4;
    --muted: #6b7480;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    background: linear-gradient(135deg, var(--paper) 0%, #ffffff 100%);
    color: var(--ink);
  }
  header.hub-nav {
    background: var(--ink);
    color: #fff;
    padding: 16px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 8px rgba(10, 31, 68, 0.15);
  }
  header .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 700;
    letter-spacing: 0.4px;
  }
  header .brand img { width: 32px; height: 32px; }
  header .right { display: flex; align-items: center; gap: 18px; font-size: 13px; }
  header .right a {
    color: rgba(255,255,255,0.78);
    text-decoration: none;
    transition: color 120ms;
  }
  header .right a:hover { color: var(--gold); }
  main {
    max-width: 1100px;
    margin: 40px auto 60px;
    padding: 0 32px;
  }
  h1.hub-title {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.4px;
    margin: 0 0 6px;
  }
  p.hub-sub {
    color: var(--muted);
    margin: 0 0 32px;
    font-size: 15px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .card {
    display: block;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 22px 22px 20px;
    text-decoration: none;
    color: var(--ink);
    transition: transform 140ms, box-shadow 140ms, border-color 140ms;
    position: relative;
    overflow: hidden;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(10, 31, 68, 0.12);
    border-color: var(--ink);
  }
  .card::before {
    content: "";
    position: absolute;
    top: 0; left: 0;
    width: 4px;
    height: 100%;
    background: var(--gold);
    opacity: 0;
    transition: opacity 140ms;
  }
  .card:hover::before { opacity: 1; }
  .card-title {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #2ec27e;
    box-shadow: 0 0 0 0 rgba(46, 194, 126, 0.6);
    animation: pulse 1.8s infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(46, 194, 126, 0.6); }
    70%  { box-shadow: 0 0 0 8px rgba(46, 194, 126, 0); }
    100% { box-shadow: 0 0 0 0 rgba(46, 194, 126, 0); }
  }
  .card-sub {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .card-arrow {
    position: absolute;
    bottom: 18px;
    right: 22px;
    color: var(--muted);
    font-size: 18px;
    transition: transform 140ms, color 140ms;
  }
  .card:hover .card-arrow {
    color: var(--ink);
    transform: translateX(4px);
  }
  .ops-bar {
    margin-top: 36px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    display: flex;
    gap: 24px;
    font-size: 13px;
    color: var(--muted);
    flex-wrap: wrap;
  }
  .ops-bar a {
    color: var(--muted);
    text-decoration: none;
    border-bottom: 1px dotted var(--line);
  }
  .ops-bar a:hover { color: var(--ink); }
</style>
</head>
<body>
  <header class="hub-nav">
    <div class="brand">
      <img src="/favicon.svg" alt="APG">
      <span>Atom Property Group</span>
    </div>
    <div class="right">
      <span>Signed in</span>
      <a href="/logout">Sign out</a>
    </div>
  </header>
  <main>
    <h1 class="hub-title">Operations Console</h1>
    <p class="hub-sub">Pick a dashboard. Real-time data lives at the green dot.</p>
    <div class="grid">${cardHtml}</div>
    <div class="ops-bar">
      <a href="/about">About</a>
      <a href="/setup">Setup notes</a>
      <a href="/ai-agents-plan">AI agents plan</a>
      <a href="/health" target="_blank">Worker health</a>
    </div>
  </main>
</body>
</html>`;
}

function loginPageHtml(opts: { error?: string; next?: string } = {}): string {
  const error = opts.error
    ? `<div class="err">${opts.error.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</div>`
    : "";
  const nextField = opts.next
    ? `<input type="hidden" name="next" value="${opts.next.replace(/"/g, "&quot;")}">`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG — Sign in</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="#1A2840">
<style>
  :root {
    --ink: #1A2840;
    --ink-deep: #0A1428;
    --gold: #FFC72C;
    --paper: #F7F4EA;
    --line: #DDD6C4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    background: linear-gradient(135deg, var(--paper) 0%, #ffffff 100%);
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: 0 4px 24px rgba(10, 31, 68, 0.08);
    padding: 40px 36px;
    width: 100%;
    max-width: 380px;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    margin-bottom: 28px;
  }
  .brand img { width: 72px; height: 72px; }
  .brand h1 {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.4px;
    margin: 16px 0 4px;
    color: var(--ink);
  }
  .brand p {
    margin: 0;
    font-size: 12px;
    color: #6b7480;
    letter-spacing: 1.2px;
    text-transform: uppercase;
  }
  form { display: flex; flex-direction: column; gap: 14px; }
  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  input[type=password], input[type=text] {
    font-size: 15px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    width: 100%;
    background: #fafaf6;
    color: var(--ink);
    transition: border-color 120ms, background 120ms;
  }
  input:focus {
    outline: none;
    border-color: var(--ink);
    background: #fff;
  }
  button {
    margin-top: 8px;
    background: var(--ink);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 13px 16px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.4px;
    cursor: pointer;
    transition: background 120ms;
  }
  button:hover { background: var(--ink-deep); }
  .err {
    margin-bottom: 16px;
    padding: 10px 12px;
    background: #fff0ec;
    border: 1px solid #f4c5b9;
    border-radius: 8px;
    color: #a23015;
    font-size: 13px;
  }
  .foot {
    margin-top: 22px;
    text-align: center;
    color: #8a8e98;
    font-size: 11px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="/favicon.svg" alt="APG">
      <h1>Atom Property Group</h1>
      <p>ACQ Operations Console</p>
    </div>
    ${error}
    <form method="POST" action="/login">
      ${nextField}
      <label for="p">Password</label>
      <input type="password" id="p" name="password" autofocus autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <div class="foot">Authorized personnel only</div>
  </div>
</body>
</html>`;
}

// Builds the Set-Cookie header value. HttpOnly + Secure + SameSite=Lax so it
// rides on top-level navigation (e.g. when you click a link to /blake from
// elsewhere) but isn't readable to JS or sent in third-party iframes.
function buildSessionCookieHeader(cookieValue: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${cookieValue}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_TTL_SECS}`,
  ].join("; ");
}

function clearSessionCookieHeader(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}

// Proxy a static page from GitHub Pages (atominvestments.github.io/acq-automation/X)
// so the Worker can gate it behind auth. The HTML's relative refs to
// /dashboard-data, /logo.svg, /favicon.svg all resolve to the Worker (which
// serves those endpoints natively). No URL rewriting needed.
async function proxyGithubPagesHtml(path: string): Promise<Response> {
  const upstream = `https://atominvestments.github.io/acq-automation/${path}`;
  const res = await fetch(upstream, { cf: { cacheTtl: 30, cacheEverything: true } as any });
  if (!res.ok) {
    return new Response(`Upstream fetch failed: ${res.status}`, { status: 502 });
  }
  const body = await res.text();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Pass through a static asset (logo.svg, favicon.svg) from GitHub Pages.
async function proxyGithubPagesAsset(path: string, contentType: string): Promise<Response> {
  const upstream = `https://atominvestments.github.io/acq-automation/${path}`;
  const res = await fetch(upstream, { cf: { cacheTtl: 3600, cacheEverything: true } as any });
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    },
  });
}

// Favicon SVG inlined directly so the login page works even if github.io
// Pages hasn't published the latest assets yet (Pages can lag the Worker
// by 1-2 min after a commit). Identical content to site/favicon.svg.
const INLINE_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-label="Atom Property Group">
  <defs>
    <style>
      .ink   { fill: #1A2840; }
      .gold  { fill: #FFC72C; }
      .orbit { stroke: #FFC72C; stroke-width: 12; fill: none; stroke-linecap: round; }
    </style>
  </defs>
  <rect width="256" height="256" fill="#FFFFFF" rx="36" />
  <g transform="translate(128, 128)">
    <ellipse class="orbit" cx="0" cy="0" rx="92" ry="34" />
    <ellipse class="orbit" cx="0" cy="0" rx="92" ry="34" transform="rotate(60)" />
    <ellipse class="orbit" cx="0" cy="0" rx="92" ry="34" transform="rotate(-60)" />
    <circle class="gold" cx="92" cy="0"   r="11" />
    <circle class="gold" cx="-46" cy="80" r="11" />
    <circle class="gold" cx="-46" cy="-80" r="11" />
    <circle class="ink" cx="0" cy="0" r="22" />
  </g>
</svg>`;
