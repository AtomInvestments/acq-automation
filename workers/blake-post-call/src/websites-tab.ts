// websites-tab.ts — rebuilt /websites surface.
//
// Replaces the old broken "No snapshot yet" tile grid embedded inside
// dashboard-v2.ts with a dedicated, mobile-first page that pairs a daily page
// snapshot with Microsoft Clarity stats (sessions, pageviews, dead/rage
// clicks, scroll depth, lead-form submits) per tracked URL.
//
// Inputs / dependencies:
//   - Env.CLARITY_API_TOKEN       — Microsoft Clarity Data Export bearer token
//                                    (already configured as Worker secret 2026-05-29).
//                                    Project ID hard-coded: wwbe84z9my.
//   - Env.CLOUDFLARE_API_TOKEN    — for the Cloudflare Browser Rendering API
//                                    (optional; falls back to thum.io if absent
//                                    or if Browser Rendering isn't opt-in on
//                                    the account).
//   - Env.CLOUDFLARE_ACCOUNT_ID   — account that owns the worker
//                                    (b8fb424de9e19010920dd0cea9545fce).
//   - Env.DIAL_STATE              — KV namespace (snapshot bytes for the
//                                    thum.io path, and Clarity response cache).
//   - Env.WEBSITES_BUCKET         — R2 bucket binding (optional; preferred
//                                    target for snapshot PNGs once Mido binds
//                                    it in wrangler.toml). Falls back to KV
//                                    when the binding is missing.
//
// Routes added (wired from index.ts):
//   GET  /websites               — server-rendered HTML dashboard
//   GET  /websites-data          — JSON payload for the page (also used by
//                                  the Websites tab inside /dashboard).
//   GET  /websites/snap/:key     — serves a stored snapshot PNG (R2-first,
//                                  KV-fallback) so the same URL works for
//                                  either backend.
//
// All routes are auth-gated by the caller (requireAuth() in index.ts).

// ---- Tracked pages ----------------------------------------------------------
//
// Source of truth for which URLs we render cards for. Mirrors the page IDs
// the WordPress builder scripts (`push_cities_v3.py`, `push_counties.py`,
// `push_zip_pages.py`) maintain on atompropertygroup.com, plus the 4
// hand-authored core pages (Home, Construction, Thank You, About).
//
// `id` is the WP post ID — used for:
//   - WP REST lookups (modified timestamp + canonical link)
//   - wp-admin deep-links (`?post=<id>&action=edit`)
// `kind` drives the "section" group in the UI ("Core" / "City" / "County" /
// "ZIP"). Pages added to WP automatically pick up here on next deploy as long
// as we add them to this list.
export const WEBSITES_TRACKED_PAGES: Array<{
  id: number;
  label: string;
  kind: "core" | "city" | "county" | "zip";
}> = [
  // --- Core pages (hand-authored) ---
  { id: 1213, label: "Homepage",             kind: "core"   },
  { id: 1355, label: "About Us",             kind: "core"   },
  { id: 1356, label: "Services",             kind: "core"   },
  { id: 1362, label: "Construction Services", kind: "core"  },
  { id: 1358, label: "Invest With Us",       kind: "core"   },
  { id: 1357, label: "Contact Us",           kind: "core"   },
  { id: 1359, label: "Career",               kind: "core"   },
  { id: 1361, label: "Blog",                 kind: "core"   },
  { id: 1201, label: "Thank You",            kind: "core"   },
  // --- City pages (push_cities_v3.py) ---
  { id: 1191, label: "City — Newark",        kind: "city"   },
  { id: 1192, label: "City — Trenton",       kind: "city"   },
  { id: 1198, label: "City — Philadelphia",  kind: "city"   },
  // --- County pages (push_counties.py) ---
  { id: 1246, label: "County — Mercer",      kind: "county" },
  { id: 1242, label: "County — Essex",       kind: "county" },
  { id: 1244, label: "County — Hudson",      kind: "county" },
  { id: 1257, label: "County — Philadelphia", kind: "county" },
  // --- ZIP landing pages (push_zip_pages.py) ---
  // TODO: extend list as Mido publishes more ZIP pages. The 30 zip-page WP
  // post IDs aren't enumerated in this repo (the python script generates
  // them at run-time). Until we add them, the existing 4 known IDs cover
  // the publicly linked zip pages.
  { id: 1383, label: "ZIP — 08611 Trenton",  kind: "zip"    },
  { id: 1397, label: "ZIP — 19132 Philadelphia", kind: "zip" },
];

// ---- Clarity client ---------------------------------------------------------
//
// Microsoft Clarity Data Export API. Free tier; bearer-token auth.
// Docs: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
//
// Single endpoint we use: `project-live-insights` returns *all metrics* for the
// requested window, broken down by an optional dimension (we use `Page` so
// each metric is keyed by URL). 16 metrics per page in one call — perfect for
// our card grid.
//
// API limits:
//   - numOfDays: 1..30 (30 max)
//   - up to 3 dimensions
//   - rate-limit reportedly low (~10 req/day on free tier), so we cache 15min.

