// attom.ts — ATTOM Data Property API integration
//
// Two endpoints we rely on, in order:
//   1. /property/address?address1=...&address2=... → returns ATTOM ID for an address
//   2. /avm/detail?attomid=...                     → returns AVM value + range + confidence
//   3. /property/detail?attomid=...                → returns sqft, lot, building details
//
// The lookup is two-step (address → ID, then ID → data) which is more reliable
// than ATTOM's combined endpoints. Results are KV-cached for 24h per address to
// stay well inside the free-trial rate limit (~5,000 requests/month).
//
// CF Worker secret: ATTOM_API_KEY  (set in dashboard)

const ATTOM_BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

export interface AttomEnrichment {
  attomId?:        string;
  resolvedAddress?: string;   // normalized address ATTOM matched
  avmValue?:       number;    // estimated market value (real AVM, used as ARV)
  avmLow?:         number;
  avmHigh?:        number;
  avmConfidence?:  number;    // 0-100, ATTOM's "scr" score
  sqft?:           number;    // universalsize
  lotSqft?:        number;
  lotAcres?:       number;
  beds?:           number;
  baths?:          number;
  yearBuilt?:      number;
  stories?:        number;
  lastSaleAmt?:    number;
  lastSaleDate?:   string;    // ISO date
  assessedTotal?:  number;
  marketValue?:    number;
  ownerName?:      string;
  ownerMailing?:   string;
  error?:          string;    // if lookup failed, capture reason for debugging
  cacheHit?:       boolean;
  capturedAt?:     string;    // when we captured (or refreshed) this data
}

// Normalize address into the two-part ATTOM format
function splitAddress(fullAddress: string): { address1: string; address2: string } | null {
  // Expected formats: "123 Main St, City, ST" or "123 Main St, City, ST 12345"
  const parts = fullAddress.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const address1 = parts[0];
  // Recompose "City, State ZIP" from the rest
  const cityStatePart = parts.slice(1).join(", ");
  return { address1, address2: cityStatePart };
}

