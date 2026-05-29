"""
dedup_slack_notes.py — one-shot cleanup for the Slack-mention note pollution
that built up before slack_scraper.py learned to dedup on Slack ts.

For every contact in weekly/_state.json (covers the entire active pipeline
since weekly_analysis rebuilds it from the same opportunity search the
scraper uses), pull all notes starting with 'Slack mention', group them by
Slack message identity, and DELETE all but the OLDEST note in each group.

Rationale for keeping the OLDEST:
  - The oldest note is the original capture — its Claude summary was written
    when the team's Slack message was the freshest signal.
  - Newer notes are paraphrases of the same Slack text, generated each cron
    run, that add no new info and clutter the contact card.
  - Keeping the oldest preserves the original 'added_at' audit trail.

Dedup key resolution (in priority order):
  1. Explicit 'Slack-Key: {channel_id}:{ts}' marker (notes written by
     slack_scraper after this fix).
  2. Slack permalink — embeds the ts as 'pNNNNNNNNNNNNNN' which is unique
     per Slack message.
  3. (channel, ts_text, first 120 chars of original) — legacy notes from
     before either marker existed.

Run mode:
  DRY_RUN=1     — report only, don't delete (default if no env override)
  DRY_RUN=0     — actually call DELETE on GHL

Reports counts to last_run_dedup.json.
"""
import os, json, re, sys, time
import requests
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
STATE_FILE = ROOT / 'weekly' / '_state.json'

GHL_TOKEN = os.environ['GHL_TOKEN']
GHL_H = {
    'Authorization': f'Bearer {GHL_TOKEN}',
    'Version': '2021-07-28',
    'Accept': 'application/json',
}

DRY_RUN = os.environ.get('DRY_RUN', '1') != '0'


def _write_status(success, summary='', error=''):
    try:
        with open('last_run_dedup.json', 'w') as f:
            json.dump({'success': success,
                       'timestamp': datetime.now(timezone.utc).isoformat(),
                       'summary': summary,
                       'error': error[:500],
                       'dry_run': DRY_RUN}, f, indent=2)
    except Exception:
        pass


def dedup_key(body):
    """Same logic as weekly_analysis._slack_dedup_key, reduced to operate on
    the raw note body so this script has no dependency on weekly_analysis."""
    m = re.search(r'Slack-Key:\s*(\S+)', body)
    if m:
        return ('key', m.group(1))
    perma = re.search(r'Slack:\s*(\S+)', body)
    if perma:
        pm = re.search(r'/p(\d{10,})', perma.group(1))
        if pm:
            return ('perma', pm.group(1))
        return ('perma', perma.group(1))
    head = re.search(r'#(\S+)\s+by\s+.+?\s+—\s+(.+?)(?:\n|$)', body)
    channel = head.group(1) if head else ''
    ts_text = head.group(2).strip() if head else ''
    orig = re.search(r'Original:\s*"(.+?)"', body, re.DOTALL)
    orig_text = (orig.group(1) if orig else '')[:120]
    return ('legacy', channel, ts_text, orig_text)


def fetch_slack_notes(cid):
    try:
        r = requests.get(
            f'https://services.leadconnectorhq.com/contacts/{cid}/notes',
            headers=GHL_H, timeout=20,
        )
        if r.status_code != 200:
            return None
        notes = r.json().get('notes', []) or []
        return [n for n in notes if (n.get('body') or '').startswith('Slack mention')]
    except Exception as e:
        print(f'  notes fetch {cid}: {e}', file=sys.stderr)
        return None


def delete_note(cid, nid):
    try:
        r = requests.delete(
            f'https://services.leadconnectorhq.com/contacts/{cid}/notes/{nid}',
            headers=GHL_H, timeout=15,
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


def main():
    try:
        summary = _main_inner()
        _write_status(True, summary or '')
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f'!! Dedup failed: {e}\n{tb}', file=sys.stderr)
        _write_status(False, '', f'{e}: {tb[-300:]}')
        raise


def _main_inner():
    if not STATE_FILE.exists():
        print('weekly/_state.json missing — run weekly_analysis.py first.', file=sys.stderr)
        return 'state missing'
    state = json.loads(STATE_FILE.read_text(encoding='utf-8'))
    cids = list(state.keys())
    print(f'Scanning {len(cids)} contacts. DRY_RUN={DRY_RUN}')

    contacts_scanned   = 0
    contacts_with_dups = 0
    dups_found         = 0
    dups_deleted       = 0
    delete_failures    = 0

    worst = []  # (count, cid, name, key) — for human-readable report

    for i, cid in enumerate(cids, 1):
        contacts_scanned += 1
        notes = fetch_slack_notes(cid)
        if not notes:
            continue
        groups = {}
        for n in notes:
            k = dedup_key(n.get('body') or '')
            groups.setdefault(k, []).append(n)
        had_dup = False
        for k, group in groups.items():
            if len(group) <= 1:
                continue
            had_dup = True
            # Sort oldest first by dateAdded. Keep [0], delete [1:].
            group.sort(key=lambda n: n.get('dateAdded') or n.get('createdAt') or '')
            keep = group[0]
            to_delete = group[1:]
            dups_found += len(to_delete)
            lead_name = state.get(cid, {}).get('name', '?')
            worst.append((len(group), cid, lead_name, k))
            if DRY_RUN:
                continue
            for n in to_delete:
                nid = n.get('id')
                if not nid:
                    continue
                if delete_note(cid, nid):
                    dups_deleted += 1
                else:
                    delete_failures += 1
                time.sleep(0.1)  # be polite to GHL
        if had_dup:
            contacts_with_dups += 1
        if i % 50 == 0:
            print(f'  {i}/{len(cids)} | dups so far: {dups_found} | deleted: {dups_deleted}')
        time.sleep(0.05)

    worst.sort(reverse=True)
    print('\nTop offenders:')
    for count, cid, name, k in worst[:15]:
        print(f'  {count:>3}x  {name:<30}  cid={cid[-8:]}  key={k}')

    mode = 'DRY RUN' if DRY_RUN else 'LIVE'
    msg = (f'{mode} | scanned {contacts_scanned} contacts | '
           f'{contacts_with_dups} had dupes | {dups_found} duplicate notes | '
           f'{dups_deleted} deleted | {delete_failures} failures')
    print(f'\nDONE — {msg}')
    return msg


if __name__ == '__main__':
    main()
