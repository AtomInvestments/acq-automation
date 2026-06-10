"""Airbnb host inbox scraper — reads Mido's logged-in Chrome session.

Read-only. Does NOT send messages. Auto-send replies requires a channel
manager (Hospitable / Hostaway / Hostfully). This tool exists so we can
build analytics + draft quick-reply templates from real history.

Run from the project venv (see README.md). Example:

    python scrape.py --max-threads 5            # smoke test
    python scrape.py --resume                   # continue last partial run
    python scrape.py                            # full inbox

Output: airbnb-messages-<YYYY-MM-DD>.json beside this file.

Author: Mike Yasser (APG)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from playwright.sync_api import (
        Page, BrowserContext, TimeoutError as PWTimeoutError, sync_playwright,
    )
except ImportError:
    print("ERROR: Playwright not installed. Run:\n"
          "  python -m venv .venv\n"
          "  .venv\\Scripts\\activate  (Windows)\n"
          "  pip install -r requirements.txt\n"
          "  playwright install chromium\n", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent
DEFAULT_PROFILE_DIR = Path(os.environ.get(
    "AIRBNB_PROFILE_DIR",
    str(HERE / ".chrome-profile"),
))
INBOX_URL = "https://www.airbnb.com/hosting/messaging"
STATE_FILE = HERE / "scrape-state.json"

THREAD_LIST_SELECTORS = [
    # Airbnb has changed the inbox DOM several times. We try multiple
    # selectors in priority order — the scraper logs which one hit so we can
    # debug later if Airbnb ships another refactor.
    "[data-testid=\"inbox-thread-list\"] [role=\"button\"]",
    "[data-testid=\"thread-list\"] a",
    "div[role=\"listbox\"] [role=\"option\"]",
    "a[href*=\"/hosting/thread/\"]",
    "a[href*=\"/messaging/qt_for/\"]",
]

MESSAGE_PANE_SELECTORS = [
    "[data-testid=\"messageThreadPanel\"]",
    "[data-testid=\"thread-panel\"]",
    "main [role=\"region\"]",
]

MESSAGE_BUBBLE_SELECTORS = [
    "[data-testid=\"message-bubble\"]",
    "[data-testid*=\"message\"][role]",
    "div[role=\"listitem\"]",
]


# ---------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------


@dataclass
class Message:
    timestamp: str           # ISO 8601 in UTC, best-effort parsed
    timestamp_raw: str       # the original string Airbnb showed us
    sender: str              # "host" | "guest" | "system"
    text: str


@dataclass
class Thread:
    thread_id: str
    url: str
    guest_name: str = ""
    listing: str = ""
    check_in: str = ""
    check_out: str = ""
    reservation_status: str = ""   # booked | inquiry | canceled | past | unknown
    messages: list[Message] = field(default_factory=list)
    host_replied: bool = False
    median_reply_minutes: float | None = None
    scraped_at: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def jitter(lo: float = 1.0, hi: float = 3.0) -> None:
    time.sleep(random.uniform(lo, hi))


def safe_text(el) -> str:
    try:
        return (el.inner_text() or "").strip()
    except Exception:
        return ""


def parse_airbnb_timestamp(raw: str, default_year: int) -> str:
    """Best-effort: Airbnb shows things like "Today 3:42 PM", "Yesterday",
    "Mar 12", "Jun 4, 2025 11:01 AM". We return an ISO 8601 string in UTC.
    On parse failure, we return the raw value (analyzer falls back to raw)."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    now = datetime.now(timezone.utc)
    s = raw.replace(" ", " ").replace("\xa0", " ").strip()
    # "Today 3:42 PM" or "Today, 3:42 PM"
    m = re.match(r"^Today[, ]+(\d{1,2}):(\d{2})\s*(AM|PM)?$", s, re.I)
    if m:
        h, mi, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "").upper()
        if ampm == "PM" and h < 12: h += 12
        if ampm == "AM" and h == 12: h = 0
        return now.replace(hour=h, minute=mi, second=0, microsecond=0).isoformat()
    m = re.match(r"^Yesterday[, ]+(\d{1,2}):(\d{2})\s*(AM|PM)?$", s, re.I)
    if m:
        from datetime import timedelta
        y = now - timedelta(days=1)
        h, mi, ampm = int(m.group(1)), int(m.group(2)), (m.group(3) or "").upper()
        if ampm == "PM" and h < 12: h += 12
        if ampm == "AM" and h == 12: h = 0
        return y.replace(hour=h, minute=mi, second=0, microsecond=0).isoformat()
    # Try several explicit formats Airbnb uses.
    for fmt in (
        "%b %d, %Y %I:%M %p",
        "%b %d, %Y, %I:%M %p",
        "%b %d %I:%M %p",
        "%B %d, %Y %I:%M %p",
        "%b %d, %Y",
        "%b %d",
    ):
        try:
            dt = datetime.strptime(s, fmt)
            if dt.year == 1900:
                dt = dt.replace(year=default_year)
            return dt.replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return raw  # surrender — analyzer can deal with raw


