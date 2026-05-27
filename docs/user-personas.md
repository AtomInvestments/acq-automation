# APG landing-page user personas (2026-05-27)

Workstream 1a from the May 26 brief. Before writing variant copy, identify who actually fills out the form on `/we-buy-houses-{zip}` pages and what voice each subset responds to.

## Methodology + caveats

- **Data sources used:** GHL ACQ pipeline contact records (sampled 20 most recent + cross-referenced against the 30 live zip-level landing pages IDs 1383-1412 + prior Blake call extractions + the [`reference_apg_markets.md`](../../.claude/projects/C--Users-midom/memory/tyler/reference_apg_markets.md) memory note).
- **Sample size:** ~30 active sellers in ACQ pipeline across NJ + AL. Insufficient for statistical claims — these are pattern observations, not conclusions.
- **Clarity sessions:** not yet pulled (no Clarity Data Export API integration). Once Workstream 1c lands, Clarity session recordings can validate (or refute) the personas below.
- **Coverage gap:** the 30 zip pages went live 2026-05-26. Most current sellers came from SMS marketing, not from these pages. The personas below blend "current seller pool" with "expected landing-page audience" based on the zip targeting (Trenton, Newark, Philly, Birmingham metro, Bessemer, Montgomery).

Re-evaluate after 4 weeks of landing-page traffic + 50+ form submissions.

---

## Persona 1 — **The Heir** (estimated 30–35% of inbound)

**Snapshot.** 45–62 years old, lives 30+ minutes from the property, just inherited it from a parent / aunt / spouse, doesn't want to deal with the cleanout, repairs, or month-long MLS process. Property is typically 1950s–1970s build, 1,100–1,800 sqft, has deferred maintenance.

**Real-pipeline anchor:** *Adele Moore* — surfaced her sister Eleonora's Newbern AL property during a Blake call. Said "I don't live there, my sister does, but she's ready to move on."

**Why they sell.** Emotional + logistical, not financial. They CAN afford to wait, but every week the empty house sits, they're paying taxes + utilities + worrying about break-ins. The pain is decision fatigue + family-dynamics friction (other siblings have opinions).

**Pain points.**
- Doesn't trust "we buy houses" signs — assumes lowball + bait-and-switch
- Has heard horror stories about wholesalers who tie up the contract then walk
- Wants to feel respected, not pitched

**Voice that resonates.** **Friendly.** Calm, conversational, warm. "Let's just talk" beats "Get your offer in 60 seconds." They want to feel like the buyer is a real human who understands family stuff.

