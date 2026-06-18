/**
 * deal-scorer.ts — Phase 1 / Module 1C  (L3 agent)
 *
 * Scores each property for three exit strategies — Airbnb (STR), Flipping,
 * and Wholesaling — using the ATTOM enrichment (attom.ts) as the fact base
 * and Claude (Haiku, cheap) for the qualitative weighting. Writes the result
 * into a GHL custom field (CF_DEAL_SCORE) and a readable note.
 *
 * Drains its own `score:` KV queue (same event-driven pattern as 1B). The form
 * handler (1A) and Blake post-call both enqueue. No cron.
 *
 * Scoring model (0-100 per strategy + a recommended exit):
 *   - Wholesale:  high equity + motivated signals + below-ARV asking
 *   - Flip:       equity spread (ARV - asking - rehab) + condition signals
 *   - Airbnb:     ARV stability + beds/baths + market (corridor) fit
 * The deterministic ATTOM-derived inputs are computed here; Claude does the
 * weighting + the one-line rationale so the rubric can evolve in the prompt
 * without a redeploy.
 *
 * NEW custom field (add in GHL, then paste the id below):
 *   CF_DEAL_SCORE — long-text. Stores "WHOLESALE 82 | FLIP 64 | STR 41 — Wholesale".
 *
 * Reuses: enrichPropertyViaAttom, scoreMotivatedSignals (attom.ts);
 *          setContactCustomField, addNote, ghlHeaders, GHL_BASE, Env (index.ts).
 */

import type { Env } from "./index";
import { setContactCustomField, addNote } from "./index";
import { enrichPropertyViaAttom, scoreMotivatedSignals, AttomEnrichment } from "./attom";

// TODO(Mido): create this long-text custom field in GHL (APG sub-account) and
// paste its id here. Until then the field-write is skipped and we only note.
const CF_DEAL_SCORE = ""; // e.g. "abc123DealScoreFieldId"

const QUEUE_PREFIX = "score:queue:";
const CLAIM_PREFIX = "score:claim:";

interface ScoreJob {
  contactId: string;
  address: string;
  source: string;
  askingPrice?: number;
  enqueuedAt: string;
}

interface DealScores {
  wholesale: number; // 0-100
  flip: number; // 0-100
  airbnb: number; // 0-100
  recommended: "Wholesale" | "Flip" | "Airbnb" | "Pass";
  rationale: string;
}

/** Producer — called by 1A / Blake post-call. */
export async function enqueueDealScore(
  env: Env,
  job: { contactId: string; address: string; source: string; askingPrice?: number },
): Promise<void> {
  const payload: ScoreJob = { ...job, enqueuedAt: new Date().toISOString() };
  await env.DIAL_STATE.put(QUEUE_PREFIX + job.contactId, JSON.stringify(payload), {
    expirationTtl: 60 * 60 * 24 * 7,
  });
  console.log(`[score] queued contact=${job.contactId}`);
}

/** Consumer — drain up to `max` jobs. Call from waitUntil / scheduled(). */
export async function drainDealScoreQueue(env: Env, max = 10): Promise<number> {
  const list = await env.DIAL_STATE.list({ prefix: QUEUE_PREFIX, limit: max });
  let done = 0;
  for (const k of list.keys) {
    const raw = await env.DIAL_STATE.get(k.name);
    if (!raw) continue;
    let job: ScoreJob;
    try {
      job = JSON.parse(raw);
    } catch {
      await env.DIAL_STATE.delete(k.name);
      continue;
    }
    try {
      await scoreOne(env, job);
      await env.DIAL_STATE.delete(k.name);
      done++;
    } catch (e) {
      console.error(`[score] job failed contact=${job.contactId}: ${e}`);
    }
  }
  if (done) console.log(`[score] drained ${done} job(s)`);
  return done;
}

async function scoreOne(env: Env, job: ScoreJob): Promise<void> {
  const e = await enrichPropertyViaAttom(env, job.address);
  if (e.error || !e.attomId) {
    await recordClaim(env, job.contactId, { ok: false, reason: e.error || "no_match" });
    return;
  }
  const signals = scoreMotivatedSignals(e);

  const scores = await computeScores(env, e, signals, job.askingPrice);

  const summary = `WHOLESALE ${scores.wholesale} | FLIP ${scores.flip} | STR ${scores.airbnb} — ${scores.recommended}`;
  if (CF_DEAL_SCORE) {
    await setContactCustomField(env.BLAKE_GHL_PIT, job.contactId, CF_DEAL_SCORE, summary);
  }
  await addNote(
    env.BLAKE_GHL_PIT,
    job.contactId,
    `🎯 Deal Score — ${summary}\n${scores.rationale}\n(ARV ~$${(e.avmValue || 0).toLocaleString()}, ${signals.score}/4 motivated signals)`,
  );

  await recordClaim(env, job.contactId, {
    ok: true,
    scores,
    motivatedScore: signals.score,
    avmValue: e.avmValue,
  });
  console.log(`[score] contact=${job.contactId} ${summary}`);
}

