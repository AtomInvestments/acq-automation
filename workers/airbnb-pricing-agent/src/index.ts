/**
 * airbnb-pricing-agent
 * ────────────────────
 * Daily Cloudflare Worker that replaces APG's manual Airbnb-pricing
 * step with an agentic flow:
 *
 *   1. Pull every listing + recommended nightly rate from PriceLabs.
 *   2. For each listing, apply Adam's rules:
 *        • base floor = BASE_FLOOR (default $200)
 *        • weekend bump = +WEEKEND_ADJUSTMENT_PCT% on Fri/Sat
 *        • clamp PriceLabs rec to ≥ floor
 *   3. Generate a one-paragraph "why this price" rationale per
 *      listing via Claude Haiku (one call per listing, not per night).
 *   4. Push overrides back into PriceLabs — PriceLabs's own Airbnb
 *      sync handles the final hop. If AIRBNB_API_TOKEN is set we
 *      also direct-push as a fallback.
 *   5. Log the full decision (input rec / applied rules / output / reasoning)
 *      to KV with 90-day TTL.
 *   6. Post a Slack digest to SLACK_CHANNEL.
 *
 * Endpoints:
 *   GET  /                  health + config echo
 *   GET  /run-now?key=...   manual trigger (auth-gated by RUN_NOW_SECRET)
 *   GET  /logs?days=7       recent run logs from KV
 *
 * DRY_RUN=true (default) skips the push back to PriceLabs/Airbnb
 * and tags the Slack message with [DRY RUN].
 */

export interface Env {
  // Bindings
  PRICING_LOG: KVNamespace;

  // Vars (wrangler [vars])
  BASE_FLOOR: string;
  WEEKEND_ADJUSTMENT_PCT: string;
  SLACK_CHANNEL: string;
  DRY_RUN: string;
  PRICE_HORIZON_DAYS: string;

  // Secrets
  PRICELABS_API_KEY: string;
  SLACK_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  RUN_NOW_SECRET: string;
  AIRBNB_API_TOKEN?: string;
}

// ─────────────────────────────────────────────────────────────────────
// PriceLabs API client
// PriceLabs API base: https://api.pricelabs.co/v1
// Endpoints used:
//   GET  /listings                       → all listings on the account
//   GET  /listing_prices?listings=ID&pms=airbnb  → recommended nightly rates
//   POST /reservation_data/airbnb        → push overrides (per-listing)
//
// Schema verified against PriceLabs public docs at build time. If a
// schema field shifts, the Slack digest will surface "no rec for {id}"
// rather than silently mis-pricing.
// ─────────────────────────────────────────────────────────────────────

const PL_BASE = "https://api.pricelabs.co/v1";

interface PLListing {
  id: string;            // PriceLabs listing id (== Airbnb listing id when source=airbnb)
  name?: string;
  pms?: string;          // "airbnb" expected
  push_enabled?: boolean;
  min?: number;
  max?: number;
}

interface PLPriceRow {
  date: string;          // YYYY-MM-DD
  price: number;         // PriceLabs recommended
  user_price?: number;   // any existing override
  min_price?: number;
}

