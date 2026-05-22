"""Generate site/progress.html — APG project tracker dashboard.

Reads progress_state.json (committed to repo) and renders an Obsidian-styled
HTML page showing active plans + checkbox completion across all four pillars
+ infrastructure. Designed to be regenerated on every sms.yml cron tick so
the page reflects the latest committed state.

To update progress: edit progress_state.json, commit, push. The next sms.yml
run regenerates the page.
"""
import json
import os
import sys
from datetime import datetime
from html import escape
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG ACQ — Project Tracker</title>
<style>
:root {
  --ink: #0A1F44;
  --ink-deep: #061331;
  --ink-soft: #1A3A7A;
  --gold: #F5C518;
  --gold-soft: #FFE58A;
  --gold-wash: #FFF6D0;
  --cream: #FAF7EC;
  --cream-deep: #F3EED8;
  --paper: #FFFFFF;
  --rule: #C9C2A8;
  --muted: #5A6786;
  --muted-soft: #8A93AA;
  --text: #101827;
  --s-uc:   #B91C1C;
  --s-live: #10B981;
  --s-warm: #EA580C;
  --s-hold: #EAB308;
  --s-dead: #6B625A;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; background: var(--cream); color: var(--text);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 16px; line-height: 1.6;
}
.shell {
  max-width: 1240px; margin: 0 auto;
  padding: 40px 64px 120px;
  background: var(--paper); min-height: 100vh;
}
@media (max-width: 820px) { .shell { padding: 32px 24px 80px; } }

.masthead {
  border-top: 5px solid var(--ink);
  border-bottom: 1px solid var(--rule);
  padding: 28px 0 24px; margin-bottom: 24px; position: relative;
}
.masthead::before {
  content: ""; position: absolute; left: 0; top: 0;
  width: 160px; height: 5px; background: var(--gold);
}
.brandrow {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 16px; flex-wrap: wrap; gap: 8px;
}
h1 {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 54px; line-height: 1.04; letter-spacing: -0.015em;
  margin: 0 0 14px; color: var(--ink); font-weight: 700;
}
h1 .accent { color: var(--gold); font-style: italic; }
.dek {
  font-family: Georgia, serif; font-style: italic; font-size: 18px;
  line-height: 1.5; color: var(--ink-soft); max-width: 780px; margin: 10px 0 0;
}

.topnav {
  position: sticky; top: 0; z-index: 50;
  background: rgba(250, 247, 236, 0.96); backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--rule);
  margin: 0 -64px 28px; padding: 10px 64px;
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--muted);
  display: flex; gap: 18px; overflow-x: auto; white-space: nowrap;
}
@media (max-width: 820px) { .topnav { margin: 0 -24px 24px; padding: 10px 24px; } }
.topnav a { color: var(--ink-soft); text-decoration: none; font-weight: 700; padding: 4px 0; border-bottom: 2px solid transparent; }
.topnav a:hover, .topnav a.active { color: var(--ink); border-bottom: 2px solid var(--gold); }

.summary-row {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 18px 0 32px;
}
@media (max-width: 1100px) { .summary-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px)  { .summary-row { grid-template-columns: repeat(2, 1fr); } }
.summary-kpi {
  background: var(--cream); border-top: 4px solid var(--gold);
  border-bottom: 1px solid var(--rule); padding: 14px 16px 16px;
}
.summary-kpi .label {
  font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px; font-weight: 700;
}
.summary-kpi .v {
  font-family: Georgia, serif; font-size: 28px; font-weight: 700;
  color: var(--ink); line-height: 1; margin: 0;
}
.summary-kpi .v small { font-size: 14px; color: var(--muted); margin-left: 6px; }
.summary-kpi.live { border-top-color: var(--s-live); } .summary-kpi.live .v { color: var(--s-live); }
.summary-kpi.warm { border-top-color: var(--s-warm); } .summary-kpi.warm .v { color: var(--s-warm); }

.pillar {
  border-top: 1px solid var(--rule);
  padding: 32px 0;
}
.pillar:first-of-type { border-top: 0; padding-top: 0; }

.pillar-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 14px; gap: 18px; flex-wrap: wrap;
}
.pillar h2 {
  font-family: Georgia, serif; font-size: 24px; color: var(--ink);
  margin: 0; padding: 0; border: 0; letter-spacing: -0.01em;
  display: flex; align-items: center; gap: 12px;
}
.status-pill {
  font-family: Helvetica, Arial, sans-serif;
  font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
  text-transform: uppercase; padding: 3px 10px; border-radius: 3px;
}
.status-pill.active     { background: var(--s-live); color: white; }
.status-pill.in-progress{ background: var(--gold); color: var(--ink); }
.status-pill.planned    { background: var(--cream-deep); color: var(--muted); border: 1px solid var(--rule); }

.progress-bar {
  flex: 0 0 200px; height: 8px; background: var(--cream-deep);
  border-radius: 4px; overflow: hidden; position: relative; margin-top: 8px;
}
.progress-bar .fill {
  height: 100%; background: var(--gold); border-radius: 4px;
  transition: width 0.4s;
}
.progress-bar.complete .fill { background: var(--s-live); }
.progress-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase;
  color: var(--muted); margin-top: 4px;
}

.pillar .summary {
  font-family: Georgia, serif; font-style: italic; font-size: 14.5px;
  color: var(--ink-soft); padding: 8px 0 4px 16px;
  border-left: 3px solid var(--gold); margin-bottom: 18px;
  max-width: 880px;
}

