/**
 * fact-checker.ts — Phase 1 / Module 1E  (L6 auditor)
 *
 * The L6 auditor. The L3 "doer" agents (1B enrichment, 1C scorer, 1D SMS)
 * each record a CLAIM in KV every time they act ("I wrote sqft=1820 to
 * contact X", "I sent this SMS to contact Y"). This auditor independently
 * VERIFIES those claims against the actual GHL contact record, then computes
 * a per-agent Trust Score = verified_claims / total_claims.
 *
 * Why a separate layer: an L3 agent that self-reports success is unreliable
 * (it can "succeed" at writing a field that GHL silently dropped — exactly the
 * bug in tyler/feedback_ghl_api.md). L6 re-reads ground truth and grades.
 *
 * Trigger: volume-triggered, NOT calendar-cron (tyler/feedback_event_driven_no_cron.md).
 *   Call runFactCheck() from the scheduled() handler's weekly branch OR when
 *   N claims have accumulated. It also writes a weekly snapshot so trust trends
 *   over time. (If you DO wire it to the existing "0 4 * * *" daily cron, gate
 *   it to run only when the ISO week changes — see shouldRunWeekly.)
 *
 * Output:
 *   - trust:score:<agent>           latest trust score per agent (0-1)
 *   - trust:snapshot:<isoWeek>      JSON snapshot of all agents for that week
 *   - posts a summary to Slack (#base1-sms-leadgen) on each run
 *
 * Reuses: GHL_BASE, ghlHeaders, postSlackMessage, CF_BEDS/BATHS/SQFT, Env.
 */

import type { Env } from "./index";
import { GHL_BASE, ghlHeaders, postSlackMessage, CF_BEDS, CF_BATHS, CF_SQFT } from "./index";

const TRUST_SLACK_CHANNEL = "#base1-sms-leadgen";

// The claim namespaces each L3 agent writes to (must match the producers).
const CLAIM_NAMESPACES: Record<string, string> = {
  "property-enrichment": "enrich:claim:",
  "deal-scorer": "score:claim:",
  "sms-bot": "sms:claim:",
};

interface AgentAudit {
  agent: string;
  total: number;
  verified: number;
  failedClaims: number; // claims the agent itself recorded as ok:false
  trustScore: number; // verified / (total - failedClaims), 0-1
  samples: string[]; // a few human-readable verification lines
}

