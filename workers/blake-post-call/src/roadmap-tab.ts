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
/* ============================================================================
 * APG Roadmap — Claymorphism revision (2026-06-03)
 *
 * Style: editorial claymorphism. Soft 3D cards with two-layer outer shadows
 *   + 1px inner highlight, 16-20px radii on cards / 10-12px on tiles,
 *   pillowy depth without abandoning the APG cream/gold/navy palette.
 *
 * Typography: Fraunces (editorial display serif, complements existing
 *   Georgia masthead) + Inter (body) + JetBrains Mono (dates/code).
 *   Loaded from Google Fonts. Falls back to Georgia / system-sans.
 *
 * Spacing: 8px base unit. All gaps / paddings snap to multiples
 *   (4, 8, 12, 16, 20, 24, 32, 40).
 *
 * Alignment: CSS Grid everywhere — no flex hacks for layout. Quarter cards
 *   use explicit row tracks (head / theme / months) so heights match across
 *   the row regardless of theme length.
 * ========================================================================== */

@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

:root {
  /* Editorial APG palette (preserved) */
  --cream:     #FAF7EC;
  --cream-2:   #F5EFD8;
  --cream-3:   #EFE7CC;   /* deeper cream for inset wells */
  --gold:      #F5C518;
  --gold-soft: #D8C998;
  --navy:      #0A1F44;
  --navy-2:    #1A2840;
  --ink:       #09090B;
  --muted:     #6B7280;
  --rule:      #E8E0C8;

  /* Quarter accent hues (preserved) */
  --q1: #3B5A82;
  --q2: #5C7A4F;
  --q3: #B8763A;
  --q4: #6B4C7C;

  /* Stoplight (preserved) */
  --green:  #4E7A4C;
  --yellow: #B8893A;
  --red:    #9C3D3D;
  --gray:   #B7AE94;

  /* Claymorphism tokens — multi-layer pillowy shadows */
  --clay-radius-lg: 20px;   /* hero cards (quarter blocks, month cards) */
  --clay-radius-md: 14px;   /* secondary cards (modal, banners, tiles) */
  --clay-radius-sm: 10px;   /* inner pills, event chips, day cells */

  /* Soft outer drop shadow (bottom-right) + inner top-left highlight
     mimics dough/clay diffusion against the cream backdrop */
  --clay-shadow:
    0 1px 2px  rgba(10, 31, 68, 0.04),
    0 6px 14px rgba(10, 31, 68, 0.07),
    0 14px 32px rgba(10, 31, 68, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);

  --clay-shadow-hover:
    0 2px  4px rgba(10, 31, 68, 0.06),
    0 10px 22px rgba(10, 31, 68, 0.10),
    0 22px 44px rgba(10, 31, 68, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);

  /* Pressed / focus — inverted (debossed) for tactile click feel */
  --clay-shadow-inset:
    inset 0 2px  4px rgba(10, 31, 68, 0.08),
    inset 0 -1px 0 rgba(255, 255, 255, 0.6);

  --ease-clay: cubic-bezier(0.34, 1.4, 0.5, 1);
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink);
  /* Subtle radial wash gives shadows somewhere to dissolve into */
  background:
    radial-gradient(circle at 20% 0%, #FFFBEC 0%, transparent 55%),
    radial-gradient(circle at 100% 100%, #F2EAD0 0%, transparent 60%),
    var(--cream);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

/* ---- TOP BAR ---- */
.rm-topbar {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 16px 24px;
  background: linear-gradient(180deg, var(--cream) 0%, var(--cream-2) 100%);
  border-bottom: 1px solid rgba(216, 201, 152, 0.5);
}
.rm-brand {
  font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
  font-weight: 600;
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--navy);
}
.rm-brand-em {
  color: var(--gold);
  font-style: italic;
  font-weight: 500;
}
.rm-source-form {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.rm-source-label {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
}
.rm-source-form select {
  background: #fff;
  border: none;
  border-radius: var(--clay-radius-sm);
  padding: 10px 14px;
  font: inherit;
  font-size: 13px;
  color: var(--navy);
  cursor: pointer;
  box-shadow: var(--clay-shadow);
  transition: box-shadow 200ms var(--ease-clay), transform 200ms var(--ease-clay);
}
.rm-source-form select:hover { box-shadow: var(--clay-shadow-hover); }
.rm-source-form select:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

/* ---- MAIN COLUMN ---- */
.rm-main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 24px 80px;
}

/* ---- HERO ---- */
.rm-hero { margin-bottom: 24px; }
.rm-hero h1 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: clamp(28px, 4.2vw, 42px);
  line-height: 1.1;
  letter-spacing: -0.02em;
  margin: 0 0 12px;
  color: var(--navy);
}
.rm-mission {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ink);
  margin: 0 0 12px;
  max-width: 68ch;
}
.rm-meta {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.rm-meta code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  background: rgba(216, 201, 152, 0.25);
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--navy);
}
.rm-meta strong { color: var(--navy); font-weight: 600; }

