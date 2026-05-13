"""One-off cleanup: delete the REVIEW-Mike spam tasks created by the
pre-PR-#7 call-needed cadence bug.

Background
==========
Before PR #7 (commit 1bc41bf), `process_call_needed_cadence` in
sms_followup.py created a Jeff CALL + Mike REVIEW task pair every 30
min for every call-needed contact, because the 48h gate never engaged
(see Issue #8). PR #7 stopped creating the Mike-side task and added a
tag-dedupe guard; PR #9 then patched the underlying persistence holes.

Both fixes are forward-looking — they prevent NEW spam. Mike's queue
still carries the historical REVIEW tasks that were created during the
bad window. This script is the one-off cleanup pass that walks every
contact, finds open Mike-assigned `REVIEW: Did Jeff call <name>` tasks
created in the last 14 days, and deletes them.

Safety
======
- **Dry-run by default.** Set `CLEANUP_MODE=execute` in the environment
  to actually delete. Without it, the script enumerates targets and
  logs them but does not call DELETE.
- **Strict filter.** Only tasks matching ALL of:
    1. Title starts with `REVIEW: Did Jeff call`
    2. Assigned to USER_MIKE
    3. Created within the last 14 days (UTC)
    4. Not already completed
  ...are touched. Anything else is logged and skipped.
- **Every action is logged.** The script prints one line per task it
  inspects with the decision (KEEP / WOULD-DELETE / DELETED / ERROR).

Usage
=====
    GHL_TOKEN=... python cleanup_review_tasks.py            # dry-run
    GHL_TOKEN=... CLEANUP_MODE=execute python cleanup_review_tasks.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests


GHL_TOKEN    = os.environ['GHL_TOKEN']
GHL_LOCATION = 'RCkiUmWqXX4BYQ39JXmm'
USER_MIKE    = 'Vj4WwH1ovxGN5Hv5Kq17'

# Behavior knobs
MODE         = os.environ.get('CLEANUP_MODE', 'dry-run').strip().lower()
TITLE_PREFIX = 'REVIEW: Did Jeff call'
MAX_AGE_DAYS = 14

GHL_H = {'Authorization': f'Bearer {GHL_TOKEN}',
         'Content-Type':  'application/json',
         'Version':       '2021-07-28'}

HTTP_TIMEOUT = 30


def http(method, url, **kw):
    kw.setdefault('timeout', HTTP_TIMEOUT)
    for attempt in range(2):
        try:
            r = requests.request(method, url, **kw)
            if r.status_code >= 500 and attempt == 0:
                time.sleep(1.0)
                continue
            return r
        except (requests.Timeout, requests.ConnectionError):
            if attempt == 0:
                time.sleep(1.0)
                continue
            raise


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def iter_contacts():
    """Page through every contact in the location.

    GHL's contacts/search endpoint is the cheapest way to enumerate
    every contact in the location regardless of tags. We pull only the
    id + a handful of fields per page to keep the response small; the
    tasks call hits each contact individually anyway.
    """
    page = 1
    while True:
        r = http('POST', 'https://services.leadconnectorhq.com/contacts/search',
                 headers=GHL_H,
                 json={'locationId': GHL_LOCATION,
                       'pageLimit':  100,
                       'page':       page})
        if r.status_code != 200:
            print(f'  ERROR: contacts/search page={page} status={r.status_code} '
                  f'body={r.text[:200]!r}', file=sys.stderr)
            return
        contacts = (r.json() or {}).get('contacts') or []
        if not contacts:
            return
        for c in contacts:
            yield c
        if len(contacts) < 100:
            return
        page += 1
        # GHL is rate-limited; small sleep keeps us well under the cap.
        time.sleep(0.2)


def fetch_tasks(contact_id):
    """Return the contact's tasks, or [] if the lookup fails."""
    r = http('GET',
             f'https://services.leadconnectorhq.com/contacts/{contact_id}/tasks',
             headers=GHL_H)
    if r.status_code != 200:
        print(f'    fetch tasks failed: status={r.status_code} '
              f'body={r.text[:200]!r}', file=sys.stderr)
        return []
    return (r.json() or {}).get('tasks') or []


def delete_task(contact_id, task_id):
    r = http('DELETE',
             f'https://services.leadconnectorhq.com/contacts/{contact_id}/tasks/{task_id}',
             headers=GHL_H)
    return r.status_code in (200, 204)


def main():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=MAX_AGE_DAYS)
    execute = MODE == 'execute'

    print('=' * 70)
    print(f'REVIEW-Mike task cleanup')
    print(f'  mode:           {"EXECUTE (DELETE)" if execute else "DRY-RUN (no deletes)"}')
    print(f'  title prefix:   {TITLE_PREFIX!r}')
    print(f'  assignee:       USER_MIKE ({USER_MIKE})')
    print(f'  max age (days): {MAX_AGE_DAYS}')
    print(f'  cutoff (UTC):   {cutoff.isoformat()}')
    print(f'  started (UTC):  {now.isoformat()}')
    print('=' * 70)

    stats = {
        'contacts_scanned': 0,
        'tasks_scanned':    0,
        'matched':          0,
        'deleted':          0,
        'would_delete':     0,
        'skipped_age':      0,
        'skipped_assignee': 0,
        'skipped_title':    0,
        'skipped_complete': 0,
        'errors':           0,
    }

    for contact in iter_contacts():
        stats['contacts_scanned'] += 1
        cid = contact.get('id')
        if not cid:
            continue
        if stats['contacts_scanned'] % 50 == 0:
            print(f'  ...scanned {stats["contacts_scanned"]} contacts, '
                  f'matched={stats["matched"]}, '
                  f'deleted={stats["deleted"]}')
        try:
            tasks = fetch_tasks(cid)
        except Exception as e:
            stats['errors'] += 1
            print(f'  contact {cid}: fetch_tasks raised {e!r}', file=sys.stderr)
            continue

        for t in tasks:
            stats['tasks_scanned'] += 1
            title = (t.get('title') or '').strip()
            assignee = t.get('assignedTo') or ''
            done = bool(t.get('completed'))
            created = parse_iso(t.get('dateAdded') or t.get('createdAt'))

            # Filter — must match ALL criteria.
            if not title.startswith(TITLE_PREFIX):
                stats['skipped_title'] += 1
                continue
            if assignee != USER_MIKE:
                stats['skipped_assignee'] += 1
                continue
            if done:
                stats['skipped_complete'] += 1
                continue
            if created is None or created < cutoff:
                stats['skipped_age'] += 1
                continue

            stats['matched'] += 1
            tid = t.get('id')
            label = f'contact={cid} task={tid} title={title!r} created={created.isoformat()}'

            if not execute:
                stats['would_delete'] += 1
                print(f'  WOULD-DELETE {label}')
                continue

            ok = delete_task(cid, tid)
            if ok:
                stats['deleted'] += 1
                print(f'  DELETED      {label}')
            else:
                stats['errors'] += 1
                print(f'  ERROR        {label}', file=sys.stderr)

            # Be polite to the API even when executing.
            time.sleep(0.05)

        time.sleep(0.05)

    print('=' * 70)
    print('Summary:')
    print(json.dumps(stats, indent=2))
    print(f'  finished (UTC): {datetime.now(timezone.utc).isoformat()}')
    print('=' * 70)


if __name__ == '__main__':
    main()
