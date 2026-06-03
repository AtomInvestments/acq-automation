// roadmap-tab.ts — APG Plan-of-Record visual roadmap.
//
// Renders the POR markdown (bundled by sync_por_sources.py) as a 4-state
// drill-down: year strip → quarter detail → month calendar → day modal.
// Reusable for any future POR doc — drop a new .md in APG-Vault/Strategy/,
// add it to sync_por_sources.py's INCLUDED_DOCS, re-run, redeploy. The same
// /roadmap?source=<slug> URL renders it without code changes.
//
// PARSING CONVENTION (Tyler-future-proof — DO NOT change without redeploying):
//   - H1 (`# APG Plan of Record`)            → doc title
//   - H2 sections like `## §4 — Quarterly Milestones` and
//                       `## §5 — Monthly Task Lists` are the two sections
//     the parser CARES about. Other H2s are skipped.
//   - Inside §4: H3 like `### Q3 — Jul / Aug / Sep 2026` or `### Q3 2026`
//     marks a quarter block. The parser pulls (year, quarter-number) from
//     the heading text — either `Q<N> <YYYY>` or `Q<N> ... <YYYY>`. Bullet
//     lists under the quarter become "themes" shown on the quarter card.
//   - Inside §5: H3 like `### June 2026` or H3 like `### July 2026` marks a
//     month block. The first markdown TABLE under that month is parsed for
//     tasks. Required columns: `Task | Owner | Deadline | Pillar | ... |
//     Definition of Done`. Deadline cells in `YYYY-MM-DD` are day-tagged
//     events; others become "this month" tasks.
//
// STATUS DETECTION:
//   Status counts for each month are derived from §2 Reality Snapshot tables
//   by scanning for the LIVE / SHIPPED-IDLE / STUBBED / MISSING / BROKEN /
//   DEFERRED keywords. Month-level stoplight = aggregate of in-flight tasks.
//   For months whose tasks are all in the future (no §2 evidence), stoplight
//   stays neutral (gray).
//
// All routes wired here are auth-gated by the caller (requireAuth in index.ts).

import { POR_SOURCES, findPorSource, type PorSource } from "./por-sources";

// ----- Public env shape ------------------------------------------------------
//
// The roadmap tab is purely server-side parsing + render — no external API
// calls — so it doesn't need any secrets. Kept as an empty interface so the
// signature mirrors the other tab modules' style.
export interface RoadmapEnv {}

// ----- Parsed data shapes ----------------------------------------------------

export type Stoplight = "green" | "yellow" | "red" | "gray";

export interface RoadmapTask {
  /** Raw task name from the markdown cell. */
  task: string;
  /** Owner string (e.g. "Mido", "Adam + Mido"). */
  owner: string;
  /** YYYY-MM-DD if the markdown cell parsed as a date, else null. */
  deadline_iso: string | null;
  /** Deadline as a user-friendly string (Jun 18, 2026). */
  deadline_disp: string;
  /** Pillar tag (A/B/C/D/Strategy/Dashboard/Infra/etc.) */
  pillar: string;
  /** Definition-of-done excerpt — may be empty. */
  done: string;
  /** Status inferred from §2 evidence; defaults to "planned". */
  status: "live" | "shipped-idle" | "stubbed" | "missing" | "broken" | "deferred" | "planned";
}

export interface RoadmapMonth {
  /** ISO month string, e.g. "2026-06". */
  month_iso: string;
  /** Display label, e.g. "June 2026". */
  label: string;
  /** Zero-based month index 0..11. */
  month_idx: number;
  year: number;
  tasks: RoadmapTask[];
  /** Aggregate stoplight across tasks (green=mostly live; red=mostly broken). */
  stoplight: Stoplight;
  /** Counts for the year-strip tile. */
  counts: { total: number; live: number; idle: number; missing: number; broken: number };
}

export interface RoadmapQuarter {
  /** "Q1" | "Q2" | "Q3" | "Q4". */
  q: "Q1" | "Q2" | "Q3" | "Q4";
  year: number;
  /** Heading prose, e.g. "industrialize Pillar A". */
  theme: string;
  /** Bullet list under the quarter heading (theme bullets). */
  bullets: string[];
  months: RoadmapMonth[];
}

export interface RoadmapDoc {
  slug: string;
  label: string;
  owner: string;
  filename: string;
  /** Year focus — derived from the §4 headings (usually the current year). */
  primary_year: number;
  /** All 4 quarters, always present (empty placeholder if not in source). */
  quarters: RoadmapQuarter[];
  /** Plain-text excerpt of §1 Mission for the page header. */
  mission_excerpt: string;
  /** All available sources for the picker. */
  sources: Array<{ slug: string; label: string }>;
  /** Parse warnings to surface honestly in the UI. */
  warnings: string[];
}

// ----- Public render entrypoints --------------------------------------------

export async function renderRoadmapPage(_env: RoadmapEnv, reqUrl: URL): Promise<string> {
  const data = buildRoadmapData(reqUrl);
  return renderHtml(data, reqUrl);
}

export async function buildRoadmapDataJson(_env: RoadmapEnv, reqUrl: URL): Promise<RoadmapDoc> {
  return buildRoadmapData(reqUrl);
}

// ----- Parser ----------------------------------------------------------------

function buildRoadmapData(reqUrl: URL): RoadmapDoc {
  const slug = reqUrl.searchParams.get("source") || "";
  const src = findPorSource(slug);

  if (!src) {
    return emptyDoc(slug || "(none)", [
      `No POR source found for slug "${slug}". Available: ${POR_SOURCES.map((p) => p.slug).join(", ") || "(none)"}.`,
    ]);
  }

  try {
    return parsePor(src);
  } catch (e: any) {
    return emptyDoc(src.slug, [
      `Parse failed for ${src.filename}: ${String(e?.message || e)}`,
    ]);
  }
}

function emptyDoc(slug: string, warnings: string[]): RoadmapDoc {
  return {
    slug,
    label: slug,
    owner: "—",
    filename: "—",
    primary_year: new Date().getFullYear(),
    quarters: blankQuartersForYear(new Date().getFullYear()),
    mission_excerpt: "",
    sources: POR_SOURCES.map((p) => ({ slug: p.slug, label: p.label })),
    warnings,
  };
}

