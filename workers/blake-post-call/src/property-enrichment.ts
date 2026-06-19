/**
 * property-enrichment.ts — Phase 1 / Module 1B  (L3 agent)
 *
 * Async property-enrichment agent. Drains the `enrich:` KV queue, runs each
 * address through the EXISTING ATTOM integration (attom.ts), writes the
 * resolved facts back onto the GHL contact's custom fields, and drops a Slack
 * note when the property scores as a motivated seller.
 *
 * This is an L3 "doer" agent — it performs an action and records a claim
 * ("I enriched contact X with sqft=Y") that the L6 fact-checker (1E) later
 * verifies. It does NOT self-grade.
 *
 * Why a KV queue instead of inline: ATTOM is a 3-call round trip (~1-2s) and
 * is rate-limited (~5k/mo on the trial key). The form handler (1A) and the
 * GHL webhook stay sub-second by enqueueing; this agent drains the queue
 * either piggy-backed on the next event (drainEnrichmentQueue called from the
 * scheduled handler or from any webhook's waitUntil) — event-driven, not a
 * dedicated cron (tyler/feedback_event_driven_no_cron.md).
 *
 * Reuses from index.ts: GHL_BASE, ghlHeaders, CF_BEDS/BATHS/SQFT, Env.
 * Reuses from attom.ts: enrichPropertyViaAttom, scoreMotivatedSignals,
 *                       formatEnrichmentForGhlNote, formatEnrichmentForSlack.
 * Reuses from index.ts: postSlackMessage, addNote, setContactCustomField.
 */

import type { Env } from "./index";
import {
  GHL_BASE,
  CF_BEDS,
  CF_BATHS,
  CF_SQFT,
  ghlHeaders,
  setContactCustomField,
  addNote,
  postSlackMessage,
} from "./index";
import {
  enrichPropertyViaAttom,
  scoreMotivatedSignals,
  formatEnrichmentForGhlNote,
  formatEnrichmentForSlack,
} from "./attom";

// Slack channel for motivated-seller alerts (Pillar B leadgen channel).
const ENRICH_SLACK_CHANNEL = "#base1-sms-leadgen";
const QUEUE_PREFIX = "enrich:queue:";
const CLAIM_PREFIX = "enrich:claim:"; // L3 claim record, consumed by 1E fact-checker
const MOTIVATED_THRESHOLD = 2; // 0-4 score; >= this triggers a Slack alert

interface EnrichJob {
  contactId: string;
  address: string;
  source: string;
  enqueuedAt: string;
}

/** Producer — called by 1A / GHL webhook. Cheap KV write, no ATTOM call. */
export async function enqueueEnrichment(
  env: Env,
  job: { contactId: string; address: string; source: string },
): Promise<void> {
  const key = QUEUE_PREFIX + job.contactId;
  const payload: EnrichJob = { ...job, enqueuedAt: new Date().toISOString() };
  // 7-day TTL so a stuck job self-expires instead of poisoning the queue.
  await env.DIAL_STATE.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 7 });
  console.log(`[enrich] queued contact=${job.contactId} addr="${job.address}"`);
}

/**
 * Consumer — drain up to `max` queued jobs. Call from a webhook's ctx.waitUntil
 * or the scheduled() handler. Each successful enrichment deletes its queue key.
 */
export async function drainEnrichmentQueue(env: Env, max = 10): Promise<number> {
  const list = await env.DIAL_STATE.list({ prefix: QUEUE_PREFIX, limit: max });
  let done = 0;
  for (const k of list.keys) {
    const raw = await env.DIAL_STATE.get(k.name);
    if (!raw) continue;
    let job: EnrichJob;
    try {
      job = JSON.parse(raw);
    } catch {
      await env.DIAL_STATE.delete(k.name);
      continue;
    }
    try {
      await enrichOne(env, job);
      await env.DIAL_STATE.delete(k.name);
      done++;
    } catch (e) {
      console.error(`[enrich] job failed contact=${job.contactId}: ${e}`);
      // Leave in queue; TTL will eventually expire it if it keeps failing.
    }
  }
  if (done) console.log(`[enrich] drained ${done} job(s)`);
  return done;
}

async function enrichOne(env: Env, job: EnrichJob): Promise<void> {
  const e = await enrichPropertyViaAttom(env, job.address);
  if (e.error || !e.attomId) {
    await recordClaim(env, job.contactId, { ok: false, reason: e.error || "no_match", address: job.address });
    console.log(`[enrich] no ATTOM match contact=${job.contactId} (${e.error})`);
    return;
  }

  // Write back the high-confidence facts onto GHL custom fields. We only
  // overwrite when ATTOM has a value — never blank an existing field.
  const written: Record<string, string | number> = {};
  if (typeof e.beds === "number") {
    await setContactCustomField(env.BLAKE_GHL_PIT, job.contactId, CF_BEDS, String(e.beds));
    written.beds = e.beds;
  }
  if (typeof e.baths === "number") {
    await setContactCustomField(env.BLAKE_GHL_PIT, job.contactId, CF_BATHS, String(e.baths));
    written.baths = e.baths;
  }
  if (typeof e.sqft === "number") {
    await setContactCustomField(env.BLAKE_GHL_PIT, job.contactId, CF_SQFT, String(e.sqft));
    written.sqft = e.sqft;
  }

  // Human-readable enrichment note on the contact timeline.
  // formatEnrichmentForGhlNote(e, propertyAddress, mao?) — pass the resolved
  // address (falls back to the input address) as the 2nd arg.
  const note = formatEnrichmentForGhlNote(e, e.resolvedAddress || job.address);
  if (note) await addNote(env.BLAKE_GHL_PIT, job.contactId, note);

  // Motivated-seller scoring → Slack alert when the signal is strong.
  const signals = scoreMotivatedSignals(e);
  if (signals.score >= MOTIVATED_THRESHOLD) {
    const slack = formatEnrichmentForSlack(e);
    const flagLines = signals.flags.join("\n");
    await postSlackMessage(
      env,
      ENRICH_SLACK_CHANNEL,
      `*Motivated-seller signal (${signals.score}/4)* — contact \`${job.contactId}\`\n${flagLines}\n${slack}`,
    );
  }

  // Record the L3 claim for the fact-checker (1E).
  await recordClaim(env, job.contactId, {
    ok: true,
    attomId: e.attomId,
    resolvedAddress: e.resolvedAddress,
    avmValue: e.avmValue,
    written,
    motivatedScore: signals.score,
    cacheHit: e.cacheHit,
  });

  console.log(
    `[enrich] contact=${job.contactId} attom=${e.attomId} wrote=${JSON.stringify(written)} score=${signals.score}`,
  );
}

/** Persist an L3 claim record (what this agent asserts it did). 1E audits these. */
async function recordClaim(env: Env, contactId: string, claim: Record<string, unknown>): Promise<void> {
  const rec = {
    agent: "property-enrichment",
    layer: "L3",
    contactId,
    claim,
    at: new Date().toISOString(),
  };
  await env.DIAL_STATE.put(CLAIM_PREFIX + contactId, JSON.stringify(rec), {
    expirationTtl: 60 * 60 * 24 * 30, // 30d — fact-checker runs weekly
  });
}