export const WEBSITES_CLARITY_PROJECT_ID = "wwbe84z9my";
const CLARITY_API_BASE = "https://www.clarity.ms/export-data/api/v1";
const CLARITY_CACHE_TTL_S = 15 * 60;  // 15 min

interface ClarityPageRow {
  url: string;
  sessions: number;
  pageviews: number;
  dead_clicks: number;
  rage_clicks: number;
  scroll_depth: number;     // percentage 0..100
  js_errors: number;
  excessive_scroll: number;
  quickback_clicks: number;
  lead_form_submits: number;
}

interface ClarityFetchResult {
  ok: boolean;
  fetched_at: string;
  num_days: number;
  rows: Record<string, ClarityPageRow>;  // keyed by URL (lower-cased pathname)
  error?: string;
}

// Normalise any URL/path Clarity returns into the same key we use to look up
// from a tracked-page link. Clarity returns "Page" values that are sometimes
// full URLs, sometimes paths, sometimes with trailing slashes. We normalise
// to "/path/" with leading slash, trailing slash, lower-case.
function normalisePageKey(raw: string): string {
  if (!raw) return "/";
  let s = raw.trim();
  try {
    // If it's a full URL, extract pathname
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.pathname || "/";
    }
  } catch {}
  if (!s.startsWith("/")) s = "/" + s;
  if (!s.endsWith("/")) s = s + "/";
  return s.toLowerCase();
}

// Build the per-URL row by merging multiple metric responses. Each metric in
// Clarity's response looks like:
//   { metricName: "Traffic", information: [ { Page: "/", SessionsCount: "42",
//     PagesViews: "63", ... }, { Page: "/about/", ... }, ... ] }
// We flatten all metrics keyed by Page.
function ingestClarityResponse(json: any): Record<string, ClarityPageRow> {
  const out: Record<string, ClarityPageRow> = {};
  const ensure = (key: string): ClarityPageRow => {
    if (!out[key]) {
      out[key] = {
        url: key,
        sessions: 0, pageviews: 0,
        dead_clicks: 0, rage_clicks: 0, scroll_depth: 0,
        js_errors: 0, excessive_scroll: 0, quickback_clicks: 0,
        lead_form_submits: 0,
      };
    }
    return out[key];
  };

  const arr: any[] = Array.isArray(json) ? json : (json?.metrics || []);
  for (const m of arr) {
    const metricName: string = String(m?.metricName || "");
    const info: any[] = Array.isArray(m?.information) ? m.information : [];
    for (const it of info) {
      const pageRaw = it.Page || it.page || it.URL || it.url || "/";
      const key = normalisePageKey(String(pageRaw));
      const row = ensure(key);
      // Numerical fields — Clarity returns strings, coerce.
      const num = (v: any) => Number(v || 0) || 0;
      // Each metric brings a subset of fields. Merge what's present.
      if (it.SessionsCount != null)   row.sessions          = num(it.SessionsCount);
      if (it.PagesViews != null)      row.pageviews         = num(it.PagesViews);
      if (it.DeadClickCount != null)  row.dead_clicks       = num(it.DeadClickCount);
      if (it.RageClickCount != null)  row.rage_clicks       = num(it.RageClickCount);
      if (it.ScrollDepth != null)     row.scroll_depth      = num(it.ScrollDepth);
      if (it.JSError != null)         row.js_errors         = num(it.JSError);
      if (it.ExcessiveScroll != null) row.excessive_scroll  = num(it.ExcessiveScroll);
      if (it.QuickbackClick != null)  row.quickback_clicks  = num(it.QuickbackClick);
      // Custom events come back with `EventName` + `EventCount` shape.
      const evName = it.EventName || it.eventName;
      if (evName === "lead_form_submit") {
        row.lead_form_submits += num(it.EventCount || it.eventCount);
      }
      // Some metric envelopes don't break down by Page when no traffic — skip
      // silently. Unknown fields ignored on purpose; we surface only what we
      // explicitly understand to avoid noise.
      void metricName;
    }
  }
  return out;
}

