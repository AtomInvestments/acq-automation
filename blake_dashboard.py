"""Generate site/blake.html — a live dashboard of Blake's outbound + inbound calls.

Pulls data from:
  - ElevenLabs Conversational AI:  /v1/convai/conversations?agent_id=...
  - GHL:                            /contacts/{id} (for name/address per call)
  - acq-automation Worker:          /dial-status (warm-up state)

Designed to be rendered by the existing GitHub Actions cron (sms.yml) every
30 min and pushed to gh-pages alongside the other dashboards.

Env required:
  ELEVENLABS_API_KEY    ElevenLabs account API key
  BLAKE_GHL_PIT         GHL Private Integration Token for APG sub-account

Output:
  site/blake.html
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from html import escape
from zoneinfo import ZoneInfo

BLAKE_AGENT_ID = "agent_5001ks3cp069f9rtfz6e81ypgnrd"
BLAKE_PHONE = "+16099449034"
APG_LOCATION_ID = "RCkiUmWqXX4BYQ39JXmm"
WORKER_BASE = "https://acq-automation.mithchell.workers.dev"
EL_API = "https://api.elevenlabs.io/v1"
GHL_API = "https://services.leadconnectorhq.com"

ET = ZoneInfo("America/New_York")
HTTP_TIMEOUT = 30


def http_get(url: str, headers: dict) -> dict | None:
    req = urllib.request.Request(url, headers={**headers, "User-Agent": "blake-dashboard"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print(f"  [{url[:60]}] HTTP {e.code}: {e.read()[:200]!r}", file=sys.stderr)
    except Exception as e:
        print(f"  [{url[:60]}] {type(e).__name__}: {e}", file=sys.stderr)
    return None


def fetch_conversations(el_key: str, page_size: int = 100) -> list[dict]:
    """List recent Blake conversations from ElevenLabs."""
    url = f"{EL_API}/convai/conversations?agent_id={BLAKE_AGENT_ID}&page_size={page_size}"
    data = http_get(url, {"xi-api-key": el_key})
    if not data:
        return []
    return data.get("conversations", []) or []


def fetch_conversation_detail(el_key: str, conv_id: str) -> dict | None:
    """Get full conversation including transcript + metadata."""
    return http_get(f"{EL_API}/convai/conversations/{conv_id}", {"xi-api-key": el_key})


def fetch_ghl_contact(pit: str, contact_id: str) -> dict | None:
    """Lookup GHL contact by id."""
    data = http_get(
        f"{GHL_API}/contacts/{contact_id}",
        {"Authorization": f"Bearer {pit}", "Version": "2021-07-28"},
    )
    return (data or {}).get("contact") if data else None


def find_ghl_contact_by_phone(pit: str, phone: str) -> dict | None:
    """Search GHL by phone."""
    if not phone:
        return None
    req = urllib.request.Request(
        f"{GHL_API}/contacts/search",
        data=json.dumps(
            {"locationId": APG_LOCATION_ID, "query": phone, "pageLimit": 1}
        ).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {pit}",
            "Version": "2021-07-28",
            "Content-Type": "application/json",
            "User-Agent": "blake-dashboard",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            data = json.loads(r.read())
            return (data.get("contacts") or [None])[0]
    except Exception as e:
        print(f"  [GHL search {phone}] {type(e).__name__}: {e}", file=sys.stderr)
        return None


def fetch_dial_status() -> dict:
    """Pull warm-up state from the Worker (public, no auth needed)."""
    data = http_get(f"{WORKER_BASE}/dial-status", {})
    return data or {}


def classify_outcome(conv_detail: dict) -> tuple[str, str]:
    """Best-effort classification of call outcome.

    Returns (tag, label) where tag is one of: hot, warm, cold, dnd, voicemail,
    no-answer, hangup, unknown.
    """
    if not conv_detail:
        return ("unknown", "Unknown")

    analysis = conv_detail.get("analysis", {}) or {}
    summary = (analysis.get("transcript_summary") or "").lower()
    call_successful = analysis.get("call_successful") or "unknown"

    # Look for explicit signal in summary
    if any(w in summary for w in ["hot lead", "ready to sell", "very interested"]):
        return ("hot", "Hot Lead")
    if any(w in summary for w in ["not interested", "no thanks", "pass"]):
        return ("cold", "Not Interested")
    if any(w in summary for w in ["do not call", "stop calling", "dnc", "take me off"]):
        return ("dnd", "DNC Requested")
    if "voicemail" in summary or "leave a message" in summary:
        return ("voicemail", "Voicemail")
    if "hung up" in summary:
        return ("hangup", "Hung Up")

    metadata = conv_detail.get("metadata", {}) or {}
    dur = metadata.get("call_duration_secs") or 0
    if dur and dur < 15:
        return ("no-answer", "No Answer / Short")

    if call_successful == "success":
        return ("warm", "Engaged")

    return ("unknown", "Completed")


# ─────────────────────────────────────────────────────────────────────────────
# Rendering
# ─────────────────────────────────────────────────────────────────────────────


HTML_TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG ACQ — Blake Calls Dashboard</title>
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
  --rule-soft: #E5E0C8;
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
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 16px; flex-wrap: wrap; gap: 8px;
}
.brand { color: var(--ink); font-weight: 700; }
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

section { margin: 40px 0; }
h2 {
  font-family: Georgia, serif; font-size: 26px; color: var(--ink);
  margin: 0 0 16px; padding-bottom: 10px; border-bottom: 2px solid var(--ink);
  letter-spacing: -0.01em; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
h2 .num {
  display: inline-block; min-width: 34px; padding: 4px 10px;
  background: var(--gold); color: var(--ink);
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 12px; font-weight: 700; text-align: center; letter-spacing: 0.04em;
}
h2 .sec-count { margin-left: auto; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); font-weight: 700; }

.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 18px; }
@media (max-width: 1100px) { .kpi-row { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 600px)  { .kpi-row { grid-template-columns: repeat(2, 1fr); } }
.kpi {
  background: var(--cream); border-top: 4px solid var(--gold);
  border-bottom: 1px solid var(--rule); padding: 16px 18px 18px;
}
.kpi .label {
  font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px; font-weight: 700;
}
.kpi .v {
  font-family: Georgia, serif; font-size: 32px; font-weight: 700;
  color: var(--ink); line-height: 1; margin: 0;
}
.kpi .v small { font-size: 14px; color: var(--muted); margin-left: 6px; }
.kpi.live   { border-top-color: var(--s-live); } .kpi.live .v   { color: var(--s-live); }
.kpi.warm   { border-top-color: var(--s-warm); } .kpi.warm .v   { color: var(--s-warm); }
.kpi.uc     { border-top-color: var(--s-uc); }   .kpi.uc .v     { color: var(--s-uc); }
.kpi.sub    { font-size: 11px; color: var(--muted); margin-top: 4px; }

.warmup-panel {
  background: var(--cream); border-left: 4px solid var(--gold);
  padding: 18px 22px; margin-top: 14px;
}
.warmup-panel h3 {
  font-family: Georgia, serif; font-size: 18px; margin: 0 0 8px; color: var(--ink);
}
.warmup-bar {
  height: 22px; background: var(--cream-deep); border: 1px solid var(--rule);
  border-radius: 3px; position: relative; overflow: hidden; margin-top: 10px;
}
.warmup-bar .fill {
  height: 100%; background: var(--gold);
  display: flex; align-items: center; justify-content: center;
  color: var(--ink); font-weight: 700; font-size: 11px; letter-spacing: 0.06em;
}
.warmup-grid { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; margin-top: 12px; }
.warmup-grid .day {
  height: 26px; background: var(--cream-deep); border: 1px solid var(--rule);
  font-size: 9.5px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  color: var(--muted); position: relative;
}
.warmup-grid .day.today { background: var(--gold); color: var(--ink); }
.warmup-grid .day.past  { background: var(--ink); color: var(--gold); }

.calls-table {
  width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 14px;
}
.calls-table th {
  text-align: left; padding: 10px 12px; background: var(--ink); color: var(--gold);
  font-family: Helvetica, Arial, sans-serif; font-size: 9.5px;
  letter-spacing: 0.10em; text-transform: uppercase; font-weight: 800;
}
.calls-table td {
  padding: 12px 12px; border-bottom: 1px solid var(--rule); vertical-align: top;
}
.calls-table tr:hover td { background: var(--cream); }
.outcome {
  display: inline-block; padding: 2px 8px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.06em; text-transform: uppercase; border-radius: 3px;
}
.outcome.hot      { background: rgba(185,28,28,0.15); color: var(--s-uc); }
.outcome.warm     { background: rgba(234,88,12,0.18); color: #7C2D12; }
.outcome.cold     { background: rgba(91,103,134,0.18); color: #334155; }
.outcome.dnd      { background: var(--ink); color: var(--gold); }
.outcome.voicemail{ background: var(--gold-wash); color: var(--ink); }
.outcome.hangup   { background: rgba(234,179,8,0.20); color: #713F12; }
.outcome.no-answer{ background: var(--cream-deep); color: var(--muted); }
.outcome.unknown  { background: var(--cream-deep); color: var(--muted); }

.caller { font-weight: 700; color: var(--ink); }
.addr { color: var(--muted); font-size: 12px; margin-top: 2px; }
.summary { font-size: 13px; color: #2b3856; max-width: 480px; }
.ts { white-space: nowrap; font-family: ui-monospace, monospace; color: var(--muted); font-size: 12px; }
.duration { font-family: ui-monospace, monospace; font-size: 12px; color: var(--ink); white-space: nowrap; }

.actions a { font-size: 11px; padding: 4px 8px; background: var(--ink); color: var(--gold); text-decoration: none; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-right: 4px; }
.actions a:hover { background: var(--gold); color: var(--ink); }

.empty { text-align: center; color: var(--muted); padding: 36px; font-style: italic; background: var(--cream); border: 1px dashed var(--rule); }

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
      <span class="brand">Atom Property Group · AI Operations</span>
      <span>{header_meta}</span>
    </div>
    <h1>Blake <span class="accent">Live.</span></h1>
    <p class="dek">Real-time view of every call Blake — APG's AI voice agent — has handled. Auto-refreshes every 30 minutes via the cron pipeline.</p>
  </header>

  <nav class="topnav">
    <a href="index.html">Follow-Ups</a>
    <a href="deals.html">Deals</a>
    <a href="weekly.html">Weekly</a>
    <a href="priorities.html">Priority</a>
    <a href="markets.html">Markets</a>
    <a href="blake.html" class="active">Blake</a>
    <a href="ai-agents-plan.html">AI Agents Plan</a>
    <a href="about.html">About</a>
  </nav>

  <section>
    <h2><span class="num">00</span>At a Glance</h2>
    <div class="kpi-row">
      <div class="kpi live"><div class="label">Calls Today</div><p class="v">{calls_today}</p><div class="sub">UTC day</div></div>
      <div class="kpi"><div class="label">Calls This Week</div><p class="v">{calls_week}</p><div class="sub">last 7 days</div></div>
      <div class="kpi"><div class="label">Total Calls</div><p class="v">{calls_total}</p><div class="sub">all time</div></div>
      <div class="kpi warm"><div class="label">Avg Duration</div><p class="v">{avg_duration}<small>s</small></p><div class="sub">across calls</div></div>
      <div class="kpi uc"><div class="label">Hot Leads</div><p class="v">{hot_count}</p><div class="sub">flagged hot</div></div>
      <div class="kpi"><div class="label">Engaged Rate</div><p class="v">{engaged_pct}<small>%</small></p><div class="sub">non-voicemail / total</div></div>
    </div>
  </section>

  <section>
    <h2><span class="num">01</span>Warm-Up State</h2>
    <div class="warmup-panel">
      <h3>Day {warmup_day} of the warm-up curve</h3>
      <p style="color:var(--muted);font-size:13px;margin:0 0 4px">
        Today's cap: <strong style="color:var(--ink)">{warmup_quota}</strong> calls ·
        Dialed so far today: <strong style="color:var(--ink)">{warmup_dialed}</strong> ·
        Remaining: <strong style="color:var(--ink)">{warmup_remaining}</strong>
      </p>
      <div class="warmup-bar"><div class="fill" style="width:{warmup_pct}%;">{warmup_pct}%</div></div>
      <div class="warmup-grid">{warmup_grid}</div>
      <p style="font-size:11px;color:var(--muted);margin-top:10px;letter-spacing:0.06em;text-transform:uppercase">
        Steady state (Day 14+): 300 calls / day. Anchor: {warmup_anchor}
      </p>
    </div>
  </section>

  <section>
    <h2><span class="num">02</span>Recent Calls<span class="sec-count">{recent_count} shown</span></h2>
    {calls_block}
  </section>

  <div class="footer">
    <span>Auto-refreshed every 30 min · APG ACQ Operating Layer</span>
    <span class="gold-stamp">Blake · Live</span>
  </div>

</div>
</body>
</html>
"""


