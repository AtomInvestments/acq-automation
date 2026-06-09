"""
SMS A/B/C Test Dashboard generator → site/sms-test.html.

Reads sms_test_state.json (per-contact outcome rows) + o2_test_config.json (variants,
stopping rules, pause flag) and bakes a static HTML page. Static-bake choice (not a
worker route) because the data freshness window (30 min cron tick) is fine for a test
that runs for days/weeks, and it lets the page survive a Worker outage.

Visual identity matches the cream/gold/navy aesthetic per project_dashboard_suite.md.

Sections:
  - Status banner (paused / running, days running, total volume)
  - KPI strip per variant (sent / reply rate / qualify rate / contract rate)
  - Funnel viz (sent → reply → qualified → contract) side-by-side
  - Stat-sig indicator (Bayesian beta posteriors on contract rate)
  - Stopping rules block (documented here AND in o2_test_config.json)
"""
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

CONFIG_FILE = "o2_test_config.json"
STATE_FILE = "sms_test_state.json"
OUT = Path("site/sms-test.html")

# Bayesian: model each variant's contract rate as Beta(1+contracts, 1+sent-contracts).
# To declare a winner, the leading variant's posterior should put >= 95% of mass
# above the others'. We approximate via monte carlo (fast, robust to small N).
MC_SAMPLES = 5000


def load_json(path: str, default):
    if os.path.exists(path):
        try:
            return json.load(open(path))
        except Exception:
            return default
    return default


def now_utc():
    return datetime.now(timezone.utc)


def beta_sample(a: float, b: float) -> float:
    """Gamma-based Beta sample (avoids numpy dep)."""
    x = _gamma_sample(a)
    y = _gamma_sample(b)
    return x / (x + y) if (x + y) > 0 else 0.0


def _gamma_sample(shape: float) -> float:
    """Marsaglia & Tsang. shape >= 1 for accuracy; we always feed >= 1."""
    import random
    if shape < 1:
        shape += 1
    d = shape - 1.0 / 3
    c = 1.0 / math.sqrt(9 * d)
    while True:
        x = random.gauss(0, 1)
        v = (1 + c * x) ** 3
        if v <= 0:
            continue
        u = random.random()
        if u < 1 - 0.0331 * x ** 4:
            return d * v
        if math.log(u) < 0.5 * x * x + d * (1 - v + math.log(v)):
            return d * v


def bayes_winner_prob(variants: dict, metric_key: str) -> dict:
    """For each variant, return P(variant has the highest `metric_key` rate).

    variants: {'A': {'sent': N, metric_key: k, ...}, ...}
    Returns: {'A': 0.62, 'B': 0.21, 'C': 0.17}
    """
    keys = list(variants.keys())
    if not keys:
        return {}
    # Posterior Beta(1+success, 1+failure)
    params = {}
    for k, v in variants.items():
        s = v.get("sent", 0) or 0
        x = v.get(metric_key, 0) or 0
        params[k] = (1 + x, 1 + max(0, s - x))

    wins = {k: 0 for k in keys}
    for _ in range(MC_SAMPLES):
        draws = {k: beta_sample(a, b) for k, (a, b) in params.items()}
        winner = max(draws.keys(), key=lambda k: draws[k])
        wins[winner] += 1
    return {k: wins[k] / MC_SAMPLES for k in keys}


def aggregate() -> dict:
    cfg = load_json(CONFIG_FILE, {})
    state = load_json(STATE_FILE, {})

    g = cfg.get("global", {})
    paused = bool(g.get("sms_paused", True))
    min_sends = int(g.get("min_sends_per_variant", 200))
    decisive_pp = float(g.get("decisive_lead_pp", 3.0))
    decisive_n = int(g.get("decisive_min_per_variant", 500))
    time_cap = int(g.get("time_cap_days", 30))

    by_campaign = {}
    for cid, row in state.items():
        camp = row.get("campaign_id", "o2_entry_offer")
        v = (row.get("variant") or "").upper()
        if v not in ("A", "B", "C"):
            continue
        bucket = by_campaign.setdefault(camp, {})
        b = bucket.setdefault(v, {"sent": 0, "replied": 0, "qualified": 0, "appointment_set": 0, "contract": 0})
        if row.get("sent_at"):
            b["sent"] += 1
        if row.get("replied"):
            b["replied"] += 1
        if row.get("qualified"):
            b["qualified"] += 1
        if row.get("appointment_set"):
            b["appointment_set"] += 1
        if row.get("contract"):
            b["contract"] += 1

    return {
        "paused": paused,
        "min_sends": min_sends,
        "decisive_pp": decisive_pp,
        "decisive_n": decisive_n,
        "time_cap": time_cap,
        "campaigns_cfg": cfg.get("campaigns", {}),
        "campaigns_data": by_campaign,
        "generated_at": now_utc().isoformat(),
    }