export async function fetchClarityInsights(
  env: WebsitesEnv,
  numOfDays: number,
): Promise<ClarityFetchResult> {
  const days = Math.max(1, Math.min(30, Math.floor(numOfDays || 7)));
  const cacheKey = `websites:clarity:${days}`;

  // Cache read — 15-min TTL keeps us well below Clarity's daily req cap.
  try {
    const cached = await env.DIAL_STATE.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ClarityFetchResult;
      return parsed;
    }
  } catch {}

  if (!env.CLARITY_API_TOKEN) {
    return {
      ok: false, fetched_at: new Date().toISOString(), num_days: days,
      rows: {}, error: "CLARITY_API_TOKEN not configured",
    };
  }

  try {
    const url = `${CLARITY_API_BASE}/project-live-insights?numOfDays=${days}&dimension1=Page`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.CLARITY_API_TOKEN}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false, fetched_at: new Date().toISOString(), num_days: days,
        rows: {}, error: `clarity_http_${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = await res.json().catch(() => ({}));
    const rows = ingestClarityResponse(json);
    const out: ClarityFetchResult = {
      ok: true, fetched_at: new Date().toISOString(), num_days: days, rows,
    };
    // Cache write — best-effort; failure is non-fatal.
    try {
      await env.DIAL_STATE.put(cacheKey, JSON.stringify(out), {
        expirationTtl: CLARITY_CACHE_TTL_S,
      });
    } catch {}
    return out;
  } catch (e: any) {
    return {
      ok: false, fetched_at: new Date().toISOString(), num_days: days,
      rows: {}, error: `clarity_threw: ${e?.message || String(e)}`,
    };
  }
}

// ---- Snapshot capture (CF Browser Rendering preferred, thum.io fallback) ---
//
// CF Browser Rendering returns a PNG body for a given URL. Auth via
// `Authorization: Bearer ${CLOUDFLARE_API_TOKEN}`. Requires opt-in per
// account; if the call returns 403/404, we silently fall back to the public
// thum.io service (no auth, free up to a low rate cap).
//
// We store the resulting PNG to R2 if a `WEBSITES_BUCKET` binding is present,
// otherwise to KV under the same key shape the existing `/insights` path
// uses. `/websites/snap/:key` reads from either.

const SNAPSHOT_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile:  { width: 375,  height: 812 },
} as const;

type Viewport = keyof typeof SNAPSHOT_VIEWPORTS;

interface SnapshotResult {
  key: string;          // storage key (also the URL slug after /websites/snap/)
  bytes: number;
  backend: "r2" | "kv";
  source: "cf_browser_rendering" | "thum.io";
}

async function tryCfBrowserRenderingScreenshot(
  env: WebsitesEnv,
  pageUrl: string,
  viewport: Viewport,
): Promise<ArrayBuffer | null> {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  const vp = SNAPSHOT_VIEWPORTS[viewport];
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/screenshot`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: pageUrl,
        viewport: { width: vp.width, height: vp.height },
        screenshotOptions: { fullPage: false, type: "png" },
      }),
    });
    if (!res.ok) {
      console.warn(`[websites] CF Browser Rendering returned ${res.status} for ${pageUrl} — falling back`);
      return null;
    }
    return await res.arrayBuffer();
  } catch (e) {
    console.warn(`[websites] CF Browser Rendering threw for ${pageUrl}: ${e}`);
    return null;
  }
}

async function tryThumIoScreenshot(pageUrl: string, viewport: Viewport): Promise<ArrayBuffer | null> {
  const vp = SNAPSHOT_VIEWPORTS[viewport];
  // thum.io public endpoint. Free tier; soft rate-limited. Format:
  //   https://image.thum.io/get/width/<W>/crop/<H>/png/<url>
  const u = `https://image.thum.io/get/width/${vp.width}/crop/${vp.height}/png/${pageUrl}`;
  try {
    const res = await fetch(u);
    if (!res.ok) {
      console.warn(`[websites] thum.io returned ${res.status} for ${pageUrl}`);
      return null;
    }
    return await res.arrayBuffer();
  } catch (e) {
    console.warn(`[websites] thum.io threw for ${pageUrl}: ${e}`);
    return null;
  }
}

