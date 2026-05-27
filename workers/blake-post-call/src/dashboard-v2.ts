// dashboard-v2.ts — Workstream 6 dashboard upgrade.
//
// New server-rendered dashboard at /dashboard. Pulls live data from the
// existing /dashboard-data cache + recent blake_iteration KV writes.
// Pure inline HTML/CSS/JS (no SPA build), Linear/Stripe-style density,
// dark mode default, no emojis in chrome.
//
// Three sections:
//   1. KPI strip (calls, avg duration, hot leads, callbacks, ELabs cost)
//   2. Funnel — dials → connects → qualified → booked → contracted
//   3. RJ performance / Blake call table with date+outcome+source filters
//   4. Cost per user (Calltools/GHL/ElevenLabs/Claude/ATTOM monthly + per-active)
//   5. What Blake can improve on (top 3 from latest iteration review)
//   6. Variant performance (placeholder — populated when WS1 lands)

interface DashboardV2Data {
  updated_at: string;
  kpis: {
    calls_today: number;
    calls_week: number;
    calls_total: number;
    avg_duration_secs: number;
    hot_count: number;
    engaged_pct: number;
  };
  recent_calls: Array<{
    id: string;
    started_at: string;
    duration_s: number;
    caller_phone: string;
    contact_id?: string;
    contact_name?: string;
    outcome?: string;
    lead_temp?: string;
    source?: string;
    summary?: string;
    transcript_excerpt?: string;
  }>;
}

interface IterationCards {
  failure_modes: string[];   // top 3 lines from latest review
  generated_at: string | null;
}

// Static cost config — operator updates these constants when contract prices
// change. Per-active-user = total / max(1, active_seats).
export interface CostConfig {
  tools: Array<{ name: string; monthly_usd: number; seats: number; per_active?: string }>;
  active_users: number;       // Mike, RJ, Adam, etc. — counted as touching the system in last 30d
  last_updated: string;       // ISO date
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  // Update by editing this object + redeploying. Cheap, accurate, no secrets.
  tools: [
    { name: "Calltools",  monthly_usd: 170, seats: 2 },           // RJ + Mike
    { name: "GHL (APG)",  monthly_usd: 297, seats: 5 },           // base + per-seat
    { name: "ElevenLabs", monthly_usd: 99,  seats: 1, per_active: "shared" },
    { name: "Claude API", monthly_usd: 35,  seats: 1, per_active: "shared" },
    { name: "ATTOM",      monthly_usd: 0,   seats: 1, per_active: "trial" },
    { name: "Cloudflare", monthly_usd: 5,   seats: 1, per_active: "shared" },
  ],
  active_users: 3,
  last_updated: "2026-05-27",
};