/** Entry point. Audits every L3 agent, snapshots, and posts to Slack. */
export async function runFactCheck(env: Env): Promise<Record<string, AgentAudit>> {
  const results: Record<string, AgentAudit> = {};
  for (const [agent, prefix] of Object.entries(CLAIM_NAMESPACES)) {
    results[agent] = await auditAgent(env, agent, prefix);
  }

  const week = isoWeek(new Date());
  await env.DIAL_STATE.put(`trust:snapshot:${week}`, JSON.stringify({ week, results, at: new Date().toISOString() }), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
  for (const [agent, a] of Object.entries(results)) {
    await env.DIAL_STATE.put(`trust:score:${agent}`, a.trustScore.toFixed(3), {
      expirationTtl: 60 * 60 * 24 * 90,
    });
  }

  await postTrustSummary(env, week, results);
  return results;
}

async function auditAgent(env: Env, agent: string, prefix: string): Promise<AgentAudit> {
  const audit: AgentAudit = { agent, total: 0, verified: 0, failedClaims: 0, trustScore: 1, samples: [] };
  const list = await env.DIAL_STATE.list({ prefix, limit: 1000 });

  for (const k of list.keys) {
    const raw = await env.DIAL_STATE.get(k.name);
    if (!raw) continue;
    let rec: any;
    try {
      rec = JSON.parse(raw);
    } catch {
      continue;
    }
    audit.total++;
    const claim = rec.claim || {};
    if (claim.ok === false) {
      // The agent honestly recorded a no-op/failure — not counted against trust.
      audit.failedClaims++;
      continue;
    }

    const ok = await verifyClaim(env, agent, rec.contactId, claim);
    if (ok) audit.verified++;
    if (audit.samples.length < 5) {
      audit.samples.push(`${ok ? "✓" : "✗"} ${rec.contactId} ${summarizeClaim(agent, claim)}`);
    }
  }

  const denom = audit.total - audit.failedClaims;
  audit.trustScore = denom > 0 ? audit.verified / denom : 1;
  return audit;
}

/** Re-read GHL ground truth and confirm the claim actually landed. */
async function verifyClaim(env: Env, agent: string, contactId: string, claim: any): Promise<boolean> {
  if (!contactId) return false;

  if (agent === "property-enrichment") {
    // Verify the custom fields the agent claims it wrote are actually present.
    const written = claim.written || {};
    if (Object.keys(written).length === 0) return true; // nothing claimed written → vacuously ok
    const contact = await getContact(env, contactId);
    if (!contact) return false;
    const cf = indexCustomFields(contact);
    const checks: boolean[] = [];
    if (written.beds != null) checks.push(String(cf[CF_BEDS]) === String(written.beds));
    if (written.baths != null) checks.push(String(cf[CF_BATHS]) === String(written.baths));
    if (written.sqft != null) checks.push(String(cf[CF_SQFT]) === String(written.sqft));
    return checks.length > 0 && checks.every(Boolean);
  }

  if (agent === "deal-scorer") {
    // Scores are advisory (LLM). We only verify the claim is well-formed:
    // three integer scores 0-100 and a recommendation. (Ground-truth ROI
    // can't be checked until a deal closes — out of scope for L6 here.)
    const s = claim.scores || {};
    return (
      isPct(s.wholesale) &&
      isPct(s.flip) &&
      isPct(s.airbnb) &&
      ["Wholesale", "Flip", "Airbnb", "Pass"].includes(s.recommended)
    );
  }

  if (agent === "sms-bot") {
    // Verify the send was accepted by GHL (status 2xx). A dropped send is a
    // trust failure even though the agent attempted it.
    return claim.ok === true && Number(claim.status) >= 200 && Number(claim.status) < 300;
  }

  return false;
}

async function getContact(env: Env, contactId: string): Promise<any | null> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(env.BLAKE_GHL_PIT),
  });
  if (!res.ok) return null;
  try {
    const j: any = await res.json();
    return j.contact || j;
  } catch {
    return null;
  }
}

function indexCustomFields(contact: any): Record<string, string> {
  const out: Record<string, string> = {};
  const arr = contact.customFields || contact.customField || [];
  for (const f of arr) {
    const id = f.id || f.fieldId;
    const val = f.value ?? f.field_value ?? f.fieldValue;
    if (id != null) out[id] = String(val);
  }
  return out;
}

function summarizeClaim(agent: string, claim: any): string {
  if (agent === "property-enrichment") return `wrote ${JSON.stringify(claim.written || {})}`;
  if (agent === "deal-scorer") return claim.scores ? `${claim.scores.recommended}` : "no scores";
  if (agent === "sms-bot") return `status=${claim.status}`;
  return "";
}

async function postTrustSummary(env: Env, week: string, results: Record<string, AgentAudit>): Promise<void> {
  const lines = Object.values(results)
    .map(
      (a) =>
        `• *${a.agent}* — trust ${(a.trustScore * 100).toFixed(0)}% (${a.verified}/${a.total - a.failedClaims} verified, ${a.failedClaims} no-ops)`,
    )
    .join("\n");
  await postSlackMessage(env, TRUST_SLACK_CHANNEL, `🔍 *L6 Fact-Checker — week ${week}*\n${lines}`);
}

function isPct(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
}

/** ISO week string like "2026-W25". */
function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Helper for the scheduled() handler: only run once per ISO week. */
export async function shouldRunWeekly(env: Env): Promise<boolean> {
  const week = isoWeek(new Date());
  const last = await env.DIAL_STATE.get("trust:last_run_week");
  if (last === week) return false;
  await env.DIAL_STATE.put("trust:last_run_week", week, { expirationTtl: 60 * 60 * 24 * 60 });
  return true;
}