export async function captureWebsiteSnapshot(
  env: WebsitesEnv,
  pageId: number,
  slug: string,
  pageUrl: string,
  viewport: Viewport,
): Promise<SnapshotResult | null> {
  let bytes: ArrayBuffer | null = null;
  let source: SnapshotResult["source"] = "thum.io";

  bytes = await tryCfBrowserRenderingScreenshot(env, pageUrl, viewport);
  if (bytes) source = "cf_browser_rendering";

  if (!bytes) {
    bytes = await tryThumIoScreenshot(pageUrl, viewport);
    source = "thum.io";
  }
  if (!bytes) return null;

  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const safeSlug = (slug || `page-${pageId}`).replace(/[^a-z0-9\-]/gi, "-").toLowerCase();
  // R2 keys (and the public URL slug) — collision-proof, sortable, human-readable.
  const storageKey = `snapshots/${safeSlug}-${viewport}-${today}.png`;

  // Prefer R2 when the binding exists. KV otherwise. We keep KV-fallback so
  // the page works the day Mido merges this even if he hasn't added the R2
  // bucket binding yet.
  if (env.WEBSITES_BUCKET) {
    try {
      await env.WEBSITES_BUCKET.put(storageKey, bytes, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: {
          pageId: String(pageId), pageUrl, viewport, capturedAt: new Date().toISOString(),
          source,
        },
      });
      // Also keep a per-page pointer to the latest snapshot key for cheap
      // dashboard reads (avoids listing R2 every render).
      await env.DIAL_STATE.put(
        `websites:latest:${pageId}:${viewport}`,
        JSON.stringify({ key: storageKey, capturedAt: new Date().toISOString(), source, bytes: bytes.byteLength, backend: "r2" }),
        { expirationTtl: 60 * 60 * 24 * 60 },
      );
      return { key: storageKey, bytes: bytes.byteLength, backend: "r2", source };
    } catch (e) {
      console.warn(`[websites] R2 put failed (${e}) — falling back to KV`);
    }
  }

  // KV fallback. Cap at ~25MB per value (KV hard limit); snapshots are <500KB
  // so this is fine in practice.
  try {
    await env.DIAL_STATE.put(`websites:snap:${storageKey}`, bytes, {
      expirationTtl: 60 * 60 * 24 * 30,  // 30 days
      metadata: { pageId, pageUrl, viewport, capturedAt: new Date().toISOString(), source },
    });
    await env.DIAL_STATE.put(
      `websites:latest:${pageId}:${viewport}`,
      JSON.stringify({ key: storageKey, capturedAt: new Date().toISOString(), source, bytes: bytes.byteLength, backend: "kv" }),
      { expirationTtl: 60 * 60 * 24 * 60 },
    );
    return { key: storageKey, bytes: bytes.byteLength, backend: "kv", source };
  } catch (e) {
    console.warn(`[websites] KV put failed: ${e}`);
    return null;
  }
}

// Daily snapshot routine — called from the existing 04:00 UTC cron.
// Walks every tracked page, captures desktop + mobile, prunes >30d in R2.
export async function runDailyWebsiteSnapshots(env: WebsitesEnv): Promise<{
  attempted: number; captured: number; failed: number;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const sentinelKey = `websites:daily_done:${today}`;
  const already = await env.DIAL_STATE.get(sentinelKey);
  if (already) {
    console.log(`[websites-daily] already ran today (${today}) — skip`);
    return { attempted: 0, captured: 0, failed: 0 };
  }

  let attempted = 0, captured = 0, failed = 0;
  for (const page of WEBSITES_TRACKED_PAGES) {
    const meta = await fetchWpPageMetaShort(env, page.id);
    if (!meta) {
      failed++;
      continue;
    }
    for (const viewport of ["desktop", "mobile"] as Viewport[]) {
      attempted++;
      try {
        const r = await captureWebsiteSnapshot(env, page.id, meta.slug, meta.link, viewport);
        if (r) {
          captured++;
        } else {
          failed++;
        }
      } catch (e) {
        console.warn(`[websites-daily] capture threw for ${page.label} (${viewport}): ${e}`);
        failed++;
      }
    }
  }

  // Best-effort prune. Only meaningful on R2; KV TTL handles cleanup there.
  if (env.WEBSITES_BUCKET) {
    try { await pruneOldSnapshots(env, 30); } catch (e) { console.warn(`[websites-daily] prune failed: ${e}`); }
  }

  await env.DIAL_STATE.put(sentinelKey, new Date().toISOString(), {
    expirationTtl: 60 * 60 * 25,
  });
  console.log(`[websites-daily] done: ${captured}/${attempted} captured, ${failed} failed`);
  return { attempted, captured, failed };
}

async function pruneOldSnapshots(env: WebsitesEnv, keepDays: number): Promise<number> {
  if (!env.WEBSITES_BUCKET) return 0;
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  // List with prefix; R2 list returns up to 1000 keys per page. Pages are
  // small enough that one page covers us for a long time.
  let cursor: string | undefined = undefined;
  for (let i = 0; i < 5; i++) {  // hard ceiling — 5 pages = 5000 objects
    const out: any = await env.WEBSITES_BUCKET.list({ prefix: "snapshots/", cursor });
    for (const o of out.objects || []) {
      const uploaded = (o.uploaded ? new Date(o.uploaded).getTime() : 0);
      if (uploaded && uploaded < cutoff) {
        try { await env.WEBSITES_BUCKET.delete(o.key); removed++; } catch {}
      }
    }
    if (!out.truncated) break;
    cursor = out.cursor;
  }
  return removed;
}

// ---- WP REST helper (slim) --------------------------------------------------
//
// Slim re-implementation that doesn't require importing from index.ts. Reads
// the same `insights:meta:<id>` KV cache that the /insights tab populates, so
// when both tabs are active we share one set of WP fetches.

interface WpMetaShort {
  id: number; modified: string; link: string; title: string; slug: string;
}

