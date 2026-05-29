// dashboard-v2.ts — unified server-rendered dashboard at /dashboard.
//
// Tabbed layout (Mido directive, 2026-05-27):
//   Overview — KPIs + funnel + cost snapshot + improve cards
//   Calls    — Blake calls table with filters (outcome / disp / source / date / unique)
//   Voice    — Eric/Chris/Bill 3-way A/B stats + per-voice tag (legacy Brian/Roger preserved)
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* APG editorial brand — cream paper + ink navy + gold accents.
   Mirrors /insights and /blake.html. Mido feedback 2026-05-27:
   "coloring scheme is really bad. It feels so AI made." Generic dark
   mode out, brand palette in. */
:root {
  --paper:     #FFFFFF;
  --cream:     #FAF7EC;
  --cream-2:   #F3EED8;
  --bg:        #FAF7EC;
  --bg-2:      #FFFFFF;
  --bg-3:      #F3EED8;
  --panel:     #FFFFFF;
  --border:    #E5E0C8;
  --border-2:  #C9C2A8;
  --ink:       #0A1F44;
  --ink-soft:  #1A2840;
  --text:      #101827;
  --text-dim:  #5A6786;
  --text-mute: #8A93AA;
  --gold:      #F5C518;
  --gold-soft: #FFE58A;
  --gold-wash: #FFF6D0;
  --gold-deep: #B58800;
  --accent:    #0A1F44;
  --accent-2:  #B58800;
  --good:      #0e6e2f;
  --warn:      #C77B00;
  --bad:       #8b1a1a;
  --hot:       #B91C1C;
  --warm:      #EA580C;
  --nurture:   #2563EB;
  --cold:      #5A6786;
  --dnc:       #6B625A;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", -apple-system, "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.serif { font-family: "Playfair Display", Georgia, serif; }
.mono, .num { font-family: "IBM Plex Mono", "JetBrains Mono", "SF Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--gold); }
a:hover { color: var(--gold-deep); }

/* Editorial masthead */
header.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 32px 18px;
  border-top: 5px solid var(--ink);
  border-bottom: 1px solid var(--border);
  background: var(--paper);
  position: relative;
}
header.topbar::before {
  content: ""; position: absolute; left: 0; top: 0;
  width: 160px; height: 5px; background: var(--gold);
}
header.topbar .brand {
  font-family: "Playfair Display", Georgia, serif;
  font-weight: 700; font-size: 22px; color: var(--ink);
  letter-spacing: -0.01em;
}
header.topbar .brand em { color: var(--gold-deep); font-style: italic; font-weight: 600; }
header.topbar .meta  {
  color: var(--text-mute); font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.18em;
}

main { padding: 24px 32px 80px; max-width: 1500px; margin: 0 auto; }

/* KPI strip */
.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-bottom: 28px; }
.kpi {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px 18px;
  position: relative;
}
.kpi::before {
  content: ""; position: absolute; left: 0; top: 0;
  width: 100%; height: 2px; background: var(--gold);
  opacity: 0;
  transition: opacity 0.2s;
}
.kpi:hover::before { opacity: 1; }
.kpi .label { color: var(--text-mute); font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 8px; font-weight: 600; }
.kpi .value { font-size: 26px; font-weight: 700; font-family: "Playfair Display", Georgia, serif; color: var(--ink); }
.kpi .delta { color: var(--text-dim); font-size: 11px; margin-top: 4px; }

/* Sections */
section.panel {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 22px 24px;
  margin-bottom: 22px;
}
section.panel h2 {
  font-family: "Playfair Display", Georgia, serif;
  font-size: 22px; font-weight: 700;
  color: var(--ink); margin: 0 0 16px 0;
  letter-spacing: -0.01em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}
section.panel h2 em { color: var(--gold-deep); font-style: italic; font-weight: 600; }

/* Funnel — editorial newspaper boxes */
.funnel { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.funnel .step {
  background: var(--cream); border: 1px solid var(--border);
  border-radius: 4px; padding: 14px 14px;
  position: relative; overflow: hidden;
}
.funnel .step::before {
  content: ""; position: absolute; left: 0; top: 0;
  width: 3px; height: 100%; background: var(--gold);
}
.funnel .step .name { color: var(--text-mute); font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 700; }
.funnel .step .count { font-size: 28px; font-weight: 700; font-family: "Playfair Display", Georgia, serif; color: var(--ink); margin-top: 4px; }
.funnel .step .pct { color: var(--gold-deep); font-size: 11px; margin-top: 2px; font-weight: 600; }

/* Two-column */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 1100px) { .grid-2 { grid-template-columns: 1fr; } }

/* Filters */
.filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; align-items: center; }
.filters .group { display: flex; align-items: center; gap: 6px; }
.filters label { color: var(--text-mute); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; }
.filters select, .filters input {
  background: var(--paper);
  border: 1px solid var(--border-2);
  color: var(--ink);
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 3px;
  font-family: "Inter", sans-serif;
}
.filters .toggle { color: var(--text-dim); font-size: 12px; cursor: pointer; user-select: none; }
.filters .toggle input { margin-right: 4px; vertical-align: middle; accent-color: var(--ink); }