**Marketing hooks that work:**
- Mention probate / inherited explicitly — they self-identify
- Promise 14-day close (relief, not urgency — they've already been waiting 6 months)
- "No cleanout" / "leave anything you want" — concrete pain solved

**Mapping → variant:** **Friendly**

---

## Persona 2 — **The Tired Landlord** (estimated 25–30% of inbound)

**Snapshot.** 50–68 years old, owns 1–4 rental properties, is done. Tenants damaged the place, evictions cost too much, or they're moving toward retirement. Often an LLC owns the property (one degree of separation makes them feel professional even when frustrated).

**Real-pipeline anchor:** *Catalin Sks del LLC* (Mount Holly, NJ — 220 Clifton Ave). Single-family that's been a long-term rental. *Mary Horezga* (Browns Mills NJ, 130 Trenton Road) likely fits this pattern too — older owner, single-family rental.

**Why they sell.** Frustration > finance. They want OUT, not the top dollar. Cash + speed + as-is matters more than $20k extra.

**Pain points.**
- Doesn't want a 3-month MLS process; tenants would make showings impossible anyway
- Suspicious of buyers who haven't dealt with tenant-occupied properties
- Wants assurance the buyer can actually close (proof of funds)

**Voice that resonates.** **Professional.** Transactional, B2B-feeling, respects their time. Skip the pleasantries, get to the math. "Here's the offer range. We've closed 47 tenant-occupied deals. Here's our proof of funds."

**Marketing hooks that work:**
- "We buy tenant-occupied" — niche specifier
- "We don't need access" or "we'll handle the tenant interview" — solves a recurring blocker
- LLC-friendly: clean entity-to-entity transaction, no personal warranty drama

**Mapping → variant:** **Professional**

---

## Persona 3 — **The Long-Time Owner** (estimated 20–25% of inbound)

**Snapshot.** 65+ years old, owned the property 25+ years, sometimes the only home they've ever known. Their kids are grown, the house is too big or the stairs are getting harder. They have significant equity but are uncomfortable with the modern process — they've never sold a house before that didn't involve a handshake at the local bank.

**Real-pipeline anchor:** *Deanne ("Dian") Smith* (Trenton NJ, Deklyn Ave). Blake mispronounced her name on the call and she said "It's *Deanne*." Then asked: "Is this auto recording or is this a live person?" The fact that she even asked that question signals she's old enough to remember when human callers were the norm. *George Kazantzis* (Haddonfield) also fits — Greek surname, older demographic, voicemail-only contact.

**Why they sell.** Life stage. Spouse passed, kids want them closer, can't manage the property, health issue, moving to a 55+ community.

**Pain points.**
- Distrusts AI / automation / "online forms" by default
- Wants to talk to a real person who treats them with respect, not "Hey John, quick question…"
- Worried about taxes, capital gains, "I don't want any surprises with the IRS"

**Voice that resonates.** **Traditional.** Formal "Hello {first}, this is Mike from Atom Property Group regarding your property at…" Full company name. No abbreviations. No "Hey!" No emojis. No urgency.

**Marketing hooks that work:**
- Real human callback within the hour (NOT instant AI text)
- "We're a Wyoming-registered company, established XXXX" — legitimacy markers
- "We'll handle the title work" — they remember when title issues killed deals
- Reference to the family / neighborhood: "We buy homes in {neighborhood} from owners who've been there a long time."

**Mapping → variant:** **Traditional**

---

## Persona 4 — **The Birmingham Out-of-State Owner** (estimated 10–15% of inbound)

**Snapshot.** 35–55 years old, lives in California, Texas, or the NYC metro, owns property in Birmingham AL (or Montgomery / Mobile) as a rental or inheritance. The Birmingham metro is APG's growth market — 63 confirmed leads with phone numbers + Birmingham address per `reference_apg_markets.md`.

**Real-pipeline anchor:** the 63 Birmingham AL ACQ leads. Coverage extends to Bessemer, Forestdale, Pinson, Center Point, Trussville, Fairfield. Plus 7 Montgomery and 1 Mobile leads. Most of these submitted via SMS marketing (Zapier-imported); a meaningful chunk will start submitting via the new `/we-buy-houses-35208`, `/we-buy-houses-35211`, etc. pages.

**Why they sell.** Geographic detachment. They don't want to fly to Alabama to deal with anything. They want a remote close, wire to the bank, done.

**Pain points.**
- Distrust of local Birmingham buyers (out-of-area paranoia)
- Worry about title clouds + property condition they can't verify
- Want POA-friendly close (signing remotely)

**Voice that resonates.** **Professional**, with a regional confidence layer. Specifically mention Birmingham / Jefferson County in the copy. They want to know APG actually knows the market, not just scraping zip codes.

**Marketing hooks that work:**
- "We close remotely — no flight to Birmingham needed"
- "We know Bessemer, Forestdale, Pinson — give us a zip"
- "POA-friendly close"
- Wire instead of certified-check (they value bank wires for proof)

**Mapping → variant:** **Professional** (same as tired landlord, with regional copy tweaks)

---

## Persona 5 — **The Distressed Seller** (estimated 5–10% of inbound; high-conversion when matched)

**Snapshot.** 30–60 years old, going through one of: divorce, job loss, medical bills, pre-foreclosure, tax delinquency. The property is the lever they need to pull to stop bleeding. Time-sensitive — measured in weeks, not months.

**Real-pipeline anchor:** Hard to anchor without paid-tier ATTOM data (Foreclosure / Distressed tiers — see [docs/attom-capabilities.md](./attom-capabilities.md)). Pre-foreclosure becomes a signal once that data is online. For now: any seller who says "need to close fast" or "behind on the mortgage" fits the pattern.

**Why they sell.** Avoid foreclosure on the credit report, get the divorce settlement done, free up cash for the medical bill. Speed is the whole pitch.

**Pain points.**
- Embarrassment — doesn't want neighbors / coworkers to know they're selling under pressure
- Skeptical of "as-is, cash buyer" pitches because too many predators in this segment
- Needs proof they're not getting underbid by 30%

**Voice that resonates.** **Friendly** — warm and discreet. Distressed sellers don't want to feel like a transaction. The Friendly variant's "Let's just talk" framing reduces the shame friction.

**Marketing hooks that work:**
- "Confidential — we don't post sold properties or put a sign in the yard"
- "We work with foreclosure timelines" (mention specific lender names if known)
- "Same week close possible"

**Mapping → variant:** **Friendly** (with discreet, no-pressure phrasing)

---

## Persona-to-variant tally

| Variant | Personas served | Estimated % of inbound |
|---|---|---|
| **Friendly** | The Heir + The Distressed Seller | 35–45% |
| **Professional** | The Tired Landlord + The Birmingham Out-of-State Owner | 35–45% |
| **Traditional** | The Long-Time Owner | 20–25% |

This roughly justifies the proposed 33/33/33 split — no single variant should be dominant.

---

## Open questions to validate post-launch

1. **Distressed-seller volume.** Without ATTOM paid-tier data, we can only see them retroactively. Track conversions from form-fillers who chose `friendly` AND mentioned "fast close" or "behind on" in the address/notes fields.

2. **Birmingham penetration.** The new zip pages target NJ-heavy (12 zips), PA-heavy (7 zips), AL (11 zips). Volume distribution after 4 weeks will show whether AL personas are over- or under-represented.

3. **Persona 3 form completion rate.** The long-time owner is the demographic least comfortable with online forms. We may see them call the listed phone number (+1 609-593-0605) instead of submitting. Track call → conversion separately from form → conversion.

4. **Repeat submissions.** Workstream 2 already deduplicates by phone within 24h. After 4 weeks, look at how many people submit the same form 2+ times — high repeat-submit rate suggests they're nervous and want confirmation. That's a Traditional-variant signal.

## Next step

Workstream 1b — produce the variant briefs (positioning paragraph + hero headline + form CTA) for each of: **Friendly**, **Professional**, **Traditional**. Mike approves before any HTML lands.