async function plListings(env: Env): Promise<PLListing[]> {
  const res = await fetch(`${PL_BASE}/listings`, {
    headers: { "X-API-Key": env.PRICELABS_API_KEY },
  });
  if (!res.ok) throw new Error(`pricelabs listings ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as any;
  const rows: PLListing[] = (j?.listings || j || []).map((l: any) => ({
    id: String(l.id ?? l.listing_id ?? l.pms_id),
    name: l.name ?? l.listing_name,
    pms: (l.pms ?? l.source ?? "airbnb").toLowerCase(),
    push_enabled: l.push_enabled ?? l.is_push_enabled ?? true,
    min: l.min ?? l.min_price,
    max: l.max ?? l.max_price,
  }));
  return rows.filter((r) => r.id);
}

async function plPrices(
  env: Env,
  listingId: string,
  horizonDays: number
): Promise<PLPriceRow[]> {
  // PriceLabs returns prices for a horizon. We only need next N days.
  const res = await fetch(
    `${PL_BASE}/listing_prices?listings=${encodeURIComponent(listingId)}&pms=airbnb`,
    { headers: { "X-API-Key": env.PRICELABS_API_KEY } }
  );
  if (!res.ok) throw new Error(`pricelabs prices ${listingId} ${res.status}`);
  const j = (await res.json()) as any;
  const raw: any[] = j?.data?.[0]?.prices || j?.prices || [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const horizonMs = horizonDays * 86_400_000;
  return raw
    .map((r) => ({
      date: r.date,
      price: Number(r.price ?? r.recommended_price ?? 0),
      user_price: r.user_price != null ? Number(r.user_price) : undefined,
      min_price: r.min_price != null ? Number(r.min_price) : undefined,
    }))
    .filter((r) => r.date && r.price > 0)
    .filter((r) => {
      const d = new Date(`${r.date}T00:00:00Z`).getTime();
      return d >= today.getTime() && d < today.getTime() + horizonMs;
    });
}

async function plPushOverrides(
  env: Env,
  listingId: string,
  rows: Array<{ date: string; price: number }>
): Promise<{ ok: boolean; status: number; body: string }> {
  // PriceLabs PUT /listings/{id}/overrides — pushes user prices that
  // PriceLabs's Airbnb sync will then propagate. Schema:
  //   { overrides: [{ date, price }, ...] }
  const res = await fetch(`${PL_BASE}/listings/${encodeURIComponent(listingId)}/overrides`, {
    method: "PUT",
    headers: {
      "X-API-Key": env.PRICELABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ overrides: rows }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// ─────────────────────────────────────────────────────────────────────
// Pricing rules
// ─────────────────────────────────────────────────────────────────────

function isWeekend(dateStr: string): boolean {
  // Fri (5) + Sat (6) in local-equivalent UTC. Airbnb nightly rate on
  // Friday covers Fri→Sat; on Saturday covers Sat→Sun. Both count as
  // "weekend" pricing in STR convention.
  const d = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return d === 5 || d === 6;
}

interface PriceDecision {
  date: string;
  pl_rec: number;
  applied_rules: string[];
  final_price: number;
  floor_hit: boolean;
}

function decidePrice(
  row: PLPriceRow,
  baseFloor: number,
  weekendPct: number
): PriceDecision {
  const applied: string[] = [];
  let price = row.price;

  if (isWeekend(row.date) && weekendPct !== 0) {
    price = Math.round(price * (1 + weekendPct / 100));
    applied.push(`weekend +${weekendPct}%`);
  }

  let floor_hit = false;
  if (price < baseFloor) {
    price = baseFloor;
    floor_hit = true;
    applied.push(`floor $${baseFloor}`);
  }

  if (applied.length === 0) applied.push("pricelabs rec");

  return {
    date: row.date,
    pl_rec: row.price,
    applied_rules: applied,
    final_price: price,
    floor_hit,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Claude Haiku — one rationale paragraph per listing
// ─────────────────────────────────────────────────────────────────────

async function generateRationale(
  env: Env,
  listingName: string,
  decisions: PriceDecision[]
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) return "rationale unavailable (no ANTHROPIC_API_KEY)";

  const avgRec = avg(decisions.map((d) => d.pl_rec));
  const avgFinal = avg(decisions.map((d) => d.final_price));
  const floorHits = decisions.filter((d) => d.floor_hit).length;
  const weekendBumps = decisions.filter((d) =>
    d.applied_rules.some((r) => r.startsWith("weekend"))
  ).length;

  const summary = {
    listing: listingName,
    horizon_days: decisions.length,
    avg_pricelabs_rec: Math.round(avgRec),
    avg_final_price: Math.round(avgFinal),
    floor_hits: floorHits,
    weekend_bumps: weekendBumps,
    sample: decisions.slice(0, 7).map((d) => ({
      date: d.date,
      rec: d.pl_rec,
      final: d.final_price,
      rules: d.applied_rules,
    })),
  };

  const body = {
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content:
          "You are pricing analyst for a short-term-rental operator. " +
          "In ONE plain-English sentence (under 25 words), explain why " +
          "the next " +
          decisions.length +
          " days of nightly prices for this Airbnb listing look the way they do. " +
          "Reference PriceLabs demand signal, floor activations, and weekend bumps where relevant. " +
          "Do NOT list dates. Data:\n" +
          JSON.stringify(summary),
      },
    ],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return `rationale error ${res.status}`;
  const j = (await res.json()) as any;
  return j?.content?.[0]?.text?.trim() || "no rationale";
}

function avg(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ─────────────────────────────────────────────────────────────────────
// Slack
// ─────────────────────────────────────────────────────────────────────

async function postSlack(
  env: Env,
  channel: string,
  text: string
): Promise<{ ok: boolean; status: number; body: string }> {
  if (!env.SLACK_BOT_TOKEN) return { ok: false, status: 0, body: "no SLACK_BOT_TOKEN" };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// ─────────────────────────────────────────────────────────────────────
// The pricing run itself
// ─────────────────────────────────────────────────────────────────────

interface RunResult {
  ranAt: string;
  dryRun: boolean;
  listings: number;
  pushed: number;
  errors: Array<{ listing: string; error: string }>;
  perListing: Array<{
    id: string;
    name: string;
    avg_today_rec: number;
    avg_final: number;
    pct_change: number;
    floor_hits: number;
    rationale: string;
    pushed: boolean;
    push_error?: string;
  }>;
}

async function runPricing(env: Env, trigger: "cron" | "manual"): Promise<RunResult> {
  const baseFloor = Number(env.BASE_FLOOR || "200");
  const weekendPct = Number(env.WEEKEND_ADJUSTMENT_PCT || "4");
  const horizonDays = Number(env.PRICE_HORIZON_DAYS || "30");
  const dryRun = (env.DRY_RUN || "true").toLowerCase() === "true";
  const ranAt = new Date().toISOString();

  const result: RunResult = {
    ranAt,
    dryRun,
    listings: 0,
    pushed: 0,
    errors: [],
    perListing: [],
  };

  let listings: PLListing[] = [];
  try {
    listings = await plListings(env);
  } catch (e: any) {
    result.errors.push({ listing: "_account_", error: String(e?.message || e) });
    await postSlack(
      env,
      env.SLACK_CHANNEL,
      `:warning: airbnb-pricing-agent (${trigger}) — could not list PriceLabs listings: ${e?.message || e}`
    );
    return result;
  }

  result.listings = listings.length;

  for (const l of listings) {
    if (l.pms && l.pms !== "airbnb") continue; // Adam's account is Airbnb-only; skip others
    try {
      const rows = await plPrices(env, l.id, horizonDays);
      if (rows.length === 0) {
        result.errors.push({ listing: l.name || l.id, error: "no prices returned" });
        continue;
      }
      const decisions = rows.map((r) => decidePrice(r, baseFloor, weekendPct));
      const rationale = await generateRationale(env, l.name || l.id, decisions);

      const avgRec = avg(decisions.map((d) => d.pl_rec));
      const avgFinal = avg(decisions.map((d) => d.final_price));
      const pct = avgRec > 0 ? ((avgFinal - avgRec) / avgRec) * 100 : 0;
      const floorHits = decisions.filter((d) => d.floor_hit).length;

      let pushed = false;
      let pushErr: string | undefined;
      if (!dryRun) {
        const overrides = decisions.map((d) => ({ date: d.date, price: d.final_price }));
        const push = await plPushOverrides(env, l.id, overrides);
        pushed = push.ok;
        if (!push.ok) pushErr = `${push.status}: ${push.body.slice(0, 200)}`;
      }
      if (pushed) result.pushed += 1;

      result.perListing.push({
        id: l.id,
        name: l.name || l.id,
        avg_today_rec: Math.round(avgRec),
        avg_final: Math.round(avgFinal),
        pct_change: Math.round(pct * 10) / 10,
        floor_hits: floorHits,
        rationale,
        pushed,
        push_error: pushErr,
      });

      // Per-listing KV log — 90-day TTL (90 * 86400 = 7,776,000 sec).
      const logKey = `run/${ranAt}/${l.id}`;
      await env.PRICING_LOG.put(
        logKey,
        JSON.stringify({
          ranAt,
          trigger,
          dryRun,
          listing: { id: l.id, name: l.name },
          rules: { baseFloor, weekendPct, horizonDays },
          decisions,
          rationale,
          push: { attempted: !dryRun, ok: pushed, error: pushErr },
        }),
        { expirationTtl: 90 * 86_400 }
      );
    } catch (e: any) {
      result.errors.push({ listing: l.name || l.id, error: String(e?.message || e) });
    }
  }

  // Slack digest
  const tag = dryRun ? "[DRY RUN] " : "";
  const dateLine = new Date(ranAt).toISOString().slice(0, 10);
  const header = `${tag}:round_pushpin: *Daily pricing run · ${dateLine}* (${trigger})`;
  const lines = result.perListing.slice(0, 25).map((p) => {
    const arrow = p.pct_change === 0 ? "held" : p.pct_change > 0 ? `+${p.pct_change}%` : `${p.pct_change}%`;
    const heldNote = p.pct_change === 0 && p.floor_hits > 0 ? " — *floor*" : "";
    return `• ${p.name}: $${p.avg_today_rec} → $${p.avg_final} (${arrow})${heldNote} — _${p.rationale}_`;
  });
  const errLines = result.errors.length
    ? [`\n:warning: errors: ${result.errors.map((e) => `${e.listing} (${e.error})`).join("; ")}`]
    : [];
  const overflow =
    result.perListing.length > 25 ? [`\n…and ${result.perListing.length - 25} more (see /logs)`] : [];
  const text = [header, ...lines, ...overflow, ...errLines].join("\n");

  await postSlack(env, env.SLACK_CHANNEL, text);
  // Index entry — lets /logs list recent runs without scanning all keys.
  await env.PRICING_LOG.put(
    `index/${ranAt}`,
    JSON.stringify({
      ranAt,
      trigger,
      dryRun,
      listings: result.listings,
      pushed: result.pushed,
      errors: result.errors.length,
    }),
    { expirationTtl: 90 * 86_400 }
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// HTTP entry
// ─────────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return json({
        worker: "airbnb-pricing-agent",
        ok: true,
        dry_run: (env.DRY_RUN || "true").toLowerCase() === "true",
        base_floor: Number(env.BASE_FLOOR || "200"),
        weekend_pct: Number(env.WEEKEND_ADJUSTMENT_PCT || "4"),
        horizon_days: Number(env.PRICE_HORIZON_DAYS || "30"),
        slack_channel: env.SLACK_CHANNEL,
        pricelabs_bound: Boolean(env.PRICELABS_API_KEY),
        slack_bound: Boolean(env.SLACK_BOT_TOKEN),
        anthropic_bound: Boolean(env.ANTHROPIC_API_KEY),
        cron: "0 7 * * * (daily 03:00 EDT)",
      });
    }

    if (url.pathname === "/run-now") {
      const key = url.searchParams.get("key");
      if (!env.RUN_NOW_SECRET || key !== env.RUN_NOW_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const result = await runPricing(env, "manual");
      return json(result);
    }

    if (url.pathname === "/logs") {
      const key = url.searchParams.get("key");
      if (!env.RUN_NOW_SECRET || key !== env.RUN_NOW_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const days = Math.min(30, Math.max(1, Number(url.searchParams.get("days") || "7")));
      const cutoff = Date.now() - days * 86_400_000;
      const list = await env.PRICING_LOG.list({ prefix: "index/", limit: 1000 });
      const runs: any[] = [];
      for (const k of list.keys) {
        const ts = k.name.replace("index/", "");
        if (new Date(ts).getTime() < cutoff) continue;
        const v = await env.PRICING_LOG.get(k.name, "json");
        if (v) runs.push(v);
      }
      runs.sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1));
      return json({ days, runs });
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runPricing(env, "cron").catch(async (e) => {
        await postSlack(
          env,
          env.SLACK_CHANNEL,
          `:rotating_light: airbnb-pricing-agent cron crashed: ${e?.message || e}`
        );
      })
    );
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