/* Table — editorial paper feel */
table.calls {
  width: 100%; border-collapse: collapse; font-size: 13px;
  background: var(--paper);
}
table.calls thead th {
  text-align: left; color: var(--text-mute); font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.12em; font-size: 10px;
  padding: 12px 14px; border-bottom: 2px solid var(--ink);
  background: var(--cream);
}
table.calls tbody td {
  padding: 11px 14px; border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.calls tbody tr { cursor: pointer; transition: background 0.1s; }
table.calls tbody tr:hover { background: var(--gold-wash); }

/* Pills — editorial badges */
.pill { display: inline-block; padding: 3px 9px; border-radius: 3px; font-size: 10px;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.pill.hot      { background: #FEE2E2; color: #B91C1C; border: 1px solid #FCA5A5; }
.pill.warm     { background: #FED7AA; color: #C2410C; border: 1px solid #FDBA74; }
.pill.nurture  { background: #DBEAFE; color: #1D4ED8; border: 1px solid #93C5FD; }
.pill.cold     { background: #E5E0C8; color: #5A6786; border: 1px solid #C9C2A8; }
.pill.dnc      { background: #F4F4F5; color: #525B6E; border: 1px solid #D4D4D8; }
.pill.unknown  { background: var(--cream); color: var(--text-mute); border: 1px solid var(--border); }

/* Cost table */
table.cost { width: 100%; border-collapse: collapse; font-size: 13px; }
table.cost th, table.cost td { padding: 10px 12px; text-align: right; }
table.cost th:first-child, table.cost td:first-child { text-align: left; }
table.cost thead th { color: var(--text-mute); font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.12em; border-bottom: 2px solid var(--ink); background: var(--cream); }
table.cost tbody td { border-bottom: 1px solid var(--border); font-family: "IBM Plex Mono", monospace; color: var(--ink); }
table.cost tfoot td { padding-top: 14px; font-weight: 700; color: var(--ink); border-top: 2px solid var(--ink); }

/* Improve cards — editorial pull-quote feel */
.improve-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.improve-cards .card {
  background: var(--cream); border-left: 3px solid var(--gold);
  border-radius: 2px;
  padding: 16px 18px; font-size: 13px; color: var(--ink); line-height: 1.55;
  font-style: italic;
}
.improve-cards .card .rank { color: var(--gold-deep); font-weight: 700; margin-right: 6px; font-style: normal; }
.improve-cards .empty { color: var(--text-mute); font-style: italic; background: var(--paper); border-left-color: var(--border); }

/* Realtor activity rows */
table.activity {
  width: 100%; border-collapse: collapse; font-size: 13px;
}
table.activity thead th {
  text-align: left; color: var(--text-mute); font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.12em; font-size: 10px;
  padding: 12px 14px; border-bottom: 2px solid var(--ink); background: var(--cream);
}
table.activity tbody td {
  padding: 11px 14px; border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.activity tbody tr:hover { background: var(--gold-wash); }
table.activity .addr { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--ink-soft); }
table.activity .money { font-family: "IBM Plex Mono", monospace; font-weight: 600; color: var(--gold-deep); }

/* Modal */
/* Tab nav — editorial section dividers */
.tabnav {
  display: flex; gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--paper);
  padding: 0 32px;
  overflow-x: auto;
}
.tabnav button {
  background: transparent; border: 0;
  color: var(--text-dim);
  padding: 14px 18px; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.14em; cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  font-family: "Inter", sans-serif;
}
.tabnav button:hover { color: var(--ink); }
.tabnav button.active { color: var(--ink); border-bottom-color: var(--gold); }
.tabnav .badge {
  display: inline-block; margin-left: 6px; padding: 1px 7px;
  background: var(--gold-wash); color: var(--ink-soft);
  border-radius: 10px; font-size: 10px; font-weight: 600;
  letter-spacing: 0;
}
.tab-panel { display: none; }
.tab-panel.active { display: block; }

/* Period selector — shown on tabs that filter by time */
.period-bar {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 18px; padding: 10px 14px;
  background: var(--cream); border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
}
.period-bar label {
  color: var(--text-mute); text-transform: uppercase;
  letter-spacing: 0.1em; font-size: 10px; font-weight: 600;
  margin-right: 4px;
}
.period-bar .preset {
  background: transparent; border: 1px solid var(--border-2);
  color: var(--ink); padding: 5px 10px; font-size: 11px;
  cursor: pointer; border-radius: 3px;
  font-family: "Inter", sans-serif; font-weight: 500;
}
.period-bar .preset.active {
  background: var(--ink); color: var(--paper); border-color: var(--ink);
}
.period-bar input[type="date"] {
  background: var(--paper); border: 1px solid var(--border-2);
  color: var(--ink); padding: 5px 8px; font-size: 11px;
  font-family: "IBM Plex Mono", monospace; border-radius: 3px;
}

/* Voice A/B */
.voice-card {
  background: var(--cream); border: 1px solid var(--border);
  border-top: 3px solid var(--gold);
  border-radius: 4px;
  padding: 20px 22px; min-width: 240px;
}
.voice-card .name { font-family: "Playfair Display", Georgia, serif; font-size: 20px; font-weight: 700; color: var(--ink); margin-bottom: 12px; }
.voice-card .row { display: flex; justify-content: space-between; align-items: baseline; margin: 8px 0; }
.voice-card .row .label { color: var(--text-mute); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; }
.voice-card .row .value { font-family: "IBM Plex Mono", monospace; font-size: 18px; font-weight: 600; color: var(--ink); }
.voice-card .winner { color: var(--good); font-size: 11px; margin-top: 8px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }

/* Agent cards — editorial profile blocks */
.agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.agent-card {
  background: var(--paper); border: 1px solid var(--border);
  border-top: 3px solid var(--ink); border-radius: 2px;
  padding: 18px 20px;
}
.agent-card .name { font-family: "Playfair Display", Georgia, serif; font-size: 19px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.agent-card .role { color: var(--gold-deep); font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 700; margin-bottom: 14px; }
.agent-card .stat { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-bottom: 1px dotted var(--border); }
.agent-card .stat:last-of-type { border-bottom: 0; }
.agent-card .stat .label { color: var(--text-dim); }
.agent-card .stat .value { font-family: "IBM Plex Mono", monospace; color: var(--ink); font-weight: 600; }
.agent-card .review { color: var(--ink-soft); font-size: 12px; font-style: italic; margin-top: 12px; line-height: 1.6; padding-top: 10px; border-top: 1px solid var(--border); }

/* WP page card (Websites tab) */
.wp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.wp-card {
  background: var(--paper); border: 1px solid var(--border); border-radius: 4px;
  overflow: hidden;
}
.wp-card .thumb {
  aspect-ratio: 16 / 10; background: var(--cream); position: relative; overflow: hidden;
  border-bottom: 1px solid var(--border);
}
.wp-card .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.wp-card .thumb .empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-mute); font-style: italic; font-size: 13px; }
.wp-card .body { padding: 14px 16px; }
.wp-card .label-row { font-family: "Playfair Display", Georgia, serif; font-weight: 700; font-size: 16px; color: var(--ink); margin-bottom: 4px; }
.wp-card .url { font-size: 11px; color: var(--text-mute); margin-bottom: 12px; word-break: break-all; }
.wp-card .meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-dim); padding-top: 10px; border-top: 1px solid var(--border); }
.wp-card .meta strong { color: var(--ink); font-weight: 600; }
.wp-card .actions { display: flex; gap: 6px; margin-top: 10px; }
.wp-card .actions a { font-size: 10px; padding: 6px 10px; border-radius: 3px; text-decoration: none; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; border: 1px solid var(--ink); color: var(--ink); }
.wp-card .actions a:hover { background: var(--gold-wash); }
.wp-card .actions a.primary { background: var(--ink); color: var(--paper); }
.wp-card .actions a.primary:hover { background: var(--ink-soft); color: var(--paper); }

/* Notice banner */
.notice {
  padding: 14px 18px; background: var(--gold-wash); border-left: 4px solid var(--gold);
  border-radius: 2px; margin-bottom: 16px; font-size: 13px; color: var(--ink-soft);
}
.notice strong { color: var(--ink); }
.notice.danger { background: #FEE2E2; border-left-color: #B91C1C; }
.notice.info   { background: var(--cream); border-left-color: var(--ink); }

.modal-backdrop {
  display: none;
  position: fixed; inset: 0; background: rgba(10, 31, 68, 0.5);
  z-index: 100; align-items: flex-start; justify-content: center; padding: 60px 20px;
  overflow-y: auto;
}
.modal-backdrop.open { display: flex; }
.modal {
  background: var(--paper); border: 1px solid var(--border);
  border-top: 4px solid var(--gold);
  border-radius: 4px; padding: 26px 30px; max-width: 820px; width: 100%;
  box-shadow: 0 12px 48px rgba(10,31,68,0.18);
}
.modal h3 { font-family: "Playfair Display", Georgia, serif; margin-top: 0; font-size: 22px; color: var(--ink); }
.modal pre { background: var(--cream); border: 1px solid var(--border); padding: 14px; border-radius: 3px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; color: var(--ink); }
.modal .close { float: right; cursor: pointer; color: var(--text-mute); font-size: 24px; line-height: 1; }
.modal .close:hover { color: var(--ink); }
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

// Read funnel events for the last `days` days and tally counts + rates.
// Mirror of `aggregateFunnel` in index.ts so the dashboard can render
// without an internal fetch hop.
async function readFunnelStatsForDashboard(
  env: { DIAL_STATE: KVNamespace },
  days: number,
): Promise<{
  period_days: number;
  total: number;
  lead_created: number;
  qualified: number;
  appointment_set: number;
  offer_sent: number;
  under_contract: number;
  dead: number;
  rate_qual: string;
  rate_appt: string;
  rate_offer: string;
}> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const counts: Record<string, number> = {
    lead_created: 0, qualified: 0, appointment_set: 0,
    offer_sent: 0, negotiating: 0, under_contract: 0, dead: 0,
  };
  let total = 0;
  let cursor: string | undefined;
  do {
    const list = await env.DIAL_STATE.list({ prefix: "funnel:event:", cursor, limit: 1000 });
    cursor = list.list_complete ? undefined : list.cursor;
    for (const k of list.keys) {
      try {
        const v = await env.DIAL_STATE.get(k.name);
        if (!v) continue;
        const ev = JSON.parse(v);
        if ((ev.at || 0) < cutoff) continue;
        if (ev.type in counts) {
          counts[ev.type]++;
          total++;
        }
      } catch {}
    }
  } while (cursor);
  const rate = (num: number, den: number) =>
    den === 0 ? "—" : `${Math.round((num / den) * 1000) / 10}%`;
  return {
    period_days: days,
    total,
    lead_created: counts.lead_created,
    qualified: counts.qualified,
    appointment_set: counts.appointment_set,
    offer_sent: counts.offer_sent,
    under_contract: counts.under_contract,
    dead: counts.dead,
    rate_qual: rate(counts.qualified, counts.lead_created),
    rate_appt: rate(counts.appointment_set, counts.qualified),
    rate_offer: rate(counts.offer_sent, counts.appointment_set),
  };
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
  // New tabs Mido asked for 2026-05-27.
  const ghlActivity = await readGhlActivity(env).catch((e) => ({
    listings: [], error: String(e?.message || e), fetched_at: null,
  }));
  const websites = await readWebsitesData(env).catch(() => ({ pages: [] }));
  // Audit 1.6 — pipeline funnel from real stage-move events (90-day TTL KV)
  const pipelineFunnel = await readFunnelStatsForDashboard(env, 14).catch(() => ({
    period_days: 14, total: 0,
    lead_created: 0, qualified: 0, appointment_set: 0, offer_sent: 0,
    under_contract: 0, dead: 0,
    rate_qual: "—", rate_appt: "—", rate_offer: "—",
  }));
  // RJ KPI panel — pull RJ's specific row from agentStub for top-level visibility.
  // Mido directive 2026-05-28: "no KPI page for RJ from GHL on here — I want it
  // so we can see how many dials what leads he called how many mins on phone".
  const rjActivity = agentStub.find((a) => a.name === "RJ Fonseca");

  return `${dashboardHead()}
<body>
<header class="topbar">
  <div class="brand">Atom Property Group · <em>Live Dashboard</em></div>
  <div class="meta mono">Updated ${updatedDisp}</div>
</header>
<nav class="tabnav" id="tabnav">
  <button data-tab="overview" class="active">Overview</button>
  <button data-tab="calls">Blake Calls <span class="badge">${calls.length}</span></button>
  <button data-tab="ghl">GHL Activity</button>
  <button data-tab="websites">Websites</button>
  <button data-tab="figma">Figma</button>
  <button data-tab="agents">Team</button>
  <button data-tab="voice">Voice A/B</button>
  <button data-tab="costs">Costs</button>
  <button data-tab="tracker">Tracker</button>
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
  <h2>RJ Fonseca — <em>last 7 days</em> <span style="color:var(--text-mute);font-size:11px;font-weight:400;">GHL-backed; dial count + minutes via Calltools (auth pending)</span></h2>
  ${rjActivity ? `
    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr);margin:0 0 14px 0;">
      <div class="kpi"><div class="label">Opps Assigned</div><div class="value">${rjActivity.opps_assigned}</div></div>
      <div class="kpi"><div class="label">Opps Moved (7d)</div><div class="value">${rjActivity.opps_moved}</div></div>
      <div class="kpi"><div class="label">Outbound Msgs (7d)</div><div class="value">${rjActivity.outbound_msgs}</div></div>
      <div class="kpi"><div class="label">Tasks Completed</div><div class="value">${rjActivity.tasks_completed}</div></div>
    </div>
    <div class="kpi-row" style="grid-template-columns:repeat(2,1fr);margin:0;">
      <div class="kpi" style="opacity:0.6;"><div class="label">Dials (7d)</div><div class="value">—</div><div class="mono" style="color:var(--text-mute);font-size:10px;">Calltools auth WIP</div></div>
      <div class="kpi" style="opacity:0.6;"><div class="label">Mins on Phone</div><div class="value">—</div><div class="mono" style="color:var(--text-mute);font-size:10px;">Calltools auth WIP</div></div>
    </div>
    ${rjActivity.ai_review ? `<div style="margin-top:12px;padding:12px;background:rgba(245,197,24,0.08);border-left:3px solid var(--gold);border-radius:4px;color:var(--ink);font-size:13px;"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--gold-deep);">Latest AI review</strong><br>${escapeHtml(rjActivity.ai_review)}</div>` : `<div style="margin-top:12px;color:var(--text-mute);font-size:12px;font-style:italic;">No AI review yet. Run <code>POST /admin/agents/review?user_id=EvxJmnll1hIJtzpW14BE</code>.</div>`}
  ` : `<div style="color:var(--text-mute);font-style:italic;font-size:13px;">RJ's activity not yet aggregated. Next daily cron tick (04:00 UTC) populates this. To force: <code>POST /admin/agents/review?user_id=EvxJmnll1hIJtzpW14BE</code>.</div>`}
</section>

<section class="panel">
  <h2>Pipeline funnel — last ${pipelineFunnel.period_days} days <span style="color:var(--text-mute);font-size:11px;font-weight:400;">(real stage events, GHL-backed)</span></h2>
  <div class="funnel">
    <div class="step"><div class="name">Leads</div><div class="count">${pipelineFunnel.lead_created}</div><div class="pct">100%</div></div>
    <div class="step"><div class="name">Qualified</div><div class="count">${pipelineFunnel.qualified}</div><div class="pct">${pipelineFunnel.rate_qual}</div></div>
    <div class="step"><div class="name">Appointments</div><div class="count">${pipelineFunnel.appointment_set}</div><div class="pct">${pipelineFunnel.rate_appt}</div></div>
    <div class="step"><div class="name">Offers Sent</div><div class="count">${pipelineFunnel.offer_sent}</div><div class="pct">${pipelineFunnel.rate_offer}</div></div>
    <div class="step"><div class="name">Under Contract</div><div class="count">${pipelineFunnel.under_contract}</div><div class="pct">${pct(pipelineFunnel.under_contract, pipelineFunnel.offer_sent)}</div></div>
  </div>
  ${pipelineFunnel.total === 0
    ? `<div style="color:var(--text-mute);font-size:12px;margin-top:10px;">No events yet — funnel will populate as new listings land and Blake calls complete. Backfill via <code>POST /admin/funnel/backfill</code> (TODO).</div>`
    : ""}
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
    <div class="group"><label>Search</label>
      <input id="f-search" type="text" placeholder="Name, phone, address…" style="background:rgba(10,31,68,0.04);border:1px solid var(--rule);border-radius:4px;padding:5px 8px;font-family:inherit;font-size:12px;color:var(--ink);min-width:160px;" />
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

<!-- TAB: GHL Activity (realtor listings + connections) -->
<div class="tab-panel" data-tab="ghl">
<section class="panel">
  <h2>GHL Activity — <em>realtor connections</em></h2>
  <div style="color:var(--text-dim);font-size:13px;margin-bottom:14px;">Latest listings from the Realtor Listings pipeline, sorted by most recent. Each row: realtor, property, MAO sent, SMS status.</div>
  ${ghlActivity.error ? `<div class="notice danger"><strong>Error loading GHL listings:</strong> ${escapeHtml(ghlActivity.error)}</div>` : ""}
  <table class="activity">
    <thead><tr>
      <th>Updated</th>
      <th>Realtor</th>
      <th>Property</th>
      <th>Asking</th>
      <th>MAO</th>
      <th>Stage</th>
      <th>SMS</th>
    </tr></thead>
    <tbody>
      ${ghlActivity.listings.length === 0
        ? `<tr><td colspan="7" style="text-align:center;color:var(--text-mute);font-style:italic;padding:24px;">No realtor listings in the pipeline yet.</td></tr>`
        : ghlActivity.listings.map((l) => `
          <tr>
            <td class="mono" style="color:var(--text-dim);">${l.updated ? new Date(l.updated).toLocaleString() : "—"}</td>
            <td><strong>${escapeHtml(l.realtor_name)}</strong>${l.realtor_phone ? `<br><span class="mono" style="color:var(--text-mute);font-size:11px;">${escapeHtml(l.realtor_phone)}</span>` : ""}</td>
            <td class="addr">${escapeHtml(l.address)}</td>
            <td class="money">${l.asking ? fmtUsd(l.asking) : "—"}</td>
            <td class="money">${l.mao ? fmtUsd(l.mao) : "—"}</td>
            <td><span style="font-size:11px;color:var(--ink-soft);">${escapeHtml(l.stage)}</span></td>
            <td>${l.sms_status === "sent" ? '<span class="pill warm">SMS Sent</span>' : l.sms_status === "skipped_no_phone" ? '<span class="pill unknown">No Phone</span>' : '<span class="pill cold">—</span>'}</td>
          </tr>`).join("")}
    </tbody>
  </table>
  <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:12px;">
    Pipeline: <code>Realtor Listings</code> · ${ghlActivity.listings.length} active opps shown · Pulled at ${ghlActivity.fetched_at || "unknown"}
  </div>
</section>
</div><!-- /GHL -->

<!-- TAB: Websites (rebuilt 2026-05-29 — full page lives at /websites) -->
<div class="tab-panel" data-tab="websites">
<section class="panel">
  <h2>Websites — <em>page snapshots + Clarity</em></h2>
  <div style="color:var(--text-dim);font-size:13px;margin-bottom:14px;">
    Per-page snapshot (desktop + mobile) plus Microsoft Clarity stats (sessions, pageviews, dead clicks, rage clicks, scroll depth, lead-form submits) for every tracked atompropertygroup.com page. Snapshots refresh daily at 04:00 UTC; Clarity data is cached 15 min.
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <a class="btn primary" href="/websites" style="padding:10px 16px;text-decoration:none;border-radius:4px;background:linear-gradient(135deg,#1A2840,#2A3D5C);color:#F5C518;font-weight:600;">Open Websites dashboard ↗</a>
    <a class="btn" href="/websites?range=today" style="padding:10px 16px;text-decoration:none;border-radius:4px;border:1px solid var(--rule);color:var(--ink);">Today</a>
    <a class="btn" href="/websites?range=7d" style="padding:10px 16px;text-decoration:none;border-radius:4px;border:1px solid var(--rule);color:var(--ink);">7 days</a>
    <a class="btn" href="/websites?range=30d" style="padding:10px 16px;text-decoration:none;border-radius:4px;border:1px solid var(--rule);color:var(--ink);">30 days</a>
  </div>
  <div class="wp-grid">
    ${websites.pages.length === 0
      ? `<div class="notice info">No tracked pages yet. Configure <code>WEBSITES_TRACKED_PAGES</code> in src/websites-tab.ts.</div>`
      : websites.pages.slice(0, 4).map((p) => `
        <div class="wp-card">
          <div class="thumb">${p.thumb_key
            ? `<img src="/insights/snap/${encodeURIComponent(p.thumb_key)}" alt="" />`
            : `<div class="empty">Open <a href="/websites" style="color:var(--gold-deep);">full Websites dashboard</a> for snapshots</div>`}
          </div>
          <div class="body">
            <div class="label-row">${escapeHtml(p.label)}</div>
            <div class="url">${escapeHtml(p.url || "")}</div>
            <div class="meta">
              <span>WP modified <strong>${p.modified_disp || "—"}</strong></span>
              <span><strong>${p.snapshot_count}</strong> snap${p.snapshot_count === 1 ? "" : "s"}</span>
            </div>
            <div class="actions">
              <a href="${escapeHtml(p.url || "")}" target="_blank" rel="noopener">Visit ↗</a>
              ${p.clarity_url ? `<a class="primary" href="${escapeHtml(p.clarity_url)}" target="_blank" rel="noopener">Heatmap ↗</a>` : ""}
              ${p.clarity_sessions ? `<a href="${escapeHtml(p.clarity_sessions)}" target="_blank" rel="noopener">Sessions ↗</a>` : ""}
            </div>
          </div>
        </div>`).join("")}
  </div>
  <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:14px;">
    Preview of the first 4 tracked pages. Full grid (16+ pages) with Clarity stats lives at <code>/websites</code>.
  </div>
</section>
</div><!-- /Websites -->

<!-- TAB: Figma -->
<div class="tab-panel" data-tab="figma">
<section class="panel">
  <h2>Figma — <em>snapshot sync</em></h2>
  <div class="notice info">
    Figma plugin lives at <code>APG-Vault/_internal/figma-plugin/</code>. Opens in your Figma desktop app. On open, it auto-syncs page screenshots from atompropertygroup.com into your Figma file. Last sync info displays inside the plugin.
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
    <div class="wp-card">
      <div class="body">
        <div class="label-row">Open in Figma</div>
        <div class="url" style="margin-bottom:14px;">Auto-syncs the latest snapshots of the 4 tracked WP pages.</div>
        <div class="actions">
          <a class="primary" href="https://www.figma.com/" target="_blank" rel="noopener">Open Figma ↗</a>
        </div>
      </div>
    </div>
    <div class="wp-card">
      <div class="body">
        <div class="label-row">Plugin source</div>
        <div class="url" style="margin-bottom:14px;">manifest.json + code.js + ui.html. To reinstall: Figma → Plugins → Development → Import plugin from manifest.</div>
        <div class="actions">
          <a href="https://www.figma.com/plugin-docs/manage-plugins/" target="_blank" rel="noopener">Import docs ↗</a>
        </div>
      </div>
    </div>
  </div>
  <div class="notice" style="margin-top:14px;">
    <strong>Note:</strong> Annotating Figma frames with conversion counts was vetoed in the May 26 meeting with Adam — the snapshots are for design reference, not the conversion metric. Variant analytics live in the Variants tab.
  </div>
</section>
</div><!-- /Figma -->

<!-- TAB: Voice A/B -->
<div class="tab-panel" data-tab="voice">
<section class="panel">
  <h2>Voice A/B — ${voiceStats.arms.map((a) => a.label).join(" vs ")}</h2>
  <div style="color:var(--text-mute);font-size:12px;margin-bottom:14px;">
    3-way rotation active since 2026-05-29 via <code>/conversation-init</code>. Sticky hash-based assignment (call_sid or phone, FNV-1a % 3) so re-dials to the same seller hear the same voice. Post-call attribution tags the GHL contact with <code>voice-&lt;name&gt;</code> for downstream conversion analysis.
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;">
    ${voiceStats.arms.map((arm) => `
      <div class="voice-card">
        <div class="name">${arm.label} <span class="mono" style="color:var(--text-mute);font-size:10px;">${arm.voice_id_preview}</span></div>
        <div class="row"><span class="label">Calls Sent</span><span class="value">${arm.sent}</span></div>
        <div class="row"><span class="label">Completed</span><span class="value">${arm.completed}</span></div>
        <div class="row"><span class="label">Completion %</span><span class="value">${arm.completion_pct}%</span></div>
        ${voiceStats.winner === arm.key ? `<div class="winner">▲ ahead</div>` : ""}
      </div>
    `).join("")}
  </div>
  ${voiceStats.winner === "insufficient" ? `
    <div style="color:var(--text-mute);font-size:12px;margin-top:14px;">
      <strong>Significance:</strong> need ~50 calls per arm for a meaningful 3-way comparison. ${voiceStats.arms.map((a) => `${a.label}: ${Math.max(0, 50 - a.sent)} more`).join(" · ")}.
    </div>
  ` : ""}
  <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:14px;">
    Raw counters: <code>blake:ab_stats:v2:&lt;voice&gt;:sent</code> / <code>:completed</code>. Reader is dynamic — adding a 4th arm in <code>VOICE_AB_VARIANTS</code> auto-renders a 4th column.
  </div>
  ${voiceStats.legacy.length ? `
    <div style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px;">
      <h3 style="font-size:14px;color:var(--text-mute);margin-bottom:10px;">Legacy (Brian / Roger, pre-2026-05-29)</h3>
      <div style="display:flex;gap:14px;flex-wrap:wrap;">
        ${voiceStats.legacy.map((arm) => `
          <div class="voice-card" style="opacity:0.75;border-top-color:var(--text-mute);">
            <div class="name">${arm.label}</div>
            <div class="row"><span class="label">Calls Sent</span><span class="value">${arm.sent}</span></div>
            <div class="row"><span class="label">Completed</span><span class="value">${arm.completed}</span></div>
            <div class="row"><span class="label">Completion %</span><span class="value">${arm.completion_pct}%</span></div>
          </div>
        `).join("")}
      </div>
      <div class="mono" style="color:var(--text-mute);font-size:10px;margin-top:10px;">
        Historical only — no new dials under these voices. KV: <code>blake:ab_stats:&lt;voice&gt;:*</code>.
      </div>
    </div>
  ` : ""}
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
  <h2>Tech stack — <em>cost per active user</em></h2>
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
  <div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:10px;">Config last updated ${cost.last_updated}. Edit DEFAULT_COST_CONFIG in dashboard-v2.ts.</div>
</section>
<section class="panel">
  <h2>Calltools — <em>per-number breakdown</em></h2>
  <div style="color:var(--text-dim);font-size:13px;margin-bottom:14px;">Live data from Calltools API. Cached 5 min. Numbers, monthly cost, minutes used, who's assigned.</div>
  <div id="calltools-mount" style="min-height:140px;">
    <div style="color:var(--text-mute);font-style:italic;text-align:center;padding:30px;">Loading Calltools data…</div>
  </div>
</section>
</div><!-- /Costs -->

<!-- TAB: Tracker -->
<div class="tab-panel" data-tab="tracker">
<section class="panel">
  <h2>Tracker — <em>where we are</em></h2>
  <div style="color:var(--text-dim);font-size:13px;margin-bottom:14px;">
    Live progress across all 4 pillars + infrastructure. Click any checkbox to toggle. Changes persist in KV and feed the daily Slack summary. Canonical source: <code>progress_state.json</code> on the AtomInvestments repo + KV overrides.
  </div>
  <div id="tracker-mount" style="min-height:200px;">
    <div style="color:var(--text-mute);font-style:italic;text-align:center;padding:30px;">Loading tracker…</div>
  </div>
</section>
</div><!-- /Tracker -->

<!-- TAB: Variants -->
<div class="tab-panel" data-tab="variants">
<section class="panel">
  <h2>Website variants — <em>A/B/C</em></h2>
  <div class="notice info"><strong>Workstream 1 status:</strong> Personas doc shipped (5 personas → 3 voice variants). Variant briefs + edge routing + Clarity tagging not yet shipped.</div>
  <table class="activity">
    <thead><tr><th>Step</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td><strong>1a. Personas doc</strong></td><td><span class="pill warm">Shipped</span></td><td>5 personas → friendly/professional/traditional · <a href="https://github.com/AtomInvestments/acq-automation/blob/main/docs/user-personas.md" target="_blank" rel="noopener">docs/user-personas.md</a></td></tr>
      <tr><td><strong>1b. Variant briefs</strong></td><td><span class="pill unknown">Drafting</span></td><td>1-paragraph positioning + hero headline + form CTA per variant. Awaiting Mido approval before any HTML.</td></tr>
      <tr><td><strong>1c. Edge routing</strong></td><td><span class="pill cold">Not started</span></td><td>Cookie-based 33/33/33 split at the Worker edge. Sets <code>apg_variant</code> cookie. Auto-injects Clarity custom tag.</td></tr>
      <tr><td><strong>1d. Variant copy</strong></td><td><span class="pill cold">Not started</span></td><td>3 variants of the home + landing pages. Pushed via push_zip_pages.py and equivalents.</td></tr>
      <tr><td><strong>1e. Conversion tracking</strong></td><td><span class="pill cold">Not started</span></td><td>Per-variant form submissions, Clarity rage clicks, scroll depth (unique visitors only).</td></tr>
      <tr><td><strong>1f. Internal-IP filter</strong></td><td><span class="pill cold">Not started</span></td><td>Egypt / India / Taiwan IPs excluded from variant metrics (Adam was explicit).</td></tr>
    </tbody>
  </table>
  <div class="notice" style="margin-top:18px;">
    Once <strong>1c</strong> ships, this tab will populate with: <em>per-variant unique visitors, form submissions, conversion rate, Clarity engagement score. Currently nothing to show.</em>
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
  var fSearch = document.getElementById('f-search');
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
    var searchTerm = (fSearch && fSearch.value || '').trim().toLowerCase();
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
      if (searchTerm) {
        var hay = (r.textContent || '').toLowerCase();
        if (hay.indexOf(searchTerm) < 0) ok = false;
      }
      r.style.display = ok ? '' : 'none';
      if (ok) n++;
    });
    fCount.textContent = n + ' of ' + rows.length + ' shown';
  }
  [fRange, fOut, fConnected, fMinDur, fUnique].forEach(function(el){
    if (el) el.addEventListener('change', filter);
  });
  if (fSearch) fSearch.addEventListener('input', filter);

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
  var trackerLoaded = false;
  var calltoolsLoaded = false;
  function activate(name) {
    tabs.forEach(function(t){ t.classList.toggle('active', t.dataset.tab === name); });
    panels.forEach(function(p){ p.classList.toggle('active', p.dataset.tab === name); });
    if (name === 'tracker' && !trackerLoaded) {
      trackerLoaded = true;
      loadTracker();
    }
    if (name === 'costs' && !calltoolsLoaded) {
      calltoolsLoaded = true;
      loadCalltools();
    }
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      activate(t.dataset.tab);
      history.replaceState(null, '', '#' + t.dataset.tab);
    });
  });
  var fromHash = (location.hash || '').replace('#','');
  if (fromHash) activate(fromHash);

  // ---- Tracker (progress) — interactive checkboxes that persist via KV --
  async function loadTracker() {
    var mount = document.getElementById('tracker-mount');
    if (!mount) return;
    try {
      var r = await fetch('/api/progress', { credentials: 'same-origin' });
      if (!r.ok) { mount.innerHTML = '<div class="notice danger">Tracker unavailable (HTTP ' + r.status + ').</div>'; return; }
      var data = await r.json();
      renderTracker(mount, data);
    } catch (e) {
      mount.innerHTML = '<div class="notice danger">Tracker error: ' + (e && e.message ? e.message : String(e)) + '</div>';
    }
  }
  function statusPillClass(status) {
    switch ((status || '').toLowerCase()) {
      case 'shipped-verified':   return { klass: 'tracker-green', label: 'verified' };
      case 'shipped-unverified': return { klass: 'tracker-amber', label: 'unverified' };
      case 'broken':             return { klass: 'tracker-red',   label: 'broken' };
      case 'deferred':           return { klass: 'tracker-muted', label: 'deferred' };
      default:                   return { klass: 'tracker-gray',  label: 'not started' };
    }
  }
  function renderTracker(mount, data) {
    var pillars = data.pillars || [];
    if (!pillars.length) {
      mount.innerHTML = '<div class="notice">No pillars defined in progress_state.json.</div>';
      return;
    }
    if (!document.getElementById('tracker-styles')) {
      var st = document.createElement('style');
      st.id = 'tracker-styles';
      st.textContent =
        '.tp{display:inline-block;padding:2px 8px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;border:1px solid;white-space:nowrap;}' +
        '.tp.tracker-green{background:#DCFCE7;color:#0e6e2f;border-color:#86EFAC;}' +
        '.tp.tracker-amber{background:#FEF3C7;color:#92400E;border-color:#FCD34D;}' +
        '.tp.tracker-red{background:#FEE2E2;color:#991B1B;border-color:#FCA5A5;}' +
        '.tp.tracker-gray{background:#F4F4F5;color:#525B6E;border-color:#D4D4D8;}' +
        '.tp.tracker-muted{background:transparent;color:#9CA3AF;border-color:#E5E7EB;}' +
        '.tracker-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px dotted var(--border);font-size:13px;}' +
        '.tracker-row:last-of-type{border-bottom:0;}' +
        '.tracker-row .label{flex:1;color:var(--ink);}' +
        '.tracker-row.muted .label{color:var(--text-dim);text-decoration:line-through;}' +
        '.tracker-row .meta{color:var(--text-mute);font-size:10px;font-style:italic;display:block;margin-top:3px;}' +
        '.broken-block{background:#FEF2F2;border-left:4px solid #B91C1C;padding:12px 14px;margin-bottom:14px;border-radius:2px;}' +
        '.broken-block .root{color:#7F1D1D;font-size:12px;font-style:italic;margin-top:4px;line-height:1.5;}';
      document.head.appendChild(st);
    }
    var html = '';

    // Top summary banner
    var c = { 'shipped-verified': 0, 'shipped-unverified': 0, 'broken': 0, 'not-started': 0, 'deferred': 0 };
    pillars.forEach(function(p) {
      (p.tasks || []).forEach(function(t) {
        var s = (t.status || 'not-started').toLowerCase();
        if (c[s] != null) c[s]++;
        else c['not-started']++;
      });
    });
    var brokenItems = pillars.reduce(function(a, p) { return a + (p.broken || []).length; }, 0);
    html += '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:22px;padding:14px 16px;background:var(--cream);border:1px solid var(--border);border-radius:4px;">';
    html += '<div><span class="tp tracker-green">verified</span> <strong style="font-family:Playfair Display,serif;font-size:20px;color:var(--ink);">' + c['shipped-verified'] + '</strong></div>';
    html += '<div><span class="tp tracker-amber">unverified</span> <strong style="font-family:Playfair Display,serif;font-size:20px;color:var(--ink);">' + c['shipped-unverified'] + '</strong></div>';
    html += '<div><span class="tp tracker-red">broken</span> <strong style="font-family:Playfair Display,serif;font-size:20px;color:var(--ink);">' + (c['broken'] + brokenItems) + '</strong></div>';
    html += '<div><span class="tp tracker-gray">not-started</span> <strong style="font-family:Playfair Display,serif;font-size:20px;color:var(--ink);">' + c['not-started'] + '</strong></div>';
    html += '<div><span class="tp tracker-muted">deferred</span> <strong style="font-family:Playfair Display,serif;font-size:20px;color:var(--ink);">' + c['deferred'] + '</strong></div>';
    html += '<div style="margin-left:auto;color:var(--text-mute);font-size:11px;align-self:center;">schema v' + (data.schema_version || 1) + ' · last updated ' + (data.last_updated || '?') + '</div>';
    html += '</div>';

    pillars.forEach(function(p) {
      var total = (p.tasks || []).length;
      var verified = (p.tasks || []).filter(function(t) { return (t.status || '').toLowerCase() === 'shipped-verified'; }).length;
      var statusKlass = p.status === 'active' ? 'tracker-green' : p.status === 'deferred' ? 'tracker-muted' : 'tracker-gray';
      html += '<div style="margin-bottom:28px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--ink);padding-bottom:10px;margin-bottom:14px;">';
      html += '<div><span class="serif" style="font-size:20px;font-weight:700;color:var(--ink);">' + escapeText(p.name || p.id) + '</span> ';
      html += '<span class="tp ' + statusKlass + '">' + escapeText(p.status || '?') + '</span></div>';
      html += '<div class="mono" style="color:var(--text-mute);font-size:12px;">' + verified + ' / ' + total + ' verified</div>';
      html += '</div>';
      if (p.summary) html += '<div style="color:var(--text-dim);font-size:12px;margin-bottom:14px;font-style:italic;">' + escapeText(p.summary) + '</div>';

      // Broken section AT THE TOP of the pillar (per v4 brief).
      (p.broken || []).forEach(function(b) {
        html += '<div class="broken-block">';
        html += '<strong style="color:#7F1D1D;">⚠ BROKEN — ' + escapeText(b.label) + '</strong>';
        html += '<div class="root">Root cause: ' + escapeText(b.root_cause || '(unknown)') + '</div>';
        html += '</div>';
      });

      (p.tasks || []).forEach(function(t) {
        var taskKey = p.id + '::' + t.label;
        var s = (t.status || 'not-started').toLowerCase();
        var pill = statusPillClass(s);
        var muted = (s === 'deferred' || s === 'shipped-verified');
        html += '<div class="tracker-row' + (muted ? ' muted' : '') + '">';
        html += '<input type="checkbox"' + (t.done ? ' checked' : '') + ' data-key="' + escapeText(taskKey) + '" style="margin-top:3px;accent-color:var(--gold);width:14px;height:14px;flex-shrink:0;">';
        html += '<div class="label">' + escapeText(t.label);
        if (t.verify_by) html += '<span class="meta">verify by ' + escapeText(t.verify_by) + (t.verify_method ? ' — ' + escapeText(t.verify_method) : '') + '</span>';
        if (t.deferred_by) html += '<span class="meta">deferred: ' + escapeText(t.deferred_by) + '</span>';
        if (t.root_cause) html += '<span class="meta">root cause: ' + escapeText(t.root_cause) + '</span>';
        html += '</div>';
        html += '<span class="tp ' + pill.klass + '" style="flex-shrink:0;margin-left:8px;">' + pill.label + '</span>';
        html += '</div>';
      });
      html += '</div>';
    });
    mount.innerHTML = html;
    mount.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', async function() {
        var key = cb.dataset.key;
        var newDone = cb.checked;
        try {
          var r = await fetch('/api/progress/toggle', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: key, done: newDone }),
          });
          if (!r.ok) {
            cb.checked = !newDone;
            alert('Save failed (HTTP ' + r.status + ')');
          }
        } catch (e) {
          cb.checked = !newDone;
          alert('Save failed: ' + e);
        }
      });
    });
  }
  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- Calltools loader -------------------------------------------------
  async function loadCalltools() {
    var mount = document.getElementById('calltools-mount');
    if (!mount) return;
    try {
      var r = await fetch('/admin/costs/calltools', { credentials: 'same-origin' });
      if (!r.ok) { mount.innerHTML = '<div class="notice danger">Calltools API error (HTTP ' + r.status + ').</div>'; return; }
      var data = await r.json();
      if (!data.ok || !data.numbers || data.numbers.length === 0) {
        mount.innerHTML =
          '<div class="notice"><strong>Calltools returned no numbers.</strong> Either the account has none active or the API base URL changed. Last error: <code>' +
          escapeText(data.last_error || 'none') + '</code></div>';
        return;
      }
      var totalCost = data.numbers.reduce(function(a, n){ return a + Number(n.cost_mo || 0); }, 0);
      var totalMin  = data.numbers.reduce(function(a, n){ return a + Number(n.minutes || 0); }, 0);
      var html = '';
      html += '<table class="cost"><thead><tr><th>Number</th><th>Label</th><th>Assigned</th><th>Minutes</th><th>$ / mo</th></tr></thead><tbody>';
      data.numbers.forEach(function(n) {
        html += '<tr>';
        html += '<td><code>' + escapeText(n.number || '—') + '</code></td>';
        html += '<td>' + escapeText(n.label || '—') + '</td>';
        html += '<td>' + escapeText(n.assigned || 'unassigned') + '</td>';
        html += '<td>' + (n.minutes != null ? n.minutes : '—') + '</td>';
        html += '<td>' + (n.cost_mo != null ? '$' + Number(n.cost_mo).toFixed(2) : '—') + '</td>';
        html += '</tr>';
      });
      html += '</tbody><tfoot><tr><td colspan="3">Total — ' + data.number_count + ' numbers</td>';
      html += '<td>' + totalMin + '</td><td>$' + totalCost.toFixed(2) + '</td></tr></tfoot></table>';
      html += '<div class="mono" style="color:var(--text-mute);font-size:11px;margin-top:10px;">Fetched ' + (data.fetched_at || '—') + ' · cached 5 min</div>';
      mount.innerHTML = html;
    } catch (e) {
      mount.innerHTML = '<div class="notice danger">Calltools fetch error: ' + (e && e.message ? e.message : String(e)) + '</div>';
    }
  }
})();
</script>
</body>
</html>`;
}

// ---- GHL Activity reader (Realtor Listings pipeline) ----------------------

interface GhlListingRow {
  updated: string;
  realtor_name: string;
  realtor_phone: string;
  address: string;
  asking: number;
  mao: number;
  stage: string;
  sms_status: "sent" | "skipped_no_phone" | "unknown";
}

async function readGhlActivity(env: any): Promise<{
  listings: GhlListingRow[];
  fetched_at: string | null;
  error?: string;
}> {
  // KV-cached for 5 min so dashboard reload is fast.
  const CACHE_KEY = "dashboard:ghl_activity:v1";
  const cached = await env.DIAL_STATE.get(CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }
  const REALTOR_PIPELINE = "Br9cCXPJRNvtm3egHmwh";
  const LOCATION = "RCkiUmWqXX4BYQ39JXmm";
  const PIT = env.BLAKE_GHL_PIT;
  if (!PIT) return { listings: [], fetched_at: null, error: "no PIT" };

  const r = await fetch(
    `https://services.leadconnectorhq.com/opportunities/search?` +
      new URLSearchParams({
        location_id: LOCATION,
        pipeline_id: REALTOR_PIPELINE,
        limit: "50",
      }).toString(),
    { headers: { Authorization: `Bearer ${PIT}`, Version: "2021-07-28", Accept: "application/json" } }
  );
  if (!r.ok) {
    return { listings: [], fetched_at: new Date().toISOString(), error: `ghl ${r.status}` };
  }
  const j: any = await r.json();
  const opps: any[] = j?.opportunities ?? [];
  const rows: GhlListingRow[] = opps.map((o) => {
    const contact = o?.contact || {};
    const tags: string[] = contact?.tags || [];
    const sms_status =
      tags.includes("30006 - landline/incapable to receive sms") ? "skipped_no_phone" :
      tags.includes("listing-pipeline") ? "sent" : "unknown";
    // Opp name is now "Realtor Name - Address - Phone" (PR #24)
    const nameParts = (o?.name || "").split(" - ").map((s: string) => s.trim());
    return {
      updated: o?.updatedAt || o?.dateUpdated || "",
      realtor_name: nameParts[0] || contact?.name || "(unknown)",
      realtor_phone: contact?.phone || nameParts[2] || "",
      address: nameParts[1] || "",
      asking: 0,
      mao: Number(o?.monetaryValue || 0),
      stage: o?.pipelineStageUId ? "1. New Listing" : (o?.status || "open"),
      sms_status: sms_status as GhlListingRow["sms_status"],
    };
  }).sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()).slice(0, 30);

  const out = { listings: rows, fetched_at: new Date().toISOString() };
  await env.DIAL_STATE.put(CACHE_KEY, JSON.stringify(out), { expirationTtl: 300 });
  return out;
}