.tasks {
  list-style: none; padding: 0; margin: 0;
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px;
}
@media (max-width: 820px) { .tasks { grid-template-columns: 1fr; } }
.task {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 0; border-bottom: 1px dashed var(--rule);
  font-size: 14px; line-height: 1.45;
}
.task .checkbox {
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 3px;
  border: 1.5px solid var(--muted-soft); margin-top: 2px;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; color: white;
}
.task.done .checkbox {
  background: var(--s-live); border-color: var(--s-live);
}
.task.done .checkbox::after { content: "✓"; }
.task.done .label { color: var(--muted); text-decoration: line-through; }

.footer {
  margin-top: 56px; padding-top: 20px;
  border-top: 3px double var(--ink);
  display: flex; justify-content: space-between;
  font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--muted); font-weight: 700; flex-wrap: wrap; gap: 12px;
}
.footer .gold-stamp { display: inline-block; padding: 4px 10px; background: var(--gold); color: var(--ink); letter-spacing: 0.14em; }
</style>
</head>
<body>
<div class="shell">

  <header class="masthead">
    <div class="brandrow">
      <img src="logo.svg" alt="Atom Property Group" style="height:32px;width:auto">
      <span>Updated {updated_at}</span>
    </div>
    <h1>Project <span class="accent">Tracker.</span></h1>
    <p class="dek">Every active plan APG is shipping right now, with live checkbox state. Source of truth is <code>progress_state.json</code> in the repo — edit, commit, push, and this page re-renders on the next cron tick.</p>
  </header>

  <nav class="topnav">
    <a href="index.html">Follow-Ups</a>
    <a href="deals.html">Deals</a>
    <a href="weekly.html">Weekly</a>
    <a href="priorities.html">Priority</a>
    <a href="markets.html">Markets</a>
    <a href="blake.html">Blake</a>
    <a href="progress.html" class="active">Progress</a>
    <a href="ai-agents-plan.html">AI Agents Plan</a>
    <a href="about.html">About</a>
  </nav>

  <div class="summary-row">
    {summary_kpis}
  </div>

  {pillars_html}

  <div class="footer">
    <span>Auto-generated from progress_state.json · APG ACQ Operating Layer</span>
    <span class="gold-stamp">Tracker · Live</span>
  </div>

</div>
</body>
</html>
"""


def render_pillar(pillar: dict) -> str:
    name = escape(pillar.get("name", ""))
    status = pillar.get("status", "planned")
    status_class = status
    status_label = status.replace("-", " ").upper()
    summary = escape(pillar.get("summary", ""))
    tasks = pillar.get("tasks", []) or []

    done_count = sum(1 for t in tasks if t.get("done"))
    total = len(tasks)
    pct = int(done_count * 100 / max(1, total))
    bar_class = "progress-bar complete" if pct == 100 else "progress-bar"

    task_lis = []
    for t in tasks:
        cls = "task done" if t.get("done") else "task"
        label = escape(t.get("label", ""))
        task_lis.append(f'<li class="{cls}"><span class="checkbox"></span><span class="label">{label}</span></li>')
    tasks_html = "\n".join(task_lis)

    return f'''
    <section class="pillar">
      <div class="pillar-header">
        <h2>{name} <span class="status-pill {status_class}">{status_label}</span></h2>
        <div>
          <div class="{bar_class}"><div class="fill" style="width:{pct}%"></div></div>
          <div class="progress-label">{done_count} / {total} done · {pct}%</div>
        </div>
      </div>
      <p class="summary">{summary}</p>
      <ul class="tasks">
        {tasks_html}
      </ul>
    </section>
    '''


def render_summary_kpis(state: dict) -> str:
    pillars = state.get("pillars", [])
    total_tasks = sum(len(p.get("tasks", [])) for p in pillars)
    done_tasks = sum(sum(1 for t in p.get("tasks", []) if t.get("done")) for p in pillars)
    pct = int(done_tasks * 100 / max(1, total_tasks))
    active = sum(1 for p in pillars if p.get("status") == "active")
    in_progress = sum(1 for p in pillars if p.get("status") == "in-progress")
    planned = sum(1 for p in pillars if p.get("status") == "planned")

    return f'''
      <div class="summary-kpi live"><div class="label">Overall Completion</div><p class="v">{pct}<small>%</small></p></div>
      <div class="summary-kpi"><div class="label">Tasks Done</div><p class="v">{done_tasks}<small> / {total_tasks}</small></p></div>
      <div class="summary-kpi live"><div class="label">Active Pillars</div><p class="v">{active}</p></div>
      <div class="summary-kpi warm"><div class="label">In Progress</div><p class="v">{in_progress}</p></div>
      <div class="summary-kpi"><div class="label">Planned</div><p class="v">{planned}</p></div>
    '''


def main():
    state_path = "progress_state.json"
    if not os.path.exists(state_path):
        print(f"ERROR: {state_path} not found", file=sys.stderr)
        return 2
    with open(state_path, "r", encoding="utf-8") as f:
        state = json.load(f)

    pillars_html = "\n".join(render_pillar(p) for p in state.get("pillars", []))
    summary_kpis = render_summary_kpis(state)
    updated = datetime.now(ET).strftime("%b %d, %Y · %I:%M %p ET")

    html = (HTML_TEMPLATE
            .replace("{summary_kpis}", summary_kpis)
            .replace("{pillars_html}", pillars_html)
            .replace("{updated_at}", escape(updated)))

    os.makedirs("site", exist_ok=True)
    out = "site/progress.html"
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Wrote {out} ({len(html)} bytes) — {len(state.get('pillars', []))} pillars rendered")
    return 0


if __name__ == "__main__":
    sys.exit(main())