def render_funnel_bar(label: str, n: int, total: int, color: str) -> str:
    pct = (n / total * 100) if total > 0 else 0
    return (
        f'<div class="funbar">'
        f'<div class="funbar-label">{label} <strong>{n}</strong> ({pct:.1f}%)</div>'
        f'<div class="funbar-track"><div class="funbar-fill" style="width:{pct:.1f}%;background:{color}"></div></div>'
        f'</div>'
    )


def render_variant_card(letter: str, data: dict, template: str) -> str:
    sent = data.get("sent", 0)
    replied = data.get("replied", 0)
    qualified = data.get("qualified", 0)
    contract = data.get("contract", 0)
    reply_rate = (replied / sent * 100) if sent else 0
    qual_rate = (qualified / sent * 100) if sent else 0
    contract_rate = (contract / sent * 100) if sent else 0

    return f"""
    <div class="vcard">
      <div class="vcard-head">
        <span class="vletter">{letter}</span>
        <span class="vrates">{reply_rate:.1f}% reply · {qual_rate:.1f}% qual · {contract_rate:.1f}% contract</span>
      </div>
      <div class="vtemplate">{template}</div>
      <div class="vfunnel">
        {render_funnel_bar('Sent', sent, sent or 1, 'var(--ink)')}
        {render_funnel_bar('Replied', replied, sent or 1, '#3B82F6')}
        {render_funnel_bar('Qualified', qualified, sent or 1, 'var(--gold)')}
        {render_funnel_bar('Contract', contract, sent or 1, 'var(--good)')}
      </div>
    </div>
    """


def render_significance(camp_data: dict, min_sends: int, decisive_pp: float, decisive_n: int) -> str:
    if not camp_data:
        return '<p class="muted">No data yet.</p>'
    win_probs_contract = bayes_winner_prob(camp_data, "contract")
    win_probs_qual = bayes_winner_prob(camp_data, "qualified")

    leader = max(camp_data.keys(), key=lambda k: win_probs_contract.get(k, 0))
    leader_p = win_probs_contract.get(leader, 0) * 100

    # Decisive-rule check
    sents = {k: v.get("sent", 0) for k, v in camp_data.items()}
    rates = {k: (v.get("contract", 0) / v.get("sent", 1) * 100 if v.get("sent") else 0) for k, v in camp_data.items()}
    sorted_by_rate = sorted(rates.items(), key=lambda kv: kv[1], reverse=True)
    decisive_msg = ""
    if len(sorted_by_rate) >= 2:
        first, second = sorted_by_rate[0], sorted_by_rate[1]
        lead_pp = first[1] - second[1]
        min_n = min(sents.values()) if sents else 0
        if lead_pp >= decisive_pp and min_n >= decisive_n:
            decisive_msg = f'<span class="pill pill-good">DECISIVE — {first[0]} leads by {lead_pp:.1f}pp at n={min_n}/variant</span>'
        elif min_n < min_sends:
            need = min_sends - min(sents.values())
            decisive_msg = f'<span class="pill pill-muted">Need {need} more sends to min sample (n={min_sends})</span>'
        else:
            decisive_msg = f'<span class="pill pill-muted">Not yet decisive — leader {first[0]} +{lead_pp:.1f}pp, want +{decisive_pp:.1f}pp at n={decisive_n}</span>'

    rows = []
    for k in sorted(camp_data.keys()):
        cp = win_probs_contract.get(k, 0) * 100
        qp = win_probs_qual.get(k, 0) * 100
        rows.append(
            f'<tr><td><strong>{k}</strong></td>'
            f'<td>{cp:.1f}%</td><td>{qp:.1f}%</td></tr>'
        )

    return f"""
    <div class="sig">
      <div class="sig-head">Bayesian winner probability (Monte Carlo, n={MC_SAMPLES})</div>
      <table class="sig-table">
        <thead><tr><th>Variant</th><th>P(best contract)</th><th>P(best qualify)</th></tr></thead>
        <tbody>{''.join(rows)}</tbody>
      </table>
      <div class="sig-foot">{decisive_msg}</div>
    </div>
    """