.rm-banner {
  padding: 14px 18px;
  border-radius: var(--clay-radius-md);
  margin: 0 0 20px;
  font-size: 13px;
  background: #FFF4E5;
  box-shadow:
    0 2px 6px rgba(245, 158, 11, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    inset 4px 0 0 #F59E0B;
  color: #92400E;
}
.rm-banner-warn {} /* alias preserved for parity */

/* ---- BREADCRUMBS ---- */
.rm-breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 8px 0 24px;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.rm-crumb {
  color: var(--muted);
  text-decoration: none;
  padding: 6px 12px;
  border-radius: var(--clay-radius-sm);
  font-weight: 600;
  transition: background 180ms var(--ease-clay), color 180ms var(--ease-clay), box-shadow 180ms var(--ease-clay);
}
.rm-crumb:hover {
  background: rgba(255, 255, 255, 0.6);
  color: var(--navy);
  box-shadow: var(--clay-shadow);
}
.rm-crumb-active {
  color: var(--navy);
  background: #fff;
  box-shadow: var(--clay-shadow);
}
.rm-crumb + .rm-crumb::before {
  content: "›";
  color: var(--gold);
  margin: 0 4px 0 0;
  font-weight: 700;
  font-size: 14px;
  line-height: 1;
}

/* ============================================================================
 * YEAR STRIP — 4 quarter blocks
 * ========================================================================== */
.rm-year {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}
.rm-q-block {
  /* Clay card */
  background: #fff;
  border: none;
  border-radius: var(--clay-radius-lg);
  padding: 20px;
  cursor: pointer;
  box-shadow: var(--clay-shadow);
  transition: box-shadow 240ms var(--ease-clay), transform 240ms var(--ease-clay);

  /* Internal grid: head / theme / months — fixed row order, aligned across cards */
  display: grid;
  grid-template-rows: auto 48px 1fr;
  gap: 12px;
  position: relative;
  overflow: hidden;
}
.rm-q-block::before {
  /* Accent ribbon along the top edge — replaces old solid border-top */
  content: "";
  position: absolute;
  top: 0; left: 16px; right: 16px;
  height: 4px;
  border-radius: 0 0 4px 4px;
  background: var(--navy);
}
.rm-q-block[data-q="Q1"]::before { background: var(--q1); }
.rm-q-block[data-q="Q2"]::before { background: var(--q2); }
.rm-q-block[data-q="Q3"]::before { background: var(--q3); }
.rm-q-block[data-q="Q4"]::before { background: var(--q4); }
.rm-q-block:hover {
  box-shadow: var(--clay-shadow-hover);
  transform: translateY(-3px);
}
.rm-q-block:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 3px;
}

