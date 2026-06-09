# apg-dashboard

APG acquisitions automation stack. Single Cloudflare Worker + KV + a local Python vault-sync daemon. Deploys to `https://apg-dashboard.mithchell.workers.dev`. (Repo name stays `AtomInvestments/acq-automation`; the Worker was renamed from `acq-automation` to `apg-dashboard` on 2026-06-09 to reflect its multi-pillar scope.)

## What's here

```
workers/blake-post-call/   The Worker (src/index.ts ~6,500 lines + helpers)
docs/                      Pipeline + integration docs
weekly/                    Per-week perf JSON consumed by /weekly
site/                      Static priorities.json consumed by dashboards
.github/workflows/         Legacy GH Actions (most replaced by Worker cron)
```

## Docs

| Doc | What it covers |
|---|---|
| [docs/attom-capabilities.md](docs/attom-capabilities.md) | ATTOM Property API tier, endpoints, fields, motivated-seller scoring, paid-tier upgrade case |
| [docs/listing-bot-workflow.md](docs/listing-bot-workflow.md) | `/listing-email` end-to-end: Zillow/Redfin → ATTOM → MAO → GHL Realtor Listings → SMS → Slack → vault |

## Deploy

```bash
cd workers/blake-post-call
CLOUDFLARE_API_TOKEN=… npx wrangler deploy
```

CF Workers Builds is broken — do not try to fix it. Direct `wrangler deploy` is the path.

## Secrets

All Worker secrets are set via `wrangler secret put`. Never committed:

- `BLAKE_GHL_PIT` — GHL Private Integration Token (APG sub-account)
- `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET` — Blake agent + post-call HMAC
- `ANTHROPIC_API_KEY` — Claude (extraction, blog, realtor lookup, Blake self-improve)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — reserved (Blake outbound)
- `SLACK_BOT_TOKEN` — `#listed-leads` + `#base1-sms-leadgen` posting
- `WP_AUTH_HEADER` — Basic-auth header for WordPress.com REST. **Rotated 2026-05-25 after GitGuardian leak.**
- `ATTOM_API_KEY` — Property API (trial, expires 2026-06-23)
- `DASHBOARD_PASSWORD`, `DASHBOARD_SESSION_SECRET` — dashboard auth
- `VAULT_SYNC_TOKEN` — bearer token for `/vault/queue` + `/vault/ack` (Pillar C)

## Vault sync (Pillar C)

Worker emits events to KV (`vault:queue:*`) → local Python daemon polls `/vault/queue` every 30s → writes markdown to `APG-Vault/` → POSTs `/vault/ack` to delete consumed keys.

Daemon lives at `APG-Vault/_internal/vault-sync-daemon.py`. Installed as Windows scheduled task `APGVaultSync` via `_internal/install-vault-sync-task.ps1`.

Event types:
- `blake_call` — post-call webhook
- `landing_lead` — website form submission
- `listing` — `/listing-email` realtor pipeline
- `ghl_message` — 15-min GHL conversations poller
- `blake_iteration` — Claude Opus self-improvement review
- `test` — manual sanity-check emit

## Cron schedule

| Cron | Tasks |
|---|---|
| `*/15 * * * *` | Dial batch, dashboard cache refresh, insights change-poll, auto-blog cadence, GHL→vault message poll |
| `0 4 * * *` | Daily Insights baseline snapshot + daily Slack summary |
