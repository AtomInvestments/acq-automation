/**
 * sms-bot.ts — Phase 1 / Module 1D  (L3 agent)
 *
 * Generates a first-touch SMS with Claude (Haiku), sends it, and logs it.
 * Triggered by: contact created (1A enqueues) OR an ACQ stage change (the GHL
 * webhook can enqueue). Event-driven, no cron.
 *
 * STRATEGY GUARDRAIL (tyler/project_apg_strategy.md + reference_apg_infrastructure.md):
 *   APG outbound SMS is DELIBERATELY HALTED — the Twilio number is voice-only,
 *   cold calling is prioritized. So this agent is HARD-GATED behind a KV flag
 *   `sms_bot:enabled` that defaults to OFF. enqueueSmsFirstTouch is a no-op
 *   unless Mido flips the flag. The code is built and ready, but it will not
 *   send a single message until the strategy changes. This mirrors the
 *   existing drip_agent:enabled / qualified_alerts:enabled KV toggles in
 *   index.ts.
 *
 * Send channel: GHL Conversations API (NOT direct Twilio). Per the Env note in
 * index.ts, "Listing-realtor SMS goes via GHL Conversations API, not direct
 * Twilio" — so APG's number, compliance, and opt-out handling all stay inside
 * GHL. This keeps STOP/opt-out + the DNC tag flow centralized.
 *
 * Reuses: GHL_BASE, APG_LOCATION_ID, ghlHeaders, addNote, Env (index.ts).
 */

import type { Env } from "./index";
import { GHL_BASE, APG_LOCATION_ID, ghlHeaders, addNote } from "./index";

const QUEUE_PREFIX = "sms:queue:";
const SENT_PREFIX = "sms:sent:"; // dedupe — never first-touch the same contact twice
const CLAIM_PREFIX = "sms:claim:";
const ENABLED_FLAG = "sms_bot:enabled"; // KV; "true" to allow sends. Default OFF.

interface SmsJob {
  contactId: string;
  phone: string;
  firstName: string;
  trigger: string; // "contact_created" | "stage_change"
  enqueuedAt: string;
}

/** Producer. No-op when the agent is disabled (the default). */
export async function enqueueSmsFirstTouch(
  env: Env,
  job: { contactId: string; phone: string; firstName: string; trigger?: string },
): Promise<void> {
  const enabled = (await env.DIAL_STATE.get(ENABLED_FLAG)) === "true";
  if (!enabled) {
    console.log(`[sms] disabled — skipping enqueue for contact=${job.contactId} (strategy: SMS halted)`);
    return;
  }
  if (!job.phone) return;
  // Dedupe: if we've already first-touched this contact, skip.
  if (await env.DIAL_STATE.get(SENT_PREFIX + job.contactId)) return;

  const payload: SmsJob = {
    contactId: job.contactId,
    phone: job.phone,
    firstName: job.firstName,
    trigger: job.trigger || "contact_created",
    enqueuedAt: new Date().toISOString(),
  };
  await env.DIAL_STATE.put(QUEUE_PREFIX + job.contactId, JSON.stringify(payload), {
    expirationTtl: 60 * 60 * 24 * 3,
  });
  console.log(`[sms] queued contact=${job.contactId}`);
}

/** Consumer — drain queued SMS jobs. Double-checks the enabled flag. */
export async function drainSmsQueue(env: Env, max = 10): Promise<number> {
  const enabled = (await env.DIAL_STATE.get(ENABLED_FLAG)) === "true";
  if (!enabled) return 0;

  const list = await env.DIAL_STATE.list({ prefix: QUEUE_PREFIX, limit: max });
  let done = 0;
  for (const k of list.keys) {
    const raw = await env.DIAL_STATE.get(k.name);
    if (!raw) continue;
    let job: SmsJob;
    try {
      job = JSON.parse(raw);
    } catch {
      await env.DIAL_STATE.delete(k.name);
      continue;
    }
    try {
      await sendOne(env, job);
      await env.DIAL_STATE.delete(k.name);
      done++;
    } catch (e) {
      console.error(`[sms] send failed contact=${job.contactId}: ${e}`);
    }
  }
  if (done) console.log(`[sms] sent ${done} message(s)`);
  return done;
}

async function sendOne(env: Env, job: SmsJob): Promise<void> {
  // Idempotency guard inside the consumer too.
  if (await env.DIAL_STATE.get(SENT_PREFIX + job.contactId)) return;

  const message = await generateSms(env, job.firstName);
  if (!message) {
    console.warn(`[sms] no message generated for contact=${job.contactId}`);
    return;
  }

  // Send via GHL Conversations API — type SMS, scoped to the contact.
  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST",
    headers: ghlHeaders(env.BLAKE_GHL_PIT),
    body: JSON.stringify({
      type: "SMS",
      contactId: job.contactId,
      locationId: APG_LOCATION_ID,
      message,
    }),
  });
  const text = await res.text();
  const ok = res.ok;

  // Mark sent (dedupe) + log to the contact timeline + record the L3 claim.
  await env.DIAL_STATE.put(SENT_PREFIX + job.contactId, new Date().toISOString(), {
    expirationTtl: 60 * 60 * 24 * 90,
  });
  await addNote(env.BLAKE_GHL_PIT, job.contactId, `📱 SMS bot sent: "${message}"`);
  await recordClaim(env, job.contactId, { ok, message, status: res.status, body: text.slice(0, 200) });

  if (!ok) console.warn(`[sms] GHL conversations send failed: ${res.status} ${text.slice(0, 200)}`);
  else console.log(`[sms] sent to contact=${job.contactId}`);
}

/** Generate a short, compliant first-touch SMS with Claude Haiku. */
async function generateSms(env: Env, firstName: string): Promise<string | null> {
  const name = (firstName || "").trim();
  if (!env.ANTHROPIC_API_KEY) {
    // Deterministic fallback template (no LLM).
    return `Hi${name ? " " + name : ""}, this is APG — we buy homes in your area as-is, no fees. Would you consider a cash offer? Reply STOP to opt out.`;
  }
  const systemPrompt = `You write a single first-touch real-estate acquisition SMS for APG (Atom Property Group). Rules:
- 1 message, under 320 chars.
- Friendly, plain, NOT salesy or spammy.
- Mention buying as-is / cash / no fees.
- MUST end with "Reply STOP to opt out." (CAN-SPAM / TCPA compliance).
- No emojis. No links. Address the person by first name if given.
Output ONLY the SMS text, nothing else.`;
  const userPrompt = `First name: ${name || "(unknown)"}\nWrite the SMS.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn(`[sms] Claude ${res.status}`);
      return `Hi${name ? " " + name : ""}, this is APG — we buy homes as-is for cash, no fees. Open to a quick offer? Reply STOP to opt out.`;
    }
    const data: any = await res.json();
    let msg = (data?.content?.[0]?.text || "").trim();
    // Safety net — guarantee the opt-out clause is present.
    if (!/stop/i.test(msg)) msg += " Reply STOP to opt out.";
    return msg.slice(0, 320);
  } catch {
    return `Hi${name ? " " + name : ""}, this is APG — we buy homes as-is for cash, no fees. Reply STOP to opt out.`;
  }
}

async function recordClaim(env: Env, contactId: string, claim: Record<string, unknown>): Promise<void> {
  const rec = { agent: "sms-bot", layer: "L3", contactId, claim, at: new Date().toISOString() };
  await env.DIAL_STATE.put(CLAIM_PREFIX + contactId, JSON.stringify(rec), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}