.rm-q-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 12px;
}
.rm-q-label {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 500;
  font-size: 22px;
  color: var(--navy);
  letter-spacing: -0.01em;
}
.rm-q-year {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.05em;
}
.rm-q-theme {
  font-size: 13px;
  line-height: 1.45;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rm-q-months {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.rm-m-tile {
  position: relative;
  display: grid;
  grid-template-rows: 1fr auto;
  align-items: center;
  justify-items: center;
  gap: 4px;
  padding: 12px 8px;
  text-align: center;
  background: var(--cream);
  border: none;
  border-radius: var(--clay-radius-sm);
  cursor: pointer;
  box-shadow: var(--clay-shadow-inset);
  transition: background 180ms var(--ease-clay), box-shadow 200ms var(--ease-clay), transform 200ms var(--ease-clay);
}
.rm-m-tile:hover {
  background: #fff;
  box-shadow: var(--clay-shadow);
  transform: translateY(-2px);
}
.rm-m-tile:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.rm-m-tile-name {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--navy);
}
.rm-m-tile-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: var(--navy);
}
.rm-m-tile-light {
  position: absolute;
  top: 8px; right: 8px;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--gray);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.8),
    0 2px 4px rgba(10, 31, 68, 0.15);
}
.rm-m-tile-light[data-light="green"]  { background: var(--green);  }
.rm-m-tile-light[data-light="yellow"] { background: var(--yellow); }
.rm-m-tile-light[data-light="red"]    { background: var(--red);    }
.rm-m-tile-light[data-light="gray"]   { background: var(--gray);   }

/* ============================================================================
 * QUARTER DETAIL
 * ========================================================================== */