def classify_sender(bubble_html: str, bubble_text: str, guest_name: str) -> str:
    """Airbnb encodes sender via DOM position + aria-label. We look for hints.
    Falling back to guest-name detection at the top of the bubble."""
    lower = bubble_html.lower()
    if "sent by you" in lower or "you sent" in lower or 'data-testid="message-bubble-host"' in lower:
        return "host"
    if "automated" in lower or "airbnb support" in lower:
        return "system"
    if guest_name:
        first = guest_name.split()[0].lower()
        if bubble_text.lower().startswith(first):
            return "guest"
    # Heuristic: host bubbles tend to align right; we can't read CSS reliably
    # from .inner_html(). Default to "guest" — analyzer will sanity-check.
    return "guest"


def safe_first_match(page: Page, selectors: list[str]):
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0:
                return loc, sel
        except Exception:
            continue
    return None, None


def safe_all_match(page: Page, selectors: list[str]):
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if loc.count() > 0:
                return loc, sel
        except Exception:
            continue
    return None, None


def scroll_thread_list_to_load_all(page: Page, max_scrolls: int = 60) -> int:
    """Airbnb's left rail virtualizes; we scroll the list until count stops
    growing. Returns the number of thread items discovered."""
    container, hit = safe_first_match(page, [s.split(" ")[0] for s in THREAD_LIST_SELECTORS])
    if not container:
        return 0
    previous = -1
    stable_for = 0
    for _ in range(max_scrolls):
        items, _ = safe_all_match(page, THREAD_LIST_SELECTORS)
        if not items:
            return 0
        current = items.count()
        if current == previous:
            stable_for += 1
            if stable_for >= 3:
                break
        else:
            stable_for = 0
            previous = current
        try:
            container.evaluate("(el) => { el.scrollTop = el.scrollHeight; }")
        except Exception:
            pass
        page.wait_for_timeout(800)
    items, _ = safe_all_match(page, THREAD_LIST_SELECTORS)
    return items.count() if items else 0


def scroll_message_pane_to_top(page: Page, max_scrolls: int = 40) -> None:
    """Scroll the message pane upward so older bubbles load."""
    pane, _ = safe_first_match(page, MESSAGE_PANE_SELECTORS)
    if not pane:
        return
    previous_height = -1
    for _ in range(max_scrolls):
        try:
            pane.evaluate("(el) => { el.scrollTop = 0; }")
        except Exception:
            pass
        page.wait_for_timeout(600)
        try:
            current_height = pane.evaluate("(el) => el.scrollHeight")
        except Exception:
            break
        if current_height == previous_height:
            break
        previous_height = current_height


# ---------------------------------------------------------------------------
# Thread scrape
# ---------------------------------------------------------------------------


def extract_thread_metadata(page: Page) -> dict[str, str]:
    """Pull guest name, listing, check-in/out from the right-rail reservation
    panel that Airbnb shows above the message stream."""
    meta: dict[str, str] = {
        "guest_name": "",
        "listing": "",
        "check_in": "",
        "check_out": "",
        "reservation_status": "unknown",
    }
    try:
        # Guest name: usually in the thread header h1/h2
        for sel in [
            "h1[data-testid=\"thread-title\"]",
            "h1",
            "[data-testid=\"guest-name\"]",
        ]:
            loc = page.locator(sel).first
            if loc.count() > 0:
                txt = safe_text(loc)
                if txt and len(txt) < 60:
                    meta["guest_name"] = txt
                    break
    except Exception:
        pass
    # Listing + dates: Airbnb tends to put them in an aside or info panel.
    full_text = ""
    try:
        full_text = page.locator("main").first.inner_text() or ""
    except Exception:
        pass
    # Heuristic regex on the reservation block.
    m = re.search(r"Check[- ]?in[\s\S]{0,40}?([A-Z][a-z]{2,8} \d{1,2}(?:,? \d{4})?)", full_text)
    if m:
        meta["check_in"] = m.group(1)
    m = re.search(r"Check[- ]?out[\s\S]{0,40}?([A-Z][a-z]{2,8} \d{1,2}(?:,? \d{4})?)", full_text)
    if m:
        meta["check_out"] = m.group(1)
    # Listing name heuristic: look for the "Listing:" label or a known prefix.
    m = re.search(r"Listing[:\s]+([^\n]{4,80})", full_text)
    if m:
        meta["listing"] = m.group(1).strip()
    # Status keywords
    lower = full_text.lower()
    if "canceled" in lower or "cancelled" in lower:
        meta["reservation_status"] = "canceled"
    elif "inquiry" in lower:
        meta["reservation_status"] = "inquiry"
    elif "confirmed" in lower or "booked" in lower or "reservation" in lower:
        meta["reservation_status"] = "booked"
    elif meta["check_out"]:
        meta["reservation_status"] = "past"
    return meta


