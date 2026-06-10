// Messages tab — Airbnb host inbox analytics.
//
// Data source: a JSON snapshot Mido (or whoever runs the local Playwright
// scraper at tools/airbnb-message-scraper/) uploads to
// POST /admin/upload-airbnb-data. The worker stores the latest snapshot in
// KV (DIAL_STATE, key `airbnb:messages:latest`) and the read paths below
// build the analytics on demand.
//
// Companion routes (wired in index.ts):
//   GET  /messages                   — analytics dashboard HTML
//   GET  /messages-data              — JSON payload the page reads
//   POST /admin/upload-airbnb-data   — upload scraped JSON
//
// Auth-gated via requireAuthV2 + the new `messages` permission flag.
//
// Phase 2 (NOT in this file): auto-send replies via Hospitable / Hostaway.
// Their APIs are a separate integration — this tab is read-only analytics
// on top of a scraper.

export interface AirbnbMessage {
  timestamp: string;
  timestamp_raw: string;
  sender: "host" | "guest" | "system";
  text: string;
}

export interface AirbnbThread {
  thread_id: string;
  url?: string;
  guest_name: string;
  listing: string;
  check_in: string;
  check_out: string;
  reservation_status: string;
  host_replied: boolean;
  median_reply_minutes: number | null;
  scraped_at: string;
  messages: AirbnbMessage[];
}

export interface AirbnbSnapshot {
  scraped_at: string;
  thread_count: number;
  message_count: number;
  threads: AirbnbThread[];
}

const KV_KEY_LATEST = "airbnb:messages:latest";
const KV_KEY_META   = "airbnb:messages:meta";

// =============================================================================
// Storage
// =============================================================================

export async function saveAirbnbSnapshot(
  env: { DIAL_STATE: KVNamespace },
  raw: string,
): Promise<{ ok: true; thread_count: number; message_count: number } | { ok: false; error: string }> {
  let parsed: AirbnbSnapshot;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: "invalid JSON" };
  }
  if (!parsed || !Array.isArray(parsed.threads)) {
    return { ok: false, error: "missing threads[]" };
  }
  // Cap stored size — KV value limit is 25 MB. Trim messages if needed.
  let serialized = JSON.stringify(parsed);
  if (serialized.length > 20 * 1024 * 1024) {
    // Drop oldest messages per thread until under the cap.
    for (const t of parsed.threads) {
      if (t.messages.length > 200) t.messages = t.messages.slice(-200);
    }
    serialized = JSON.stringify(parsed);
  }
  await env.DIAL_STATE.put(KV_KEY_LATEST, serialized);
  await env.DIAL_STATE.put(KV_KEY_META, JSON.stringify({
    uploaded_at: new Date().toISOString(),
    thread_count: parsed.thread_count ?? parsed.threads.length,
    message_count: parsed.message_count ?? parsed.threads.reduce((a, t) => a + t.messages.length, 0),
  }));
  return {
    ok: true,
    thread_count: parsed.thread_count ?? parsed.threads.length,
    message_count: parsed.message_count ?? parsed.threads.reduce((a, t) => a + t.messages.length, 0),
  };
}

export async function loadAirbnbSnapshot(
  env: { DIAL_STATE: KVNamespace },
): Promise<AirbnbSnapshot | null> {
  const raw = await env.DIAL_STATE.get(KV_KEY_LATEST);
  if (!raw) return null;
  try { return JSON.parse(raw) as AirbnbSnapshot; } catch { return null; }
}

// =============================================================================
// Analytics
// =============================================================================

interface ResponseBucket { label: string; count: number; }