// Read the latest blake_iteration review markdown and pull the first three
// "Failure modes" bullets out of it. Best-effort: returns empty when nothing
// has been written yet.
async function readLatestIterationCards(env: { DIAL_STATE: KVNamespace }): Promise<IterationCards> {
  const out: IterationCards = { failure_modes: [], generated_at: null };
  // Iterations live in the vault queue OR (after the daemon picks them up)
  // they're already on disk and we don't have access. So we read the most
  // recent emit by listing the queue + filtering. Once consumed, the data is
  // gone — but the dashboard refresh is cheap.
  //
  // Future: maintain a `blake:iteration:latest` KV pointer the function writes
  // alongside each vault emit. For now, scan the queue.
  try {
    const ptr = await env.DIAL_STATE.get("blake:iteration:latest");
    if (ptr) {
      const parsed = JSON.parse(ptr);
      const md: string = parsed?.review_markdown || "";
      out.generated_at = parsed?.generated_at || null;
      // Find "## Failure modes" section, take first 3 bullet starts.
      const fmIdx = md.indexOf("## Failure modes");
      if (fmIdx >= 0) {
        const section = md.slice(fmIdx, md.indexOf("\n## ", fmIdx + 1));
        const bullets = section.match(/^\d+\.\s+\*\*[^*]+\*\*[^\n]*/gm) || [];
        out.failure_modes = bullets.slice(0, 3).map((b) =>
          b.replace(/^\d+\.\s+/, "").replace(/\*\*/g, "")
        );
      }
    }
  } catch (e) {
    console.warn(`[dashboard-v2] iteration read failed: ${e}`);
  }
  return out;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtSec(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function dashboardHead(): string {
  // Linear/Stripe-style: dark mode default, IBM Plex Mono for numerics, Inter
  // for chrome. Tight 4/8/16 spacing. No emojis. Single CSS block.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG ACQ — Dashboard</title>
<style>
:root {
  --bg:        #0A0E14;
  --bg-2:      #0F141C;
  --bg-3:      #161D28;
  --panel:     #131A24;
  --border:    #1F2937;
  --border-2:  #2A3441;
  --text:      #E5E7EB;
  --text-dim:  #9CA3AF;
  --text-mute: #6B7280;
  --accent:    #60A5FA;
  --accent-2:  #A78BFA;
  --good:      #34D399;
  --warn:      #FBBF24;
  --bad:       #F87171;
  --hot:       #EF4444;
  --warm:      #F59E0B;
  --nurture:   #38BDF8;
  --cold:      #6B7280;
  --dnc:       #94A3B8;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, "Inter", "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.mono, .num { font-family: "IBM Plex Mono", "JetBrains Mono", "SF Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Layout */
header.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
}
header.topbar .brand { font-weight: 600; letter-spacing: 0.02em; font-size: 14px; }
header.topbar .meta  { color: var(--text-mute); font-size: 12px; }

main { padding: 20px 24px; max-width: 1600px; margin: 0 auto; }

/* KPI strip */
.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 24px; }
.kpi {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.kpi .label { color: var(--text-mute); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.kpi .value { font-size: 22px; font-weight: 600; font-family: "IBM Plex Mono", monospace; }
.kpi .delta { color: var(--text-dim); font-size: 11px; margin-top: 4px; }

/* Sections */
section.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 18px 20px;
  margin-bottom: 20px;
}
section.panel h2 {
  font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--text-dim); margin: 0 0 14px 0; font-weight: 600;
}

/* Funnel */
.funnel { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.funnel .step {
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  border-radius: 6px;
  padding: 10px 12px;
}
.funnel .step .name { color: var(--text-mute); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
.funnel .step .count { font-size: 20px; font-weight: 600; font-family: "IBM Plex Mono", monospace; margin-top: 2px; }
.funnel .step .pct { color: var(--text-dim); font-size: 11px; margin-top: 2px; }

/* Two-column */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 1100px) { .grid-2 { grid-template-columns: 1fr; } }

/* Filters */
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: center; }
.filters .group { display: flex; align-items: center; gap: 6px; }
.filters label { color: var(--text-mute); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.filters select, .filters input {
  background: var(--bg-3);
  border: 1px solid var(--border-2);
  color: var(--text);
  padding: 5px 8px;
  font-size: 12px;
  border-radius: 4px;
}
.filters .toggle { color: var(--text-dim); font-size: 12px; cursor: pointer; user-select: none; }
.filters .toggle input { margin-right: 4px; vertical-align: middle; }

/* Table */
table.calls {
  width: 100%; border-collapse: collapse; font-size: 12px;
}
table.calls thead th {
  text-align: left; color: var(--text-mute); font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px;
  padding: 8px 10px; border-bottom: 1px solid var(--border-2);
}
table.calls tbody td {
  padding: 8px 10px; border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.calls tbody tr { cursor: pointer; }
table.calls tbody tr:hover { background: var(--bg-3); }

/* Pills */
.pill { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 10px;
  font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
.pill.hot      { background: rgba(239,68,68,0.15);   color: #FCA5A5; }
.pill.warm     { background: rgba(245,158,11,0.15);  color: #FCD34D; }
.pill.nurture  { background: rgba(56,189,248,0.15);  color: #93C5FD; }
.pill.cold     { background: rgba(107,114,128,0.18); color: #D1D5DB; }
.pill.dnc      { background: rgba(148,163,184,0.18); color: #CBD5E1; }
.pill.unknown  { background: rgba(107,114,128,0.18); color: #D1D5DB; }

/* Cost table */
table.cost { width: 100%; border-collapse: collapse; font-size: 12px; }
table.cost th, table.cost td { padding: 6px 10px; text-align: right; }
table.cost th:first-child, table.cost td:first-child { text-align: left; }
table.cost thead th { color: var(--text-mute); font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; border-bottom: 1px solid var(--border-2); }
table.cost tbody td { border-bottom: 1px solid var(--border); font-family: "IBM Plex Mono", monospace; }
table.cost tfoot td { padding-top: 10px; font-weight: 600; }

/* Improve cards */
.improve-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.improve-cards .card {
  background: var(--bg-3); border: 1px solid var(--border-2); border-radius: 6px;
  padding: 12px 14px; font-size: 12px; color: var(--text-dim); line-height: 1.5;
}
.improve-cards .card .rank { color: var(--accent); font-weight: 600; margin-right: 6px; }
.improve-cards .empty { color: var(--text-mute); font-style: italic; }

/* Modal */
.modal-backdrop {
  display: none;
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  z-index: 100; align-items: flex-start; justify-content: center; padding: 60px 20px;
  overflow-y: auto;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: var(--panel); border: 1px solid var(--border-2);
  border-radius: 8px; padding: 22px 26px; max-width: 800px; width: 100%;
}
.modal h3 { margin-top: 0; font-size: 16px; }
.modal pre { background: var(--bg); border: 1px solid var(--border); padding: 10px; border-radius: 4px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; }
.modal .close { float: right; cursor: pointer; color: var(--text-mute); font-size: 18px; line-height: 1; }
</style>
</head>`;
}

function pillFor(leadTemp: string): string {
  const v = (leadTemp || "").toLowerCase();
  const known = ["hot", "warm", "nurture", "cold", "dnc"];
  const klass = known.includes(v) ? v : "unknown";
  return `<span class="pill ${klass}">${v || "?"}</span>`;
}

export async function renderDashboardV2(env: {
  DIAL_STATE: KVNamespace;
}): Promise<string> {
  // 1. Pull the existing live dashboard cache (populated by /dashboard-data
  //    + cron tick). If empty, render placeholder.
  let data: DashboardV2Data | null = null;
  try {
    const raw = await env.DIAL_STATE.get("dashboard:cache");
    if (raw) data = JSON.parse(raw);
  } catch {}

  const cards = await readLatestIterationCards(env);
  const cost = DEFAULT_COST_CONFIG;

  const kpis = data?.kpis || {
    calls_today: 0, calls_week: 0, calls_total: 0,
    avg_duration_secs: 0, hot_count: 0, engaged_pct: 0,
  };
  const calls = data?.recent_calls || [];

  // Funnel — compute from the call list. Heuristic for now; can be replaced
  // with real GHL pipeline counts when /dashboard-data exposes them.
  const dials      = calls.length;
  const connects   = calls.filter((c) => (c.duration_s || 0) >= 15).length;
  const qualified  = calls.filter((c) => c.lead_temp === "warm" || c.lead_temp === "hot").length;
  const booked     = calls.filter((c) => c.lead_temp === "hot").length;
  // Contracted is the long-tail outcome — we don't track it on call records;
  // pull from a future GHL pipeline count. For now, 0 placeholder.
  const contracted = 0;
  const pct = (n: number, base: number) => base ? `${Math.round((n / base) * 100)}%` : "—";

  // Cost summary
  const totalMonthly = cost.tools.reduce((a, t) => a + t.monthly_usd, 0);
  const perUser = Math.round(totalMonthly / Math.max(1, cost.active_users));

  const updatedAt = data?.updated_at || new Date().toISOString();
  const updatedDisp = new Date(updatedAt).toLocaleString();

  return `${dashboardHead()}
<body>
<header class="topbar">
  <div class="brand">APG ACQ · Dashboard</div>
  <div class="meta mono">Updated ${updatedDisp}</div>
</header>
<main>

<div class="kpi-row">
  <div class="kpi"><div class="label">Calls Today</div><div class="value">${kpis.calls_today}</div></div>
  <div class="kpi"><div class="label">Week</div><div class="value">${kpis.calls_week}</div></div>
  <div class="kpi"><div class="label">All-time</div><div class="value">${kpis.calls_total}</div></div>
  <div class="kpi"><div class="label">Avg Duration</div><div class="value">${fmtSec(kpis.avg_duration_secs)}</div></div>
  <div class="kpi"><div class="label">Hot Leads</div><div class="value">${kpis.hot_count}</div></div>
  <div class="kpi"><div class="label">Engaged %</div><div class="value">${kpis.engaged_pct}%</div></div>
</div>

<section class="panel">
  <h2>Funnel — dials to contracted</h2>
  <div class="funnel">
    <div class="step"><div class="name">Dials</div><div class="count">${dials}</div><div class="pct">100%</div></div>
    <div class="step"><div class="name">Connects</div><div class="count">${connects}</div><div class="pct">${pct(connects, dials)}</div></div>
    <div class="step"><div class="name">Qualified</div><div class="count">${qualified}</div><div class="pct">${pct(qualified, dials)}</div></div>
    <div class="step"><div class="name">Booked</div><div class="count">${booked}</div><div class="pct">${pct(booked, dials)}</div></div>
    <div class="step"><div class="name">Contracted</div><div class="count">${contracted}</div><div class="pct">${pct(contracted, dials)}</div></div>
  </div>
</section>

<section class="panel">
  <h2>What Blake can improve on</h2>
  <div class="improve-cards">
    ${cards.failure_modes.length === 0
      ? `<div class="card empty">No iteration review yet. Run <code>POST /admin/blake/self-improve?sample=10</code> to generate one.</div>`
      : cards.failure_modes.map((fm, i) => `<div class="card"><span class="rank">${i + 1}.</span>${escapeHtml(fm)}</div>`).join("")}
  </div>
  ${cards.generated_at ? `<div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:8px;">Latest review: ${cards.generated_at}</div>` : ""}
</section>

<div class="grid-2">
  <section class="panel">
    <h2>RJ Performance — last 7 days</h2>
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin:0;">
      <div class="kpi"><div class="label">Callbacks Booked</div><div class="value">${booked}</div></div>
      <div class="kpi"><div class="label">Avg Connect Time</div><div class="value">${fmtSec(kpis.avg_duration_secs)}</div></div>
      <div class="kpi"><div class="label">Disposition Coverage</div><div class="value">${pct(qualified + booked, dials)}</div></div>
    </div>
    <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:14px;">
      Connectivity flags: <span style="color:var(--text-dim);">awaiting Calltools webhook integration</span>
    </div>
  </section>
  <section class="panel">
    <h2>Tech stack — cost per active user</h2>
    <table class="cost">
      <thead><tr><th>Tool</th><th>Monthly</th><th>Seats</th><th>Per active user</th></tr></thead>
      <tbody>
        ${cost.tools.map((t) => `
          <tr>
            <td>${t.name}</td>
            <td>${fmtUsd(t.monthly_usd)}</td>
            <td>${t.seats}</td>
            <td>${t.per_active === "shared" ? "shared" : t.per_active === "trial" ? "trial" : fmtUsd(Math.round(t.monthly_usd / Math.max(1, t.seats)))}</td>
          </tr>`).join("")}
      </tbody>
      <tfoot>
        <tr><td>Total / Active users (${cost.active_users})</td><td>${fmtUsd(totalMonthly)}</td><td>—</td><td>${fmtUsd(perUser)}/user</td></tr>
      </tfoot>
    </table>
    <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:8px;">Config last updated ${cost.last_updated}. Edit DEFAULT_COST_CONFIG in dashboard-v2.ts.</div>
  </section>
</div>

<section class="panel">
  <h2>Blake calls — recent</h2>
  <div class="filters">
    <div class="group"><label>Outcome</label>
      <select id="f-outcome">
        <option value="">All</option>
        <option value="connected">Connected (≥15s)</option>
        <option value="voicemail">Voicemail (3-14s)</option>
        <option value="no-answer">No answer (&lt;3s)</option>
        <option value="dnc">DNC</option>
      </select>
    </div>
    <div class="group"><label>Disposition</label>
      <select id="f-temp">
        <option value="">All</option>
        <option value="hot">Hot</option>
        <option value="warm">Warm</option>
        <option value="nurture">Nurture</option>
        <option value="cold">Cold</option>
        <option value="dnc">DNC</option>
      </select>
    </div>
    <div class="group"><label>Source</label>
      <select id="f-source">
        <option value="">All</option>
        <option value="landing">Landing page</option>
        <option value="listing">Listing pipeline</option>
        <option value="referral">Referral</option>
        <option value="unknown">Unknown</option>
      </select>
    </div>
    <div class="group"><label>Since</label>
      <input id="f-since" type="date" />
    </div>
    <label class="toggle"><input type="checkbox" id="f-unique" /> Unique contacts only</label>
    <span id="f-count" class="mono" style="color:var(--text-mute);margin-left:auto;font-size:11px;"></span>
  </div>
  <table class="calls">
    <thead><tr>
      <th>When</th>
      <th>Caller</th>
      <th>Duration</th>
      <th>Outcome</th>
      <th>Disposition</th>
      <th>Source</th>
      <th>Summary</th>
    </tr></thead>
    <tbody id="calls-body">
      ${calls.map((c) => {
        const dur = c.duration_s || 0;
        const outcome = dur >= 15 ? "connected" : dur >= 3 ? "voicemail" : "no-answer";
        const source = (c.source || "unknown").toLowerCase();
        const caller = c.contact_name || c.caller_phone || "(unknown)";
        const summary = (c.summary || c.transcript_excerpt || "").slice(0, 120);
        return `<tr data-outcome="${outcome}" data-temp="${c.lead_temp || ''}" data-source="${source}" data-phone="${escapeHtml(c.caller_phone || '')}" data-ts="${c.started_at || ''}" data-call='${escapeAttr(JSON.stringify(c))}'>
          <td class="mono" style="color:var(--text-dim);">${new Date(c.started_at || Date.now()).toLocaleString()}</td>
          <td>${escapeHtml(caller)}</td>
          <td class="mono">${fmtSec(dur)}</td>
          <td>${outcome}</td>
          <td>${pillFor(c.lead_temp || "")}</td>
          <td style="color:var(--text-dim);">${source}</td>
          <td style="color:var(--text-dim);">${escapeHtml(summary)}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
</section>

<section class="panel">
  <h2>Variant performance (Workstream 1)</h2>
  <div style="color:var(--text-mute);font-size:12px;">
    A/B/C variant routing not yet shipped. Once Workstream 1 lands, this section surfaces conversions per variant + Clarity engagement metrics (unique visitors only).
  </div>
</section>

</main>

<div class="modal-backdrop" id="modal-backdrop">
  <div class="modal">
    <span class="close" onclick="document.getElementById('modal-backdrop').classList.remove('open');">×</span>
    <h3 id="modal-title">Call detail</h3>
    <pre id="modal-body"></pre>
  </div>
</div>

<script>
(function(){
  var body = document.getElementById('calls-body');
  var fOut = document.getElementById('f-outcome');
  var fTemp = document.getElementById('f-temp');
  var fSrc = document.getElementById('f-source');
  var fSince = document.getElementById('f-since');
  var fUnique = document.getElementById('f-unique');
  var fCount = document.getElementById('f-count');
  var seen = {};
  function filter(){
    seen = {};
    var rows = body.querySelectorAll('tr');
    var n = 0;
    rows.forEach(function(r){
      var ok = true;
      if (fOut.value  && r.dataset.outcome !== fOut.value)  ok = false;
      if (fTemp.value && r.dataset.temp    !== fTemp.value) ok = false;
      if (fSrc.value  && r.dataset.source  !== fSrc.value)  ok = false;
      if (fSince.value && r.dataset.ts && new Date(r.dataset.ts) < new Date(fSince.value)) ok = false;
      if (fUnique.checked && r.dataset.phone) {
        if (seen[r.dataset.phone]) ok = false;
        else seen[r.dataset.phone] = 1;
      }
      r.style.display = ok ? '' : 'none';
      if (ok) n++;
    });
    fCount.textContent = n + ' of ' + rows.length + ' shown';
  }
  [fOut, fTemp, fSrc, fSince, fUnique].forEach(function(el){ el.addEventListener('change', filter); });
  body.addEventListener('click', function(e){
    var tr = e.target.closest('tr');
    if (!tr || !tr.dataset.call) return;
    try {
      var call = JSON.parse(tr.dataset.call);
      document.getElementById('modal-title').textContent = (call.contact_name || call.caller_phone || 'Call') + ' — ' + (call.started_at || '');
      document.getElementById('modal-body').textContent = JSON.stringify(call, null, 2);
      document.getElementById('modal-backdrop').classList.add('open');
    } catch (err) {}
  });
  document.getElementById('modal-backdrop').addEventListener('click', function(e){
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });
  filter();
})();
</script>
</body>
</html>`;
}

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
    .replace(/</g, "&lt;");
}
