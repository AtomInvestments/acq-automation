"""Cluster scraped Airbnb guest messages, then write proposed quick-reply
templates that match Mido's historical reply tone.

Input:  airbnb-messages-YYYY-MM-DD.json (output of scrape.py)
Output: airbnb-quickreplies-proposed-YYYY-MM-DD.md (review + paste into Airbnb)

Two LLM calls per cluster category:
  1. Classify each guest message → cluster slug (Claude Haiku, cheap+fast)
  2. For each cluster, write a template that sounds like the host's
     historical replies in that cluster (Claude Sonnet, single call)

Usage:
    $env:ANTHROPIC_API_KEY = "sk-ant-..."
    python analyze.py airbnb-messages-2026-06-09.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from anthropic import Anthropic
except ImportError:
    print("ERROR: pip install anthropic", file=sys.stderr)
    sys.exit(2)


HERE = Path(__file__).resolve().parent

# Matches the 12 categories visible in Airbnb's `Manage quick replies` UI.
CLUSTERS: list[tuple[str, str]] = [
    ("wifi", "Wifi password / network name / connection trouble"),
    ("sleeping_arrangement", "How many beds, bed configuration, sleeps how many"),
    ("directions_transport", "Driving directions, public transit, parking, airport pickup"),
    ("checkin_early", "Can I check in earlier than the standard time?"),
    ("checkin_standard", "Standard check-in process, lockbox code, keys, doors"),
    ("checkin_late", "Arriving late at night, after-hours check-in"),
    ("checkout_instructions", "How do I checkout, where do I leave keys, what to clean"),
    ("checkout_late", "Can I check out later than standard?"),
    ("listing_availability", "Is the listing available on X dates? Pricing for a stay"),
    ("after_departure", "Forgotten item, review request, follow-up after they left"),
    ("after_first_night", "How was your first night, any issues?"),
    ("before_checkout", "Reminder of checkout day, last-night message"),
    ("before_checkin", "Pre-arrival message, looking-forward note"),
    ("booking_confirmation", "Thanks for booking, here's what to expect"),
    ("other", "Anything that doesn't fit the categories above"),
]
CLUSTER_LOOKUP = {slug: desc for slug, desc in CLUSTERS}
CLUSTER_SLUGS = [slug for slug, _ in CLUSTERS]


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def load_scraped(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Pair extraction
# ---------------------------------------------------------------------------


def extract_qa_pairs(data: dict[str, Any]) -> list[dict[str, str]]:
    """For each guest message, find the next host message in the same thread
    and pair them. We use these pairs for tone-matching templates."""
    pairs: list[dict[str, str]] = []
    for thread in data.get("threads", []):
        guest = thread.get("guest_name", "")
        messages = thread.get("messages", [])
        for i, m in enumerate(messages):
            if m.get("sender") != "guest":
                continue
            guest_text = (m.get("text") or "").strip()
            if not guest_text:
                continue
            # Look ahead for the host's reply in the same thread.
            host_reply = ""
            for j in range(i + 1, len(messages)):
                if messages[j].get("sender") == "host":
                    host_reply = (messages[j].get("text") or "").strip()
                    break
            pairs.append({
                "thread_id": thread.get("thread_id", ""),
                "guest_name": guest,
                "guest_text": guest_text,
                "host_reply": host_reply,
                "listing": thread.get("listing", ""),
            })
    return pairs


# ---------------------------------------------------------------------------
# Claude calls
# ---------------------------------------------------------------------------


def classify_messages(client: Anthropic, pairs: list[dict[str, str]]) -> list[str]:
    """Returns a list of cluster slugs aligned to pairs. Uses Haiku because
    the per-call cost matters when there are 300+ pairs."""
    slugs: list[str] = []
    # Batch in groups of 30 so Haiku context stays small and parse is cheap.
    BATCH = 30
    for i in range(0, len(pairs), BATCH):
        chunk = pairs[i:i + BATCH]
        numbered = "\n".join(
            f"{n+1}. {p['guest_text'][:300].replace(chr(10), ' ')}"
            for n, p in enumerate(chunk)
        )
        slug_list = "\n".join(f"- {s}: {d}" for s, d in CLUSTERS)
        prompt = f"""You are categorizing guest messages from an Airbnb host inbox.

Categories (use the exact slug on the left):
{slug_list}

Classify each of these {len(chunk)} guest messages. Reply with ONLY a JSON
array of slugs in the same order, like:
["wifi", "checkin_late", "other", ...]

Messages:
{numbered}
"""
        try:
            resp = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text.strip()
            start = text.find("[")
            end = text.rfind("]")
            if start == -1 or end == -1:
                slugs.extend(["other"] * len(chunk))
                continue
            parsed = json.loads(text[start:end + 1])
            if not isinstance(parsed, list) or len(parsed) != len(chunk):
                slugs.extend(["other"] * len(chunk))
                continue
            for s in parsed:
                slugs.append(s if s in CLUSTER_LOOKUP else "other")
        except Exception as e:
            print(f"  classify batch {i//BATCH + 1} failed: {e}", file=sys.stderr)
            slugs.extend(["other"] * len(chunk))
    return slugs


def propose_template(client: Anthropic, slug: str, examples: list[dict[str, str]]) -> dict[str, Any]:
    """Returns {template, tone_consistency, signal_to_template}."""
    desc = CLUSTER_LOOKUP[slug]
    # Build an example block; trim long messages so we stay cheap.
    sample_lines = []
    for ex in examples[:12]:
        g = ex["guest_text"].replace("\n", " ")[:280]
        h = (ex["host_reply"] or "(no host reply yet)").replace("\n", " ")[:400]
        sample_lines.append(f"GUEST: {g}\nHOST:  {h}")
    sample_block = "\n\n".join(sample_lines)
    prompt = f"""You are drafting an Airbnb quick-reply template for a host named Mido.