def extract_messages(page: Page, guest_name: str, default_year: int) -> list[Message]:
    bubbles, hit_sel = safe_all_match(page, MESSAGE_BUBBLE_SELECTORS)
    if not bubbles:
        return []
    out: list[Message] = []
    count = bubbles.count()
    for i in range(count):
        try:
            b = bubbles.nth(i)
            text = safe_text(b)
            if not text or len(text) < 2:
                continue
            try:
                html = b.evaluate("(el) => el.outerHTML") or ""
            except Exception:
                html = ""
            # Find a timestamp inside or next to the bubble.
            ts_raw = ""
            try:
                t_el = b.locator("time, [data-testid=\"timestamp\"]").first
                if t_el.count() > 0:
                    ts_raw = safe_text(t_el) or t_el.get_attribute("datetime") or ""
            except Exception:
                pass
            sender = classify_sender(html, text, guest_name)
            out.append(Message(
                timestamp=parse_airbnb_timestamp(ts_raw, default_year),
                timestamp_raw=ts_raw,
                sender=sender,
                text=text,
            ))
        except Exception:
            continue
    return out


def compute_reply_stats(messages: list[Message]) -> tuple[bool, float | None]:
    """Returns (host_replied, median_reply_minutes_after_guest_message)."""
    if not messages:
        return False, None
    replied = any(m.sender == "host" for m in messages)
    deltas: list[float] = []
    last_guest_dt: datetime | None = None
    for m in messages:
        try:
            dt = datetime.fromisoformat(m.timestamp.replace("Z", "+00:00"))
        except Exception:
            continue
        if m.sender == "guest":
            last_guest_dt = dt
        elif m.sender == "host" and last_guest_dt:
            delta_min = (dt - last_guest_dt).total_seconds() / 60.0
            if delta_min >= 0:
                deltas.append(delta_min)
            last_guest_dt = None
    median: float | None = None
    if deltas:
        s = sorted(deltas)
        n = len(s)
        median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    return replied, median


def scrape_thread(page: Page, anchor_locator, default_year: int) -> Thread | None:
    """Click the thread anchor, wait for the pane, scrape it."""
    try:
        href = anchor_locator.get_attribute("href") or ""
    except Exception:
        href = ""
    thread_id = ""
    m = re.search(r"/(?:hosting/thread|messaging/qt_for|thread)/(\d+)", href or "")
    if m:
        thread_id = m.group(1)
    try:
        anchor_locator.click(timeout=10000)
    except PWTimeoutError:
        return None
    # Wait for the pane to render. Use a soft wait — Airbnb is SPA-routed.
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except PWTimeoutError:
        pass
    page.wait_for_timeout(800)
    scroll_message_pane_to_top(page)
    meta = extract_thread_metadata(page)
    guest_name = meta.get("guest_name", "")
    messages = extract_messages(page, guest_name, default_year)
    replied, median = compute_reply_stats(messages)
    if not thread_id:
        # Fall back to a derived id so deduping still works.
        thread_id = f"derived-{abs(hash(guest_name + (messages[0].text[:40] if messages else '')))}"
    return Thread(
        thread_id=thread_id,
        url=page.url,
        guest_name=guest_name,
        listing=meta.get("listing", ""),
        check_in=meta.get("check_in", ""),
        check_out=meta.get("check_out", ""),
        reservation_status=meta.get("reservation_status", "unknown"),
        messages=messages,
        host_replied=replied,
        median_reply_minutes=median,
        scraped_at=datetime.now(timezone.utc).isoformat(),
    )


