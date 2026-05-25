// auto-blog.ts — APG auto-publishing blog system
//
// Every 3 days the Worker cron picks an unused topic from BLOG_TOPIC_POOL,
// calls the Anthropic API to write a 700-word value-driven post, attaches a
// curated Unsplash photo, and publishes to WP REST (DRAFT status by default
// so Adam reviews before going live).
//
// Once you trust the quality, flip BLOG_DEFAULT_STATUS to "publish".

export const BLOG_DEFAULT_STATUS: "draft" | "publish" = "draft";

// WP author for blog posts. uxamx11 has display name "adamchodes" — we don't
// need a separate user. WP will use that user's display name as the byline.
// If you want literally "Adam Chodes" as the byline, change the user's
// display name in wp-admin → Users → uxamx11 → "Display name publicly as".
export const BLOG_AUTHOR_USER_ID = 1;  // uxamx11 is typically user 1

// Cadence in days. Cron tick fires every 15 min; we only generate if the
// last post was published more than this many days ago.
export const BLOG_CADENCE_DAYS = 3;

// Curated Unsplash photo IDs known to be real-estate friendly. We rotate
// through these to avoid Unsplash API auth + rate limiting. Each is the
// direct CDN URL — no auth required to fetch.
export const BLOG_IMAGE_POOL: string[] = [
  "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1600&q=80",   // suburban house
  "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1600&q=80",   // brick house front
  "https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=1600&q=80",   // colonial NJ-style
  "https://images.unsplash.com/photo-1480074568708-e7b720bb3f09?w=1600&q=80",   // for sale sign
  "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1600&q=80",   // interior
  "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1600&q=80",   // modern home
  "https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1600&q=80",      // living room
  "https://images.unsplash.com/photo-1494526585095-c41746248156?w=1600&q=80",   // house exterior
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1600&q=80",   // contemporary
  "https://images.unsplash.com/photo-1605276373954-0c4a0dac5b12?w=1600&q=80",   // distressed/needs work
];

// The topic pool. ~60 evergreen NJ/PA real-estate topics that map to APG's
// services. Each is a (slug, title, keyword, brief) tuple. The brief tells
// Claude exactly what the post should cover so the output stays focused.
export interface BlogTopic {
  slug: string;
  title: string;
  keyword: string;
  brief: string;       // hand-written guidance for Claude on structure/angle
  category: "selling" | "construction" | "investing" | "process";
}