async function fetchWpPageMetaShort(env: WebsitesEnv, pageId: number): Promise<WpMetaShort | null> {
  const cacheKey = `insights:meta:${pageId}`;
  try {
    const cached = await env.DIAL_STATE.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch {}
  if (!env.WP_AUTH_HEADER) return null;
  try {
    const res = await fetch(
      `https://atompropertygroup.com/wp-json/wp/v2/pages/${pageId}?_fields=id,modified,link,title,slug`,
      { headers: { Authorization: env.WP_AUTH_HEADER } },
    );
    if (!res.ok) return null;
    const p: any = await res.json();
    const meta: WpMetaShort = {
      id: p.id, modified: p.modified, link: p.link,
      title: p.title?.rendered || "", slug: p.slug || "",
    };
    try {
      await env.DIAL_STATE.put(cacheKey, JSON.stringify(meta), {
        expirationTtl: 60 * 60 * 6,
      });
    } catch {}
    return meta;
  } catch {
    return null;
  }
}

// ---- /websites-data — JSON payload for the dashboard -----------------------

export interface WebsitePageCard {
  id: number;
  label: string;
  kind: "core" | "city" | "county" | "zip";
  url: string;
  pathname: string;
  modified_iso: string | null;
  modified_disp: string;
  wp_edit_url: string;
  // Snapshots
  desktop_snap_key: string | null;
  desktop_snap_at: string | null;
  mobile_snap_key: string | null;
  mobile_snap_at: string | null;
  snapshot_source: string | null;
  // Clarity stats (window-scoped)
  stats: ClarityPageRow | null;
  // Deep-link into Clarity, pre-filtered to this URL
  clarity_dashboard_url: string;
  clarity_heatmap_url: string;
  clarity_recordings_url: string;
  // Any soft warning we want to surface inline (e.g. "snapshot unavailable")
  warnings: string[];
}

export interface WebsitesDataPayload {
  generated_at: string;
  range_days: number;
  range_label: string;
  clarity_ok: boolean;
  clarity_error: string | null;
  snapshot_backend_hint: string;   // "r2" / "kv" / "unconfigured"
  pages: WebsitePageCard[];
}

function rangeFromQuery(url: URL): { days: number; label: string } {
  const raw = (url.searchParams.get("range") || "").toLowerCase();
  switch (raw) {
    case "today":     return { days: 1,  label: "Today"            };
    case "yesterday": return { days: 2,  label: "Yesterday (2d diff)" };
    case "7d":        return { days: 7,  label: "Last 7 days"      };
    case "30d":       return { days: 30, label: "Last 30 days"     };
    default: {
      // Custom numeric override; cap at Clarity's 30-day limit.
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) {
        const capped = Math.min(30, n);
        return { days: capped, label: capped === n ? `Last ${capped} days` : `Last ${capped} days (capped — Clarity max)` };
      }
      return { days: 7, label: "Last 7 days" };
    }
  }
}

export async function buildWebsitesData(env: WebsitesEnv, reqUrl: URL): Promise<WebsitesDataPayload> {
  const { days, label } = rangeFromQuery(reqUrl);
  const clarity = await fetchClarityInsights(env, days);

  const snapshotBackendHint = env.WEBSITES_BUCKET ? "r2" : (env.CLARITY_API_TOKEN ? "kv" : "unconfigured");

  const pages: WebsitePageCard[] = [];
  for (const page of WEBSITES_TRACKED_PAGES) {
    const meta = await fetchWpPageMetaShort(env, page.id);
    const link = meta?.link || `https://atompropertygroup.com/?p=${page.id}`;
    let pathname = "/";
    try { pathname = new URL(link).pathname; } catch {}
    const claritySlug = encodeURIComponent(link);
    const desktopLatest = await env.DIAL_STATE.get(`websites:latest:${page.id}:desktop`);
    const mobileLatest = await env.DIAL_STATE.get(`websites:latest:${page.id}:mobile`);
    const dLatest = desktopLatest ? safeJson(desktopLatest) : null;
    const mLatest = mobileLatest ? safeJson(mobileLatest) : null;

    const warnings: string[] = [];
    if (!meta) warnings.push("WP meta unavailable");
    if (!dLatest && !mLatest) warnings.push("Snapshot unavailable");

    const stats = clarity.ok ? (clarity.rows[normalisePageKey(link)] || null) : null;

    pages.push({
      id: page.id,
      label: page.label,
      kind: page.kind,
      url: link,
      pathname,
      modified_iso: meta?.modified || null,
      modified_disp: meta?.modified ? new Date(meta.modified).toLocaleString() : "—",
      wp_edit_url: `https://atompropertygroup.com/wp-admin/post.php?action=edit&post=${page.id}`,
      desktop_snap_key: dLatest?.key || null,
      desktop_snap_at:  dLatest?.capturedAt || null,
      mobile_snap_key:  mLatest?.key || null,
      mobile_snap_at:   mLatest?.capturedAt || null,
      snapshot_source:  dLatest?.source || mLatest?.source || null,
      stats,
      clarity_dashboard_url:  `https://clarity.microsoft.com/projects/view/${WEBSITES_CLARITY_PROJECT_ID}/dashboard?date=Last+${days}+days&Page=${claritySlug}`,
      clarity_heatmap_url:    `https://clarity.microsoft.com/projects/view/${WEBSITES_CLARITY_PROJECT_ID}/heatmaps?date=Last+${days}+days&Page=${claritySlug}`,
      clarity_recordings_url: `https://clarity.microsoft.com/projects/view/${WEBSITES_CLARITY_PROJECT_ID}/recordings?date=Last+${days}+days&Page=${claritySlug}`,
      warnings,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    range_days: days,
    range_label: label,
    clarity_ok: clarity.ok,
    clarity_error: clarity.error || null,
    snapshot_backend_hint: snapshotBackendHint,
    pages,
  };
}

function safeJson(s: string | null): any | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// ---- /websites/snap/:key — image serving (R2-first, KV-fallback) ----------

export async function serveSnapshot(env: WebsitesEnv, rawKey: string): Promise<Response> {
  let key: string;
  try { key = decodeURIComponent(rawKey); } catch { key = rawKey; }
  // Accept either "snapshots/foo.png" (R2-style) or the legacy KV key shape
  // "websites:snap:snapshots/foo.png". Normalise to the R2 form.
  if (key.startsWith("websites:snap:")) key = key.slice("websites:snap:".length);

  // R2 first
  if (env.WEBSITES_BUCKET) {
    try {
      const obj = await env.WEBSITES_BUCKET.get(key);
      if (obj) {
        return new Response(obj.body, {
          status: 200,
          headers: {
            "content-type": obj.httpMetadata?.contentType || "image/png",
            "cache-control": "public, max-age=86400",
          },
        });
      }
    } catch (e) {
      console.warn(`[websites] R2 get failed for ${key}: ${e}`);
    }
  }

  // KV fallback
  const bytes = await env.DIAL_STATE.get(`websites:snap:${key}`, "arrayBuffer");
  if (bytes) {
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      },
    });
  }
  return new Response("Not Found", { status: 404 });
}