# ---------------------------------------------------------------------------
# State / output
# ---------------------------------------------------------------------------


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"completed_thread_ids": [], "threads": []}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"completed_thread_ids": [], "threads": []}


def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def write_output(threads: list[Thread]) -> Path:
    today = datetime.now().strftime("%Y-%m-%d")
    out_path = HERE / f"airbnb-messages-{today}.json"
    payload = {
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "thread_count": len(threads),
        "message_count": sum(len(t.messages) for t in threads),
        "threads": [
            {**asdict(t), "messages": [asdict(m) for m in t.messages]}
            for t in threads
        ],
    }
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--max-threads", type=int, default=0,
                    help="Stop after N threads (0 = no limit, default).")
    ap.add_argument("--resume", action="store_true",
                    help="Skip threads already in scrape-state.json.")
    ap.add_argument("--profile-dir", type=str, default=str(DEFAULT_PROFILE_DIR),
                    help="Path to Chrome user-data-dir for the logged-in session.")
    ap.add_argument("--headless", action="store_true",
                    help="Headless. NOT recommended for first run (Airbnb may 2FA).")
    args = ap.parse_args()

    profile_dir = Path(args.profile_dir)
    profile_dir.mkdir(parents=True, exist_ok=True)
    print(f"[airbnb] profile dir = {profile_dir}")
    print(f"[airbnb] headless    = {args.headless}")
    state = load_state() if args.resume else {"completed_thread_ids": [], "threads": []}
    completed: set[str] = set(state.get("completed_thread_ids", []))
    threads: list[Thread] = [Thread(**{**t, "messages": [Message(**m) for m in t["messages"]]})
                             for t in state.get("threads", [])] if args.resume else []

    default_year = datetime.now().year

    with sync_playwright() as p:
        context: BrowserContext = p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=args.headless,
            viewport={"width": 1440, "height": 900},
            # Use a real-looking UA to dodge cursory bot heuristics.
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
        )
        page = context.pages[0] if context.pages else context.new_page()
        print(f"[airbnb] opening {INBOX_URL}")
        page.goto(INBOX_URL, wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=12000)
        except PWTimeoutError:
            pass

        if "/login" in page.url or "signup" in page.url:
            print("ERROR: Chrome profile is not logged into Airbnb.\n"
                  "  1. Close every Chrome window.\n"
                  "  2. Re-run with --profile-dir pointing at a fresh dir, log in once.\n"
                  "  3. Re-run the scraper.")
            context.close()
            return 3

        n_threads = scroll_thread_list_to_load_all(page)
        print(f"[airbnb] discovered {n_threads} thread items in the left rail")
        if n_threads == 0:
            print("ERROR: Could not find the inbox thread list. Selectors may need a refresh "
                  "(see THREAD_LIST_SELECTORS at the top of scrape.py).")
            context.close()
            return 4

        items, sel_hit = safe_all_match(page, THREAD_LIST_SELECTORS)
        print(f"[airbnb] using selector: {sel_hit}")
        total = items.count()
        cap = total if args.max_threads <= 0 else min(args.max_threads, total)
        print(f"[airbnb] scraping up to {cap} threads...")

        for i in range(cap):
            try:
                items, _ = safe_all_match(page, THREAD_LIST_SELECTORS)
                anchor = items.nth(i)
                href = (anchor.get_attribute("href") or "").strip()
                preview_id = re.search(r"(\d{6,})", href or "")
                preview_id = preview_id.group(1) if preview_id else f"item-{i}"
                if preview_id in completed:
                    print(f"  [{i+1}/{cap}] {preview_id} skipped (resume)")
                    continue
                print(f"  [{i+1}/{cap}] clicking thread {preview_id}...")
                t = scrape_thread(page, anchor, default_year)
                if t is None:
                    print(f"    skipped (click failed)")
                    continue
                threads.append(t)
                completed.add(t.thread_id)
                # Checkpoint every thread so a crash mid-run doesn't lose anything.
                state["completed_thread_ids"] = sorted(completed)
                state["threads"] = [
                    {**asdict(th), "messages": [asdict(m) for m in th.messages]}
                    for th in threads
                ]
                save_state(state)
                jitter(1.0, 3.0)
            except Exception as e:
                print(f"    error on thread {i+1}: {e}")
                jitter(2.0, 4.0)
                continue

        context.close()

    out = write_output(threads)
    print(f"\n[airbnb] wrote {out} ({len(threads)} threads, "
          f"{sum(len(t.messages) for t in threads)} messages)")
    print("[airbnb] state checkpoint at", STATE_FILE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
