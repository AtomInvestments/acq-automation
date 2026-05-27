# ATTOM Property API — what we use, what we don't

> Source of truth: [`workers/blake-post-call/src/attom.ts`](../workers/blake-post-call/src/attom.ts). This doc is hand-derived from the code; if they ever disagree, the code wins.

## Account tier (as of 2026-05-26)

- **Plan:** ATTOM Property API trial/free tier
- **Quota:** ~5,000 requests / month (per code comment; ATTOM has not enforced this strictly in practice)
- **Trial expiration:** 2026-06-23
- **Decision (May 26 meeting with Adam):** **DO NOT upgrade** to a paid tier until MLS access is secured. The MLS will replace many of the fields a paid ATTOM tier would unlock.

## Endpoints we call

Base URL: `https://api.gateway.attomdata.com/propertyapi/v1.0.0`

| Order | Endpoint | Purpose | KV-cached? |
|---|---|---|---|
| 1 | `GET /property/address?address1=…&address2=…` | Resolve a street address to an ATTOM ID. `address1` = "123 Main St", `address2` = "City, ST 12345". | No (cheap, only 1 hop) |
| 2 | `GET /avm/detail?attomid=…` | AVM = automated valuation (low / value / high / confidence). | 24h via `attom:enrich:<addr>` |
| 3 | `GET /property/detail?attomid=…` | Static building + lot + owner + last-sale + assessment. | Same cache key as step 2 |

Steps 2 and 3 are fired in parallel via `Promise.all` once we have the ATTOM ID.

**Auth:** `apikey: $ATTOM_API_KEY` header. Set via `wrangler secret put ATTOM_API_KEY`. Never logged.

## Fields returned (and what's actually populated on the trial)

`AttomEnrichment` shape — defined in [`attom.ts:16`](../workers/blake-post-call/src/attom.ts):

| Field | Source endpoint | Trial-tier reliability |
|---|---|---|
| `attomId` | `/property/address` | Reliable when there's a match. ~70% match rate on NJ/PA addresses in our test set; lower on AL. |
| `resolvedAddress` | `/property/address` (`property[0].address.oneLine`) | Reliable. Useful for confirming we matched the right property. |
| `avmValue`, `avmLow`, `avmHigh`, `avmConfidence` | `/avm/detail` (`avm.amount.{value,low,high,scr}`) | **Reliable.** This is the core trial-tier value-add. Confidence (`scr`) is 0–100. |
| `sqft` (`universalsize`) | `/property/detail` (`building.size.universalsize`) | Reliable when the property has been assessed. |
| `lotSqft`, `lotAcres` | `building.lot.{lotsize2,lotsize1}` | Spotty — present for ~50% of trial responses. |
| `beds`, `baths` | `building.rooms.{beds,bathstotal}` | Spotty on trial; reliable on paid. |
| `yearBuilt`, `stories` | `building.summary.{yearbuilt,levels}` | Spotty on trial. |
| `lastSaleAmt`, `lastSaleDate` | `sale.amount.saleamt` / `sale.saleTransDate` | **Usually empty on trial.** This is the gating field for the "recent transfer" motivated-seller signal. |
| `assessedTotal`, `marketValue` | `assessment.{assessed.assdttlvalue,market.mktttlvalue}` | Usually empty on trial. |
| `ownerName`, `ownerMailing` | `owner.owner1.{lastname,firstname}` + `owner.mailingaddressoneline` | **Usually empty on trial.** Gating field for the "absentee owner" signal. |
| `cacheHit`, `capturedAt` | Our own metadata | n/a |
| `error` | "no_match" / "address_parse_failed" | Set when ATTOM returned nothing or address couldn't be split |

## How `/listing-email` uses it ([listing-bot-workflow.md](./listing-bot-workflow.md))

1. Build `fullAddress = "{street}, {city}, {state} {zip}"`
2. `enrichPropertyViaAttom(env, fullAddress)` — KV cache check first; if miss, address→id then parallel avm+detail
3. **MAO calc:**
   ```
   arvProxy   = attomEnrichment.avmValue ?? asking_price   // prefer ATTOM, fall back to asking
   sqftForRehab = parsed_sqft || attomEnrichment.sqft || 0
   rehabEstimate = sqftForRehab × $30   /* MAO_REHAB_PER_SQFT */
   MAO = max(0, round(arvProxy × 0.70 − rehabEstimate − $10,000))
                            /*       MAO_ARV_MULTIPLIER         MAO_BUFFER */
   ```