// ---- /websites — server-rendered HTML ---------------------------------------

export async function renderWebsitesPage(env: WebsitesEnv, reqUrl: URL): Promise<string> {
  const data = await buildWebsitesData(env, reqUrl);
  // Initial sort: sessions DESC
  data.pages.sort((a, b) => (b.stats?.sessions || 0) - (a.stats?.sessions || 0));

  const rangeOptions = [
    { v: "today",     label: "Today"        },
    { v: "yesterday", label: "Yesterday"    },
    { v: "7d",        label: "Last 7 days"  },
    { v: "30d",       label: "Last 30 days" },
  ];
  const currentRange = (reqUrl.searchParams.get("range") || "7d").toLowerCase();

  const clarityBanner = !data.clarity_ok
    ? `<div class="banner banner-warn">Clarity: unavailable${data.clarity_error ? ` — <code>${escapeHtml(data.clarity_error)}</code>` : ""}</div>`
    : "";

  const snapshotBackendBanner = data.snapshot_backend_hint === "unconfigured"
    ? `<div class="banner banner-warn">Snapshot backend unconfigured. Add the <code>WEBSITES_BUCKET</code> R2 binding to wrangler.toml (preferred) or rely on KV fallback.</div>`
    : "";

  const limitBanner = data.range_label.includes("capped")
    ? `<div class="banner banner-info">Clarity API max: 30d</div>`
    : "";

  const cardsHtml = data.pages.map((p) => renderCard(p)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Websites — APG Dashboard</title>
  <style>${WEBSITES_CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="brand">APG <em>· Websites</em></div>
  <div class="meta">Generated ${escapeHtml(new Date(data.generated_at).toLocaleString())}</div>
</header>
<main>
  <section class="controls">
    <form method="GET" action="/websites" class="range-form">
      <label class="r-label">Range</label>
      <select name="range" onchange="this.form.submit()">
        ${rangeOptions.map((o) => `<option value="${o.v}"${o.v === currentRange ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
      </select>
      <span class="r-current">${escapeHtml(data.range_label)}</span>
    </form>
    <div class="sort-buttons" data-current="sessions">
      <button data-sort="sessions" class="active">Sessions</button>
      <button data-sort="rage">Rage clicks</button>
      <button data-sort="leads">Lead submits</button>
    </div>
  </section>
  ${clarityBanner}
  ${snapshotBackendBanner}
  ${limitBanner}
  <section class="grid" id="cards">${cardsHtml}</section>
  <footer class="page-footer">
    <span>Clarity project <code>${WEBSITES_CLARITY_PROJECT_ID}</code> · ${data.pages.length} tracked pages · backend <code>${escapeHtml(data.snapshot_backend_hint)}</code></span>
  </footer>
</main>
<script>${WEBSITES_JS}</script>
</body>
</html>`;
}

function renderCard(p: WebsitePageCard): string {
  const s = p.stats;
  const desktopImg = p.desktop_snap_key
    ? `<img class="thumb-desktop" src="/websites/snap/${encodeURIComponent(p.desktop_snap_key)}" alt="${escapeHtml(p.label + " desktop snapshot")}" loading="lazy" />`
    : `<div class="thumb-empty">Snapshot: unavailable</div>`;
  const mobileImg = p.mobile_snap_key
    ? `<img class="thumb-mobile" src="/websites/snap/${encodeURIComponent(p.mobile_snap_key)}" alt="${escapeHtml(p.label + " mobile snapshot")}" loading="lazy" />`
    : "";

  const stat = (label: string, value: string | number, accent: string = "") =>
    `<div class="stat${accent ? " stat-" + accent : ""}"><span class="s-label">${label}</span><span class="s-val">${value}</span></div>`;

  const dataAttrs = `data-sessions="${s?.sessions || 0}" data-rage="${s?.rage_clicks || 0}" data-leads="${s?.lead_form_submits || 0}"`;

  const warnings = p.warnings.length
    ? `<div class="warnings">${p.warnings.map(escapeHtml).join(" · ")}</div>`
    : "";

  return `
<article class="card" data-kind="${p.kind}" ${dataAttrs}>
  <div class="card-head">
    <div class="card-title">
      <span class="kind kind-${p.kind}">${p.kind.toUpperCase()}</span>
      <a href="${escapeAttr(p.url)}" target="_blank" rel="noopener" class="title-link">${escapeHtml(p.label)}</a>
    </div>
    <div class="card-url"><a href="${escapeAttr(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.pathname)}</a></div>
  </div>
  <div class="thumb-wrap">
    ${desktopImg}
    ${mobileImg}
  </div>
  <div class="meta-row">
    <span>Snapped <strong>${escapeHtml(p.desktop_snap_at ? new Date(p.desktop_snap_at).toLocaleDateString() : "—")}</strong></span>
    <span>WP modified <strong>${escapeHtml(p.modified_disp)}</strong></span>
  </div>
  ${warnings}
  <div class="stats">
    ${s ? `
      ${stat("Sessions",   s.sessions)}
      ${stat("Pageviews",  s.pageviews)}
      ${stat("Dead clicks", s.dead_clicks, s.dead_clicks > 0 ? "warn" : "")}
      ${stat("Rage clicks", s.rage_clicks, s.rage_clicks > 0 ? "bad" : "")}
      ${stat("Scroll %",   s.scroll_depth + "%")}
      ${stat("Lead submits", s.lead_form_submits, s.lead_form_submits > 0 ? "good" : "")}
    ` : `<div class="stats-empty">Clarity: no data for this URL in window</div>`}
  </div>
  <div class="actions">
    <a class="btn primary" href="${escapeAttr(p.clarity_heatmap_url)}" target="_blank" rel="noopener">Heatmap ↗</a>
    <a class="btn" href="${escapeAttr(p.clarity_recordings_url)}" target="_blank" rel="noopener">Sessions ↗</a>
    <a class="btn" href="${escapeAttr(p.clarity_dashboard_url)}" target="_blank" rel="noopener">Clarity ↗</a>
    <a class="btn ghost" href="${escapeAttr(p.wp_edit_url)}" target="_blank" rel="noopener">Edit in WP ↗</a>
  </div>
</article>`;
}

// ---- CSS / JS (kept inline so dashboard is self-contained) -----------------

const WEBSITES_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px; line-height: 1.45; color: #1A2840; background: #FAF7EC;
}
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #E8E0C8;
  background: linear-gradient(180deg, #FAF7EC, #F5EFD8);
}
.topbar .brand { font-family: Georgia, serif; font-size: 18px; }
.topbar .brand em { color: #B8860B; font-style: italic; }
.topbar .meta { font-size: 11px; color: #6B7280; font-family: 'JetBrains Mono', monospace; }
main { max-width: 1280px; margin: 0 auto; padding: 18px; }
.controls {
  display: flex; gap: 14px; flex-wrap: wrap; align-items: center;
  margin-bottom: 14px;
}
.range-form { display: flex; align-items: center; gap: 8px; }
.range-form select {
  background: #fff; border: 1px solid #D8C998; border-radius: 4px;
  padding: 6px 10px; font: inherit; color: #1A2840;
}
.r-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; }
.r-current { font-size: 12px; color: #6B7280; font-style: italic; }
.sort-buttons { display: flex; gap: 6px; margin-left: auto; }
.sort-buttons button {
  background: #fff; border: 1px solid #D8C998; color: #1A2840;
  padding: 6px 12px; font: inherit; font-size: 12px; cursor: pointer; border-radius: 4px;
}
.sort-buttons button.active { background: #1A2840; color: #F5C518; border-color: #1A2840; }
.banner {
  padding: 10px 14px; border-radius: 4px; margin-bottom: 14px; font-size: 13px;
}
.banner-warn { background: #FFF4E5; border-left: 4px solid #F59E0B; color: #92400E; }
.banner-info { background: #EAF4FF; border-left: 4px solid #3B82F6; color: #1E40AF; }
.grid {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
}
.card {
  background: #fff; border: 1px solid #E8E0C8; border-radius: 8px;
  padding: 14px; display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.card-head { display: flex; flex-direction: column; gap: 4px; }
.card-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.kind {
  font-size: 9px; letter-spacing: 0.1em; padding: 2px 6px; border-radius: 3px;
  font-weight: 700;
}
.kind-core   { background: #1A2840; color: #F5C518; }
.kind-city   { background: #DBEAFE; color: #1E40AF; }
.kind-county { background: #DCFCE7; color: #166534; }
.kind-zip    { background: #FCE7F3; color: #9D174D; }
.title-link { color: #1A2840; text-decoration: none; font-weight: 600; }
.title-link:hover { text-decoration: underline; }
.card-url { font-size: 11px; color: #6B7280; font-family: 'JetBrains Mono', monospace; word-break: break-all; }
.card-url a { color: inherit; text-decoration: none; }
.thumb-wrap {
  position: relative; aspect-ratio: 16/10; background: #F1ECDA;
  border-radius: 4px; overflow: hidden;
}
.thumb-desktop { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-mobile {
  position: absolute; bottom: 8px; right: 8px;
  width: 60px; height: 90px; object-fit: cover;
  border: 2px solid #fff; border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.thumb-empty {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  color: #9CA3AF; font-style: italic; font-size: 12px;
}
.meta-row { display: flex; justify-content: space-between; font-size: 11px; color: #6B7280; }
.warnings { font-size: 11px; color: #92400E; background: #FFFBEB; padding: 4px 8px; border-radius: 3px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.stat {
  background: #FAF7EC; border: 1px solid #E8E0C8; border-radius: 4px;
  padding: 6px 8px; text-align: center;
}
.stat .s-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #6B7280; }
.stat .s-val { display: block; font-size: 16px; font-weight: 700; color: #1A2840; margin-top: 2px; }
.stat-warn { background: #FFFBEB; border-color: #FCD34D; }
.stat-warn .s-val { color: #92400E; }
.stat-bad { background: #FEF2F2; border-color: #FCA5A5; }
.stat-bad .s-val { color: #991B1B; }
.stat-good { background: #ECFDF5; border-color: #6EE7B7; }
.stat-good .s-val { color: #065F46; }
.stats-empty { grid-column: 1 / -1; font-size: 11px; color: #9CA3AF; font-style: italic; text-align: center; padding: 8px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.btn {
  display: inline-block; padding: 5px 10px; border-radius: 3px;
  font-size: 11px; font-weight: 600; text-decoration: none; letter-spacing: 0.04em;
  background: #fff; border: 1px solid #D8C998; color: #1A2840;
}
.btn.primary { background: linear-gradient(135deg, #1A2840, #2A3D5C); color: #F5C518; border-color: #1A2840; }
.btn.ghost { border-style: dashed; color: #6B7280; }
.btn:hover { transform: translateY(-1px); box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
.page-footer {
  margin-top: 24px; padding-top: 14px; border-top: 1px solid #E8E0C8;
  font-size: 11px; color: #6B7280; font-family: 'JetBrains Mono', monospace;
}
@media (max-width: 480px) {
  main { padding: 12px; }
  .grid { grid-template-columns: 1fr; }
  .card { padding: 10px; }
  .controls { gap: 8px; }
  .sort-buttons { margin-left: 0; width: 100%; }
  .sort-buttons button { flex: 1; }
  .stats { grid-template-columns: repeat(3, 1fr); }
  .stat .s-val { font-size: 14px; }
}
`;

const WEBSITES_JS = `
(function () {
  var buttons = document.querySelectorAll('.sort-buttons button');
  var grid = document.getElementById('cards');
  if (!grid) return;
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var key = btn.getAttribute('data-sort');
      var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
      cards.sort(function (a, b) {
        var av = parseFloat(a.getAttribute('data-' + key) || '0');
        var bv = parseFloat(b.getAttribute('data-' + key) || '0');
        return bv - av;
      });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
  });
})();
`;

// ---- shared helpers ---------------------------------------------------------

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/'/g, "&#39;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

// ---- Env shape consumed by this module --------------------------------------
//
// Subset of the main Worker Env interface — kept local so this file can be
// type-checked even if the main interface gains/loses unrelated fields.

export interface WebsitesEnv {
  DIAL_STATE: KVNamespace;
  WP_AUTH_HEADER: string;
  CLARITY_API_TOKEN?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WEBSITES_BUCKET?: R2Bucket;
}