// ---- Websites tab reader (uses /insights cache) ----------------------------

interface WebsitePageRow {
  id: number;
  label: string;
  url: string;
  modified_disp: string;
  snapshot_count: number;
  thumb_key: string;
  clarity_url: string;
  clarity_sessions: string;
}

async function readWebsitesData(env: any): Promise<{ pages: WebsitePageRow[] }> {
  // Source list of tracked pages — mirrors INSIGHTS_TRACKED_PAGES in index.ts.
  // Hard-coded here so dashboard-v2 doesn't depend on index.ts internals.
  const TRACKED = [
    { id: 1340, label: "Home" },
    { id: 1343, label: "About" },
    { id: 1383, label: "Sell — 08611 Trenton" },
    { id: 1397, label: "Sell — 19132 Philadelphia" },
  ];
  const CLARITY_PROJECT_ID = "san6yebog2";
  const pages: WebsitePageRow[] = [];
  for (const { id, label } of TRACKED) {
    const [metaRaw, timelineRaw] = await Promise.all([
      env.DIAL_STATE.get(`insights:meta:${id}`),
      env.DIAL_STATE.get(`insights:timeline:${id}`),
    ]);
    let meta: any = null;
    try { if (metaRaw) meta = JSON.parse(metaRaw); } catch {}
    let timeline: any[] = [];
    try { if (timelineRaw) timeline = JSON.parse(timelineRaw); } catch {}
    const latest = timeline[0];
    const url = meta?.link || "";
    const claritySlug = url ? encodeURIComponent(url) : "";
    pages.push({
      id,
      label,
      url,
      modified_disp: meta?.modified ? new Date(meta.modified).toLocaleString() : "—",
      snapshot_count: timeline.length,
      thumb_key: latest?.key || "",
      clarity_url: claritySlug ? `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/heatmaps?date=Last+7+days&Page=${claritySlug}` : "",
      clarity_sessions: claritySlug ? `https://clarity.microsoft.com/projects/view/${CLARITY_PROJECT_ID}/recordings?date=Last+7+days&Page=${claritySlug}` : "",
    });
  }
  return { pages };
}