def render_html() -> str:
    agg = aggregate()
    paused = agg["paused"]
    cfg_campaigns = agg["campaigns_cfg"]
    data_campaigns = agg["campaigns_data"]

    # Pick the active campaign (one for now — multi-campaign extension renders one section per)
    sections = []
    for camp_id, cfg in cfg_campaigns.items():
        if not cfg.get("active"):
            continue
        camp_data = data_campaigns.get(camp_id, {})
        for letter in ("A", "B", "C"):
            camp_data.setdefault(letter, {"sent": 0, "replied": 0, "qualified": 0, "appointment_set": 0, "contract": 0})

        total_sent = sum(v["sent"] for v in camp_data.values())
        days_running = 0
        if cfg.get("started_at"):
            try:
                start = datetime.fromisoformat(cfg["started_at"].replace("Z", "+00:00"))
                days_running = (now_utc() - start).days
            except Exception:
                pass

        variant_cards = "\n".join(
            render_variant_card(letter, camp_data[letter], cfg["variants"][letter]["template"])
            for letter in ("A", "B", "C")
        )

        sig_html = render_significance(camp_data, agg["min_sends"], agg["decisive_pp"], agg["decisive_n"])

        sections.append(f"""
        <section>
          <h2><span class="num">01</span> {camp_id.replace('_', ' ').title()}</h2>
          <div class="kpi-strip">
            <div class="kpi"><div class="l">Total sent</div><div class="v">{total_sent}</div><div class="s">across A/B/C</div></div>
            <div class="kpi"><div class="l">Days running</div><div class="v">{days_running}</div><div class="s">of {agg['time_cap']}-day cap</div></div>
            <div class="kpi"><div class="l">Min per variant</div><div class="v">{min(v['sent'] for v in camp_data.values())}</div><div class="s">target {agg['min_sends']}</div></div>
            <div class="kpi"><div class="l">Status</div><div class="v" style="color:{'#B91C1C' if paused else 'var(--good)'}">{'PAUSED' if paused else 'LIVE'}</div><div class="s">{'flip sms_paused=false to fire sends' if paused else 'sends firing each cron tick'}</div></div>
          </div>
          <div class="variant-grid">
            {variant_cards}
          </div>
          {sig_html}
        </section>
        """)

    paused_banner = (
        '<div class="paused-banner">SMS sends are <strong>PAUSED</strong> per APG Q2 strategy. '
        'Test infrastructure is fully wired — variant assignment, outcome tracking, '
        'and dashboard rendering all run. Flip <code>o2_test_config.json::global.sms_paused</code> '
        'to <code>false</code> to begin firing sends. Variant assignments computed during the pause '
        'are deterministic and survive the flip.</div>'
        if paused else ''
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atom Property Group — SMS A/B/C Test</title>
<style>
:root {{
  --ink: #0A1F44; --ink-soft: #1A3A7A; --gold: #F5C518; --gold-soft: #FFE58A;
  --gold-wash: #FFF6D0; --cream: #FAF7EC; --cream-deep: #F3EED8; --paper: #FFFFFF;
  --rule: #C9C2A8; --rule-soft: #E5E0C8; --muted: #5A6786; --text: #101827;
  --good: #10B981; --bad: #B91C1C;
}}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; background: var(--cream); color: var(--text);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; }}
.shell {{ max-width: 1240px; margin: 0 auto; padding: 40px 64px 120px; background: var(--paper); min-height: 100vh; }}
@media (max-width: 820px) {{ .shell {{ padding: 32px 24px 80px; }} }}

.masthead {{ border-top: 5px solid var(--ink); border-bottom: 1px solid var(--rule);
  padding: 28px 0 24px; margin-bottom: 24px; position: relative; }}
.masthead::before {{ content: ""; position: absolute; left: 0; top: 0; width: 160px; height: 5px; background: var(--gold); }}
.brandrow {{ display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }}
.brand {{ color: var(--ink); font-weight: 700; }}
h1 {{ font-family: Georgia, "Times New Roman", serif; font-size: 54px; line-height: 1.04;
  letter-spacing: -0.015em; margin: 0 0 14px; color: var(--ink); font-weight: 700; }}
h1 .accent {{ color: var(--gold); font-style: italic; }}
.dek {{ font-family: Georgia, serif; font-style: italic; font-size: 18px;
  line-height: 1.5; color: var(--ink-soft); max-width: 820px; margin: 10px 0 0; }}

section {{ margin: 40px 0; }}
h2 {{ font-family: Georgia, serif; font-size: 26px; color: var(--ink);
  margin: 0 0 16px; padding-bottom: 10px; border-bottom: 2px solid var(--ink);
  letter-spacing: -0.01em; display: flex; align-items: center; gap: 14px; }}
h2 .num {{ display: inline-block; min-width: 34px; padding: 4px 10px;
  background: var(--gold); color: var(--ink); font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 12px; font-weight: 700; text-align: center; letter-spacing: 0.04em; }}

.kpi-strip {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px; margin: 24px 0; }}
.kpi {{ background: var(--cream); border: 1px solid var(--rule);
  border-left: 4px solid var(--gold); padding: 14px 18px; }}
.kpi .l {{ font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); font-weight: 700; }}
.kpi .v {{ font-family: Georgia, serif; font-size: 26px; color: var(--ink); margin-top: 6px; line-height: 1.1; }}
.kpi .s {{ font-size: 11px; color: var(--muted); margin-top: 4px; }}