interface MessagesAnalytics {
  has_data: boolean;
  uploaded_at?: string;
  scraped_at?: string;
  totals: {
    threads_all_time: number;
    threads_last_30d: number;
    guest_messages: number;
    host_messages: number;
    reply_rate_pct: number;
    median_response_min: number | null;
    p95_response_min: number | null;
    inquiry_to_booking_pct: number | null;
  };
  reply_rate_trend: Array<{ week: string; rate_pct: number; volume: number }>;
  response_buckets: ResponseBucket[];
  top_clusters: Array<{ slug: string; label: string; count: number; samples: string[] }>;
  per_listing: Array<{
    listing: string;
    volume: number;
    reply_rate_pct: number;
    median_response_min: number | null;
    inquiry_to_booking_pct: number | null;
  }>;
  heatmap: { guest: number[][]; host: number[][] };   // 7 days × 24 hours
  stale_threads: Array<{
    thread_id: string;
    guest_name: string;
    listing: string;
    last_guest_text: string;
    hours_since: number;
    url?: string;
  }>;
}

function parseTs(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

function bucketResponse(min: number): string {
  if (min <= 15) return "0–15 min";
  if (min <= 60) return "15–60 min";
  if (min <= 240) return "1–4 hr";
  if (min <= 24 * 60) return "4–24 hr";
  return ">24 hr";
}

// Lightweight keyword clustering (no LLM at request time — we run Claude
// classification offline via analyze.py for the proposed-templates output).
// This keeps the dashboard fast + free to render.
const CLUSTER_KEYWORDS: Array<{ slug: string; label: string; words: string[] }> = [
  { slug: "wifi", label: "Wifi",                  words: ["wifi", "wi-fi", "password", "network", "internet"] },
  { slug: "checkin_early", label: "Early check-in", words: ["early check", "check in early", "earlier check"] },
  { slug: "checkin_late", label: "Late check-in",   words: ["late check", "check in late", "after midnight", "arriving late"] },
  { slug: "checkin_standard", label: "Check-in instructions", words: ["check in", "check-in", "lockbox", "code", "keys", "door", "entry"] },
  { slug: "checkout_late", label: "Late checkout",  words: ["late checkout", "late check out", "checkout later", "extend checkout"] },
  { slug: "checkout_instructions", label: "Checkout instructions", words: ["check out", "check-out", "checkout", "leave the keys", "trash"] },
  { slug: "directions_transport", label: "Directions / parking", words: ["direction", "parking", "park", "uber", "lyft", "airport", "transit", "driving"] },
  { slug: "sleeping_arrangement", label: "Beds / sleeping", words: ["bed", "sleep", "pillow", "mattress", "sofa", "couch"] },
  { slug: "listing_availability", label: "Availability / pricing", words: ["available", "availability", "open", "free", "book", "price", "rate"] },
  { slug: "after_departure", label: "After departure", words: ["forgot", "left behind", "review", "thank you", "thanks"] },
  { slug: "before_checkin", label: "Pre-arrival", words: ["looking forward", "see you", "tomorrow", "tonight"] },
  { slug: "booking_confirmation", label: "Booking confirmation", words: ["confirmation", "confirmed", "just booked"] },
];

function clusterOf(text: string): { slug: string; label: string } {
  const lower = (text || "").toLowerCase();
  for (const c of CLUSTER_KEYWORDS) {
    if (c.words.some((w) => lower.includes(w))) return { slug: c.slug, label: c.label };
  }
  return { slug: "other", label: "Other" };
}

export function buildAnalytics(snap: AirbnbSnapshot | null, uploadedAt?: string): MessagesAnalytics {
  if (!snap || !snap.threads.length) {
    return {
      has_data: false,
      totals: {
        threads_all_time: 0, threads_last_30d: 0, guest_messages: 0, host_messages: 0,
        reply_rate_pct: 0, median_response_min: null, p95_response_min: null,
        inquiry_to_booking_pct: null,
      },
      reply_rate_trend: [], response_buckets: [], top_clusters: [],
      per_listing: [], heatmap: { guest: [], host: [] }, stale_threads: [],
    };
  }

  const now = Date.now();
  const day30 = 30 * 24 * 3600 * 1000;
  let guestMessages = 0;
  let hostMessages = 0;
  const responseDeltas: number[] = [];
  const weekBuckets = new Map<string, { guest: number; replied: number }>();
  const responseBucketCounts = new Map<string, number>();
  const clusterCounts = new Map<string, { label: string; count: number; samples: string[] }>();
  const perListing = new Map<string, { volume: number; replied: number; deltas: number[]; inquiries: number; bookings: number }>();
  const heatmapGuest: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const heatmapHost:  number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const staleCandidates: Array<{ thread_id: string; guest_name: string; listing: string; last_guest_text: string; hours_since: number; url?: string }> = [];

  let threads30d = 0;
  let inquiries = 0;
  let bookings = 0;

  for (const t of snap.threads) {
    if (!t.messages || !t.messages.length) continue;
    const firstTs = parseTs(t.messages[0].timestamp);
    if (firstTs && now - firstTs < day30) threads30d++;

    const status = (t.reservation_status || "").toLowerCase();
    if (status === "inquiry") inquiries++;
    if (status === "booked")  bookings++;

    const listingKey = t.listing || "(unknown listing)";
    if (!perListing.has(listingKey)) perListing.set(listingKey, { volume: 0, replied: 0, deltas: [], inquiries: 0, bookings: 0 });
    const pl = perListing.get(listingKey)!;
    if (status === "inquiry") pl.inquiries++;
    if (status === "booked")  pl.bookings++;

    // Track last-guest-without-reply for the stale list.
    let lastGuestUnreplied: { ts: number; text: string } | null = null;

    for (let i = 0; i < t.messages.length; i++) {
      const m = t.messages[i];
      const ts = parseTs(m.timestamp);
      if (m.sender === "guest") {
        guestMessages++;
        if (ts) {
          const d = new Date(ts);
          const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
          heatmapGuest[dow][d.getUTCHours()]++;
        }
        const c = clusterOf(m.text);
        const cur = clusterCounts.get(c.slug) ?? { label: c.label, count: 0, samples: [] };
        cur.count++;
        if (cur.samples.length < 5) cur.samples.push(m.text.slice(0, 200));
        clusterCounts.set(c.slug, cur);
        pl.volume++;
        if (ts) lastGuestUnreplied = { ts, text: m.text };
        // Track weekly volume.
        if (ts) {
          const wk = isoWeek(new Date(ts));
          const w = weekBuckets.get(wk) ?? { guest: 0, replied: 0 };
          w.guest++;
          weekBuckets.set(wk, w);
        }
      } else if (m.sender === "host") {
        hostMessages++;
        if (ts) {
          const d = new Date(ts);
          const dow = (d.getUTCDay() + 6) % 7;
          heatmapHost[dow][d.getUTCHours()]++;
        }
        if (lastGuestUnreplied && ts) {
          const deltaMin = (ts - lastGuestUnreplied.ts) / 60000;
          if (deltaMin >= 0 && deltaMin < 60 * 24 * 14) {
            responseDeltas.push(deltaMin);
            const lbl = bucketResponse(deltaMin);
            responseBucketCounts.set(lbl, (responseBucketCounts.get(lbl) ?? 0) + 1);
            pl.deltas.push(deltaMin);
            // Weekly reply rate
            const wk = isoWeek(new Date(lastGuestUnreplied.ts));
            const w = weekBuckets.get(wk);
            if (w) w.replied++;
            pl.replied++;
          }
          lastGuestUnreplied = null;
        }
      }
    }

    // Stale thread: last guest message unreplied for >2 hours.
    if (lastGuestUnreplied) {
      const hours = (now - lastGuestUnreplied.ts) / 3_600_000;
      if (hours > 2) {
        staleCandidates.push({
          thread_id: t.thread_id,
          guest_name: t.guest_name,
          listing: t.listing,
          last_guest_text: lastGuestUnreplied.text.slice(0, 200),
          hours_since: Math.round(hours * 10) / 10,
          url: t.url,
        });
      }
    }
  }

  const totalGuestRepliedTo = responseDeltas.length;
  const replyRate = pct(totalGuestRepliedTo, guestMessages);

  // Reply rate trend — last ~12 weeks.
  const sortedWeeks = [...weekBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const trend = sortedWeeks.slice(-12).map(([wk, b]) => ({
    week: wk, rate_pct: pct(b.replied, b.guest), volume: b.guest,
  }));

  const BUCKET_ORDER = ["0–15 min", "15–60 min", "1–4 hr", "4–24 hr", ">24 hr"];
  const responseBuckets: ResponseBucket[] = BUCKET_ORDER.map((label) => ({
    label, count: responseBucketCounts.get(label) ?? 0,
  }));

  const topClusters = [...clusterCounts.entries()]
    .map(([slug, v]) => ({ slug, label: v.label, count: v.count, samples: v.samples }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const perListingArr = [...perListing.entries()]
    .map(([listing, v]) => ({
      listing,
      volume: v.volume,
      reply_rate_pct: pct(v.replied, v.volume),
      median_response_min: median(v.deltas),
      inquiry_to_booking_pct: v.inquiries ? pct(v.bookings, v.inquiries + v.bookings) : null,
    }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 20);

  const staleSorted = staleCandidates
    .sort((a, b) => b.hours_since - a.hours_since)
    .slice(0, 25);

  return {
    has_data: true,
    uploaded_at: uploadedAt,
    scraped_at: snap.scraped_at,
    totals: {
      threads_all_time: snap.threads.length,
      threads_last_30d: threads30d,
      guest_messages: guestMessages,
      host_messages: hostMessages,
      reply_rate_pct: replyRate,
      median_response_min: median(responseDeltas),
      p95_response_min: percentile(responseDeltas, 95),
      inquiry_to_booking_pct: inquiries ? pct(bookings, inquiries + bookings) : null,
    },
    reply_rate_trend: trend,
    response_buckets: responseBuckets,
    top_clusters: topClusters,
    per_listing: perListingArr,
    heatmap: { guest: heatmapGuest, host: heatmapHost },
    stale_threads: staleSorted,
  };
}

function isoWeek(d: Date): string {
  // Returns "YYYY-Www"
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// =============================================================================
// HTML
// =============================================================================

export function renderMessagesPageHtml(analyticsJson: string): string {
  // Guard against any guest message containing `</script>` literally —
  // breaking out of our inline JSON island would be very bad.
  const safeJson = analyticsJson
    .replace(/<\/script>/gi, "<\\/script>")
    .replace(/<!--/g, "<\\!--");
  // The page is self-contained — it ships with /messages-data baked in
  // (server-side) so the empty-state doesn't flash, but it also fetches
  // /messages-data on a "Refresh" click for new uploads.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Messages · APG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink: #0A1F44;
    --cream: #FAF7EC;
    --gold: #F5C518;
    --paper: #ffffff;
    --ash: #6B7280;
    --rule: #E5E1D8;
    --danger: #B91C1C;
    --ok: #0E6E2F;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--cream); color: var(--ink); }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 28px; }
  h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 38px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.01em; }
  h1 em { color: #B58800; font-style: italic; }
  h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 22px; margin: 28px 0 12px; }
  .sub { color: var(--ash); font-size: 14px; margin-bottom: 24px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; flex-wrap: wrap; padding: 14px; background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; }
  .toolbar .meta { color: var(--ash); font-size: 12px; margin-right: auto; }
  .btn { font-family: inherit; font-size: 12px; font-weight: 700; padding: 9px 14px; border-radius: 6px; border: 1px solid var(--ink); background: var(--paper); color: var(--ink); cursor: pointer; letter-spacing: 0.04em; text-transform: uppercase; }
  .btn:hover { background: var(--gold); border-color: var(--gold); }
  .btn.primary { background: var(--ink); color: var(--cream); }
  .btn.primary:hover { background: var(--gold); color: var(--ink); }
  .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; margin-bottom: 22px; }
  .kpi { background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 16px; }
  .kpi .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ash); }
  .kpi .value { font-family: 'Playfair Display', Georgia, serif; font-size: 30px; font-weight: 700; margin-top: 4px; }
  .kpi .sub { font-size: 11px; color: var(--ash); margin-top: 2px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 980px) { .grid-2 { grid-template-columns: 1fr; } }
  .card { background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 18px; }
  .card h3 { font-family: 'Playfair Display', serif; font-size: 16px; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--rule); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ash); font-weight: 700; }
  tr.stale td:first-child { border-left: 3px solid var(--danger); }
  .bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .bar-row .label { width: 90px; font-size: 12px; color: var(--ash); }
  .bar-row .bar { flex: 1; background: var(--rule); height: 14px; border-radius: 3px; overflow: hidden; }
  .bar-row .bar > div { background: var(--ink); height: 100%; }
  .bar-row .count { width: 40px; text-align: right; font-size: 12px; font-weight: 700; }
  .heatmap { display: grid; grid-template-columns: 70px repeat(24, 1fr); gap: 2px; font-size: 10px; }
  .heatmap .corner { color: var(--ash); }
  .heatmap .col-h { color: var(--ash); text-align: center; }
  .heatmap .row-h { color: var(--ash); padding-right: 4px; text-align: right; }
  .heatmap .cell { aspect-ratio: 1.4 / 1; min-height: 14px; border-radius: 2px; }
  .heatmap legend { display: flex; align-items: center; gap: 4px; }
  .trend { display: flex; align-items: flex-end; gap: 4px; height: 140px; padding: 8px 0; border-bottom: 1px solid var(--rule); }
  .trend .bar { flex: 1; background: var(--ink); position: relative; min-height: 2px; border-radius: 3px 3px 0 0; }
  .trend .bar:hover::after { content: attr(data-tt); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: var(--ink); color: var(--cream); padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; }
  .trend-labels { display: flex; justify-content: space-between; font-size: 10px; color: var(--ash); margin-top: 4px; }
  .stale-list a { color: var(--ink); text-decoration: underline; }
  .cluster-samples { font-size: 12px; color: var(--ash); margin-top: 6px; font-style: italic; }
  .upload-zone { background: linear-gradient(135deg, #FAF7EC 0%, #FFF8E0 100%); border: 1px dashed var(--gold); border-radius: 10px; padding: 24px; text-align: center; margin-bottom: 22px; }
  .upload-zone input[type=file] { display: block; margin: 10px auto 0; }
  .empty { padding: 80px 24px; text-align: center; color: var(--ash); font-style: italic; }
  .status { padding: 10px 14px; background: var(--ink); color: var(--cream); border-radius: 6px; font-size: 12px; margin-bottom: 16px; display: none; }
  .status.show { display: block; }
  .status.ok { background: var(--ok); }
  .status.error { background: var(--danger); }
  .pill { display: inline-block; padding: 2px 8px; background: var(--rule); border-radius: 999px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink); font-weight: 700; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Airbnb <em>Messages</em></h1>
  <div class="sub">Inbox analytics scraped from your logged-in browser. Read-only — auto-send replies need a channel manager. <span class="pill">Read-only</span></div>

  <div class="status" id="status"></div>

  <div class="upload-zone">
    <div style="font-family:'Playfair Display',serif;font-size:18px;">Upload a fresh scrape</div>
    <div class="sub" style="margin-top:4px;">From <code>tools/airbnb-message-scraper/airbnb-messages-YYYY-MM-DD.json</code></div>
    <input type="file" id="upload-input" accept="application/json" />
    <button class="btn primary" id="upload-btn" style="margin-top:10px;">Upload to dashboard</button>
  </div>

  <div class="toolbar">
    <div class="meta" id="meta-line">Loading meta...</div>
    <button class="btn" id="refresh-btn">Refresh</button>
  </div>

  <div id="dashboard-root"></div>
</div>

<script>
window.__APG_MESSAGES_DATA__ = ${safeJson};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
}

function fmtMin(m) {
  if (m == null) return "—";
  if (m < 60) return Math.round(m) + "m";
  if (m < 60*24) return (m / 60).toFixed(1) + "h";
  return (m / (60*24)).toFixed(1) + "d";
}

function render(data) {
  const root = document.getElementById("dashboard-root");
  const meta = document.getElementById("meta-line");
  if (!data || !data.has_data) {
    root.innerHTML = '<div class="empty">No data uploaded yet. Run <code>tools/airbnb-message-scraper/scrape.py</code> locally, then upload the JSON above.</div>';
    meta.textContent = "No snapshot uploaded yet.";
    return;
  }
  meta.textContent = "Snapshot scraped " + (data.scraped_at ?? "?") + " · uploaded " + (data.uploaded_at ?? "?");

  const t = data.totals;
  const kpis = [
    { label: "Threads (all-time)", value: t.threads_all_time, sub: t.threads_last_30d + " in last 30d" },
    { label: "Reply rate", value: t.reply_rate_pct + "%", sub: t.host_messages + " host msgs / " + t.guest_messages + " guest msgs" },
    { label: "Median response", value: fmtMin(t.median_response_min), sub: "p95: " + fmtMin(t.p95_response_min) },
    { label: "Inquiry → book", value: t.inquiry_to_booking_pct == null ? "—" : t.inquiry_to_booking_pct + "%", sub: "of inquiry threads" },
    { label: "Stale (>2h)", value: data.stale_threads.length, sub: "needs reply" },
  ];

  let html = '<div class="kpis">' + kpis.map(k =>
    '<div class="kpi"><div class="label">' + escapeHtml(k.label) + '</div><div class="value">' + escapeHtml(k.value) + '</div><div class="sub">' + escapeHtml(k.sub) + '</div></div>'
  ).join("") + '</div>';

  // Trend
  const trendMax = Math.max(1, ...data.reply_rate_trend.map(p => p.volume));
  html += '<h2>Reply rate over time</h2><div class="card">';
  if (data.reply_rate_trend.length === 0) {
    html += '<div class="empty">No weekly data yet.</div>';
  } else {
    html += '<div class="trend">' + data.reply_rate_trend.map(p => {
      const h = (p.volume / trendMax) * 100;
      return '<div class="bar" style="height:' + h + '%;background:linear-gradient(180deg, var(--gold) 0%, var(--ink) ' + (100 - p.rate_pct) + '%);" data-tt="' + escapeHtml(p.week + ': ' + p.rate_pct + '% reply, ' + p.volume + ' msgs') + '"></div>';
    }).join("") + '</div>';
    html += '<div class="trend-labels"><span>' + escapeHtml(data.reply_rate_trend[0].week) + '</span><span>' + escapeHtml(data.reply_rate_trend[data.reply_rate_trend.length - 1].week) + '</span></div>';
  }
  html += '</div>';

  // Response distribution + Top clusters side-by-side
  html += '<div class="grid-2" style="margin-top:20px;">';
  const maxBucket = Math.max(1, ...data.response_buckets.map(b => b.count));
  html += '<div class="card"><h3>Response time distribution</h3>' + data.response_buckets.map(b =>
    '<div class="bar-row"><div class="label">' + escapeHtml(b.label) + '</div><div class="bar"><div style="width:' + ((b.count / maxBucket) * 100) + '%;"></div></div><div class="count">' + b.count + '</div></div>'
  ).join("") + '</div>';

  const maxCluster = Math.max(1, ...data.top_clusters.map(c => c.count));
  html += '<div class="card"><h3>Top question clusters</h3>' + data.top_clusters.map((c, idx) =>
    '<div class="bar-row"><div class="label">' + escapeHtml(c.label) + '</div><div class="bar"><div style="width:' + ((c.count / maxCluster) * 100) + '%;"></div></div><div class="count">' + c.count + '</div></div>' +
    (c.samples && c.samples.length ? '<div class="cluster-samples">e.g., "' + escapeHtml(c.samples[0]) + '"</div>' : '')
  ).join("") + '</div>';
  html += '</div>';

  // Per-listing table
  html += '<h2>By listing</h2><div class="card"><table><thead><tr><th>Listing</th><th>Volume</th><th>Reply rate</th><th>Median response</th><th>Inquiry → book</th></tr></thead><tbody>';
  html += data.per_listing.map(p =>
    '<tr><td>' + escapeHtml(p.listing) + '</td><td>' + p.volume + '</td><td>' + p.reply_rate_pct + '%</td><td>' + fmtMin(p.median_response_min) + '</td><td>' + (p.inquiry_to_booking_pct == null ? "—" : p.inquiry_to_booking_pct + '%') + '</td></tr>'
  ).join("") + '</tbody></table></div>';

  // Heatmap
  html += '<h2>Time-of-day coverage</h2><div class="card"><div class="sub">Top half: guest messages (when they reach out). Bottom half: your replies. After-hours gaps = candidates for Hospitable AI auto-reply.</div>';
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const renderHm = (matrix, color) => {
    const flat = matrix.flat();
    const mx = Math.max(1, ...flat);
    let h = '<div class="heatmap"><div class="corner"></div>';
    for (let hr = 0; hr < 24; hr++) h += '<div class="col-h">' + (hr % 6 === 0 ? hr : "") + '</div>';
    for (let d = 0; d < 7; d++) {
      h += '<div class="row-h">' + days[d] + '</div>';
      for (let hr = 0; hr < 24; hr++) {
        const v = matrix[d][hr];
        const alpha = v === 0 ? 0.06 : 0.15 + (v / mx) * 0.85;
        h += '<div class="cell" style="background: rgba(' + color + ',' + alpha + ');" title="' + days[d] + ' ' + hr + ':00 — ' + v + ' msgs"></div>';
      }
    }
    h += '</div>';
    return h;
  };
  html += '<div style="margin-bottom:12px;"><strong style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:var(--ash);">Guest sends</strong>' + renderHm(data.heatmap.guest, "10,31,68") + '</div>';
  html += '<div><strong style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:var(--ash);">Host replies</strong>' + renderHm(data.heatmap.host, "245,197,24") + '</div>';
  html += '</div>';

  // Stale threads
  html += '<h2>Stale inquiries (no reply in >2 hours)</h2><div class="card stale-list">';
  if (data.stale_threads.length === 0) {
    html += '<div class="sub">All caught up. Nice.</div>';
  } else {
    html += '<table><thead><tr><th>Guest</th><th>Listing</th><th>Last message</th><th>Waiting</th><th></th></tr></thead><tbody>';
    html += data.stale_threads.map(s =>
      '<tr class="stale"><td>' + escapeHtml(s.guest_name) + '</td><td>' + escapeHtml(s.listing) + '</td><td>' + escapeHtml(s.last_guest_text) + '</td><td>' + s.hours_since + 'h</td><td>' + (s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank">open</a>' : '') + '</td></tr>'
    ).join("") + '</tbody></table>';
  }
  html += '</div>';

  root.innerHTML = html;
}

render(window.__APG_MESSAGES_DATA__);

document.getElementById("refresh-btn").addEventListener("click", async () => {
  const r = await fetch("/messages-data", { credentials: "include" });
  if (!r.ok) { showStatus("Refresh failed: " + r.status, "error"); return; }
  const j = await r.json();
  render(j);
});

document.getElementById("upload-btn").addEventListener("click", async () => {
  const input = document.getElementById("upload-input");
  if (!input.files || input.files.length === 0) { showStatus("Pick a JSON file first.", "error"); return; }
  const file = input.files[0];
  const text = await file.text();
  try { JSON.parse(text); } catch { showStatus("Not valid JSON.", "error"); return; }
  showStatus("Uploading " + (file.size / 1024).toFixed(0) + "KB...", "ok");
  const r = await fetch("/admin/upload-airbnb-data", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  if (!r.ok) { showStatus("Upload failed: " + r.status, "error"); return; }
  const j = await r.json();
  showStatus("Uploaded — " + j.thread_count + " threads, " + j.message_count + " messages.", "ok");
  // Re-fetch + re-render.
  const r2 = await fetch("/messages-data", { credentials: "include" });
  render(await r2.json());
});

function showStatus(msg, kind) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status show " + (kind || "");
  setTimeout(() => { el.className = "status"; }, 5000);
}
</script>
</body>
</html>`;
}
