# airbnb-pricing-agent

Cloudflare Worker that replaces APG's manual Airbnb-pricing step.

Daily at **03:00 EDT** (07:00 UTC) it:

1. Pulls every listing + recommended nightly rate from **PriceLabs**.
2. Applies APG's pricing rules:
   - **Base floor** = `$200` (`BASE_FLOOR`)
   - **Weekend bump** = `+4%` on Fri/Sat (`WEEKEND_ADJUSTMENT_PCT`)
3. Generates a one-sentence rationale per listing via **Claude Haiku**.
4. Pushes overrides back to PriceLabs (PriceLabs's own Airbnb sync handles the final hop to Airbnb).
5. Logs every decision to KV (`PRICING_LOG`, 90-day TTL).
6. Posts a digest to the configured Slack channel.

**Default mode is `DRY_RUN=true`.** No real prices move until Adam approves the dry-run sample and Mido flips it off.

---

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /` | none | Health + config echo (which secrets are bound, current floor/weekend, dry-run state) |
| `GET /run-now?key=…` | `RUN_NOW_SECRET` | Fire a pricing run on demand. Returns the full result JSON. |
| `GET /logs?days=7&key=…` | `RUN_NOW_SECRET` | Last N days of run-index entries. Per-listing details live at KV key `run/{ranAt}/{listingId}`. |

Cron: `0 7 * * *` (daily 03:00 EDT / 07:00 UTC).

---

## Sample Slack digest

```
[DRY RUN] :round_pushpin: Daily pricing run · 2026-06-10 (cron)
• 207 Stokes Ave: $245 → $258 (+5.3%) — PriceLabs is reading a weekend demand spike, so Fri/Sat got the +4% bump on top of an already-rising comp set.
• 14 Maple St: $200 → $215 (+7.5%) — Floor anchored most weekdays at $200; weekend nights pushed up by the +4% bump and a small PriceLabs lift.
• 88 Oak Ln: $200 → $200 (held) — floor — PriceLabs is recommending below $200 across the horizon, so the floor is holding every night.
```

When `DRY_RUN=false` the `[DRY RUN]` tag drops and the overrides are actually written to PriceLabs.

---

## Adam's hand-off checklist

Adam needs to provide:

1. **PriceLabs API key** — `pricelabs.co` dashboard → *Account* → *API* → copy the key. Mido sets it as `PRICELABS_API_KEY` via `wrangler secret put`.
2. **Confirm listing list** — once `GET /` is live and the key is set, hit `GET /run-now?key=…` once in dry-run mode. The Slack digest will list every listing PriceLabs sees. Adam confirms the names match his Airbnb portfolio.
3. **Slack channel approval** — recommend `#airbnb-pricing-log` (new, scoped). Falls back to `#base1-sms-leadgen` if Adam prefers consolidation.
4. **Dry-run sample approval** — Adam eyeballs 2-3 dry-run digests over 2-3 days, signs off on the math (floor, weekend bump, rationale tone).
5. **Flip `DRY_RUN=false`** — only after sign-off. Mido runs `wrangler secret put DRY_RUN` (or edits `wrangler.toml` `[vars]` and redeploys).

Optional: if Adam later wants APG to push to Airbnb directly (bypass PriceLabs sync), add `AIRBNB_API_TOKEN` from the Airbnb Partner Console. Not needed at MVP.

---

## Operating the worker

### One-time setup (Mido)

```bash
cd workers/airbnb-pricing-agent
npm install

# 1. Create the KV namespace
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler kv:namespace create PRICING_LOG
# → paste the returned id into wrangler.toml (replace REPLACE_AFTER_CREATE)

# 2. Set secrets
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler secret put PRICELABS_API_KEY
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler secret put SLACK_BOT_TOKEN
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler secret put ANTHROPIC_API_KEY
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler secret put RUN_NOW_SECRET   # any long random string

# 3. Deploy
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler deploy
```

URL once deployed: `https://airbnb-pricing-agent.mithchell.workers.dev`

### Flip out of dry-run

After Adam approves the dry-run sample:

```bash
# Edit wrangler.toml → [vars] DRY_RUN = "false"
CLOUDFLARE_API_TOKEN=cfut_... ./node_modules/.bin/wrangler deploy
```

### Reading logs

```bash
# Index of recent runs
curl "https://airbnb-pricing-agent.mithchell.workers.dev/logs?days=7&key=$RUN_NOW_SECRET"

# Tail live
./node_modules/.bin/wrangler tail airbnb-pricing-agent --format pretty
```

Per-listing decision detail lives at KV key `run/{ranAt}/{listingId}` — open the Cloudflare dashboard → KV → `PRICING_LOG` to inspect.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `:warning: could not list PriceLabs listings: 401` | `PRICELABS_API_KEY` wrong/expired | re-set the secret, redeploy |
| Slack message never arrives | `SLACK_BOT_TOKEN` not bound, or bot not in `#airbnb-pricing-log` | `/invite @<bot>` in the channel, verify token |
| "no prices returned" for a listing | PriceLabs sync to Airbnb broken on that listing | fix in PriceLabs UI, agent will pick up next run |
| Prices not landing on Airbnb after `DRY_RUN=false` | PriceLabs→Airbnb push disabled on the listing | enable "auto-sync" in PriceLabs, or set `AIRBNB_API_TOKEN` for direct push |
| Wrong floor / wrong weekend % | `[vars]` in `wrangler.toml` out of date | edit + redeploy, or `wrangler secret put` to override |

---

## Why a separate worker (not a tab on apg-dashboard)?

Clean separation: this could be productized for other STR operators later. Sharing the repo gives us CI/auth/Slack-token reuse without coupling code paths. The worker name `airbnb-pricing-agent` is intentionally generic — drop in different rule sets per tenant when that day comes.