async function attomGet(path: string, env: { ATTOM_API_KEY: string }): Promise<any> {
  if (!env.ATTOM_API_KEY) throw new Error("ATTOM_API_KEY not configured");
  const res = await fetch(`${ATTOM_BASE}${path}`, {
    headers: {
      "apikey": env.ATTOM_API_KEY,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`ATTOM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// Step 1: address → ATTOM ID. Returns null if no match.
async function lookupAttomId(
  env: { ATTOM_API_KEY: string },
  address1: string,
  address2: string,
): Promise<{ attomId: string; oneLine: string } | null> {
  const url = `/property/address?address1=${encodeURIComponent(address1)}&address2=${encodeURIComponent(address2)}`;
  const data: any = await attomGet(url, env);
  if (data?.status?.code !== 0) return null;
  const p = (data.property || [])[0];
  if (!p) return null;
  return {
    attomId: String(p.identifier?.attomId || ""),
    oneLine: String(p.address?.oneLine || ""),
  };
}

// Step 2: ATTOM ID → AVM. Best-effort, returns partial if some fields missing.
async function getAvm(
  env: { ATTOM_API_KEY: string },
  attomId: string,
): Promise<Partial<AttomEnrichment>> {
  try {
    const data: any = await attomGet(`/avm/detail?attomid=${attomId}`, env);
    if (data?.status?.code !== 0) return {};
    const p = (data.property || [])[0];
    const amt = p?.avm?.amount || {};
    return {
      avmValue:      typeof amt.value === "number" ? amt.value : undefined,
      avmLow:        typeof amt.low   === "number" ? amt.low   : undefined,
      avmHigh:       typeof amt.high  === "number" ? amt.high  : undefined,
      avmConfidence: typeof amt.scr   === "number" ? amt.scr   : undefined,
    };
  } catch (e: any) {
    console.warn(`[attom] avm failed: ${e?.message || e}`);
    return {};
  }
}

// Step 3: ATTOM ID → property detail (sqft, beds/baths, year built, lot, owner)
async function getDetail(
  env: { ATTOM_API_KEY: string },
  attomId: string,
): Promise<Partial<AttomEnrichment>> {
  try {
    const data: any = await attomGet(`/property/detail?attomid=${attomId}`, env);
    if (data?.status?.code !== 0) return {};
    const p = (data.property || [])[0] || {};
    const bld = p.building || {};
    const sz = bld.size || {};
    const rms = bld.rooms || {};
    const summ = bld.summary || {};
    const lot = p.lot || {};
    const asmt = p.assessment || {};
    const sale = p.sale || {};
    const own = p.owner || {};
    return {
      resolvedAddress: p.address?.oneLine,
      sqft:           typeof sz.universalsize === "number" ? sz.universalsize : undefined,
      lotSqft:        typeof lot.lotsize2 === "number" ? lot.lotsize2 : undefined,
      lotAcres:       typeof lot.lotsize1 === "number" ? lot.lotsize1 : undefined,
      beds:           typeof rms.beds === "number" ? rms.beds : undefined,
      baths:          typeof rms.bathstotal === "number" ? rms.bathstotal : undefined,
      yearBuilt:      typeof summ.yearbuilt === "number" ? summ.yearbuilt : undefined,
      stories:        typeof summ.levels === "number" ? summ.levels : undefined,
      lastSaleAmt:    (sale.amount?.saleamt) || (sale.saleAmountData?.saleAmt),
      lastSaleDate:   sale.saleTransDate || sale.transactiondate || undefined,
      assessedTotal:  asmt.assessed?.assdttlvalue,
      marketValue:    asmt.market?.mktttlvalue,
      ownerName:      (own.owner1?.lastname || "") + (own.owner1?.firstname ? `, ${own.owner1.firstname}` : "") || undefined,
      ownerMailing:   own.mailingaddressoneline || undefined,
    };
  } catch (e: any) {
    console.warn(`[attom] detail failed: ${e?.message || e}`);
    return {};
  }
}

// One-shot: address → full enrichment. KV-cached for 24h per address.
// Cache key is the lowercased address with whitespace collapsed.
export async function enrichPropertyViaAttom(
  env: { ATTOM_API_KEY: string; DIAL_STATE: KVNamespace },
  fullAddress: string,
): Promise<AttomEnrichment> {
  const split = splitAddress(fullAddress);
  if (!split) return { error: "address_parse_failed" };

  const cacheKey = "attom:enrich:" + fullAddress.toLowerCase().replace(/\s+/g, " ").trim();
  const cachedRaw = await env.DIAL_STATE.get(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as AttomEnrichment;
      return { ...cached, cacheHit: true };
    } catch {}
  }

  // Step 1
  let id: { attomId: string; oneLine: string } | null = null;
  try {
    id = await lookupAttomId(env, split.address1, split.address2);
  } catch (e: any) {
    console.warn(`[attom] address lookup threw: ${e?.message || e}`);
  }
  if (!id || !id.attomId) {
    const fail: AttomEnrichment = { error: "no_match", capturedAt: new Date().toISOString() };
    // Cache misses too (but only for 6h — give address a chance to enter ATTOM)
    await env.DIAL_STATE.put(cacheKey, JSON.stringify(fail), { expirationTtl: 60 * 60 * 6 });
    return fail;
  }

  // Steps 2 + 3 in parallel
  const [avm, detail] = await Promise.all([
    getAvm(env, id.attomId),
    getDetail(env, id.attomId),
  ]);

  const result: AttomEnrichment = {
    attomId:         id.attomId,
    resolvedAddress: detail.resolvedAddress || id.oneLine,
    ...avm,
    ...detail,
    capturedAt:      new Date().toISOString(),
    cacheHit:        false,
  };

  await env.DIAL_STATE.put(cacheKey, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 });
  return result;
}

// Score a property against the 4 motivated-seller signals.
// Returns flags + a 0-4 score. Caller decides what threshold means "motivated."
export interface MotivatedSignals {
  score: number;                  // 0-4
  flags: string[];                // human-readable flag list for Slack/notes
  absentee:        boolean;
  highEquity:      boolean;
  recentTransfer:  boolean;       // best-effort — based on saleTransDate < 12mo
  taxDelinquent:   boolean;       // requires Foreclosure tier — usually false on trial
  equityAmount?:   number;        // AVM - lastSaleAmt when both known
  equityMultiple?: number;        // AVM / lastSaleAmt
}

export function scoreMotivatedSignals(e: AttomEnrichment): MotivatedSignals {
  const out: MotivatedSignals = {
    score: 0, flags: [],
    absentee: false, highEquity: false, recentTransfer: false, taxDelinquent: false,
  };

  // 1. Absentee owner — mailing address doesn't match property address
  if (e.ownerMailing && e.resolvedAddress) {
    const propStreet = (e.resolvedAddress.split(",")[0] || "").trim().toLowerCase();
    const mailStreet = (e.ownerMailing.split(",")[0] || "").trim().toLowerCase();
    if (propStreet && mailStreet && propStreet !== mailStreet) {
      out.absentee = true;
      out.score += 1;
      out.flags.push(`🏠➡📦 Absentee owner (mailing: ${e.ownerMailing})`);
    }
  }

  // 2. High equity — AVM significantly above last sale price
  if (e.avmValue && e.lastSaleAmt && e.lastSaleAmt > 0) {
    const multiple = e.avmValue / e.lastSaleAmt;
    out.equityAmount   = e.avmValue - e.lastSaleAmt;
    out.equityMultiple = multiple;
    if (multiple >= 1.5) {
      out.highEquity = true;
      out.score += 1;
      out.flags.push(`💰 High equity (~$${(out.equityAmount).toLocaleString()}, ${multiple.toFixed(1)}x last sale of $${e.lastSaleAmt.toLocaleString()})`);
    }
  }

  // 3. Recent transfer (likely inherited / death-of-owner) — sale date in last 12 months
  if (e.lastSaleDate) {
    const saleDate = new Date(e.lastSaleDate);
    const monthsAgo = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    // Recent sale AND no real sale price → likely a $0 deed transfer (inheritance/quitclaim)
    if (monthsAgo >= 0 && monthsAgo < 12 && (!e.lastSaleAmt || e.lastSaleAmt < 1000)) {
      out.recentTransfer = true;
      out.score += 1;
      out.flags.push(`⚰ Recent deed transfer (${monthsAgo.toFixed(1)} months ago, no sale price → likely probate / quitclaim)`);
    }
  }

  // 4. Tax delinquent — requires the Foreclosure tier; usually undefined in the
  //    trial Property API. Reserved for when we have richer data.
  //    (Placeholder — would set out.taxDelinquent = true based on ATTOM's
  //    /foreclosure/snapshot endpoint, not /property/detail.)

  return out;
}

// Format an enrichment as a Slack message section (multi-line, ">"-quoted).
// Returns "" when ATTOM didn't match (so the caller can drop it cleanly).
export function formatEnrichmentForSlack(e: AttomEnrichment): string {
  if (e.error || !e.attomId) return "";
  const lines: string[] = ["> *ATTOM property record* —"];
  if (e.avmValue) {
    let avmLine = `>   AVM \`$${e.avmValue.toLocaleString()}\``;
    if (e.avmLow && e.avmHigh) {
      avmLine += ` (range $${e.avmLow.toLocaleString()} – $${e.avmHigh.toLocaleString()}, confidence ${e.avmConfidence ?? "?"}/100)`;
    }
    lines.push(avmLine);
  }
  const facts: string[] = [];
  if (e.beds)      facts.push(`${e.beds}bd`);
  if (e.baths)     facts.push(`${e.baths}ba`);
  if (e.sqft)      facts.push(`${e.sqft.toLocaleString()} sqft`);
  if (e.yearBuilt) facts.push(`built ${e.yearBuilt}`);
  if (e.lotAcres)  facts.push(`${e.lotAcres.toFixed(2)} acres`);
  if (facts.length) lines.push(`>   ${facts.join(" · ")}`);
  if (e.lastSaleAmt && e.lastSaleDate) {
    lines.push(`>   Last sale: \`$${e.lastSaleAmt.toLocaleString()}\` on ${e.lastSaleDate.slice(0, 10)}`);
  }
  if (e.assessedTotal) lines.push(`>   Tax assessed: $${e.assessedTotal.toLocaleString()}`);
  if (e.ownerName) {
    let line = `>   Owner of record: ${e.ownerName.trim()}`;
    if (e.ownerMailing && e.resolvedAddress &&
        !e.ownerMailing.includes(e.resolvedAddress.slice(0, 10))) {
      line += ` (:exclamation: absentee — mailing: ${e.ownerMailing})`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// Format as a GHL contact-note body (plain text, multi-line).
export function formatEnrichmentForGhlNote(e: AttomEnrichment, propertyAddress: string, mao?: number | null): string {
  if (e.error || !e.attomId) {
    return `=== ATTOM property check ===\nNo match for "${propertyAddress}" (${e.error || "unknown error"}).`;
  }
  const parts: string[] = [];
  parts.push(`=== ATTOM property record — ${propertyAddress} ===`);
  if (e.resolvedAddress && e.resolvedAddress !== propertyAddress) {
    parts.push(`ATTOM normalized address: ${e.resolvedAddress}`);
  }
  const facts: string[] = [];
  if (e.beds)      facts.push(`${e.beds}bd`);
  if (e.baths)     facts.push(`${e.baths}ba`);
  if (e.sqft)      facts.push(`${e.sqft.toLocaleString()} sqft`);
  if (e.yearBuilt) facts.push(`built ${e.yearBuilt}`);
  if (e.lotAcres)  facts.push(`${e.lotAcres.toFixed(2)} acres`);
  if (facts.length) parts.push(facts.join(" · "));
  if (e.avmValue) {
    let line = `AVM: $${e.avmValue.toLocaleString()}`;
    if (e.avmLow && e.avmHigh) {
      line += ` (range $${e.avmLow.toLocaleString()} – $${e.avmHigh.toLocaleString()}`;
      if (e.avmConfidence) line += `, confidence ${e.avmConfidence}/100`;
      line += `)`;
    }
    parts.push(line);
  }
  if (mao != null) parts.push(`Computed MAO: $${mao.toLocaleString()} (= AVM × 0.70 − rehab − $10K)`);
  if (e.lastSaleAmt && e.lastSaleDate) {
    parts.push(`Last sale: $${e.lastSaleAmt.toLocaleString()} on ${e.lastSaleDate.slice(0, 10)}`);
  }
  if (e.assessedTotal) parts.push(`Tax assessed: $${e.assessedTotal.toLocaleString()}`);
  if (e.ownerName) {
    let line = `Owner of record: ${e.ownerName.trim()}`;
    if (e.ownerMailing && e.resolvedAddress &&
        !e.ownerMailing.includes(e.resolvedAddress.slice(0, 10))) {
      line += `\n⚠ ABSENTEE OWNER — mailing address: ${e.ownerMailing}`;
    }
    parts.push(line);
  }
  // Motivated-seller summary
  const sig = scoreMotivatedSignals(e);
  if (sig.score > 0) {
    parts.push("");
    parts.push(`🔥 Motivated-seller score: ${sig.score}/4`);
    sig.flags.forEach((f) => parts.push(`  • ${f}`));
  }
  return parts.join("\n");
}

// Format an enrichment for Blake's seller_file injection (compact human-readable).
export function formatEnrichmentForSellerFile(e: AttomEnrichment): string | null {
  if (e.error || !e.attomId) return null;
  const parts: string[] = [];
  parts.push(`=== Property facts (ATTOM) ===`);
  if (e.resolvedAddress) parts.push(`Resolved: ${e.resolvedAddress}`);
  const facts: string[] = [];
  if (e.beds)      facts.push(`${e.beds}bd`);
  if (e.baths)     facts.push(`${e.baths}ba`);
  if (e.sqft)      facts.push(`${e.sqft.toLocaleString()} sqft`);
  if (e.yearBuilt) facts.push(`built ${e.yearBuilt}`);
  if (e.lotAcres)  facts.push(`${e.lotAcres.toFixed(2)} acres`);
  if (facts.length) parts.push(facts.join(" · "));

  if (e.avmValue) {
    let line = `AVM (estimated value): $${e.avmValue.toLocaleString()}`;
    if (e.avmLow && e.avmHigh) {
      line += ` (range $${e.avmLow.toLocaleString()} – $${e.avmHigh.toLocaleString()}`;
      if (e.avmConfidence) line += `, confidence ${e.avmConfidence}/100`;
      line += `)`;
    }
    parts.push(line);
  }
  if (e.lastSaleAmt && e.lastSaleDate) {
    parts.push(`Last sale: $${e.lastSaleAmt.toLocaleString()} on ${e.lastSaleDate.slice(0, 10)}`);
  }
  if (e.assessedTotal) parts.push(`Tax assessed: $${e.assessedTotal.toLocaleString()}`);
  if (e.ownerName) {
    let line = `Owner of record: ${e.ownerName.trim()}`;
    if (e.ownerMailing && e.resolvedAddress && !e.ownerMailing.includes(e.resolvedAddress.slice(0, 10))) {
      line += ` (absentee — mailing: ${e.ownerMailing})`;
    }
    parts.push(line);
  }
  return parts.join("\n");
}