/**
 * Compute the three strategy scores. Deterministic ATTOM inputs are assembled
 * here; Claude Haiku does the final weighting + rationale so we can tune the
 * rubric in the prompt without a redeploy. Falls back to a pure-deterministic
 * score if the API key is missing or the call fails.
 */
async function computeScores(
  env: Env,
  e: AttomEnrichment,
  signals: ReturnType<typeof scoreMotivatedSignals>,
  askingPrice?: number,
): Promise<DealScores> {
  const arv = e.avmValue || 0;
  const asking = askingPrice || e.lastSaleAmt || 0;
  const equitySpread = arv && asking ? arv - asking : 0;
  const equityPct = arv ? Math.round((equitySpread / arv) * 100) : 0;

  const facts = {
    arv,
    asking,
    equitySpread,
    equityPct,
    beds: e.beds ?? null,
    baths: e.baths ?? null,
    sqft: e.sqft ?? null,
    yearBuilt: e.yearBuilt ?? null,
    motivatedScore: signals.score,
    motivatedFlags: signals.flags,
    state: (e.resolvedAddress || "").split(",").slice(-1)[0]?.trim() || null,
  };

  if (!env.ANTHROPIC_API_KEY) {
    return deterministicFallback(facts);
  }

  const systemPrompt = `You are APG's deal-scoring engine. Given ATTOM-derived property facts, output STRICT JSON scoring the property 0-100 for three exit strategies and recommending one.

Rubric:
- wholesale: reward high equity spread, motivated-seller signals, asking well below ARV. 80+ = strong assignable spread.
- flip: reward equity spread net of an assumed 15% rehab + 10% holding/selling cost; reward older homes (renovation upside) but penalize negative net spread.
- airbnb: reward 3+ beds / 2+ baths, ARV stability, and Northern NJ / Route 30 PA corridor fit (APG's active markets). Penalize tiny units.
- recommended: the single best of Wholesale | Flip | Airbnb, or "Pass" if all three < 40.
Be conservative. Never invent numbers beyond what's given.`;

  const userPrompt = `Property facts:\n${JSON.stringify(facts, null, 2)}\n\nReturn ONLY JSON:\n{"wholesale":int,"flip":int,"airbnb":int,"recommended":"Wholesale"|"Flip"|"Airbnb"|"Pass","rationale":"one sentence"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5", // cheap; this is a high-volume scoring call
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn(`[score] Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return deterministicFallback(facts);
    }
    const data: any = await res.json();
    let text = (data?.content?.[0]?.text || "").trim();
    const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) text = m[1];
    const parsed = JSON.parse(text) as DealScores;
    // Clamp to 0-100 defensively.
    parsed.wholesale = clamp(parsed.wholesale);
    parsed.flip = clamp(parsed.flip);
    parsed.airbnb = clamp(parsed.airbnb);
    return parsed;
  } catch (e2) {
    console.warn(`[score] Claude parse/call failed: ${e2}`);
    return deterministicFallback(facts);
  }
}

function deterministicFallback(f: any): DealScores {
  const wholesale = clamp(f.equityPct * 1.5 + f.motivatedScore * 12);
  const flip = clamp(f.equityPct - 25 + (f.yearBuilt && f.yearBuilt < 1990 ? 15 : 0));
  const airbnb = clamp((f.beds >= 3 ? 40 : 20) + (f.baths >= 2 ? 20 : 0) + (f.arv ? 20 : 0));
  const best = Math.max(wholesale, flip, airbnb);
  const recommended =
    best < 40 ? "Pass" : wholesale === best ? "Wholesale" : flip === best ? "Flip" : "Airbnb";
  return {
    wholesale,
    flip,
    airbnb,
    recommended,
    rationale: `Deterministic fallback (no LLM): ${f.equityPct}% equity, ${f.motivatedScore}/4 motivated.`,
  };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function recordClaim(env: Env, contactId: string, claim: Record<string, unknown>): Promise<void> {
  const rec = { agent: "deal-scorer", layer: "L3", contactId, claim, at: new Date().toISOString() };
  await env.DIAL_STATE.put(CLAIM_PREFIX + contactId, JSON.stringify(rec), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}