.paused-banner {{ background: var(--gold-wash); border: 1px solid var(--gold);
  border-left: 4px solid var(--gold); padding: 14px 18px; margin: 16px 0 24px;
  font-size: 13.5px; line-height: 1.55; color: var(--ink); }}
.paused-banner code {{ background: #fff; border: 1px solid var(--rule); padding: 1px 6px; font-size: 12.5px; }}

.variant-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 16px 0; }}
@media (max-width: 980px) {{ .variant-grid {{ grid-template-columns: 1fr; }} }}
.vcard {{ background: var(--paper); border: 1px solid var(--rule); padding: 18px; display: flex; flex-direction: column; gap: 12px; }}
.vcard-head {{ display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }}
.vletter {{ font-family: Georgia, serif; font-size: 32px; color: var(--gold); font-weight: 700; }}
.vrates {{ font-size: 11px; letter-spacing: 0.06em; color: var(--muted); font-weight: 700; }}
.vtemplate {{ font-family: Georgia, serif; font-style: italic; font-size: 13.5px;
  line-height: 1.5; color: var(--ink-soft); background: var(--cream);
  border: 1px solid var(--rule-soft); padding: 10px 12px; }}
.vfunnel {{ display: flex; flex-direction: column; gap: 6px; }}
.funbar-label {{ font-size: 11px; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 2px; }}
.funbar-label strong {{ color: var(--ink); font-size: 12.5px; }}
.funbar-track {{ height: 8px; background: var(--cream-deep); border: 1px solid var(--rule-soft); position: relative; }}
.funbar-fill {{ height: 100%; transition: width 0.3s ease; }}

.sig {{ background: var(--cream); border: 1px solid var(--rule); padding: 16px 20px; margin: 16px 0; }}
.sig-head {{ font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px; font-weight: 700; }}
.sig-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
.sig-table th {{ text-align: left; color: var(--muted); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; padding: 6px 10px; border-bottom: 1px solid var(--rule); }}
.sig-table td {{ padding: 8px 10px; border-bottom: 1px dashed var(--rule-soft); }}
.sig-foot {{ margin-top: 12px; }}
.pill {{ display: inline-block; padding: 4px 10px; font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; font-weight: 700; }}
.pill-good {{ background: var(--good); color: #fff; }}
.pill-muted {{ background: var(--cream-deep); color: var(--ink); border: 1px solid var(--rule); }}
.muted {{ color: var(--muted); }}

.stopping {{ background: var(--cream); border: 1px solid var(--rule); padding: 16px 20px; margin: 16px 0; font-size: 13px; }}
.stopping h3 {{ font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; font-weight: 700; }}
.stopping ul {{ margin: 6px 0 0; padding-left: 22px; }}
.stopping li {{ margin: 4px 0; }}
.foot {{ margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--rule); font-size: 11px;
  color: var(--muted); letter-spacing: 0.06em; }}
</style>
</head>
<body>
<div class="shell">
  <div class="masthead">
    <div class="brandrow"><span class="brand">Atom Property Group</span><span>SMS A/B/C Test</span></div>
    <h1>O2 entry-offer <span class="accent">variants</span></h1>
    <p class="dek">Three first-touch SMS variants compete on the fresh inbound pool. Reply / qualify / contract tracked per variant. Bayesian decisive-rule indicator below.</p>
  </div>

  {paused_banner}

  {''.join(sections)}

  <section>
    <h2><span class="num">SR</span> Stopping rules</h2>
    <div class="stopping">
      <h3>Decision protocol</h3>
      <ul>
        <li><strong>Minimum sample:</strong> {agg['min_sends']} sends per variant before reading any results.</li>
        <li><strong>Decisive lead:</strong> if one variant beats the others on contract rate by ≥ {agg['decisive_pp']:.1f} percentage points at n ≥ {agg['decisive_n']}/variant, declare winner.</li>
        <li><strong>Time cap:</strong> {agg['time_cap']} days from first send. Declare based on data even if inconclusive — and note the inconclusion.</li>
        <li><strong>Bayesian read:</strong> P(best contract) reported per variant via Monte Carlo over Beta(1+x, 1+n-x) posteriors.</li>
      </ul>
      <p style="margin-top:10px;color:var(--muted);font-size:12px">Documented in <code>o2_test_config.json::global</code> and rendered above for visibility.</p>
    </div>
  </section>

  <div class="foot">Generated {agg['generated_at']} · sms_test_dashboard.py</div>
</div>
</body>
</html>"""


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    html = render_html()
    OUT.write_text(html, encoding="utf-8")
    print(f"[sms_test_dashboard] wrote {OUT} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
