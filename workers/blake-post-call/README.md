# blake-post-call

Cloudflare Worker that receives **ElevenLabs Conversational AI post-call webhooks** for the Blake voice agent and writes a backup record into GHL.

Real-time, sub-second. Replaces the polling/cron pattern in `sms_followup.py` and `acq_automation.py` for the Blake call path. See [`tyler/feedback_event_driven_no_cron.md`](../../README.md) for the architecture rule.

## Why this exists

Blake's in-conversation tools (`lookup_contact_by_phone`, `save_call_summary`, `set_lead_temp`, ...) already write to GHL during the call. But tools can fail mid-call — the LLM forgets to call `save_call_summary`, a network blip, GHL rate-limits, etc.

This Worker is the **safety net**. At call end, ElevenLabs POSTs the full transcript and outcome here, we look up the GHL contact by caller phone, and write a deterministic backup note. The dashboard's existing "APG Lead Summary" parser will still pick up the in-call note as primary; this one is a fallback record explicitly tagged as a post-call write.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Health check (returns JSON status) |
| GET | `/health` | Same as `/` |
| POST | `/webhook` | ElevenLabs post-call event (HMAC-verified) |

## Bindings

Two secrets, set via `wrangler secret put` locally or pushed by the GitHub Actions workflow:

| Name | Source | Purpose |
|---|---|---|
| `BLAKE_GHL_PIT` | GHL → Settings → Private Integrations | Bearer token for GHL API calls |
| `ELEVENLABS_WEBHOOK_SECRET` | ElevenLabs → Webhook config | HMAC-SHA256 signing key |

## Local dev

```sh
cd workers/blake-post-call
npm install
wrangler login        # one-time, opens browser
wrangler secret put BLAKE_GHL_PIT
wrangler secret put ELEVENLABS_WEBHOOK_SECRET
wrangler dev          # local server on http://localhost:8787
```

Test the health endpoint:

```sh
curl http://localhost:8787/
```

## Deploy

Pushing to `main` with any file changed under `workers/blake-post-call/` triggers `.github/workflows/deploy-blake-post-call.yml`. Manual deploy:

```sh
wrangler deploy
```

After deploy, the Worker is live at `https://blake-post-call.<your-cf-subdomain>.workers.dev`.

## Wire ElevenLabs to call it

1. Open ElevenLabs → Conversational AI → Blake agent → Webhooks
2. Add **Post-call webhook**:
   - URL: `https://blake-post-call.<your-cf-subdomain>.workers.dev/webhook`
   - Method: POST
   - Sign with HMAC: yes
   - Signing secret: any random ≥32-char string. Paste the SAME value into the `ELEVENLABS_WEBHOOK_SECRET` repo secret.
3. Save. Make a test call. Watch the Worker logs:

```sh
wrangler tail blake-post-call --format pretty
```

## Payload defensiveness

ElevenLabs has changed post-call payload shapes more than once. The handler treats every field as possibly missing and looks for:

- `conversation_id` at `data.conversation_id`, `data.id`, or top-level
- caller phone at `data.metadata.phone_call.external_number`, `data.metadata.phone_number`, or `data.caller_phone`
- transcript array at `data.transcript` or `data.messages`
- auto-summary at `data.analysis.transcript_summary` or `data.summary`

If a field is missing the Worker still returns 200 (otherwise ElevenLabs will retry forever) and logs the skip reason.