export const BLOG_TOPIC_POOL: BlogTopic[] = [
  // -- Selling / situations (highest-intent) ---------------------------------
  { slug: "sell-inherited-house-nj", title: "How to Sell an Inherited House in New Jersey Without the Family Drama", keyword: "sell inherited house NJ", brief: "Cover probate timeline, splitting proceeds cleanly across multiple heirs, the step-up basis tax benefit, when as-is cash makes sense vs MLS. Include a concrete NJ example.", category: "selling" },
  { slug: "pre-foreclosure-options-nj-pa", title: "Pre-Foreclosure in NJ or PA? Here Are Your Real Options Before It's Too Late", keyword: "pre-foreclosure NJ PA", brief: "Walk through the foreclosure timeline in NJ and PA specifically. Cover: short sale, deed in lieu, cash sale to investor, loan mod. Be honest about credit impact of each.", category: "selling" },
  { slug: "selling-tenant-occupied-property", title: "Selling a Tenant-Occupied Property: The Honest Landlord's Playbook", keyword: "sell rental with tenants", brief: "Tired-landlord exit. Don't evict. Cover: month-to-month vs lease, cash-for-keys, selling to investors who keep tenants, cap rate buyer math. NJ landlord-tenant law specifics.", category: "selling" },
  { slug: "fire-damage-house-insurance-gap", title: "Fire-Damaged House? What the Insurance Adjuster Won't Tell You", keyword: "sell fire damaged house", brief: "Insurance pays for repair, not for the gap between repaired value and pre-fire equity. Cover: ACV vs RCV, ALE limits, when selling as-is beats rebuilding, who buys fire-damaged.", category: "selling" },
  { slug: "divorce-house-options", title: "Divorce and the House: 4 Clean Exits Without Court Drama", keyword: "divorce house sale", brief: "Cover the 4 options: buy-out one spouse, sell on MLS and split, sell to cash buyer for speed, defer until kids graduate. NJ equitable distribution basics. Tax implications.", category: "selling" },
  { slug: "hoarder-house-sale", title: "Selling a Hoarder House: Don't Clean a Thing", keyword: "sell hoarder house", brief: "Reframe — cash buyers WANT distressed condition. Don't spend a dollar cleaning. Cover: cleanout cost vs as-is discount math, biohazard concerns, family situations.", category: "selling" },
  { slug: "behind-on-mortgage-options", title: "Behind on Your Mortgage? 6 Moves Before You Lose Everything", keyword: "behind on mortgage NJ", brief: "Loan mod, forbearance, refi, short sale, cash sale, foreclosure auction. Be honest about which works in which situation. Time pressure matters.", category: "selling" },
  { slug: "vacant-house-carrying-costs", title: "The True Cost of an Empty House (Spoiler: It's More Than You Think)", keyword: "vacant house carrying costs", brief: "Run the math on monthly carrying costs: mortgage + insurance + taxes + utilities + maintenance + risk of vandalism. Show why a 'wait for the right buyer' strategy often loses money.", category: "selling" },
  { slug: "code-violations-selling", title: "Got Code Violations? Here's How to Sell the House Anyway", keyword: "sell house with code violations", brief: "Municipal liens, certificate of occupancy (CO) issues, building code red-tags. Why investor buyers handle these vs why retail buyers/lenders won't touch them.", category: "selling" },
  { slug: "old-house-major-repairs", title: "Your House Needs $80K of Repairs. Now What?", keyword: "sell house needs repairs", brief: "Run the math: $80K out of pocket + 6 months + 6% commission = your break-even. Often selling as-is to a cash buyer nets close to the same. Decision framework.", category: "selling" },

  // -- Investing (investor-facing) -------------------------------------------
  { slug: "passive-real-estate-nj", title: "Passive Real Estate Income in NJ: 3 Structures Compared", keyword: "passive real estate investing NJ", brief: "Compare: private lending to operators, equity in flip deals, equity in rental holds. Returns + risk + liquidity for each. Why APG offers the first two.", category: "investing" },
  { slug: "accredited-investor-checklist", title: "Are You an Accredited Investor? The 60-Second Checklist", keyword: "accredited investor requirements", brief: "SEC Rule 501 plain-English. Income test, net worth test, professional license test (new). What docs you'll need to provide. Why it matters for APG deals.", category: "investing" },
  { slug: "1031-exchange-basics", title: "1031 Exchange in 5 Minutes: Defer the Tax, Keep Investing", keyword: "1031 exchange basics", brief: "Like-kind real estate, 45-day identification, 180-day close, qualified intermediary, boot. Walk through one full example with numbers. Why APG can be a replacement property.", category: "investing" },
  { slug: "private-lending-vs-syndication", title: "Private Lending vs Syndication: Which Real Estate Investment Is Right for You?", keyword: "private lending vs syndication", brief: "Compare debt (private lending) vs equity (syndication). Returns, risk position, exit liquidity, tax treatment, common deal structures. Help reader self-select.", category: "investing" },

  // -- Construction / contractor matching ------------------------------------
  { slug: "vet-contractor-checklist", title: "10 Questions to Ask Before Hiring Any Contractor in NJ or PA", keyword: "vet contractor questions", brief: "License lookup, insurance verification (general liability + workers' comp), references from completed jobs (not in-progress), payment structure (never 50% upfront), permit handling.", category: "construction" },
  { slug: "kitchen-remodel-budget-nj", title: "What a Kitchen Remodel Actually Costs in NJ in 2026", keyword: "kitchen remodel cost NJ", brief: "Real ranges: cabinets, counters, appliances, plumbing, electrical, permits. Where corners get cut. The midrange ($35-65K) vs high-end ($80K+) tradeoff. Permit timeline.", category: "construction" },
  { slug: "roofing-vs-siding-priority", title: "Roof or Siding First? The Right Order Saves You Thousands", keyword: "roofing vs siding order", brief: "Always roof first — siding install can't happen on a damaged roof. Cover age signs for each, when partial replacement vs full, asphalt vs metal, vinyl vs fiber cement.", category: "construction" },
  { slug: "permit-process-philadelphia", title: "Philadelphia Permit Process Without Going Insane", keyword: "Philadelphia permit process", brief: "L&I, eClipse system, common over-the-counter vs plan review tiers, typical timelines, what triggers a stop-work-order, why hiring locally connected GCs matters.", category: "construction" },
  { slug: "renovation-roi-by-project", title: "Which Renovations Actually Pay Back in NJ & PA (2026 Data)", keyword: "renovation ROI 2026", brief: "Cost-vs-value report numbers for our region. Top ROI: garage door, manufactured stone veneer, minor kitchen. Worst: master suite add. Why ROI is wrong for properties you're selling vs holding.", category: "construction" },

  // -- Process / education ---------------------------------------------------
  { slug: "cash-offer-vs-mls", title: "Cash Offer vs MLS: When Each Path Actually Wins", keyword: "cash offer vs MLS", brief: "Honest comparison: net proceeds, time, certainty, hassle. Run the numbers on a $300K NJ house: MLS path nets ~$259K after 6% commission + $10K closing + $5K repairs + 4 months carrying. Cash often nets close.", category: "process" },
  { slug: "as-is-sale-explained", title: "What 'As-Is' Sale Actually Means (and What It Doesn't)", keyword: "as is sale meaning", brief: "Disclosure obligations don't go away in NJ/PA. As-is means buyer accepts physical condition, but seller still discloses known material defects. Cover lead paint, asbestos, oil tank rules in NJ.", category: "process" },
  { slug: "title-issues-fix-fast", title: "Title Issues Killing Your Sale? Here's How to Fix Them Fast", keyword: "title issues sale", brief: "Liens, judgments, missing heirs, easements, boundary disputes. Walk through how a real-estate attorney clears each. Why cash buyers handle this in-house vs retail buyers walking away.", category: "process" },
  { slug: "closing-costs-in-nj-pa", title: "Who Actually Pays What at Closing in NJ vs PA", keyword: "closing costs NJ PA", brief: "Realty transfer fee (NJ) vs realty transfer tax (PA). Recording, title insurance, attorney fees, prorated taxes. Who pays which by custom. Why APG covers all closing costs.", category: "process" },
  { slug: "first-time-investor-mistakes", title: "5 Mistakes First-Time Real Estate Investors Make in 2026", keyword: "first time real estate investor mistakes", brief: "Underestimating rehab cost, overconfidence on ARV, ignoring carrying costs, hiring uninsured contractors, not having reserves. Each with a specific NJ/PA example.", category: "investing" },
];

