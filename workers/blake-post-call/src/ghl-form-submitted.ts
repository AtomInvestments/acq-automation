/**
 * ghl-form-submitted.ts — Phase 1 / Module 1A
 *
 * Real-time webhook handler for a GHL Form/Survey submission (or any inbound
 * "new lead" event GHL Workflow Builder can POST to us). It:
 *   1. Upserts a GHL contact from the form fields (idempotent).
 *   2. Tags the contact (source + pipeline tags).
 *   3. Creates an ACQ opportunity in the UNQUALIFIED stage.
 *   4. Enqueues the contact for async property enrichment + deal scoring
 *      (KV queue — drained by the enrichment + scorer agents).
 *   5. Optionally enqueues the SMS-bot first-touch.
 *
 * Architecture rule (tyler/feedback_event_driven_no_cron.md):
 *   Real-time webhook, never cron. We return 200 immediately and push the
 *   slow work (enrichment, scoring, SMS) into ctx.waitUntil + a KV queue so
 *   GHL's Workflow Builder never blocks on us.
 *
 * Wiring (add to the router in index.ts):
 *   if (req.method === "POST" && url.pathname === "/ghl-form-submitted") {
 *     return handleGhlFormSubmitted(req, env, ctx);
 *   }
 *
 * Auth: same shared-secret model as handleGhlWebhook — `?token=` query param
 * OR `Authorization: Bearer <secret>`, constant-time compared to
 * env.GHL_WEBHOOK_SECRET. (Reuses constantTimeEqual from index.ts.)
 *
 * This file assumes the following already exist in index.ts (do NOT redeclare):
 *   GHL_BASE, APG_LOCATION_ID, ACQ_PIPELINE_ID, STAGE_UNQUALIFIED, USER_RJ,
 *   CF_BEDS, CF_BATHS, CF_SQFT, CF_ASKING, CF_MOTIVATION, CF_TIMELINE,
 *   ghlHeaders(), constantTimeEqual(), Env.
 *
 * It imports the shared enrichment/scoring/SMS queue helpers from
 * ./phase1-queue (see property-enrichment.ts, deal-scorer.ts, sms-bot.ts).
 */

import type { Env } from "./index";
import {
  GHL_BASE,
  APG_LOCATION_ID,
  ACQ_PIPELINE_ID,
  STAGE_UNQUALIFIED,
  USER_RJ,
  CF_BEDS,
  CF_BATHS,
  CF_SQFT,
  CF_ASKING,
  CF_MOTIVATION,
  CF_TIMELINE,
  ghlHeaders,
  constantTimeEqual,
} from "./index";
import { enqueueEnrichment } from "./property-enrichment";
import { enqueueDealScore } from "./deal-scorer";
import { enqueueSmsFirstTouch } from "./sms-bot";

interface FormLead {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  askingPrice?: string;
  motivation?: string;
  timeline?: string;
  source?: string;
}