.rm-quarter-detail .rm-q-detail-head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 16px;
  padding-bottom: 16px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(216, 201, 152, 0.6);
}
.rm-q-detail-title {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: clamp(24px, 3.6vw, 32px);
  letter-spacing: -0.02em;
  color: var(--navy);
  margin: 0;
}
.rm-q-detail-theme {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-weight: 400;
  font-size: 17px;
  color: var(--q3);
}
.rm-q-detail-bullets {
  margin: 0 0 24px;
  padding-left: 20px;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.6;
}
.rm-q-detail-bullets li { margin-bottom: 4px; }
.rm-q-detail-months {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

/* ---- Month cards (clay) ---- */
.rm-month-card {
  background: #fff;
  border: none;
  border-radius: var(--clay-radius-lg);
  padding: 20px;
  cursor: pointer;
  box-shadow: var(--clay-shadow);
  transition: box-shadow 240ms var(--ease-clay), transform 240ms var(--ease-clay);
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 12px;
}
.rm-month-card:hover {
  box-shadow: var(--clay-shadow-hover);
  transform: translateY(-2px);
}
.rm-month-card:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 3px;
}
.rm-month-card-head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 12px;
}
.rm-month-card-title {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--navy);
  margin: 0;
}
.rm-month-card-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  justify-content: flex-end;
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.rm-month-card-counts span strong {
  color: var(--navy);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  margin-left: 4px;
}
.rm-month-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.rm-month-task-list li {
  padding: 10px 12px;
  background: var(--cream);
  border-radius: var(--clay-radius-sm);
  font-size: 13px;
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: center;
  gap: 10px;
  box-shadow: var(--clay-shadow-inset);
}
.rm-task-status {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--gray);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.9),
    0 1px 2px rgba(10, 31, 68, 0.2);
}
.rm-task-status[data-status="live"]         { background: var(--green);  }
.rm-task-status[data-status="shipped-idle"] { background: var(--yellow); }
.rm-task-status[data-status="stubbed"]      { background: var(--yellow); }
.rm-task-status[data-status="missing"]      { background: var(--red);    }
.rm-task-status[data-status="broken"]       { background: var(--red);    }
.rm-task-status[data-status="deferred"]     { background: var(--gray);   }
.rm-task-status[data-status="planned"]      { background: var(--navy); opacity: 0.45; }
.rm-task-text { color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rm-task-deadline {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}

/* ============================================================================
 * MONTH CALENDAR
 * ========================================================================== */
.rm-cal-head {
  display: grid;
  grid-template-columns: 1fr;
  align-items: baseline;
  padding-bottom: 16px;
  margin-bottom: 20px;
  border-bottom: 1px solid rgba(216, 201, 152, 0.6);
}
.rm-cal-title {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: clamp(24px, 3.6vw, 32px);
  letter-spacing: -0.02em;
  color: var(--navy);
  margin: 0;
}
.rm-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  padding: 16px;
  background: #fff;
  border: none;
  border-radius: var(--clay-radius-lg);
  box-shadow: var(--clay-shadow);
}
.rm-cal-dow {
  text-align: center;
  padding: 8px 0;
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
}
.rm-cal-day {
  background: var(--cream);
  border-radius: var(--clay-radius-sm);
  min-height: 88px;
  padding: 8px;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 4px;
  cursor: pointer;
  box-shadow: var(--clay-shadow-inset);
  transition: background 180ms var(--ease-clay), box-shadow 200ms var(--ease-clay), transform 200ms var(--ease-clay);
  position: relative;
}
.rm-cal-day:hover {
  background: #fff;
  box-shadow: var(--clay-shadow);
  transform: translateY(-2px);
}
.rm-cal-day:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}
.rm-cal-day-blank {
  background: transparent;
  box-shadow: none;
  cursor: default;
}
.rm-cal-day-blank:hover { background: transparent; box-shadow: none; transform: none; }
.rm-cal-day-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--navy);
  justify-self: start;
}
.rm-cal-day-today .rm-cal-day-num {
  background: var(--gold);
  color: var(--navy);
  padding: 2px 7px;
  border-radius: 8px;
  box-shadow:
    0 2px 4px rgba(245, 197, 24, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}
.rm-cal-day-events {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}
.rm-cal-event {
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 6px;
  background: #fff;
  color: var(--navy);
  border-left: 3px solid var(--navy);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow:
    0 1px 2px rgba(10, 31, 68, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.rm-cal-event[data-status="live"]         { border-left-color: var(--green);  }
.rm-cal-event[data-status="shipped-idle"] { border-left-color: var(--yellow); }
.rm-cal-event[data-status="missing"]      { border-left-color: var(--red);    }
.rm-cal-event[data-status="broken"]       { border-left-color: var(--red);    }
.rm-cal-event[data-status="planned"]      { border-left-color: var(--navy);   }

.rm-cal-untagged {
  margin-top: 20px;
  padding: 20px;
  background: #fff;
  border: none;
  border-radius: var(--clay-radius-lg);
  box-shadow: var(--clay-shadow);
}
.rm-cal-untagged-title {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 12px;
}

/* ============================================================================
 * DAY MODAL
 * ========================================================================== */
.rm-modal {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: flex-end; justify-content: stretch;
}
.rm-modal[hidden] { display: none; }
.rm-modal-backdrop { position: absolute; inset: 0; background: rgba(10, 31, 68, 0.45); backdrop-filter: blur(2px); }
.rm-modal-card {
  position: relative; z-index: 1;
  width: 100%; max-width: 600px; margin: 0 auto;
  background: var(--cream);
  border-radius: 24px 24px 0 0;
  max-height: 82vh;
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow:
    0 -4px 16px rgba(10, 31, 68, 0.12),
    0 -16px 40px rgba(10, 31, 68, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
.rm-modal-card::before {
  /* Drag handle / gold accent */
  content: "";
  position: absolute;
  top: 8px; left: 50%; transform: translateX(-50%);
  width: 40px; height: 4px;
  border-radius: 2px;
  background: var(--gold);
  opacity: 0.6;
}
@media (min-width: 768px) {
  .rm-modal { align-items: center; padding: 32px; }
  .rm-modal-card {
    border-radius: var(--clay-radius-lg);
    max-height: 70vh;
    max-width: 640px;
    box-shadow:
      0 20px 50px rgba(10, 31, 68, 0.25),
      0 6px 14px rgba(10, 31, 68, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }
  .rm-modal-card::before { display: none; }
}
.rm-modal-head {
  padding: 20px 24px 16px;
  border-bottom: 1px solid rgba(216, 201, 152, 0.6);
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 12px;
}
.rm-modal-head h3 {
  margin: 0;
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--navy);
}
.rm-modal-x {
  background: #fff;
  border: none;
  width: 32px; height: 32px;
  border-radius: 50%;
  font-size: 18px;
  cursor: pointer;
  color: var(--muted);
  line-height: 1;
  box-shadow: var(--clay-shadow);
  transition: box-shadow 200ms var(--ease-clay), color 200ms var(--ease-clay);
}
.rm-modal-x:hover { color: var(--navy); box-shadow: var(--clay-shadow-hover); }
.rm-modal-x:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.rm-modal-body {
  padding: 16px 24px 24px;
  overflow-y: auto;
  display: grid;
  gap: 12px;
}
.rm-modal-task {
  padding: 14px 16px;
  background: #fff;
  border-radius: var(--clay-radius-md);
  box-shadow: var(--clay-shadow);
  display: grid;
  gap: 6px;
}
.rm-modal-task-name {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 15px;
  color: var(--navy);
  letter-spacing: -0.01em;
}
.rm-modal-task-meta {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: var(--muted);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.rm-modal-task-meta span strong { color: var(--ink); font-weight: 600; }
.rm-modal-task-done {
  font-size: 12.5px;
  color: var(--ink);
  font-style: italic;
  line-height: 1.5;
}

/* ---- footer ---- */
.rm-page-footer {
  max-width: 1280px;
  margin: 48px auto 0;
  padding: 24px;
  color: var(--muted);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  text-align: center;
}
.rm-page-footer code { color: var(--navy); }

/* ============================================================================
 * RESPONSIVE — mobile first 380px
 * ========================================================================== */
@media (max-width: 1024px) {
  .rm-year { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rm-q-detail-months { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .rm-main { padding: 24px 16px 60px; }
  .rm-year { grid-template-columns: 1fr; gap: 16px; }
  .rm-q-detail-months { grid-template-columns: 1fr; gap: 16px; }
  .rm-q-block { padding: 18px; grid-template-rows: auto auto 1fr; }
  .rm-month-card { padding: 18px; }
  .rm-cal-grid { gap: 4px; padding: 10px; }
  .rm-cal-day { min-height: 64px; padding: 6px; }
  .rm-cal-event { font-size: 10px; padding: 2px 5px; }
  .rm-topbar { padding: 14px 16px; }
  .rm-hero h1 { font-size: 26px; }
  .rm-month-card-head {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .rm-month-card-counts { justify-content: flex-start; }
}
@media (max-width: 480px) {
  /* 380-480px: calendar collapses to vertical day list */
  .rm-cal-grid {
    display: grid;
    grid-template-columns: 1fr;
    background: transparent;
    box-shadow: none;
    padding: 0;
    gap: 8px;
  }
  .rm-cal-dow { display: none; }
  .rm-cal-day {
    background: #fff;
    box-shadow: var(--clay-shadow);
    min-height: 0;
    display: grid;
    grid-template-columns: 56px 1fr;
    grid-template-rows: auto;
    align-items: start;
    gap: 12px;
    padding: 12px 14px;
  }
  .rm-cal-day-blank { display: none; }
  .rm-cal-day-num {
    font-size: 13px;
    align-self: center;
  }
  .rm-cal-day-num::before {
    content: attr(data-dow) " ";
    color: var(--muted);
    font-weight: 400;
    margin-right: 4px;
  }
  .rm-cal-day-events { gap: 4px; }
  .rm-q-block { padding: 16px; }
  .rm-month-card { padding: 16px; }
  .rm-modal-body { padding: 12px 18px 20px; }
  .rm-modal-head { padding: 18px 20px 14px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
  .rm-q-block:hover, .rm-month-card:hover, .rm-m-tile:hover, .rm-cal-day:hover { transform: none; }
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
