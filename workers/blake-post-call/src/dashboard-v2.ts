// dashboard-v2.ts — unified server-rendered dashboard at /dashboard.
//
// Tabbed layout (Mido directive, 2026-05-27):
//   Overview — KPIs + funnel + cost snapshot + improve cards
//   Calls    — Blake calls table with filters (outcome / disp / source / date / unique)
//   Voice    — Brian vs Roger A/B stats + per-voice tag
//   Agents   — per-agent (RJ/Mike/Justus/Brady) call+msg+opp activity (PR C populates AI review)
//   Costs    — tech-stack cost per active user (detailed breakdown)
//   Variants — website A/B/C performance (placeholder until WS1 ships)
//
// All tabs in one page, server-rendered, vanilla JS for tab switch + filters.
// No SPA, no build step, single CSS block. Linear/Stripe density, dark mode,
// no emojis in chrome.

// Field names MUST match computeDashboardData() output in index.ts:3088 —
// the cache writes `started_unix`, `duration_secs`, `caller_name`,
// `outcome_tag`, etc., NOT `started_at`/`duration_s`/`lead_temp`. Earlier
// version of dashboard-v2 read the wrong field names, so everything
// rendered as zeros/blanks even though the cache was populated. Fixed
// 2026-05-27 (Mido feedback: "dashboard is not good").
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
  warmup?: {
    day: number;
    daily_quota: number;
    dialed_today: number;
    remaining_today: number;
  };
  recent_calls: Array<{
    conv_id: string;
    started_unix: number;
    duration_secs: number;
    caller_phone: string;
    caller_name?: string;
    caller_address?: string;
    ghl_contact_id?: string;
    outcome_tag?: string;      // "hot" | "warm" | "cold" | "dnd" | "voicemail" | "no_answer" | "unknown"
    outcome_label?: string;
    summary?: string;
    hydrated?: boolean;
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
/* Tab nav */
.tabnav {
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  padding: 0 24px;
  overflow-x: auto;
}
.tabnav button {
  background: transparent; border: 0; color: var(--text-mute);
  padding: 12px 14px; font-size: 12px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;
  border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s;
}
.tabnav button:hover { color: var(--text); }
.tabnav button.active { color: var(--accent); border-bottom-color: var(--accent); }
.tabnav .badge {
  display: inline-block; margin-left: 6px; padding: 1px 6px;
  background: var(--bg-3); border-radius: 8px; font-size: 10px;
  color: var(--text-dim); font-weight: 500; letter-spacing: 0;
}
.tab-panel { display: none; }
.tab-panel.active { display: block; }

/* Voice A/B */
.voice-card {
  background: var(--bg-3); border: 1px solid var(--border-2); border-radius: 8px;
  padding: 18px 20px; min-width: 220px;
}
.voice-card .name { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.voice-card .row { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0; }
.voice-card .row .label { color: var(--text-mute); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.voice-card .row .value { font-family: "IBM Plex Mono", monospace; font-size: 16px; }
.voice-card .winner { color: var(--good); font-size: 11px; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.08em; }

/* Agent cards */
.agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.agent-card {
  background: var(--bg-3); border: 1px solid var(--border-2); border-radius: 8px;
  padding: 14px 16px;
}
.agent-card .name { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.agent-card .role { color: var(--text-mute); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
.agent-card .stat { display: flex; justify-content: space-between; font-size: 12px; padding: 4px 0; }
.agent-card .stat .label { color: var(--text-dim); }
.agent-card .stat .value { font-family: "IBM Plex Mono", monospace; color: var(--text); }
.agent-card .review { color: var(--text-mute); font-size: 11px; font-style: italic; margin-top: 10px; line-height: 1.5; }

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

// Map computeDashboardData outcome_tag → display pill.
function outcomePillFor(tag: string, label: string): string {
  const t = (tag || "unknown").toLowerCase();
  const klassMap: Record<string, string> = {
    hot: "hot", warm: "warm", cold: "cold", dnd: "dnc",
    voicemail: "nurture", no_answer: "unknown", completed: "warm", unknown: "unknown",
  };
  const klass = klassMap[t] || "unknown";
  const display = label || (t === "no_answer" ? "No Answer" : t === "dnd" ? "DNC" : t.charAt(0).toUpperCase() + t.slice(1));
  return `<span class="pill ${klass}">${display}</span>`;
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
  const warmup = data?.warmup;

  // Funnel — real categorization from outcome_tag set by classifyOutcomeForDashboard:
  //   "hot"       — Hot Lead per transcript_summary
  //   "warm"      — engaged but not hot
  //   "cold"      — not interested
  //   "dnd"       — DNC requested
  //   "voicemail" — left a message
  //   "no_answer" — call dropped under 3s
  //   "completed" — connected, neutral outcome
  //   "unknown"   — not yet hydrated
  const dials      = calls.length;
  const connects   = calls.filter((c) => {
    const t = c.outcome_tag || "";
    return t === "hot" || t === "warm" || t === "cold" || t === "completed" || t === "dnd";
  }).length;
  const qualified  = calls.filter((c) => c.outcome_tag === "warm" || c.outcome_tag === "hot").length;
  const booked     = calls.filter((c) => c.outcome_tag === "hot").length;
  // Contracted requires a pipeline-stage lookup — leave at 0 until that's wired.
  const contracted = 0;
  const pct = (n: number, base: number) => base ? `${Math.round((n / base) * 100)}%` : "—";

  // Cost summary
  const totalMonthly = cost.tools.reduce((a, t) => a + t.monthly_usd, 0);
  const perUser = Math.round(totalMonthly / Math.max(1, cost.active_users));

  const updatedAt = data?.updated_at || new Date().toISOString();
  const updatedDisp = new Date(updatedAt).toLocaleString();

  // Voice A/B stats — populated by /conversation-init + post-call attribution.
  const voiceStats = await readVoiceAbStats(env);
  // Per-agent activity — reads `agent:activity:<user_id>:weekly` + `:latest`
  // from KV. Falls back to zero-stat placeholders when the aggregator hasn't
  // run yet.
  const agentStub = await readAgentActivity(env);

  return `${dashboardHead()}
<body>
<header class="topbar">
  <div class="brand">APG ACQ · Dashboard</div>
  <div class="meta mono">Updated ${updatedDisp}</div>
</header>
<nav class="tabnav" id="tabnav">
  <button data-tab="overview" class="active">Overview</button>
  <button data-tab="calls">Calls <span class="badge">${calls.length}</span></button>
  <button data-tab="voice">Voice A/B</button>
  <button data-tab="agents">Agents</button>
  <button data-tab="costs">Costs</button>
  <button data-tab="variants">Variants</button>
</nav>
<main>

<!-- TAB: Overview -->
<div class="tab-panel active" data-tab="overview">

<div class="kpi-row">
  <div class="kpi"><div class="label">Calls Today</div><div class="value">${kpis.calls_today}</div></div>
  <div class="kpi"><div class="label">Week</div><div class="value">${kpis.calls_week}</div></div>
  <div class="kpi"><div class="label">All-time</div><div class="value">${kpis.calls_total}</div></div>
  <div class="kpi"><div class="label">Avg Duration</div><div class="value">${fmtSec(kpis.avg_duration_secs)}</div></div>
  <div class="kpi"><div class="label">Hot Leads</div><div class="value">${kpis.hot_count}</div></div>
  <div class="kpi"><div class="label">Engaged %</div><div class="value">${kpis.engaged_pct}%</div></div>
</div>

${warmup ? `<div class="kpi-row" style="margin-top:-8px;">
  <div class="kpi"><div class="label">Warm-up Day</div><div class="value">${warmup.day}</div></div>
  <div class="kpi"><div class="label">Daily Quota</div><div class="value">${warmup.daily_quota}</div></div>
  <div class="kpi"><div class="label">Dialed Today</div><div class="value">${warmup.dialed_today}</div></div>
  <div class="kpi"><div class="label">Remaining</div><div class="value">${warmup.remaining_today}</div></div>
  <div class="kpi" style="grid-column:span 2;"><div class="label">Quota Used</div><div class="value">${warmup.daily_quota ? Math.round(100 * warmup.dialed_today / warmup.daily_quota) : 0}%</div></div>
</div>` : ""}

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

</div><!-- /Overview -->

<!-- TAB: Calls -->
<div class="tab-panel" data-tab="calls">
<section class="panel">
  <h2>Blake calls — recent</h2>
  <div class="filters">
    <div class="group"><label>Range</label>
      <select id="f-range">
        <option value="all">All time</option>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>
    </div>
    <div class="group"><label>Outcome</label>
      <select id="f-outcome">
        <option value="">All outcomes</option>
        <option value="hot">Hot Lead</option>
        <option value="warm">Warm</option>
        <option value="cold">Not Interested</option>
        <option value="dnd">DNC</option>
        <option value="voicemail">Voicemail</option>
        <option value="no_answer">No Answer</option>
        <option value="completed">Completed (neutral)</option>
        <option value="unknown">Unknown</option>
      </select>
    </div>
    <div class="group"><label>Connected?</label>
      <select id="f-connected">
        <option value="">Either</option>
        <option value="yes">Connected only</option>
        <option value="no">Not connected only</option>
      </select>
    </div>
    <div class="group"><label>Min duration</label>
      <select id="f-mindur">
        <option value="0">Any</option>
        <option value="3">≥ 3s</option>
        <option value="15">≥ 15s</option>
        <option value="60">≥ 1 min</option>
      </select>
    </div>
    <label class="toggle"><input type="checkbox" id="f-unique" /> Unique contacts only</label>
    <span id="f-count" class="mono" style="color:var(--text-mute);margin-left:auto;font-size:11px;"></span>
  </div>
  <table class="calls">
    <thead><tr>
      <th>When</th>
      <th>Caller</th>
      <th>Phone</th>
      <th>Duration</th>
      <th>Outcome</th>
      <th>Summary</th>
    </tr></thead>
    <tbody id="calls-body">
      ${calls.map((c) => {
        const dur = c.duration_secs || 0;
        const tag = (c.outcome_tag || "unknown").toLowerCase();
        const connected = (tag === "hot" || tag === "warm" || tag === "cold" || tag === "completed" || tag === "dnd") ? "yes" : "no";
        const caller = c.caller_name || "(not in GHL)";
        const phone = c.caller_phone || "—";
        const summary = (c.summary || "").slice(0, 140);
        const startedMs = (c.started_unix || 0) * 1000;
        return `<tr data-outcome="${tag}" data-connected="${connected}" data-duration="${dur}" data-phone="${escapeHtml(phone)}" data-ts="${startedMs}" data-call='${escapeAttr(JSON.stringify(c))}'>
          <td class="mono" style="color:var(--text-dim);">${startedMs ? new Date(startedMs).toLocaleString() : "—"}</td>
          <td>${escapeHtml(caller)}</td>
          <td class="mono" style="color:var(--text-dim);">${escapeHtml(phone)}</td>
          <td class="mono">${fmtSec(dur)}</td>
          <td>${outcomePillFor(tag, c.outcome_label || "")}</td>
          <td style="color:var(--text-dim);">${escapeHtml(summary)}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
</section>

</section>
</div><!-- /Calls -->

<!-- TAB: Voice A/B -->
<div class="tab-panel" data-tab="voice">
<section class="panel">
  <h2>Voice A/B — Brian vs Roger</h2>
  <div style="color:var(--text-mute);font-size:12px;margin-bottom:14px;">
    50/50 split active since 2026-05-27 via <code>/conversation-init</code>. Each new call randomly assigns Brian or Roger; post-call attribution tags the GHL contact with <code>voice-brian</code> or <code>voice-roger</code> for downstream conversion analysis.
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;">
    <div class="voice-card">
      <div class="name">Brian <span class="mono" style="color:var(--text-mute);font-size:10px;">nPczCjz...zQrb</span></div>
      <div class="row"><span class="label">Calls Sent</span><span class="value">${voiceStats.brian.sent}</span></div>
      <div class="row"><span class="label">Completed</span><span class="value">${voiceStats.brian.completed}</span></div>
      <div class="row"><span class="label">Completion %</span><span class="value">${voiceStats.brian.completion_pct}%</span></div>
      ${voiceStats.winner === "brian" ? `<div class="winner">▲ ahead</div>` : ""}
    </div>
    <div class="voice-card">
      <div class="name">Roger <span class="mono" style="color:var(--text-mute);font-size:10px;">CwhRB...Fs17</span></div>
      <div class="row"><span class="label">Calls Sent</span><span class="value">${voiceStats.roger.sent}</span></div>
      <div class="row"><span class="label">Completed</span><span class="value">${voiceStats.roger.completed}</span></div>
      <div class="row"><span class="label">Completion %</span><span class="value">${voiceStats.roger.completion_pct}%</span></div>
      ${voiceStats.winner === "roger" ? `<div class="winner">▲ ahead</div>` : ""}
    </div>
  </div>
  <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:14px;">
    Raw counters: <code>blake:ab_stats:&lt;voice&gt;:sent</code> / <code>:completed</code>. Pick winner after ~50 sent each.
  </div>
</section>
</div><!-- /Voice -->

<!-- TAB: Agents -->
<div class="tab-panel" data-tab="agents">
<section class="panel">
  <h2>Agent activity — last 7 days</h2>
  <div style="color:var(--text-mute);font-size:12px;margin-bottom:14px;">
    Per-agent breakdown of calls, opp moves, tasks completed. AI-generated review per agent populates after the next daily cron tick.
  </div>
  <div class="agent-grid">
    ${agentStub.map((a) => `
      <div class="agent-card">
        <div class="name">${escapeHtml(a.name)}</div>
        <div class="role">${escapeHtml(a.role)}</div>
        <div class="stat"><span class="label">Opps assigned</span><span class="value">${a.opps_assigned}</span></div>
        <div class="stat"><span class="label">Opps moved</span><span class="value">${a.opps_moved}</span></div>
        <div class="stat"><span class="label">Tasks completed</span><span class="value">${a.tasks_completed}</span></div>
        <div class="stat"><span class="label">Outbound msgs</span><span class="value">${a.outbound_msgs}</span></div>
        ${a.ai_review
          ? `<div class="review">${escapeHtml(a.ai_review)}</div>`
          : `<div class="review">AI review pending — see <code>POST /admin/agents/review</code>.</div>`}
      </div>`).join("")}
  </div>
</section>
</div><!-- /Agents -->

<!-- TAB: Costs -->
<div class="tab-panel" data-tab="costs">
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
</div><!-- /Costs -->

<!-- TAB: Variants -->
<div class="tab-panel" data-tab="variants">
<section class="panel">
  <h2>Website variants — A/B/C (Workstream 1)</h2>
  <div style="color:var(--text-mute);font-size:12px;">
    Friendly / Professional / Traditional routing not yet shipped. Once Workstream 1 lands at the edge, this section surfaces conversions per variant + Clarity engagement metrics (unique visitors only).
  </div>
</section>
</div><!-- /Variants -->

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
  var fRange = document.getElementById('f-range');
  var fOut = document.getElementById('f-outcome');
  var fConnected = document.getElementById('f-connected');
  var fMinDur = document.getElementById('f-mindur');
  var fUnique = document.getElementById('f-unique');
  var fCount = document.getElementById('f-count');

  function rangeCutoff(val) {
    var now = Date.now();
    var d = new Date(); d.setHours(0,0,0,0);
    var startOfTodayMs = d.getTime();
    switch (val) {
      case 'today':     return [startOfTodayMs, now];
      case 'yesterday': return [startOfTodayMs - 86400000, startOfTodayMs];
      case '7d':        return [now - 7 * 86400000, now];
      case '30d':       return [now - 30 * 86400000, now];
      default:          return [0, Infinity];
    }
  }

  function filter(){
    var seen = {};
    var rows = body.querySelectorAll('tr');
    var range = rangeCutoff(fRange.value);
    var minDur = Number(fMinDur.value || 0);
    var n = 0;
    rows.forEach(function(r){
      var ok = true;
      var ts = Number(r.dataset.ts || 0);
      if (ts && (ts < range[0] || ts > range[1])) ok = false;
      if (fOut.value && r.dataset.outcome !== fOut.value) ok = false;
      if (fConnected.value && r.dataset.connected !== fConnected.value) ok = false;
      if (Number(r.dataset.duration || 0) < minDur) ok = false;
      if (fUnique.checked && r.dataset.phone) {
        if (seen[r.dataset.phone]) ok = false;
        else seen[r.dataset.phone] = 1;
      }
      r.style.display = ok ? '' : 'none';
      if (ok) n++;
    });
    fCount.textContent = n + ' of ' + rows.length + ' shown';
  }
  [fRange, fOut, fConnected, fMinDur, fUnique].forEach(function(el){
    if (el) el.addEventListener('change', filter);
  });

  // Auto-refresh the whole dashboard every 60s so the data is never more
  // than a minute stale. Only reloads when the user isn't actively
  // interacting (avoids clobbering an open modal or in-progress filter
  // click).
  var lastInteract = Date.now();
  document.addEventListener('click', function(){ lastInteract = Date.now(); });
  document.addEventListener('keydown', function(){ lastInteract = Date.now(); });
  setInterval(function(){
    var idleMs = Date.now() - lastInteract;
    var modalOpen = document.getElementById('modal-backdrop').classList.contains('open');
    if (idleMs > 5000 && !modalOpen) location.reload();
  }, 60000);

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

  // Tab switching — vanilla, no router. Hash drives the active tab so links
  // are share-able (e.g. /dashboard#calls).
  var tabs = document.querySelectorAll('#tabnav button');
  var panels = document.querySelectorAll('.tab-panel');
  function activate(name) {
    tabs.forEach(function(t){ t.classList.toggle('active', t.dataset.tab === name); });
    panels.forEach(function(p){ p.classList.toggle('active', p.dataset.tab === name); });
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      activate(t.dataset.tab);
      history.replaceState(null, '', '#' + t.dataset.tab);
    });
  });
  var fromHash = (location.hash || '').replace('#','');
  if (fromHash) activate(fromHash);
})();
</script>
</body>
</html>`;
}

// ---- Voice A/B reader -------------------------------------------------------

interface VoiceAbStats {
  brian: { sent: number; completed: number; completion_pct: number };
  roger: { sent: number; completed: number; completion_pct: number };
  winner: "brian" | "roger" | "tie" | "insufficient";
}

async function readVoiceAbStats(env: { DIAL_STATE: KVNamespace }): Promise<VoiceAbStats> {
  const read = async (k: string): Promise<number> => Number((await env.DIAL_STATE.get(k)) || "0");
  const [bs, bc, rs, rc] = await Promise.all([
    read("blake:ab_stats:brian:sent"),
    read("blake:ab_stats:brian:completed"),
    read("blake:ab_stats:roger:sent"),
    read("blake:ab_stats:roger:completed"),
  ]);
  const bp = bs ? Math.round((bc / bs) * 100) : 0;
  const rp = rs ? Math.round((rc / rs) * 100) : 0;
  let winner: VoiceAbStats["winner"] = "insufficient";
  // Need ≥10 sent on EACH side before we call a winner, otherwise it's noise.
  if (bs >= 10 && rs >= 10) {
    winner = bp === rp ? "tie" : bp > rp ? "brian" : "roger";
  }
  return {
    brian: { sent: bs, completed: bc, completion_pct: bp },
    roger: { sent: rs, completed: rc, completion_pct: rp },
    winner,
  };
}

// ---- Agent activity stub ----------------------------------------------------
//
// PR C will populate these from GHL aggregations. For now we render the four
// known agents with zero-stat placeholders so the Agents tab isn't empty.

interface AgentActivity {
  name: string;
  role: string;
  ghl_user_id?: string;
  opps_assigned: number;
  opps_moved: number;
  tasks_completed: number;
  outbound_msgs: number;
  ai_review: string | null;
}

function readAgentActivityStub(_env: { DIAL_STATE: KVNamespace }): AgentActivity[] {
  // Synchronous fallback used only when the async reader can't fire (e.g. KV
  // is unavailable). Returns the 4-agent placeholder list.
  return [
    { name: "RJ Fonseca",      role: "Acquisitions Partner", opps_assigned: 0, opps_moved: 0, tasks_completed: 0, outbound_msgs: 0, ai_review: null },
    { name: "Mike (Yasser)",   role: "PM / Marketing Systems", opps_assigned: 0, opps_moved: 0, tasks_completed: 0, outbound_msgs: 0, ai_review: null },
    { name: "Justus",          role: "VA — Acquisitions",      opps_assigned: 0, opps_moved: 0, tasks_completed: 0, outbound_msgs: 0, ai_review: null },
    { name: "Brady",           role: "Apprentice",             opps_assigned: 0, opps_moved: 0, tasks_completed: 0, outbound_msgs: 0, ai_review: null },
  ];
}

// PR C — async reader that pulls real activity + reviews from KV. Falls back
// to the stub when nothing has been aggregated yet (KV empty).
export async function readAgentActivity(env: { DIAL_STATE: KVNamespace }): Promise<AgentActivity[]> {
  const ROSTER = [
    { user_id: "EvxJmnll1hlJtzpW14BE", name: "RJ Fonseca",    role: "Acquisitions Partner" },
    { user_id: "Vj4WwH1ovxGN5Hv5Kq17", name: "Mike (Yasser)", role: "PM / Marketing Systems" },
  ];
  const out: AgentActivity[] = [];
  for (const u of ROSTER) {
    const [aRaw, rRaw] = await Promise.all([
      env.DIAL_STATE.get(`agent:activity:${u.user_id}:weekly`),
      env.DIAL_STATE.get(`agent:review:${u.user_id}:latest`),
    ]);
    let activity: any = null;
    let review: any = null;
    try { if (aRaw) activity = JSON.parse(aRaw); } catch {}
    try { if (rRaw) review = JSON.parse(rRaw); } catch {}
    // Pull a one-line teaser from the review markdown (first "## What should
    // have gone better" bullet, or fall back to one-line summary).
    let teaser: string | null = null;
    if (review?.review_md) {
      const md = String(review.review_md);
      const m = md.match(/## What should have gone better[^\n]*\n+1\.\s*\*\*([^*]+)\*\*([^\n]*)/i);
      if (m) {
        teaser = (m[1] + " — " + (m[2] || "").trim()).slice(0, 200);
      } else {
        const first = md.split(/\n+/).filter((l) => l.trim() && !l.startsWith("#"))[0];
        if (first) teaser = first.slice(0, 200);
      }
    }
    out.push({
      name: u.name,
      role: u.role,
      ghl_user_id: u.user_id,
      opps_assigned:   activity?.opps_assigned ?? 0,
      opps_moved:      activity?.opps_moved ?? 0,
      tasks_completed: activity?.tasks_completed ?? 0,
      outbound_msgs:   activity?.outbound_msgs ?? 0,
      ai_review:       teaser,
    });
  }
  return out;
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