// Build the Claude prompt for a given topic. Returns a single user message.
export function buildBlogPrompt(topic: BlogTopic): string {
  return `You are writing a blog post for Atom Property Group (APG), a cash home buyer + construction connector + investor partner operating across NJ and PA. Founder: Adam Chodes, based in Mercer County, NJ.

The post should be ~700 words. Write it as Adam himself — first-person plural ("we" = APG) where appropriate, conversational but precise, no jargon-stuffing, no SEO sludge.

# Topic
Title: ${topic.title}
Target keyword: ${topic.keyword}
Category: ${topic.category}

# Brief (what to cover)
${topic.brief}

# Style requirements
- Lead with a 2-3 sentence hook that names the problem the reader is facing right now
- 4 sub-headings (H2), each ~120-180 words
- Use concrete numbers (real $ amounts, real timelines) — NJ/PA specific where relevant
- One short pull quote or list within the body
- Closing CTA paragraph: invite the reader to get a free cash offer or talk to APG. Mention the (609) 593-0605 number.
- Voice: confident, honest, practical. Acknowledge tradeoffs. Don't pretend cash sale is always best.
- Never use these phrases: "in today's market", "in this article", "let's dive in", "stay tuned"

# Inline images
Insert EXACTLY 2 image placeholders at natural breaks between sub-headings (NOT at the very top — the featured image already lives there, and NOT inside the closing CTA). Use this exact format on its own line:

  <p><!-- INLINE_IMAGE --></p>

The Worker will replace each <!-- INLINE_IMAGE --> with a relevant photo from APG's curated stock pool, uploaded to WP. Do NOT insert your own <img> tags or stock URLs.

# Format
Return ONLY a JSON object with this exact shape:
{
  "title": "string — final post title (you can refine the input title)",
  "excerpt": "string — 1-2 sentence excerpt for the blog index card, ~140 chars",
  "body_html": "string — the full post as HTML. Use <h2>, <p>, <ul>/<li>, <strong>, <em>. NO <h1> (that's the post title). NO <html>/<body> wrapper. End with the CTA paragraph as a styled callout (use class='apg-cta-box' on a div wrapper)"
}

Output ONLY the JSON. No preamble.`;
}