export async function handleGhlFormSubmitted(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // 1. Auth (mirror handleGhlWebhook exactly).
  const url = new URL(req.url);
  const expected = env.GHL_WEBHOOK_SECRET || "";
  if (!expected) {
    console.error("[ghl-form] GHL_WEBHOOK_SECRET not configured; rejecting");
    return json({ ok: false, error: "secret_not_configured" }, 503);
  }
  const authz = req.headers.get("authorization") || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  const provided = bearer || url.searchParams.get("token") || "";
  if (!provided || !constantTimeEqual(provided, expected)) {
    console.warn("[ghl-form] auth failed");
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // 2. Parse — GHL form payloads vary; be defensive.
  let body: any = {};
  try {
    body = await req.json();
  } catch (e) {
    console.warn(`[ghl-form] invalid_json: ${e}`);
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const lead = normalizeFormPayload(body);
  if (!lead.phone && !lead.email) {
    console.warn("[ghl-form] no phone or email; cannot dedupe contact");
    return json({ ok: false, error: "missing_phone_and_email" }, 422);
  }

  // 3. Return 200 immediately; do the GHL writes + queueing in waitUntil.
  ctx.waitUntil(processFormLead(env, lead));
  return json({ ok: true, queued: true }, 200);
}

function normalizeFormPayload(body: any): FormLead {
  // GHL nests form answers under different keys depending on trigger config.
  const c = body.contact || body.data?.contact || body;
  const cf = c.customData || body.customData || {};
  const name: string = c.full_name || c.name || "";
  return {
    firstName: c.first_name || c.firstName || name.split(" ")[0] || "",
    lastName: c.last_name || c.lastName || name.split(" ").slice(1).join(" ") || "",
    name,
    phone: c.phone || c.phone_number || "",
    email: c.email || "",
    address1: c.address1 || c.address || cf.property_address || "",
    city: c.city || "",
    state: c.state || "",
    postalCode: c.postal_code || c.postalCode || c.zip || "",
    beds: cf.beds || cf.bedrooms || "",
    baths: cf.baths || cf.bathrooms || "",
    sqft: cf.sqft || cf.square_feet || "",
    askingPrice: cf.asking_price || cf.price || "",
    motivation: cf.motivation || cf.reason_for_selling || "",
    timeline: cf.timeline || cf.when_selling || "",
    source: body.source || c.source || "GHL Form",
  };
}

async function processFormLead(env: Env, lead: FormLead): Promise<void> {
  // 3a. Upsert the contact. /contacts/upsert dedupes by phone/email on the
  //     location, so a re-submit updates rather than duplicates.
  const customFields = buildCustomFields(lead);
  const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: "POST",
    headers: ghlHeaders(env.BLAKE_GHL_PIT),
    body: JSON.stringify({
      locationId: APG_LOCATION_ID,
      firstName: lead.firstName || "Web",
      lastName: lead.lastName || "Lead",
      phone: lead.phone || undefined,
      email: lead.email || undefined,
      address1: lead.address1 || undefined,
      city: lead.city || undefined,
      state: lead.state || undefined,
      postalCode: lead.postalCode || undefined,
      source: lead.source || "GHL Form",
      tags: ["web-form", "acq-inbound"],
      customFields: customFields.length ? customFields : undefined,
    }),
  });
  const upsertText = await upsertRes.text();
  let contactId = "";
  try {
    contactId =
      JSON.parse(upsertText)?.contact?.id ||
      JSON.parse(upsertText)?.id ||
      "";
  } catch {}
  if (!contactId) {
    console.error(`[ghl-form] contact upsert failed: ${upsertRes.status} ${upsertText.slice(0, 200)}`);
    return;
  }
  console.log(`[ghl-form] upserted contact=${contactId}`);

  // 3b. Create the ACQ opportunity (UNQUALIFIED entry stage, assigned to RJ
  //     per Mido directive 2026-05-27 — every opp must have assignedTo).
  const oppName = buildOppName(lead);
  const oppRes = await fetch(`${GHL_BASE}/opportunities/`, {
    method: "POST",
    headers: ghlHeaders(env.BLAKE_GHL_PIT),
    body: JSON.stringify({
      locationId: APG_LOCATION_ID,
      pipelineId: ACQ_PIPELINE_ID,
      pipelineStageId: STAGE_UNQUALIFIED,
      contactId,
      name: oppName,
      status: "open",
      source: lead.source || "GHL Form",
      assignedTo: USER_RJ,
    }),
  });
  if (!oppRes.ok) {
    console.warn(`[ghl-form] opp create failed: ${oppRes.status} ${(await oppRes.text()).slice(0, 200)}`);
  }

  // 3c. Enqueue async work. These push a job into the DIAL_STATE KV queue and
  //     are drained by the agent modules (1B/1C/1D). We DON'T block on them.
  const fullAddress = [lead.address1, lead.city, lead.state, lead.postalCode]
    .filter(Boolean)
    .join(", ");
  if (fullAddress) {
    await enqueueEnrichment(env, { contactId, address: fullAddress, source: "ghl_form" });
    await enqueueDealScore(env, { contactId, address: fullAddress, source: "ghl_form" });
  }
  // First-touch SMS is queued only if strategy allows it — sms-bot.ts checks
  // the `sms_bot:enabled` KV flag (default OFF per the halt-SMS strategy).
  await enqueueSmsFirstTouch(env, { contactId, phone: lead.phone || "", firstName: lead.firstName || "" });
}

function buildCustomFields(lead: FormLead): Array<{ id: string; field_value: string }> {
  const fields: Array<{ id: string; field_value: string }> = [];
  if (lead.beds) fields.push({ id: CF_BEDS, field_value: lead.beds });
  if (lead.baths) fields.push({ id: CF_BATHS, field_value: lead.baths });
  if (lead.sqft) fields.push({ id: CF_SQFT, field_value: lead.sqft });
  if (lead.askingPrice) fields.push({ id: CF_ASKING, field_value: lead.askingPrice });
  if (lead.motivation) fields.push({ id: CF_MOTIVATION, field_value: lead.motivation });
  if (lead.timeline) fields.push({ id: CF_TIMELINE, field_value: lead.timeline });
  return fields;
}

function buildOppName(lead: FormLead): string {
  const name = (lead.name || `${lead.firstName} ${lead.lastName}`).trim() || "Web Lead";
  const addr = lead.address1 || lead.city || "";
  const phone = lead.phone || "";
  return [name, addr, phone].filter(Boolean).join(" / ");
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