function blankQuartersForYear(year: number): RoadmapQuarter[] {
  return ["Q1", "Q2", "Q3", "Q4"].map((q, i) => ({
    q: q as RoadmapQuarter["q"],
    year,
    theme: "",
    bullets: [],
    months: [0, 1, 2].map((m) => {
      const monthIdx = i * 3 + m;
      return {
        month_iso: `${year}-${String(monthIdx + 1).padStart(2, "0")}`,
        label: `${monthName(monthIdx)} ${year}`,
        month_idx: monthIdx,
        year,
        tasks: [],
        stoplight: "gray" as Stoplight,
        counts: { total: 0, live: 0, idle: 0, missing: 0, broken: 0 },
      };
    }),
  }));
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthName(idx: number): string {
  return MONTHS_LONG[idx] || "?";
}

function parsePor(src: PorSource): RoadmapDoc {
  const md = src.markdown.replace(/\r\n/g, "\n");
  const warnings: string[] = [];

  // ---- Build §2 status map: task-keyword → status. We scan §2 once and
  // capture every <td>STATUS</td> cell, then later we string-match task names
  // back to that status. This is fuzzy on purpose — the POR is human-edited.
  const statusMap = parseSection2StatusMap(md);

  // ---- §1 Mission excerpt
  const missionExcerpt = sliceSection(md, /^##\s+§?1\s/m, /^##\s+§?\d/m)
    .split(/\n+/)
    .filter((l) => l && !l.startsWith("#"))
    .join(" ")
    .replace(/\*\*/g, "")
    .slice(0, 380);

  // ---- §4 Quarterly Milestones
  const sec4 = sliceSection(md, /^##\s+§?4\s/m, /^##\s+§?\d/m);
  // ---- §5 Monthly Task Lists
  const sec5 = sliceSection(md, /^##\s+§?5\s/m, /^##\s+§?\d/m);

  if (!sec4) warnings.push("§4 (Quarterly Milestones) not found — quarters will be empty");
  if (!sec5) warnings.push("§5 (Monthly Task Lists) not found — months will be empty");

  // Primary year = mode of years found in §4 headings (or current year)
  const yearsFound: number[] = [];
  for (const m of sec4.matchAll(/\bQ([1-4])[^\n]*?(20\d{2})/g)) {
    yearsFound.push(parseInt(m[2], 10));
  }
  for (const m of sec5.matchAll(/^###\s+([A-Za-z]+)\s+(20\d{2})/gm)) {
    yearsFound.push(parseInt(m[2], 10));
  }
  const primaryYear = pickMode(yearsFound) || new Date().getFullYear();

  // Seed empty quarters, then fill from §4
  const quarters = blankQuartersForYear(primaryYear);
  parseSection4Into(sec4, quarters, primaryYear);

  // Fill months from §5
  parseSection5Into(sec5, quarters, primaryYear, statusMap, warnings);

  // Aggregate stoplight + counts per month
  for (const q of quarters) {
    for (const m of q.months) {
      m.counts = countByStatus(m.tasks);
      m.stoplight = aggStoplight(m.counts);
    }
  }

  return {
    slug: src.slug,
    label: src.label,
    owner: src.owner,
    filename: src.filename,
    primary_year: primaryYear,
    quarters,
    mission_excerpt: missionExcerpt,
    sources: POR_SOURCES.map((p) => ({ slug: p.slug, label: p.label })),
    warnings,
  };
}

function sliceSection(md: string, startRe: RegExp, endRe: RegExp): string {
  const startMatch = startRe.exec(md);
  if (!startMatch) return "";
  const startIdx = startMatch.index;
  // Find next H2 AFTER startIdx
  const afterStart = md.slice(startIdx + startMatch[0].length);
  const endMatch = endRe.exec(afterStart);
  const endIdx = endMatch ? startIdx + startMatch[0].length + endMatch.index : md.length;
  return md.slice(startIdx, endIdx);
}

function parseSection4Into(sec4: string, quarters: RoadmapQuarter[], primaryYear: number): void {
  // H3 headings like:
  //   ### Q2 — June 2026 (what's left this month)
  //   ### Q3 — Jul / Aug / Sep 2026 (by month)
  //   ### Q4 — Oct / Nov / Dec 2026 (themes, not tasks)
  // We split on ^### and walk each block.
  const blocks = sec4.split(/^###\s+/m).slice(1);
  for (const b of blocks) {
    const firstLineEnd = b.indexOf("\n");
    const heading = firstLineEnd >= 0 ? b.slice(0, firstLineEnd) : b;
    const body = firstLineEnd >= 0 ? b.slice(firstLineEnd + 1) : "";
    const qMatch = /Q([1-4])/i.exec(heading);
    if (!qMatch) continue;
    const qIdx = parseInt(qMatch[1], 10) - 1;
    const yearMatch = /(20\d{2})/.exec(heading);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : primaryYear;
    // Theme = whatever's left after stripping `Q3 — `, `Jul / Aug / Sep 2026`,
    // and parenthetical tail. Prefer the bit inside quotes if present, e.g.
    //   ### July — "industrialize Pillar A":
    const quoted = /["“']([^"“”']{4,80})["”']/.exec(heading);
    let theme = "";
    if (quoted) {
      theme = quoted[1].trim();
    } else {
      theme = heading
        .replace(/Q[1-4]\s*[—\-–]?\s*/i, "")              // drop Q3 —
        .replace(/(?:[A-Z][a-z]+\s*\/\s*)+[A-Z][a-z]+\s*20\d{2}/i, "")  // drop "Jul / Aug / Sep 2026"
        .replace(/20\d{2}/g, "")                          // drop bare year
        .replace(/\([^)]*\)/g, "")                        // drop (parenthetical)
        .replace(/[—\-–:]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    const bullets = extractBullets(body);

    const target = quarters[qIdx];
    if (target) {
      target.year = year;
      target.theme = theme.slice(0, 80);
      target.bullets = bullets;
    }
  }
}

function extractBullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (m && !/^\*\*/.test(m[1])) {
      // strip leading "**Theme N:** " labels
      let v = m[1].replace(/^\*\*[^*]+\*\*\s*[—-]?\s*/, "");
      v = v.replace(/\*\*/g, "");
      out.push(v);
    } else if (m) {
      out.push(m[1].replace(/\*\*/g, ""));
    }
  }
  return out;
}

function parseSection5Into(
  sec5: string,
  quarters: RoadmapQuarter[],
  primaryYear: number,
  statusMap: Map<string, RoadmapTask["status"]>,
  warnings: string[],
): void {
  // H3 headings: "### June 2026", "### July 2026", etc.
  // Inside each: the first markdown table is the task list.
  // We split on ^###.
  const blocks = sec5.split(/^###\s+/m).slice(1);
  for (const b of blocks) {
    const firstLineEnd = b.indexOf("\n");
    const heading = firstLineEnd >= 0 ? b.slice(0, firstLineEnd) : b;
    const body = firstLineEnd >= 0 ? b.slice(firstLineEnd + 1) : "";
    const monthMatch = /^([A-Za-z]+)\s+(20\d{2})/.exec(heading.trim());
    if (!monthMatch) continue;
    const monthIdx = MONTHS_LONG.indexOf(monthMatch[1]);
    if (monthIdx < 0) continue;
    const year = parseInt(monthMatch[2], 10);

    const tasks = parseMarkdownTable(body, statusMap);
    if (!tasks.length) {
      warnings.push(`No tasks parsed for ${heading.trim()} — check table format.`);
    }

    // Find the matching quarter+month slot. Quarters are indexed 0..3 (Q1..Q4).
    const qIdx = Math.floor(monthIdx / 3);
    const innerMonthIdx = monthIdx - qIdx * 3;
    const quarter = quarters[qIdx];
    if (!quarter) continue;
    const month = quarter.months[innerMonthIdx];
    if (!month) continue;

    month.year = year;
    month.month_idx = monthIdx;
    month.month_iso = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
    month.label = `${MONTHS_LONG[monthIdx]} ${year}`;
    month.tasks = tasks;
    // Adjust quarter year if §5 disagrees with §4 (§5 wins — it's dated)
    if (year !== primaryYear) {
      // keep the year on the month; quarter year stays as set by §4
    }
  }
}

function parseMarkdownTable(body: string, statusMap: Map<string, RoadmapTask["status"]>): RoadmapTask[] {
  const lines = body.split("\n");
  // Find first row starting with "|"
  let i = 0;
  while (i < lines.length && !/^\s*\|/.test(lines[i])) i++;
  if (i >= lines.length) return [];
  // Header row
  const headerRow = splitTableRow(lines[i]);
  i++;
  // Separator row (|---|---|...) — skip if present
  if (i < lines.length && /^\s*\|\s*[-:]+/.test(lines[i])) i++;

  // Map header → column index
  const colIdx: Record<string, number> = {};
  headerRow.forEach((h, idx) => {
    colIdx[h.toLowerCase()] = idx;
  });
  const cTask = pickCol(colIdx, ["task"]);
  const cOwner = pickCol(colIdx, ["owner"]);
  const cDeadline = pickCol(colIdx, ["deadline"]);
  const cPillar = pickCol(colIdx, ["pillar"]);
  const cDone = pickCol(colIdx, ["definition of done", "done"]);

  const out: RoadmapTask[] = [];
  while (i < lines.length) {
    const ln = lines[i];
    i++;
    if (!/^\s*\|/.test(ln)) {
      if (out.length) break;          // table ended
      continue;
    }
    const cells = splitTableRow(ln);
    if (!cells.length) continue;
    const task = pickCell(cells, cTask).trim();
    if (!task) continue;
    const owner = pickCell(cells, cOwner).trim();
    const deadlineCell = pickCell(cells, cDeadline).trim();
    const pillar = pickCell(cells, cPillar).trim();
    const done = pickCell(cells, cDone).trim();

    const dateMatch = /(20\d{2})-(\d{2})-(\d{2})/.exec(deadlineCell);
    const deadlineIso = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
    const deadlineDisp = deadlineIso
      ? new Date(deadlineIso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : deadlineCell || "—";

    const status = inferTaskStatus(task, statusMap);

    out.push({
      task,
      owner: owner || "—",
      deadline_iso: deadlineIso,
      deadline_disp: deadlineDisp,
      pillar: pillar || "—",
      done,
      status,
    });
  }
  return out;
}

function pickCol(map: Record<string, number>, candidates: string[]): number {
  for (const c of candidates) if (map[c] !== undefined) return map[c];
  return -1;
}

function pickCell(cells: string[], idx: number): string {
  if (idx < 0 || idx >= cells.length) return "";
  return cells[idx];
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|\s*$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

// ---- §2 status map ---------------------------------------------------------
//
// Walks §2 Reality Snapshot tables; for each row, indexes the capability name
// (column 1) → status keyword (column 2). When parseMarkdownTable later sees a
// task whose name contains one of these capability keywords, it picks up the
// matching status.

function parseSection2StatusMap(md: string): Map<string, RoadmapTask["status"]> {
  const sec2 = sliceSection(md, /^##\s+§?2\s/m, /^##\s+§?\d/m);
  const map = new Map<string, RoadmapTask["status"]>();
  if (!sec2) return map;
  for (const line of sec2.split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitTableRow(line);
    if (cells.length < 2) continue;
    const cap = cells[0];
    if (!cap || /^[-:]+$/.test(cap) || /capability|item/i.test(cap)) continue;
    const status = parseStatusKeyword(cells[1]);
    if (status === "planned") continue;
    // Index by first 3 distinctive words (lower) so fuzzy match later
    const key = capKey(cap);
    if (key) map.set(key, status);
  }
  return map;
}

function capKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function inferTaskStatus(task: string, statusMap: Map<string, RoadmapTask["status"]>): RoadmapTask["status"] {
  const lower = task.toLowerCase();
  for (const [key, status] of statusMap) {
    // Match if 60% of the cap's distinctive words appear in task name
    const words = key.split(" ").filter((w) => w.length > 3);
    if (!words.length) continue;
    const hits = words.filter((w) => lower.includes(w)).length;
    if (hits / words.length >= 0.5) return status;
  }
  return "planned";
}

function parseStatusKeyword(s: string): RoadmapTask["status"] {
  const u = s.toUpperCase();
  if (/\bBROKEN\b/.test(u)) return "broken";
  if (/SHIPPED-IDLE|SHIPPED IDLE/.test(u)) return "shipped-idle";
  if (/\bSTUBBED\b/.test(u)) return "stubbed";
  if (/\bMISSING\b/.test(u)) return "missing";
  if (/\bDEFERRED\b/.test(u)) return "deferred";
  if (/\bLIVE\b/.test(u)) return "live";
  return "planned";
}

function countByStatus(tasks: RoadmapTask[]) {
  let live = 0, idle = 0, missing = 0, broken = 0;
  for (const t of tasks) {
    if (t.status === "live") live++;
    else if (t.status === "shipped-idle" || t.status === "stubbed") idle++;
    else if (t.status === "missing" || t.status === "deferred") missing++;
    else if (t.status === "broken") broken++;
  }
  return { total: tasks.length, live, idle, missing, broken };
}

function aggStoplight(counts: { total: number; live: number; idle: number; missing: number; broken: number }): Stoplight {
  if (counts.total === 0) return "gray";
  if (counts.broken > 0 || counts.missing > counts.live) return "red";
  if (counts.idle > 0 || counts.missing > 0) return "yellow";
  if (counts.live > 0) return "green";
  return "gray";
}

function pickMode(xs: number[]): number | null {
  if (!xs.length) return null;
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  let best = xs[0], bestN = 0;
  for (const [k, v] of c) if (v > bestN) { best = k; bestN = v; }
  return best;
}

// ----- Renderer --------------------------------------------------------------

function renderHtml(d: RoadmapDoc, reqUrl: URL): string {
  const dataJson = JSON.stringify(d);
  const srcOptions = d.sources.map((s) =>
    `<option value="${escapeAttr(s.slug)}"${s.slug === d.slug ? " selected" : ""}>${escapeHtml(s.label)}</option>`,
  ).join("");
  const warningsBanner = d.warnings.length
    ? `<div class="rm-banner rm-banner-warn">${d.warnings.map(escapeHtml).join(" &middot; ")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Roadmap — ${escapeHtml(d.label)}</title>
  <style>${ROADMAP_CSS}</style>
</head>
<body>
<header class="rm-topbar">
  <div class="rm-brand">
    <span class="rm-brand-main">APG</span><span class="rm-brand-em"> &middot; Roadmap</span>
  </div>
  <form method="GET" action="/roadmap" class="rm-source-form">
    <label class="rm-source-label">Plan</label>
    <select name="source" onchange="this.form.submit()" aria-label="Roadmap source">
      ${srcOptions}
    </select>
  </form>
</header>

<main class="rm-main">
  <section class="rm-hero">
    <h1>${escapeHtml(d.label)}</h1>
    <p class="rm-mission">${escapeHtml(d.mission_excerpt)}…</p>
    <p class="rm-meta">Owner: <strong>${escapeHtml(d.owner)}</strong> &middot; Source: <code>${escapeHtml(d.filename)}</code> &middot; Focus year: <strong>${d.primary_year}</strong></p>
  </section>

  ${warningsBanner}

  <nav class="rm-breadcrumbs" id="rm-crumbs" aria-label="Roadmap breadcrumbs">
    <a href="#year" data-crumb="year" class="rm-crumb rm-crumb-active">Year</a>
  </nav>

  <section id="rm-view" class="rm-view" aria-live="polite"><!-- JS renders here --></section>
</main>

<div id="rm-modal" class="rm-modal" hidden role="dialog" aria-modal="true" aria-labelledby="rm-modal-title">
  <div class="rm-modal-backdrop" data-close></div>
  <div class="rm-modal-card">
    <header class="rm-modal-head">
      <h3 id="rm-modal-title"></h3>
      <button type="button" class="rm-modal-x" data-close aria-label="Close">&times;</button>
    </header>
    <div class="rm-modal-body" id="rm-modal-body"></div>
  </div>
</div>

<footer class="rm-page-footer">
  <span>Parsed from <code>${escapeHtml(d.filename)}</code>. Edit the markdown, re-run <code>sync_por_sources.py</code>, redeploy.</span>
</footer>

<script id="rm-data" type="application/json">${escapeForScript(dataJson)}</script>
<script>${ROADMAP_JS}</script>
</body>
</html>`;
}

// ----- CSS / JS (inline; mirrors the websites-tab pattern) -------------------

const ROADMAP_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
:root {
  --cream: #FAF7EC;
  --cream-2: #F5EFD8;
  --gold: #F5C518;
  --gold-soft: #D8C998;
  --navy: #0A1F44;
  --navy-2: #1A2840;
  --ink: #09090B;
  --muted: #6B7280;
  --rule: #E8E0C8;
  --q1: #3B5A82;
  --q2: #5C7A4F;
  --q3: #B8763A;
  --q4: #6B4C7C;
  --green: #4E7A4C;
  --yellow: #B8893A;
  --red: #9C3D3D;
  --gray: #B7AE94;
}
body {
  font-family: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px; line-height: 1.45; color: var(--ink); background: var(--cream);
}
@font-face {
  font-family: 'Fira Sans';
  src: local('Fira Sans');
}
.rm-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 20px; border-bottom: 1px solid var(--rule);
  background: linear-gradient(180deg, var(--cream), var(--cream-2));
}
.rm-brand { font-family: Georgia, 'Times New Roman', serif; font-size: 19px; color: var(--navy); }
.rm-brand-em { color: var(--gold); font-style: italic; }
.rm-source-form { display: flex; align-items: center; gap: 8px; }
.rm-source-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.rm-source-form select {
  background: #fff; border: 1px solid var(--gold-soft); border-radius: 4px;
  padding: 6px 10px; font: inherit; color: var(--navy); cursor: pointer;
}
.rm-main { max-width: 1280px; margin: 0 auto; padding: 22px 20px 60px; }
.rm-hero h1 {
  font-family: Georgia, serif; font-weight: 400; font-size: 32px;
  margin: 0 0 6px; color: var(--navy); letter-spacing: -0.01em;
}
.rm-mission { font-size: 14px; color: var(--ink); margin: 0 0 6px; max-width: 70ch; }
.rm-meta { font-size: 11px; color: var(--muted); margin: 0 0 16px; }
.rm-meta code { font-family: 'Fira Code', ui-monospace, monospace; font-size: 10.5px; }
.rm-banner {
  padding: 10px 14px; border-radius: 4px; margin: 0 0 14px; font-size: 12.5px;
}
.rm-banner-warn { background: #FFF4E5; border-left: 4px solid #F59E0B; color: #92400E; }

/* breadcrumbs */
.rm-breadcrumbs {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  margin: 4px 0 14px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
}
.rm-crumb {
  color: var(--muted); text-decoration: none; padding: 4px 6px; border-radius: 3px;
  font-weight: 600;
}
.rm-crumb:hover { background: var(--cream-2); color: var(--navy); }
.rm-crumb-active { color: var(--navy); background: var(--cream-2); }
.rm-crumb + .rm-crumb::before {
  content: "›"; color: var(--gold); margin-right: 4px; font-weight: 700;
}

/* ---- YEAR STRIP ---- */
.rm-year {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
}
.rm-q-block {
  background: #fff; border: 1px solid var(--rule); border-top: 4px solid var(--navy);
  border-radius: 6px; padding: 12px; cursor: pointer;
  transition: box-shadow 160ms, transform 160ms;
}
.rm-q-block:hover { box-shadow: 0 4px 12px rgba(10,31,68,0.12); transform: translateY(-2px); }
.rm-q-block[data-q="Q1"] { border-top-color: var(--q1); }
.rm-q-block[data-q="Q2"] { border-top-color: var(--q2); }
.rm-q-block[data-q="Q3"] { border-top-color: var(--q3); }
.rm-q-block[data-q="Q4"] { border-top-color: var(--q4); }
.rm-q-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 8px;
}
.rm-q-label {
  font-family: Georgia, serif; font-style: italic; font-size: 18px; color: var(--navy);
}
.rm-q-year { font-size: 11px; color: var(--muted); font-family: 'Fira Code', monospace; }
.rm-q-theme { font-size: 12px; color: var(--ink); margin-bottom: 10px; min-height: 30px; }
.rm-q-months {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
}
.rm-m-tile {
  position: relative;
  border: 1px solid var(--rule); border-radius: 4px; padding: 8px 6px;
  text-align: center; background: var(--cream);
  cursor: pointer; transition: background 140ms;
}
.rm-m-tile:hover { background: #fff; }
.rm-m-tile-name {
  font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--navy); font-weight: 600;
}
.rm-m-tile-count {
  font-family: 'Fira Code', monospace; font-size: 16px; color: var(--navy); margin-top: 2px;
}
.rm-m-tile-light {
  position: absolute; top: 6px; right: 6px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--gray);
}
.rm-m-tile-light[data-light="green"] { background: var(--green); }
.rm-m-tile-light[data-light="yellow"] { background: var(--yellow); }
.rm-m-tile-light[data-light="red"] { background: var(--red); }
.rm-m-tile-light[data-light="gray"] { background: var(--gray); }

/* ---- QUARTER DETAIL ---- */
.rm-quarter-detail .rm-q-detail-head {
  display: flex; align-items: baseline; gap: 12px;
  border-bottom: 2px solid var(--navy);
  padding-bottom: 8px; margin-bottom: 14px;
}
.rm-q-detail-title {
  font-family: Georgia, serif; font-size: 26px; color: var(--navy); margin: 0;
}
.rm-q-detail-theme { font-style: italic; color: var(--gold); }
.rm-q-detail-bullets {
  margin: 10px 0 18px; padding-left: 18px; color: var(--ink); font-size: 13px;
}
.rm-q-detail-months {
  display: grid; gap: 14px; grid-template-columns: repeat(3, 1fr);
}
.rm-month-card {
  background: #fff; border: 1px solid var(--rule); border-radius: 6px;
  padding: 12px; cursor: pointer; transition: box-shadow 160ms;
}
.rm-month-card:hover { box-shadow: 0 4px 12px rgba(10,31,68,0.12); }
.rm-month-card-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 8px;
}
.rm-month-card-title {
  font-family: Georgia, serif; font-size: 18px; color: var(--navy); margin: 0;
}
.rm-month-card-counts {
  display: flex; gap: 8px; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted);
}
.rm-month-card-counts span strong { color: var(--navy); font-family: 'Fira Code', monospace; }
.rm-month-task-list {
  list-style: none; margin: 0; padding: 0;
}
.rm-month-task-list li {
  padding: 6px 0; border-top: 1px dashed var(--rule); font-size: 12.5px;
  display: flex; align-items: flex-start; gap: 8px;
}
.rm-month-task-list li:first-child { border-top: none; }
.rm-task-status {
  flex-shrink: 0; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  margin-top: 6px; background: var(--gray);
}
.rm-task-status[data-status="live"]         { background: var(--green); }
.rm-task-status[data-status="shipped-idle"] { background: var(--yellow); }
.rm-task-status[data-status="stubbed"]      { background: var(--yellow); }
.rm-task-status[data-status="missing"]      { background: var(--red); }
.rm-task-status[data-status="broken"]       { background: var(--red); }
.rm-task-status[data-status="deferred"]     { background: var(--gray); }
.rm-task-status[data-status="planned"]      { background: var(--navy); opacity: 0.4; }
.rm-task-text { color: var(--ink); flex: 1; }
.rm-task-deadline { font-family: 'Fira Code', monospace; font-size: 11px; color: var(--muted); white-space: nowrap; }

/* ---- MONTH CALENDAR ---- */
.rm-cal-head {
  display: flex; align-items: baseline; gap: 12px;
  border-bottom: 2px solid var(--navy); padding-bottom: 8px; margin-bottom: 14px;
}
.rm-cal-title { font-family: Georgia, serif; font-size: 26px; color: var(--navy); margin: 0; }
.rm-cal-grid {
  display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
  background: var(--rule); border: 1px solid var(--rule); border-radius: 6px; padding: 4px;
}
.rm-cal-dow {
  text-align: center; padding: 6px 0; font-size: 10px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--muted); background: var(--cream-2);
  font-weight: 700;
}
.rm-cal-day {
  background: #fff; border-radius: 3px; min-height: 76px;
  padding: 4px 6px; display: flex; flex-direction: column; gap: 2px;
  cursor: pointer; transition: background 140ms, box-shadow 140ms;
  position: relative;
}
.rm-cal-day:hover { background: var(--cream); box-shadow: inset 0 0 0 1px var(--gold-soft); }
.rm-cal-day-blank { background: var(--cream-2); cursor: default; }
.rm-cal-day-blank:hover { background: var(--cream-2); box-shadow: none; }
.rm-cal-day-num { font-family: 'Fira Code', monospace; font-size: 11px; color: var(--navy); font-weight: 600; }
.rm-cal-day-today .rm-cal-day-num {
  background: var(--gold); color: var(--navy); padding: 1px 5px; border-radius: 3px; align-self: flex-start;
}
.rm-cal-day-events { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.rm-cal-event {
  font-size: 10.5px; padding: 2px 4px; border-radius: 2px;
  background: var(--cream); color: var(--navy);
  border-left: 3px solid var(--navy);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rm-cal-event[data-status="live"]         { border-left-color: var(--green); }
.rm-cal-event[data-status="shipped-idle"] { border-left-color: var(--yellow); }
.rm-cal-event[data-status="missing"]      { border-left-color: var(--red); }
.rm-cal-event[data-status="broken"]       { border-left-color: var(--red); }
.rm-cal-event[data-status="planned"]      { border-left-color: var(--navy); }
.rm-cal-untagged {
  margin-top: 16px; padding: 12px; border: 1px dashed var(--gold-soft); border-radius: 6px;
  background: #fff;
}
.rm-cal-untagged-title {
  font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 8px;
}

/* ---- DAY MODAL ---- */
.rm-modal {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: flex-end; justify-content: stretch;
}
.rm-modal[hidden] { display: none; }
.rm-modal-backdrop { position: absolute; inset: 0; background: rgba(10,31,68,0.4); }
.rm-modal-card {
  position: relative; z-index: 1; width: 100%; max-width: 560px; margin: 0 auto;
  background: var(--cream); border-radius: 12px 12px 0 0;
  max-height: 80vh; display: flex; flex-direction: column;
  box-shadow: 0 -8px 32px rgba(10,31,68,0.3);
  border-top: 4px solid var(--gold);
}
@media (min-width: 768px) {
  .rm-modal { align-items: center; padding: 24px; }
  .rm-modal-card { border-radius: 8px; max-height: 70vh; max-width: 600px; }
}
.rm-modal-head {
  padding: 14px 18px; border-bottom: 1px solid var(--rule);
  display: flex; align-items: center; justify-content: space-between;
}
.rm-modal-head h3 {
  margin: 0; font-family: Georgia, serif; font-size: 18px; color: var(--navy);
}
.rm-modal-x {
  background: none; border: none; font-size: 24px; cursor: pointer;
  color: var(--muted); line-height: 1; padding: 0 4px;
}
.rm-modal-x:hover { color: var(--navy); }
.rm-modal-body { padding: 14px 18px; overflow-y: auto; }
.rm-modal-task {
  padding: 10px 0; border-top: 1px solid var(--rule);
}
.rm-modal-task:first-child { border-top: none; }
.rm-modal-task-name { font-weight: 600; color: var(--navy); }
.rm-modal-task-meta {
  margin-top: 4px; font-size: 11px; color: var(--muted);
  display: flex; gap: 10px; flex-wrap: wrap;
}
.rm-modal-task-meta span strong { color: var(--ink); }
.rm-modal-task-done { font-size: 12px; color: var(--ink); margin-top: 6px; font-style: italic; }

/* ---- footer ---- */
.rm-page-footer {
  max-width: 1280px; margin: 32px auto 0; padding: 16px 20px;
  border-top: 1px solid var(--rule); color: var(--muted);
  font-size: 11px; font-family: 'Fira Code', monospace;
}

/* ---- mobile ---- */
@media (max-width: 760px) {
  .rm-main { padding: 16px 14px 60px; }
  .rm-hero h1 { font-size: 24px; }
  .rm-year { grid-template-columns: 1fr; gap: 10px; }
  .rm-q-detail-months { grid-template-columns: 1fr; }
  .rm-cal-grid { gap: 2px; padding: 2px; }
  .rm-cal-day { min-height: 52px; padding: 3px 4px; }
  .rm-cal-event { font-size: 9.5px; padding: 1px 3px; }
  .rm-topbar { padding: 12px 14px; }
}
@media (max-width: 480px) {
  .rm-cal-grid {
    /* On very narrow viewports, collapse to a single column day list */
    display: block;
    background: transparent; border: none; padding: 0;
  }
  .rm-cal-dow { display: none; }
  .rm-cal-day {
    min-height: 0; flex-direction: row; align-items: center; gap: 8px;
    padding: 8px 10px; margin-bottom: 4px; border: 1px solid var(--rule);
  }
  .rm-cal-day-blank { display: none; }
  .rm-cal-day-num { font-size: 12px; min-width: 36px; }
  .rm-cal-day-num::before {
    content: attr(data-dow) " "; color: var(--muted); font-weight: 400;
  }
  .rm-cal-day-events { flex: 1; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

const ROADMAP_JS = `
(function () {
  var dataEl = document.getElementById('rm-data');
  if (!dataEl) return;
  var DATA;
  try { DATA = JSON.parse(dataEl.textContent || '{}'); } catch (e) { DATA = {quarters: []}; }

  var view = document.getElementById('rm-view');
  var crumbs = document.getElementById('rm-crumbs');
  var modal = document.getElementById('rm-modal');
  var modalTitle = document.getElementById('rm-modal-title');
  var modalBody = document.getElementById('rm-modal-body');

  var MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function findQuarter(qKey) {
    for (var i=0; i<DATA.quarters.length; i++) {
      if (DATA.quarters[i].q === qKey) return DATA.quarters[i];
    }
    return null;
  }
  function findMonth(qKey, monthIdx) {
    var q = findQuarter(qKey);
    if (!q) return null;
    for (var i=0; i<q.months.length; i++) {
      if (q.months[i].month_idx === monthIdx) return q.months[i];
    }
    return null;
  }

  // ---- routing via URL hash ----
  function parseHash() {
    var h = (window.location.hash || '#year').replace(/^#/, '');
    // Forms: year | q3 | q3-jul | q3-jul-2026-07-15
    var parts = h.split('-');
    var state = { kind: 'year' };
    if (!parts[0]) return state;
    if (parts[0] === 'year') return state;
    var qMatch = /^q([1-4])$/i.exec(parts[0]);
    if (!qMatch) return state;
    state.kind = 'q';
    state.q = 'Q' + qMatch[1];
    if (parts[1]) {
      var monthIdx = MONTHS_SHORT.map(function(m){return m.toLowerCase();}).indexOf(parts[1].toLowerCase());
      if (monthIdx >= 0) {
        state.kind = 'm';
        state.monthIdx = monthIdx;
        if (parts.length >= 5) {
          state.day = parts[2] + '-' + parts[3] + '-' + parts[4];
          state.kind = 'd';
        }
      }
    }
    return state;
  }

  function setHash(h) {
    if (window.location.hash !== '#' + h) {
      history.pushState(null, '', '#' + h);
    }
  }

  function renderBreadcrumbs(state) {
    var parts = [{label: 'Year', href: 'year'}];
    if (state.kind === 'q' || state.kind === 'm' || state.kind === 'd') {
      parts.push({label: state.q + ' ' + (findQuarter(state.q) ? findQuarter(state.q).year : ''), href: state.q.toLowerCase()});
    }
    if (state.kind === 'm' || state.kind === 'd') {
      parts.push({label: MONTHS_SHORT[state.monthIdx], href: state.q.toLowerCase() + '-' + MONTHS_SHORT[state.monthIdx].toLowerCase()});
    }
    crumbs.innerHTML = parts.map(function (p, i) {
      var active = (i === parts.length - 1) ? ' rm-crumb-active' : '';
      return '<a class="rm-crumb' + active + '" href="#' + esc(p.href) + '">' + esc(p.label) + '</a>';
    }).join('');
  }

  // ---- YEAR view ----
  function renderYear() {
    var html = '<div class="rm-year">';
    DATA.quarters.forEach(function (q) {
      var themeText = q.theme ? esc(q.theme) : '<em style="color:#9CA3AF">no theme set</em>';
      html += '<article class="rm-q-block" data-q="' + esc(q.q) + '" tabindex="0" role="button" aria-label="Open ' + esc(q.q) + ' detail">';
      html += '  <div class="rm-q-head"><div class="rm-q-label">' + esc(q.q) + '</div><div class="rm-q-year">' + esc(String(q.year)) + '</div></div>';
      html += '  <div class="rm-q-theme">' + themeText + '</div>';
      html += '  <div class="rm-q-months">';
      q.months.forEach(function (m) {
        var totalDisp = m.counts.total ? String(m.counts.total) : '·';
        html += '    <div class="rm-m-tile" data-q="' + esc(q.q) + '" data-month-idx="' + m.month_idx + '" tabindex="0" role="button" aria-label="Open ' + esc(MONTHS_SHORT[m.month_idx]) + ' ' + esc(String(m.year)) + '">';
        html += '      <span class="rm-m-tile-light" data-light="' + esc(m.stoplight) + '"></span>';
        html += '      <div class="rm-m-tile-name">' + esc(MONTHS_SHORT[m.month_idx]) + '</div>';
        html += '      <div class="rm-m-tile-count">' + totalDisp + '</div>';
        html += '    </div>';
      });
      html += '  </div>';
      html += '</article>';
    });
    html += '</div>';
    view.innerHTML = html;

    view.querySelectorAll('.rm-q-block').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.rm-m-tile')) return;
        var q = el.getAttribute('data-q');
        setHash(q.toLowerCase());
        route();
      });
      el.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') { el.click(); }
      });
    });
    view.querySelectorAll('.rm-m-tile').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        var q = el.getAttribute('data-q');
        var mi = parseInt(el.getAttribute('data-month-idx'), 10);
        setHash(q.toLowerCase() + '-' + MONTHS_SHORT[mi].toLowerCase());
        route();
      });
      el.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') { el.click(); }
      });
    });
  }

  // ---- QUARTER view ----
  function renderQuarter(qKey) {
    var q = findQuarter(qKey);
    if (!q) { view.innerHTML = '<p>Quarter not found.</p>'; return; }
    var html = '<section class="rm-quarter-detail">';
    html += '  <div class="rm-q-detail-head">';
    html += '    <h2 class="rm-q-detail-title">' + esc(q.q) + ' ' + esc(String(q.year)) + '</h2>';
    if (q.theme) html += '    <div class="rm-q-detail-theme">' + esc(q.theme) + '</div>';
    html += '  </div>';
    if (q.bullets && q.bullets.length) {
      html += '  <ul class="rm-q-detail-bullets">';
      q.bullets.forEach(function (b) { html += '<li>' + esc(b) + '</li>'; });
      html += '  </ul>';
    }
    html += '  <div class="rm-q-detail-months">';
    q.months.forEach(function (m) {
      html += renderMonthCard(q, m);
    });
    html += '  </div>';
    html += '</section>';
    view.innerHTML = html;

    view.querySelectorAll('.rm-month-card').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.rm-task-status') || e.target.closest('.rm-month-task-list li')) return;
        var qKey = el.getAttribute('data-q');
        var mi = parseInt(el.getAttribute('data-month-idx'), 10);
        setHash(qKey.toLowerCase() + '-' + MONTHS_SHORT[mi].toLowerCase());
        route();
      });
    });
  }

  function renderMonthCard(q, m) {
    var taskListHtml;
    if (m.tasks.length === 0) {
      taskListHtml = '<p style="font-size:12px;color:#9CA3AF;font-style:italic;margin:6px 0 0;">No tasks scheduled.</p>';
    } else {
      var shown = m.tasks.slice(0, 6);
      taskListHtml = '<ul class="rm-month-task-list">';
      shown.forEach(function (t) {
        taskListHtml += '<li>';
        taskListHtml += '<span class="rm-task-status" data-status="' + esc(t.status) + '" title="' + esc(t.status) + '"></span>';
        taskListHtml += '<span class="rm-task-text">' + esc(t.task) + '</span>';
        taskListHtml += '<span class="rm-task-deadline">' + esc(t.deadline_disp) + '</span>';
        taskListHtml += '</li>';
      });
      if (m.tasks.length > shown.length) {
        taskListHtml += '<li><em style="color:#9CA3AF;">+' + (m.tasks.length - shown.length) + ' more &mdash; open calendar</em></li>';
      }
      taskListHtml += '</ul>';
    }
    var counts = m.counts;
    return ''
      + '<article class="rm-month-card" data-q="' + esc(q.q) + '" data-month-idx="' + m.month_idx + '" tabindex="0" role="button" aria-label="Open ' + esc(MONTHS_LONG[m.month_idx]) + ' calendar">'
      + '  <div class="rm-month-card-head">'
      + '    <h3 class="rm-month-card-title">' + esc(MONTHS_LONG[m.month_idx]) + '</h3>'
      + '    <div class="rm-month-card-counts">'
      + '      <span>Tasks <strong>' + counts.total + '</strong></span>'
      + (counts.live    ? '<span>Live <strong>' + counts.live + '</strong></span>'        : '')
      + (counts.idle    ? '<span>Idle <strong>' + counts.idle + '</strong></span>'        : '')
      + (counts.missing ? '<span>Missing <strong>' + counts.missing + '</strong></span>'  : '')
      + (counts.broken  ? '<span>Broken <strong>' + counts.broken + '</strong></span>'    : '')
      + '    </div>'
      + '  </div>'
      + taskListHtml
      + '</article>';
  }

  // ---- MONTH view (calendar) ----
  function renderMonth(qKey, monthIdx) {
    var q = findQuarter(qKey);
    var m = findMonth(qKey, monthIdx);
    if (!q || !m) { view.innerHTML = '<p>Month not found.</p>'; return; }

    // Build the calendar grid for this month/year
    var year = m.year;
    var firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();  // 0..6
    var daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();

    // Group tasks by deadline_iso
    var dayEvents = {};
    var untagged = [];
    m.tasks.forEach(function (t) {
      if (t.deadline_iso) {
        if (!dayEvents[t.deadline_iso]) dayEvents[t.deadline_iso] = [];
        dayEvents[t.deadline_iso].push(t);
      } else {
        untagged.push(t);
      }
    });

    var today = new Date();
    var todayIso = today.getUTCFullYear() + '-' + String(today.getUTCMonth()+1).padStart(2,'0') + '-' + String(today.getUTCDate()).padStart(2,'0');

    var html = '<section class="rm-calendar">';
    html += '  <div class="rm-cal-head"><h2 class="rm-cal-title">' + esc(MONTHS_LONG[monthIdx]) + ' ' + year + '</h2></div>';
    html += '  <div class="rm-cal-grid">';
    DOW.forEach(function (d) { html += '<div class="rm-cal-dow">' + d + '</div>'; });
    for (var i=0; i<firstDow; i++) {
      html += '<div class="rm-cal-day rm-cal-day-blank"></div>';
    }
    for (var d=1; d<=daysInMonth; d++) {
      var iso = year + '-' + String(monthIdx+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
      var events = dayEvents[iso] || [];
      var dowIdx = new Date(Date.UTC(year, monthIdx, d)).getUTCDay();
      var todayClass = (iso === todayIso) ? ' rm-cal-day-today' : '';
      html += '<div class="rm-cal-day' + todayClass + '" data-q="' + esc(qKey) + '" data-month-idx="' + monthIdx + '" data-day="' + iso + '" tabindex="0" role="button" aria-label="Day ' + d + ', ' + events.length + ' tasks">';
      html += '  <span class="rm-cal-day-num" data-dow="' + DOW[dowIdx] + '">' + d + '</span>';
      html += '  <div class="rm-cal-day-events">';
      events.slice(0, 3).forEach(function (e) {
        html += '<div class="rm-cal-event" data-status="' + esc(e.status) + '" title="' + esc(e.task) + '">' + esc(e.task) + '</div>';
      });
      if (events.length > 3) {
        html += '<div class="rm-cal-event" style="font-style:italic;color:#6B7280;">+' + (events.length - 3) + ' more</div>';
      }
      html += '  </div>';
      html += '</div>';
    }
    var totalCells = firstDow + daysInMonth;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var t=0; t<trailing; t++) {
      html += '<div class="rm-cal-day rm-cal-day-blank"></div>';
    }
    html += '  </div>';

    if (untagged.length) {
      html += '  <div class="rm-cal-untagged">';
      html += '    <div class="rm-cal-untagged-title">Untagged this month (no specific date)</div>';
      html += '    <ul class="rm-month-task-list">';
      untagged.forEach(function (u) {
        html += '<li><span class="rm-task-status" data-status="' + esc(u.status) + '"></span><span class="rm-task-text">' + esc(u.task) + '</span><span class="rm-task-deadline">' + esc(u.deadline_disp) + '</span></li>';
      });
      html += '    </ul>';
      html += '  </div>';
    }
    html += '</section>';
    view.innerHTML = html;

    view.querySelectorAll('.rm-cal-day:not(.rm-cal-day-blank)').forEach(function (el) {
      el.addEventListener('click', function () {
        var iso = el.getAttribute('data-day');
        var qKey = el.getAttribute('data-q');
        var mi = parseInt(el.getAttribute('data-month-idx'), 10);
        var parts = iso.split('-');
        setHash(qKey.toLowerCase() + '-' + MONTHS_SHORT[mi].toLowerCase() + '-' + parts[0] + '-' + parts[1] + '-' + parts[2]);
        route();
      });
      el.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') { el.click(); }
      });
    });
  }

  // ---- DAY modal ----
  function openDay(qKey, monthIdx, iso) {
    var m = findMonth(qKey, monthIdx);
    if (!m) return;
    var events = m.tasks.filter(function (t) { return t.deadline_iso === iso; });
    var dt = new Date(iso + 'T12:00:00Z');
    modalTitle.textContent = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    if (!events.length) {
      modalBody.innerHTML = '<p style="color:#6B7280;font-style:italic;">Nothing scheduled.</p>';
    } else {
      modalBody.innerHTML = events.map(function (e) {
        var meta = ''
          + '<span>Status <strong>' + esc(e.status) + '</strong></span>'
          + '<span>Owner <strong>' + esc(e.owner) + '</strong></span>'
          + '<span>Pillar <strong>' + esc(e.pillar) + '</strong></span>';
        var done = e.done ? '<div class="rm-modal-task-done">DoD: ' + esc(e.done) + '</div>' : '';
        return '<div class="rm-modal-task">'
             +   '<div class="rm-modal-task-name">' + esc(e.task) + '</div>'
             +   '<div class="rm-modal-task-meta">' + meta + '</div>'
             +   done
             + '</div>';
      }).join('');
    }
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDay() {
    modal.hidden = true;
    document.body.style.overflow = '';
    var state = parseHash();
    if (state.kind === 'd') {
      setHash(state.q.toLowerCase() + '-' + MONTHS_SHORT[state.monthIdx].toLowerCase());
    }
  }
  modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-close')) closeDay();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeDay();
  });

  // ---- Router ----
  function route() {
    var state = parseHash();
    renderBreadcrumbs(state);
    if (state.kind === 'year') {
      renderYear();
      closeModalSilent();
    } else if (state.kind === 'q') {
      renderQuarter(state.q);
      closeModalSilent();
    } else if (state.kind === 'm') {
      renderMonth(state.q, state.monthIdx);
      closeModalSilent();
    } else if (state.kind === 'd') {
      renderMonth(state.q, state.monthIdx);
      openDay(state.q, state.monthIdx, state.day);
    }
  }
  function closeModalSilent() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  window.addEventListener('hashchange', route);
  route();
})();
`;

// ----- escape helpers --------------------------------------------------------

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

// Escape a JSON payload for safe embedding inside <script type="application/json">.
// We only need to neutralize the </script> sequence; everything else is JSON-safe.
function escapeForScript(s: string): string {
  return s.replace(/<\/script>/gi, "<\\/script>");
}