// Pick the next unused topic. State stored in KV under insights:blog:used.
export async function pickNextTopic(env: { DIAL_STATE: KVNamespace }): Promise<BlogTopic | null> {
  const usedRaw = await env.DIAL_STATE.get("insights:blog:used");
  const used: string[] = usedRaw ? JSON.parse(usedRaw) : [];
  for (const t of BLOG_TOPIC_POOL) {
    if (!used.includes(t.slug)) return t;
  }
  // All topics used — reset the pool (in practice this gives us 60 × 3 days = 180 days
  // before recycling, which is plenty of time for the pool to feel fresh again).
  await env.DIAL_STATE.delete("insights:blog:used");
  return BLOG_TOPIC_POOL[0];
}

export async function markTopicUsed(
  env: { DIAL_STATE: KVNamespace },
  slug: string,
): Promise<void> {
  const usedRaw = await env.DIAL_STATE.get("insights:blog:used");
  const used: string[] = usedRaw ? JSON.parse(usedRaw) : [];
  if (!used.includes(slug)) used.push(slug);
  await env.DIAL_STATE.put("insights:blog:used", JSON.stringify(used), {
    expirationTtl: 60 * 60 * 24 * 365,  // 1 year
  });
}

// Rotate through the curated image pool by hash of the topic slug.
export function pickImageForTopic(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % BLOG_IMAGE_POOL.length;
  return BLOG_IMAGE_POOL[idx];
}

// Pick N additional images for inline body placement. Guaranteed not to repeat
// the featured image; cycles through the pool starting from the index AFTER
// the featured one (deterministic per slug so re-runs are stable).
export function pickInlineImages(slug: string, count: number): string[] {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  const featuredIdx = Math.abs(h) % BLOG_IMAGE_POOL.length;
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(BLOG_IMAGE_POOL[(featuredIdx + i) % BLOG_IMAGE_POOL.length]);
  }
  return out;
}

// Whether enough time has passed since the last published post.
export async function isReadyToPost(env: { DIAL_STATE: KVNamespace }): Promise<boolean> {
  const lastIso = await env.DIAL_STATE.get("insights:blog:last_posted");
  if (!lastIso) return true;
  const last = new Date(lastIso).getTime();
  const now = Date.now();
  const days = (now - last) / (1000 * 60 * 60 * 24);
  return days >= BLOG_CADENCE_DAYS;
}

export async function recordLastPosted(env: { DIAL_STATE: KVNamespace }): Promise<void> {
  await env.DIAL_STATE.put("insights:blog:last_posted", new Date().toISOString(), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
}

// CTA box appended to every post (rendered as raw HTML inside body_html).
// We do NOT rely on Claude to write this — it's a guaranteed standard format.
export const BLOG_CTA_BOX = `
<div class="apg-cta-box" style="background:linear-gradient(135deg,#FFF6DC 0%,#FFECB3 100%);border:1px solid #FFC72C;border-radius:12px;padding:24px;margin:32px 0;font-family:'Inter',sans-serif;">
  <p style="font-family:Georgia,serif;font-size:20px;font-style:italic;color:#1A2840;margin:0 0 12px;line-height:1.4;">Ready for your cash offer?</p>
  <p style="color:#1A2840;margin:0 0 16px;font-size:15px;line-height:1.6;">Two minutes to fill out the form. Written cash offer in 24 hours. Close in 14 days. Zero fees, zero pressure.</p>
  <p style="margin:0;">
    <a href="https://atompropertygroup.com/" style="display:inline-block;background:#1A2840;color:#FAFAF7;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-size:13px;margin-right:8px;">Get my offer →</a>
    <a href="tel:+16095930605" style="display:inline-block;background:transparent;color:#1A2840;padding:12px 24px;border:2px solid #1A2840;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;font-size:13px;">Call (609) 593-0605</a>
  </p>
</div>`;