// ---- Voice A/B reader -------------------------------------------------------
//
// Dynamic: scans KV for any `blake:ab_stats:v2:<voice>:sent` key and renders
// one card per voice found. Adding a 4th arm in the Worker's
// `VOICE_AB_VARIANTS` requires no change here. Legacy Brian/Roger counters
// are read from the un-versioned `blake:ab_stats:<voice>:*` keys and rendered
// in a separate "Legacy" section.

interface VoiceArm {
  key: string;             // e.g., "eric"
  label: string;           // e.g., "Eric"
  sent: number;
  completed: number;
  completion_pct: number;
  voice_id_preview: string; // short display of the ElevenLabs voice_id
}

interface VoiceAbStats {
  arms: VoiceArm[];
  legacy: VoiceArm[];
  winner: string;          // arm key, or "tie" / "insufficient"
}

// Pretty-printable voice IDs so the dashboard shows the same fingerprint
// format as the original Brian/Roger cards did. New arms automatically fall
// through to "—" if not listed here.
const VOICE_ID_PREVIEWS: Record<string, string> = {
  eric:  "cjVigY...OWal",
  chris: "iP95p4...742B",
  bill:  "pqHfZK...NhV4",
};

function titleCase(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

async function readVoiceAbStats(env: { DIAL_STATE: KVNamespace }): Promise<VoiceAbStats> {
  const read = async (k: string): Promise<number> => Number((await env.DIAL_STATE.get(k)) || "0");

  // ---- v2 arms: discover from KV by scanning the `:sent` key prefix --------
  const sentKeys = new Set<string>();
  let cursor: string | undefined;
  do {
    const list = await env.DIAL_STATE.list({ prefix: "blake:ab_stats:v2:", cursor, limit: 1000 });
    cursor = list.list_complete ? undefined : list.cursor;
    for (const k of list.keys) {
      if (k.name.endsWith(":sent")) sentKeys.add(k.name);
    }
  } while (cursor);

  // Map each discovered key back to a voice name. If the discovery comes up
  // empty (fresh KV before the first call) we still want all 3 cards visible,
  // so seed from a fallback list that matches the Worker's VOICE_AB_VARIANTS.
  const FALLBACK_ARMS = ["eric", "chris", "bill"];
  const discovered = new Set<string>();
  for (const key of sentKeys) {
    const m = key.match(/^blake:ab_stats:v2:([^:]+):sent$/);
    if (m) discovered.add(m[1]);
  }
  const armKeys = Array.from(discovered.size ? discovered : new Set(FALLBACK_ARMS)).sort();

  const arms: VoiceArm[] = await Promise.all(
    armKeys.map(async (key) => {
      const [sent, completed] = await Promise.all([
        read(`blake:ab_stats:v2:${key}:sent`),
        read(`blake:ab_stats:v2:${key}:completed`),
      ]);
      const completion_pct = sent ? Math.round((completed / sent) * 100) : 0;
      return {
        key,
        label: titleCase(key),
        sent,
        completed,
        completion_pct,
        voice_id_preview: VOICE_ID_PREVIEWS[key] || "",
      };
    })
  );

  // Need >=10 sent on EVERY arm before we call a winner — same noise floor as
  // the 2-way logic, applied per arm.
  let winner = "insufficient";
  if (arms.length > 0 && arms.every((a) => a.sent >= 10)) {
    const max = Math.max(...arms.map((a) => a.completion_pct));
    const tied = arms.filter((a) => a.completion_pct === max);
    winner = tied.length === 1 ? tied[0].key : "tie";
  }

  // ---- Legacy Brian/Roger — only render if they have any history ----------
  const legacy: VoiceArm[] = [];
  for (const key of ["brian", "roger"]) {
    const [sent, completed] = await Promise.all([
      read(`blake:ab_stats:${key}:sent`),
      read(`blake:ab_stats:${key}:completed`),
    ]);
    if (sent === 0 && completed === 0) continue;
    legacy.push({
      key,
      label: titleCase(key),
      sent,
      completed,
      completion_pct: sent ? Math.round((completed / sent) * 100) : 0,
      voice_id_preview: "",
    });
  }

  return { arms, legacy, winner };
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
  // Mirrors APG_AGENT_ROSTER in index.ts. Corrected 2026-05-27 after Mido
  // pasted GHL Settings → My Staff. Bug fixes:
  //   - vDKOqPSkA8nLkia5skd0 is Jef De los Santos, NOT Adam (was mis-labeled)
  //   - Real Adam is vCjuvuuQ7p7K5GUODujQ
  //   - RJ id had l/I visual collision; correct char is capital I
  //   - Added John Williams (360 Synergy Tech) — owns 923 opps incl. the
  //     9 stale Qualified ones
  const ROSTER = [
    { user_id: "EvxJmnll1hIJtzpW14BE", name: "RJ Fonseca",        role: "Acquisitions Partner" },
    { user_id: "Vj4WwH1ovxGN5Hv5Kq17", name: "Mike Yasser",       role: "PM / Marketing Systems" },
    { user_id: "vCjuvuuQ7p7K5GUODujQ", name: "Adam Chodes",       role: "Owner — APG" },
    { user_id: "vDKOqPSkA8nLkia5skd0", name: "Jef De los Santos", role: "ACQ Workhorse — 858 opps" },
    { user_id: "1X0bfFpMocO5hRewdjV0", name: "John Williams",     role: "External (360 Synergy) — 923 opps" },
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