def fmt_duration(secs: int | None) -> str:
    if not secs:
        return "—"
    secs = int(secs)
    if secs < 60:
        return f"{secs}s"
    return f"{secs // 60}m {secs % 60:02d}s"


def fmt_ts_et(unix_ts: int | None) -> str:
    if not unix_ts:
        return ""
    try:
        dt = datetime.fromtimestamp(int(unix_ts), tz=timezone.utc).astimezone(ET)
        return dt.strftime("%b %d, %I:%M %p ET")
    except Exception:
        return ""


def main():
    el_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    pit = os.environ.get("BLAKE_GHL_PIT", "").strip()
    if not el_key:
        print("ERROR: ELEVENLABS_API_KEY required", file=sys.stderr)
        return 2
    if not pit:
        print("ERROR: BLAKE_GHL_PIT required", file=sys.stderr)
        return 2

    print("Fetching dial-status from Worker...")
    dial_status = fetch_dial_status()

    print("Fetching conversations from ElevenLabs...")
    conversations = fetch_conversations(el_key, page_size=50)
    print(f"  found {len(conversations)} conversations")

    # Hydrate each — fetch full detail (with rate-limit nap between calls)
    enriched = []
    for c in conversations[:50]:
        conv_id = c.get("conversation_id")
        if not conv_id:
            continue
        detail = fetch_conversation_detail(el_key, conv_id)
        if not detail:
            enriched.append({"summary_only": c, "detail": None, "contact": None, "outcome": ("unknown", "Unknown")})
            continue

        metadata = detail.get("metadata", {}) or {}
        start_unix = metadata.get("start_time_unix_secs") or 0
        duration_secs = metadata.get("call_duration_secs") or 0

        # Try to extract caller phone
        phone_call = metadata.get("phone_call") or {}
        caller_phone = (
            phone_call.get("external_number")
            or metadata.get("phone_number")
            or ""
        )

        contact = find_ghl_contact_by_phone(pit, caller_phone) if caller_phone else None
        outcome = classify_outcome(detail)

        analysis = detail.get("analysis", {}) or {}
        summary = analysis.get("transcript_summary") or ""

        enriched.append({
            "conv_id": conv_id,
            "start_unix": start_unix,
            "duration_secs": duration_secs,
            "caller_phone": caller_phone,
            "contact": contact,
            "outcome": outcome,
            "summary": summary,
        })

        time.sleep(0.1)  # gentle rate limiting

    # Sort newest-first
    enriched.sort(key=lambda x: x.get("start_unix") or 0, reverse=True)

    # Aggregate stats
    now_utc = datetime.now(timezone.utc)
    today_utc_start = int(datetime(now_utc.year, now_utc.month, now_utc.day, tzinfo=timezone.utc).timestamp())
    week_start = int((now_utc - timedelta(days=7)).timestamp())

    calls_today = sum(1 for e in enriched if (e.get("start_unix") or 0) >= today_utc_start)
    calls_week = sum(1 for e in enriched if (e.get("start_unix") or 0) >= week_start)
    calls_total = len(enriched)
    durations = [e["duration_secs"] for e in enriched if e.get("duration_secs")]
    avg_duration = int(sum(durations) / len(durations)) if durations else 0
    hot_count = sum(1 for e in enriched if e["outcome"][0] == "hot")
    engaged = sum(1 for e in enriched if e["outcome"][0] in ("hot", "warm"))
    engaged_pct = int(engaged * 100 / calls_total) if calls_total else 0

    # Warm-up
    warmup_day = (dial_status.get("day_index") or 0) + 1
    warmup_quota = dial_status.get("daily_quota") or 0
    warmup_dialed = dial_status.get("dialed_today") or 0
    warmup_remaining = dial_status.get("remaining_today") or 0
    warmup_pct = int(warmup_dialed * 100 / max(1, warmup_quota))
    warmup_anchor = dial_status.get("anchor_date") or "—"

    # Warm-up 14-day visual grid
    warmup_grid_parts = []
    for d in range(1, 15):
        cls = "today" if d == warmup_day else ("past" if d < warmup_day else "")
        warmup_grid_parts.append(f'<div class="day {cls}">D{d}</div>')
    warmup_grid = "".join(warmup_grid_parts)

    # Render calls table
    if enriched:
        rows = []
        for e in enriched:
            ts = fmt_ts_et(e.get("start_unix"))
            dur = fmt_duration(e.get("duration_secs"))
            outcome_tag, outcome_label = e["outcome"]
            phone = e.get("caller_phone") or "—"
            contact = e.get("contact") or {}
            name = (
                (contact.get("firstName") or "") + " " + (contact.get("lastName") or "")
            ).strip() or contact.get("contactName") or "(not in GHL)"
            addr_parts = [contact.get("address1") or "", contact.get("city") or "", contact.get("state") or ""]
            addr = ", ".join(p for p in addr_parts if p) or "—"
            summary_clip = (e.get("summary") or "")[:200] + ("..." if len(e.get("summary") or "") > 200 else "")

            ghl_link = (
                f"https://app.gohighlevel.com/v2/location/{APG_LOCATION_ID}/contacts/detail/{contact.get('id')}"
                if contact and contact.get("id") else ""
            )
            el_link = f"https://elevenlabs.io/app/conversational-ai/agents/{BLAKE_AGENT_ID}/history/{e.get('conv_id','')}"

            rows.append(f"""
            <tr>
              <td class="ts">{escape(ts)}</td>
              <td>
                <div class="caller">{escape(name)}</div>
                <div class="addr">{escape(addr)} · {escape(phone)}</div>
              </td>
              <td><span class="outcome {outcome_tag}">{escape(outcome_label)}</span></td>
              <td class="duration">{escape(dur)}</td>
              <td><div class="summary">{escape(summary_clip)}</div></td>
              <td class="actions">
                <a href="{escape(el_link)}" target="_blank">Transcript</a>
                {('<a href="' + escape(ghl_link) + '" target="_blank">GHL</a>') if ghl_link else ''}
              </td>
            </tr>""")

        calls_block = f"""
        <table class="calls-table">
          <thead>
            <tr>
              <th style="width:140px">When</th>
              <th>Caller</th>
              <th style="width:120px">Outcome</th>
              <th style="width:90px">Duration</th>
              <th>Summary</th>
              <th style="width:140px">Links</th>
            </tr>
          </thead>
          <tbody>{''.join(rows)}</tbody>
        </table>"""
    else:
        calls_block = '<div class="empty">No calls yet. Once Blake starts dialing, calls will appear here within ~5 minutes of completion.</div>'

    header_meta = f"Updated {datetime.now(ET).strftime('%b %d, %Y · %I:%M %p ET')}"

    # Use literal-string .replace() instead of str.format() — the CSS in the
    # template contains '{...}' braces (CSS rule blocks) that collide with
    # format placeholder syntax and raise KeyError.
    substitutions = {
        "{header_meta}":      escape(header_meta),
        "{calls_today}":      str(calls_today),
        "{calls_week}":       str(calls_week),
        "{calls_total}":      str(calls_total),
        "{avg_duration}":     str(avg_duration),
        "{hot_count}":        str(hot_count),
        "{engaged_pct}":      str(engaged_pct),
        "{warmup_day}":       str(warmup_day),
        "{warmup_quota}":     str(warmup_quota),
        "{warmup_dialed}":    str(warmup_dialed),
        "{warmup_remaining}": str(warmup_remaining),
        "{warmup_pct}":       str(warmup_pct),
        "{warmup_anchor}":    escape(warmup_anchor),
        "{warmup_grid}":      warmup_grid,
        "{recent_count}":     str(len(enriched)),
        "{calls_block}":      calls_block,
    }
    html = HTML_TEMPLATE
    for placeholder, value in substitutions.items():
        html = html.replace(placeholder, value)

    os.makedirs("site", exist_ok=True)
    out = "site/blake.html"
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Wrote {out} ({len(html)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