4. Write enriched data into:
   - **Realtor contact note** (`formatEnrichmentForGhlNote`) — full AVM range, beds/baths/sqft, last sale, tax assessed, owner of record, absentee flag, motivated-seller summary
   - **Realtor contact custom fields** — `CF_BEDS`, `CF_BATHS`, `CF_SQFT` (only when ATTOM had a value)
   - **Slack `#listed-leads` alert** (`formatEnrichmentForSlack`) — same data, Slack-quoted
5. Tag the realtor contact with motivated-seller signals (see scoring below)
6. Emit `listing` event to the vault queue with the full enrichment payload

## How `/landing-lead` uses it

Same `enrichPropertyViaAttom` call, but the payload feeds the contact directly (not a realtor middleman). The MAO is written to the opportunity's `monetaryValue` field so RJ can see it on the opp card.

## Motivated-seller scoring

Defined in `scoreMotivatedSignals()` in [`attom.ts:208`](../workers/blake-post-call/src/attom.ts). Returns a 0–4 score plus human-readable flags.

| # | Signal | Condition | Trial-tier viable? |
|---|---|---|---|
| 1 | **Absentee owner** | `ownerMailing` street ≠ `resolvedAddress` street (case-insensitive, after the comma split) | Only when owner data is populated — rare on trial |
| 2 | **High equity** | `avmValue / lastSaleAmt >= 1.5` (so AVM is 50%+ above purchase) | Needs `lastSaleAmt` — rare on trial |
| 3 | **Recent transfer** | `lastSaleDate < 12 months ago` AND `lastSaleAmt < $1,000` (proxy for $0 deed transfers = inheritance / quitclaim) | Same — rare on trial |
| 4 | **Tax delinquent** | Placeholder. Requires ATTOM's **Foreclosure tier** (`/foreclosure/snapshot`), not in the Property API. | **Never on trial.** |

Score thresholds in use:
- `score > 0` → ATTOM block included in Slack alert, motivated-seller tags applied to contact
- `score > 0` + `absentee=true` → SMS opener switches to "I work fast on out-of-state owner situations…"
- `score > 0` + `recentTransfer=true` → SMS opener switches to "I work a lot of probate / inherited-property sales…"
- `score > 0` + `highEquity=true` → SMS opener switches to "Looks like the owner has significant equity here…"

**Reality check:** On the trial tier most listings score 0/4 because the gating fields (owner, last sale) are blank. The plumbing is in place — it'll come alive on a paid tier or via MLS comp data.

## What the paid tier would unlock

Per ATTOM's public product matrix (rough — confirm with sales rep when ready):

| Tier | Adds | Approximate $$/mo |
|---|---|---|
| **Property Pro** | Reliable `ownerName`, `ownerMailing`, `lastSaleAmt`, `lastSaleDate`, `assessedTotal` | $99–$249 depending on call volume |
| **Foreclosure** | Pre-foreclosure status, NOD/NOTS filings, auction dates — unlocks signal #4 (tax delinquent) and a new "pre-foreclosure" signal | +$99–$249 |
| **Distressed** | Tax-delinquent rolls, eviction filings, vacancy indicators | +$99–$249 |
| **Comps / AVM Plus** | Comp set per address (5–10 comps with sale dates + adjustments), more accurate AVM | Custom |

**Upgrade trigger (per May 26 meeting):** Defer until MLS access lands. MLS gives us comp data + listing history that overlaps with Property Pro + AVM Plus, so the upgrade calculus changes once MLS is in.

When the trigger fires, target tier = **Property Pro + Foreclosure**. That makes all four motivated-seller signals viable + unlocks pre-foreclosure as a fifth, which is the highest-converting cold-call angle in our market.

## Operational notes

- **Cache invalidation:** keyed on lowercase address with whitespace collapsed. If you change the cache key shape, bump the `attom:enrich:` prefix or live with 24h of stale hits.
- **Address-parse failures** are cached for 6h (not 24h) — gives the address a chance to enter ATTOM's index if it's a brand-new listing.
- **Error capture:** `enrichPropertyViaAttom` never throws — it returns `{ error: "..." }` so upstream code can decide whether to proceed (we always do; ATTOM-miss is not a blocker).
- **No PII in logs.** The address strings are logged at INFO level but owner names + mailing addresses are not.

## Related

- [`docs/listing-bot-workflow.md`](./listing-bot-workflow.md) — the listing-email pipeline that consumes this
- [`tyler/reference_apg_infrastructure.md`](../../.claude/projects/C--Users-midom/memory/tyler/reference_apg_infrastructure.md) — ATTOM key location + rotation history