Category: {slug}
Category meaning: {desc}

Below are real guest messages in this category, paired with how Mido
actually replied. Draft a single reply template that:
  - Sounds like Mido's voice (not Airbnb-generic)
  - Covers the common information Mido tends to share in this category
  - Uses {{guest_first_name}} and other Airbnb variables when helpful
  - Is short — 2 to 5 sentences, like a real text

Also assess: are Mido's historical replies in this category CONSISTENT,
or is he winging it (different info / different tone every time)? If
they're inconsistent, this template is *more* important. Report a
single integer 1-5 where 1 = wildly inconsistent and 5 = he already has
a script in his head.

Real examples:
{sample_block}

Respond in this exact JSON shape (no other text):
{{
  "template": "the proposed reply",
  "tone_consistency": <1-5 int>,
  "notes": "1-2 sentence rationale"
}}
"""
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1:
            return {"template": "(parse failed)", "tone_consistency": 3, "notes": text[:200]}
        return json.loads(text[start:end + 1])
    except Exception as e:
        return {"template": f"(LLM error: {e})", "tone_consistency": 3, "notes": ""}


# ---------------------------------------------------------------------------
# Markdown writer
# ---------------------------------------------------------------------------


def write_markdown(out_path: Path, cluster_stats: dict[str, dict[str, Any]]) -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    lines: list[str] = []
    lines.append(f"# Airbnb Quick-Reply Templates — Proposed {today}")
    lines.append("")
    lines.append("Generated from your scraped inbox. Review each, then copy/paste the ones you "
                 "want into Airbnb's `Manage quick replies` UI.")
    lines.append("")
    lines.append("**Consistency score** — how varied your historical replies were in this category. "
                 "1 = totally winging it (template most needed). 5 = you already have a script.")
    lines.append("")

    # Sort: lowest consistency first (most urgent), then highest volume.
    ordered = sorted(
        cluster_stats.items(),
        key=lambda kv: (kv[1].get("tone_consistency", 3), -kv[1].get("count", 0)),
    )
    for slug, stat in ordered:
        if stat.get("count", 0) == 0:
            continue
        lines.append(f"## {slug.replace('_', ' ').title()}  ({stat['count']} guest message(s))")
        lines.append("")
        lines.append(f"**Consistency:** {stat.get('tone_consistency', 'n/a')} / 5")
        if stat.get("notes"):
            lines.append(f"**Notes:** {stat['notes']}")
        lines.append("")
        lines.append("**Proposed template:**")
        lines.append("```")
        lines.append(stat.get("template", "").strip() or "(no template)")
        lines.append("```")
        lines.append("")
        lines.append("**Sample guest messages:**")
        for ex in stat.get("samples", [])[:4]:
            lines.append(f"- *{ex['guest_name'] or 'guest'}* — {ex['guest_text'][:240]}")
        lines.append("")
        lines.append("---")
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("json_path", help="Path to airbnb-messages-YYYY-MM-DD.json")
    ap.add_argument("--limit-pairs", type=int, default=0,
                    help="Cap on Q/A pairs analyzed (0 = no cap). Useful for testing.")
    args = ap.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: set ANTHROPIC_API_KEY in your shell first.", file=sys.stderr)
        return 2

    json_path = Path(args.json_path)
    if not json_path.exists():
        print(f"ERROR: {json_path} not found.", file=sys.stderr)
        return 3

    data = load_scraped(json_path)
    pairs = extract_qa_pairs(data)
    if args.limit_pairs > 0:
        pairs = pairs[: args.limit_pairs]
    print(f"[analyze] {len(pairs)} guest messages from {data.get('thread_count', 0)} threads")
    if not pairs:
        print("[analyze] nothing to analyze (no guest messages). Exiting.")
        return 0

    client = Anthropic(api_key=api_key)
    print("[analyze] classifying...")
    slugs = classify_messages(client, pairs)

    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for pair, slug in zip(pairs, slugs):
        grouped[slug].append(pair)

    print("[analyze] cluster sizes:")
    for slug, items in sorted(grouped.items(), key=lambda kv: -len(kv[1])):
        print(f"  {slug:24s} {len(items):3d}")

    stats: dict[str, dict[str, Any]] = {}
    for slug, items in grouped.items():
        if slug == "other" and len(items) < 3:
            continue
        if len(items) < 1:
            continue
        print(f"[analyze] proposing template for {slug} (n={len(items)})...")
        proposed = propose_template(client, slug, items)
        stats[slug] = {
            **proposed,
            "count": len(items),
            "samples": items[:6],
        }

    today = datetime.now().strftime("%Y-%m-%d")
    out_path = HERE / f"airbnb-quickreplies-proposed-{today}.md"
    write_markdown(out_path, stats)
    print(f"\n[analyze] wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
