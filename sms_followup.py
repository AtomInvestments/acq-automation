"""
ACQ Pipeline SMS Follow-Up Automation
Runs every 30 min via GitHub Actions cron.

For each contact in ACQ pipeline stages 1-4:
- Tracks per-contact SMS state in sms_state.json
- Sends next SMS in sequence (7-day intervals, 6 touches over 6 weeks)
- Routes from-number based on contact's state (primary for 1-3, secondary for 4-6)
- Polls for replies; on reply: stops sequence, tags, creates Jeff task + Mike review task
- After 6 SMS no reply: marks dormant, creates manual-call task
"""
import json, os, re, requests, time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')

GHL_TOKEN     = os.environ['GHL_TOKEN']
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
GHL_LOCATION  = 'RCkiUmWqXX4BYQ39JXmm'
PIPELINE_ID   = 'O8wzIa6E3SgD8HLg6gh9'
STATE_FILE    = 'sms_state.json'
CONTACTS_CACHE = 'contacts_cache.json'
STATUS_FILE   = 'last_run_sms.json'
CADENCE_HEALTH_FILE = 'cadence_health.json'
# Number of consecutive in-business-hours days with zero successful sends
# before we escalate to Slack as a "cadence is stuck" alert. Days where
# the workflow only ran outside 9 AM - 8 PM ET don't count toward the
# streak (we never send then).
CADENCE_STUCK_DAYS = 7
SHEET_ID      = os.environ.get('DASHBOARD_SHEET_ID', '')
SLACK_WEBHOOK = os.environ.get('SLACK_WEBHOOK_URL', '')

GHL_H = {'Authorization': f'Bearer {GHL_TOKEN}',
         'Content-Type': 'application/json', 'Version': '2021-07-28'}

# Network defaults — every request gets a timeout + one retry on transient errors
HTTP_TIMEOUT = 30


def http(method, url, **kw):
    """Wrapped requests with timeout + one retry on connection/5xx errors."""
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

# Active deal stages (high-engagement 7-day cadence, 6 touches)
STAGE_QUALIFIED = 'a17517be-8d1a-49fd-bd53-b9128a66e242'
STAGE_LAO       = 'd43fddd8-3a17-46b2-a193-cf18619f654f'
STAGE_RR        = '23a159ad-ba39-4c74-9d07-c1beb219d9f2'
STAGE_MAO       = '43589167-14f0-4e09-ba2a-8b9bd3296a4a'
# Re-engagement stages (slow cadence, low-pressure tone)
STAGE_FU_15MO   = '4aa78ab3-85dc-46d1-a683-d97b0c7a23ee'  # Follow Up (1.5 month)
STAGE_FU_3MO    = '571c115e-2603-4f3f-8546-d716f44ba8ef'  # Follow Up (3 months)
STAGE_DEAD      = 'b9b560b0-30cb-47fc-a4ca-1e55ca2531e2'  # Dead Deals

STAGE_NAMES = {
    STAGE_QUALIFIED: 'qualified',
    STAGE_LAO:       'lao',
    STAGE_RR:        'rr',
    STAGE_MAO:       'mao',
    STAGE_FU_15MO:   'fu15mo',
    STAGE_FU_3MO:    'fu3mo',
    STAGE_DEAD:      'dead',
}
ACTIVE_STAGES = set(STAGE_NAMES.keys())

# Per-stage cadence / behavior
STAGE_CONFIG = {
    'qualified': {'interval_days': 7,   'max_touches': 6, 'secondary_after': 3, 'dormant_wait': 3},
    'lao':       {'interval_days': 7,   'max_touches': 6, 'secondary_after': 3, 'dormant_wait': 3},
    'rr':        {'interval_days': 7,   'max_touches': 6, 'secondary_after': 3, 'dormant_wait': 3},
    'mao':       {'interval_days': 7,   'max_touches': 6, 'secondary_after': 3, 'dormant_wait': 3},
    'fu15mo':    {'interval_days': 30,  'max_touches': 3, 'secondary_after': 999, 'dormant_wait': 14},
    'fu3mo':     {'interval_days': 60,  'max_touches': 3, 'secondary_after': 999, 'dormant_wait': 14},
    'dead':      {'interval_days': 180, 'max_touches': 3, 'secondary_after': 999, 'dormant_wait': 30},
}

# GHL user IDs
USER_JEFF = 'vDKOqPSkA8nLkia5skd0'
USER_MIKE = 'Vj4WwH1ovxGN5Hv5Kq17'

# Phone routing
JEFF_NJ        = '+16094388996'
NJ_SECONDARY   = '+12676197270'  # PA Market
STATE_PRIMARY = {
    'AL': '+12568006289', 'GA': '+14707508168',
    'IN': '+12603193698', 'OH': '+14406169376',
    'PA': '+12676197270', 'SC': '+18037843538',
    'TN': '+19013138258', 'WI': '+14143489182',
}
STATE_SECONDARY = {
    'AL': '+19013138258',  # TN
    'GA': '+18037843538',  # SC
    'IN': '+14406169376',  # OH
    'OH': '+12603193698',  # IN
    'PA': '+16094388996',  # Jeff NJ
    'SC': '+14707508168',  # GA
    'TN': '+12568006289',  # AL
    'WI': '+12603193698',  # IN
}

# SMS templates: 6 per stage. Index 0-2 = primary number, 3-5 = secondary.
# `TEMPLATES` is the live (possibly Sheet-overridden) set; `HARDCODED_TEMPLATES`
# stays as the immutable shipping defaults so W6 fallback can recover when
# either a Sheet row or a per-send format() blows up.
HARDCODED_TEMPLATES = {
    'qualified': [
        "Hey {first_name}, this is Jeff with APG — circling back on {address1}. Still thinking about selling, or did things shift on your end?",
        "Hey {first_name}, checking back on {address1}. Anything you wanted to think over before we kept the conversation going?",
        "{first_name} — last one on this. If {address1} is still something you'd sell, reply Y. If not, no problem and I'll stop reaching out.",
        "Hey {first_name}, Jeff again from APG. Switched numbers in case the last one wasn't reaching you. You still considering selling {address1}?",
        "{first_name}, just wanted to check one more time — any update on {address1}? Quick yes-or-no works for me.",
        "{first_name} — final attempt. Reply Y if still on the table for {address1}, or I'll mark this closed on our end. Either way is fine.",
    ],
    'lao': [
        "Hey {first_name}, Jeff at APG. Just making sure our offer on {address1} made it to you. Any thoughts?",
        "{first_name}, did the number we sent for {address1} work for what you had in mind? Happy to hear your feedback.",
        "{first_name} — final check on {address1}. Reply Y to revisit, N to pass. No hard feelings either way.",
        "Hey {first_name}, switched numbers — wanted to make sure our offer on {address1} got through. Any thoughts?",
        "{first_name}, just one more nudge on the {address1} offer. Y or N works for me.",
        "{first_name} — last attempt. If the {address1} offer is worth revisiting, reply Y. Otherwise I'll close it on our end.",
    ],
    'rr': [
        "Hey {first_name}, Jeff at APG. Wrapping up our review on {address1} this week. Anything we should know on your end?",
        "{first_name} — any new info from your end on {address1}? Want to make sure we have the full picture.",
        "{first_name}, let me know if you've heard from anyone else on {address1} — just keeping us aligned.",
        "Hey {first_name}, Jeff here. Switched numbers — we're closing in on review for {address1}. Quick update?",
        "{first_name}, anything I should know before we finalize on {address1}?",
        "{first_name} — last check before we close out review on {address1}. All good on your end?",
    ],
    'mao': [
        "Hey {first_name}, Jeff with APG. Final number on {address1} is in your court. Want to grab a quick call to walk through it?",
        "{first_name}, anything I can answer on the {address1} offer? Happy to adjust if there's something specific.",
        "{first_name} — last check on {address1}. Reply Y to keep moving, N to pass. All good either way.",
        "Hey {first_name}, Jeff. Different number — wanted to make sure our final number on {address1} got to you.",
        "{first_name}, any final thoughts on the {address1} number? Either way works for me.",
        "{first_name} — last attempt on {address1}. Y to move forward, N to pass. No hard feelings.",
    ],
    # Re-engagement: low-pressure, calm, "checking in" tone
    'fu15mo': [
        "Hey {first_name}, Jeff with APG. Wanted to circle back on {address1} — anything new on your end?",
        "{first_name}, just checking in on {address1}. Door's still open whenever you're ready to talk.",
        "{first_name} — last touch on {address1}. If anything's changed, just shoot me a text. Otherwise no worries.",
    ],
    'fu3mo': [
        "Hey {first_name}, Jeff with APG. It's been a few months — anything change with {address1}?",
        "{first_name}, just keeping in touch on {address1}. Always here if anything shifts.",
        "{first_name} — quick check on {address1}. Reply if there's anything to revisit, otherwise all good.",
    ],
    'dead': [
        "Hey {first_name} — Jeff with APG. It's been a while. If anything's ever changed with {address1} and you'd consider selling, just let me know. No pressure either way.",
        "{first_name}, Jeff again. Just a quick check on {address1} — sometimes life shifts. If you're ever curious about a number, I'm here.",
        "{first_name} — last reach-out on {address1}. If anything's in the air, you know where to find me.",
    ],
}
TEMPLATES = {k: list(v) for k, v in HARDCODED_TEMPLATES.items()}


def load_state():
    if os.path.exists(STATE_FILE):
        return json.load(open(STATE_FILE))
    return {}


def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2, sort_keys=True)


def now_utc():
    return datetime.now(timezone.utc)


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except Exception:
        return None


def days_since(iso):
    dt = parse_iso(iso)
    if not dt:
        return None
    return (now_utc() - dt).total_seconds() / 86400.0


def from_number_for(state_code, sms_index, stage_name):
    """Pick from-number based on contact's state and where in the sequence we are."""
    s = (state_code or '').strip().upper()
    cfg = STAGE_CONFIG.get(stage_name, STAGE_CONFIG['qualified'])
    if sms_index < cfg['secondary_after']:
        return STATE_PRIMARY.get(s, JEFF_NJ)
    return STATE_SECONDARY.get(s, NJ_SECONDARY)


def fetch_active_leads():
    """Query each active stage server-side. GHL's pagination 'total' field is unreliable
    (returns 0 even when there are 400+ opps), so we filter by stage at fetch time."""
    entries = []
    for stage_id, stage_name in STAGE_NAMES.items():
        page = 1
        while True:
            r = http('GET', 'https://services.leadconnectorhq.com/opportunities/search',
                     headers=GHL_H,
                     params={'location_id': GHL_LOCATION, 'pipeline_id': PIPELINE_ID,
                             'pipeline_stage_id': stage_id,
                             'limit': 100, 'page': page})
            if r.status_code != 200:
                break
            opps = r.json().get('opportunities', [])
            if not opps:
                break
            for o in opps:
                c = o.get('contact') or {}
                if 'agent' not in c.get('tags', []) and o.get('contactId'):
                    entries.append({'cid': o['contactId'], 'oid': o['id'],
                                    'stage': stage_id, 'stage_name': stage_name})
            if len(opps) < 100:
                break
            page += 1
            time.sleep(0.15)
    return entries


def get_contact(cid):
    r = http('GET', f'https://services.leadconnectorhq.com/contacts/{cid}', headers=GHL_H)
    if r.status_code != 200:
        return None
    return r.json().get('contact')


def _scan_messages(contact_id):
    """Return all messages across this contact's conversations (most recent N
    per conversation). Centralized so reply-detection and outbound-dedupe
    share a single GHL fetch path."""
    r = http('GET', 'https://services.leadconnectorhq.com/conversations/search',
             headers=GHL_H,
             params={'locationId': GHL_LOCATION, 'contactId': contact_id, 'limit': 5})
    if r.status_code != 200:
        return []
    convs = r.json().get('conversations', [])
    out = []
    for conv in convs:
        cid = conv.get('id')
        if not cid:
            continue
        rm = http('GET', f'https://services.leadconnectorhq.com/conversations/{cid}/messages',
                  headers=GHL_H, params={'limit': 50})
        if rm.status_code != 200:
            continue
        msgs = (rm.json().get('messages') or {}).get('messages', [])
        out.extend(msgs)
    return out


def has_inbound_since(contact_id, after_iso, messages=None):
    """Look for any inbound message from contact after the given timestamp.

    Returns (replied: bool, when_iso: str|None, text: str|None) so the caller
    can classify the reply (negative/positive/wrong-number) before flagging Jeff.

    Defense-in-depth: callers should invoke this for EVERY contact (not just
    those with sms_count > 0). State persistence has bitten us before — if
    a fresh-looking state file claims sms_count == 0 but the conversation
    has inbound traffic, we still want to bail out before re-messaging.

    `messages` may be supplied to avoid re-fetching the conversation; if
    omitted, falls back to a fresh scan.
    """
    after = parse_iso(after_iso)
    if not after:
        return False, None, None
    msgs = messages if messages is not None else _scan_messages(contact_id)
    for m in msgs:
        if m.get('direction') == 'inbound':
            msg_dt = parse_iso(m.get('dateAdded', ''))
            if msg_dt and msg_dt > after:
                return True, msg_dt.isoformat(), (m.get('body') or m.get('message') or '').strip()
    return False, None, None


def latest_outbound_at(contact_id, messages=None):
    """Return ISO timestamp of the most recent outbound SMS to this contact,
    or None if no outbound SMS exists in their conversation history.

    Used to anchor reply detection when our local state file has no
    last_sms_at: GHL is the source of truth for "did we ever message them",
    and any inbound message AFTER our last outbound is a real reply.

    `messages` may be supplied to avoid re-fetching the conversation; if
    omitted, falls back to a fresh scan.
    """
    latest_dt = None
    msgs = messages if messages is not None else _scan_messages(contact_id)
    for m in msgs:
        if m.get('direction') != 'outbound':
            continue
        mtype = m.get('messageType') or m.get('type') or ''
        if 'SMS' not in str(mtype).upper() and str(mtype) != '1':
            continue
        msg_dt = parse_iso(m.get('dateAdded', ''))
        if msg_dt and (latest_dt is None or msg_dt > latest_dt):
            latest_dt = msg_dt
    return latest_dt.isoformat() if latest_dt else None


# Tag prefixes that indicate a reply has already been routed (Jeff has been
# tasked, the contact has been DND'd, etc.). If the live GHL contact already
# carries any of these, we MUST NOT recreate tasks, even if our state file
# disagrees. This is the round-2 hotfix tag-dedupe guard.
REPLIED_TAG_PREFIXES = (
    'replied-stage-',
    'replied-positive',
    'replied-neutral',
    'replied-negative',
    'replied-wrong',
    'replied-hard_stop',
    'replied-hostile',
    'replied-stop',
    'dnd-opt-out',
    'not-interested',
    'wrong-number',
)


def already_routed_reply(contact):
    """True if the live GHL contact already has any tag indicating that an
    earlier reply has been processed (Jeff tasked, DND'd, marked wrong-number,
    etc.). Used to suppress duplicate task creation."""
    tags = contact.get('tags') or []
    for t in tags:
        tl = (t or '').lower()
        for prefix in REPLIED_TAG_PREFIXES:
            if tl.startswith(prefix):
                return True
    return False


def last_outbound_within(contact_id, hours, messages=None):
    """Returns True if there is an outbound SMS to this contact within the
    last `hours` hours. Used as a "did we already text them recently?" guard
    so a state-file regression can't double-send within a single window.

    `messages` may be supplied to avoid re-fetching the conversation; if
    omitted, falls back to a fresh scan.
    """
    cutoff = now_utc() - timedelta(hours=hours)
    msgs = messages if messages is not None else _scan_messages(contact_id)
    for m in msgs:
        if m.get('direction') != 'outbound':
            continue
        # GHL message types: SMS=1, Email=3, ... we only care about SMS.
        # The `messageType` field is sometimes absent on older records, so
        # fall back to checking `type` too.
        mtype = m.get('messageType') or m.get('type') or ''
        if 'SMS' not in str(mtype).upper() and str(mtype) != '1':
            continue
        msg_dt = parse_iso(m.get('dateAdded', ''))
        if msg_dt and msg_dt > cutoff:
            return True, msg_dt.isoformat()
    return False, None


# ── Reply classifier ─────────────────────────────────────────────────────────
# Hard-stop keywords trigger DND immediately without an LLM call (cheap + fast).
HARD_STOP_RE = re.compile(
    r'\b(stop|stopall|unsubscribe|cancel|end|quit|remove\s*me|opt\s*out|leave\s*me\s*alone)\b',
    re.IGNORECASE)
WRONG_NUMBER_RE = re.compile(
    r'\b(wrong\s*number|not\s*me|no\s*such\s*person|never\s*owned|don.?t\s*own)\b',
    re.IGNORECASE)
HARD_NEG_RE = re.compile(
    r'(f[\*u]+ck|piss\s*off|go\s*to\s*hell|don.?t\s*(text|message|contact|call)\s*me|'
    r'do\s*not\s*(text|message|contact|call)\s*me|harass|sue\s*you|lawyer|attorney|tcpa)',
    re.IGNORECASE)


CLASSIFY_SYSTEM = """You classify a one-line SMS reply from a homeowner to a real estate investor's outreach.

Return ONLY one of these tokens, nothing else:
- NEGATIVE   — they're declining, not interested, annoyed, but not legally hostile (e.g. "no thanks", "not selling", "leave me alone")
- WRONG      — wrong number / not the owner / never owned this property
- POSITIVE   — interested, wants to talk, asks about offer, gives info
- NEUTRAL    — ambiguous, asking who you are, requesting more info before deciding
- HOSTILE    — threatens legal action, profanity directed at sender, demands stop

Be strict on POSITIVE — only if there's clear interest. Default ambiguity to NEUTRAL."""


def classify_reply(text):
    """Returns one of: HARD_STOP, WRONG, HOSTILE, NEGATIVE, POSITIVE, NEUTRAL,
    or None on transient Anthropic API failure (429/5xx/exception). The caller
    is expected to distinguish None ("API hiccup, try again next tick") from a
    concrete verdict.

    Free regex check first; falls back to Claude only when ambiguous."""
    if not text:
        return 'NEUTRAL'
    if HARD_STOP_RE.search(text):
        return 'HARD_STOP'
    if HARD_NEG_RE.search(text):
        return 'HOSTILE'
    if WRONG_NUMBER_RE.search(text):
        return 'WRONG'
    if not ANTHROPIC_KEY:
        # No LLM configured — treat as POSITIVE so Jeff sees it.
        return 'POSITIVE'
    try:
        r = http('POST', 'https://api.anthropic.com/v1/messages',
                 headers={'x-api-key': ANTHROPIC_KEY,
                          'anthropic-version': '2023-06-01',
                          'content-type': 'application/json'},
                 json={'model': 'claude-haiku-4-5-20251001',
                       'max_tokens': 8,
                       'system': CLASSIFY_SYSTEM,
                       'messages': [{'role': 'user', 'content': text[:500]}]},
                 timeout=20)
        if r.status_code == 429 or r.status_code >= 500:
            print(f'  classify_reply: Anthropic transient {r.status_code}; deferring')
            return None
        if r.status_code != 200:
            # 4xx other than 429: treat as ambiguous-positive (don't infinitely defer
            # on auth errors, etc.) so Jeff still sees the reply.
            print(f'  classify_reply: Anthropic non-200 {r.status_code}; falling back POSITIVE')
            return 'POSITIVE'
        token = r.json()['content'][0]['text'].strip().upper().split()[0]
        if token in ('NEGATIVE', 'WRONG', 'POSITIVE', 'NEUTRAL', 'HOSTILE'):
            return token
        return 'POSITIVE'
    except Exception as e:
        print(f'  classify_reply: exception {e!r}; deferring')
        return None


REPLY_ATTEMPT_LIMIT = 3


def set_dnd(contact_id, reason):
    """Set GHL DND flags so we never SMS this contact again."""
    payload = {
        'dnd': True,
        'dndSettings': {
            'SMS':   {'status': 'active', 'message': f'auto: {reason}', 'code': 'opt_out'},
            'Call':  {'status': 'active', 'message': f'auto: {reason}', 'code': 'opt_out'},
            'Email': {'status': 'active', 'message': f'auto: {reason}', 'code': 'opt_out'},
        },
    }
    try:
        http('PUT', f'https://services.leadconnectorhq.com/contacts/{contact_id}',
             headers=GHL_H, json=payload)
    except Exception as e:
        print(f'  set_dnd failed: {e}')


def send_sms(contact_id, message, from_number):
    body = {
        'type': 'SMS',
        'contactId': contact_id,
        'message': message,
        'fromNumber': from_number,
    }
    r = http('POST', 'https://services.leadconnectorhq.com/conversations/messages',
             headers=GHL_H, json=body)
    if r.status_code in (200, 201):
        try:
            return True, r.json().get('messageId', '')
        except Exception:
            return True, ''
    return False, f'{r.status_code} {r.text[:200]}'


def add_tag(contact_id, tag):
    try:
        http('POST', f'https://services.leadconnectorhq.com/contacts/{contact_id}/tags',
             headers=GHL_H, json={'tags': [tag]})
    except Exception as e:
        print(f'  tag add failed: {e}')


def slack_post(text):
    if not SLACK_WEBHOOK:
        return
    try:
        requests.post(SLACK_WEBHOOK, json={'text': text}, timeout=10)
    except Exception:
        pass


def create_task(contact_id, user_id, title, body, due_in_days=0):
    due = (now_utc() + timedelta(days=due_in_days)).isoformat()
    try:
        r = http('POST', f'https://services.leadconnectorhq.com/contacts/{contact_id}/tasks',
                 headers=GHL_H,
                 json={'title': title, 'body': body, 'dueDate': due,
                       'completed': False, 'assignedTo': user_id})
        return r.status_code in (200, 201)
    except Exception as e:
        print(f'  task create failed: {e}')
        return False


def process_lead(entry, contact, state):
    cid = entry['cid']
    stage_name = entry['stage_name']

    # state for this contact (init or pull)
    cs = state.setdefault(cid, {})

    # If stage changed since last run, reset SMS sequence for the new stage
    if cs.get('stage_name') != stage_name:
        cs.update({
            'stage_name':       stage_name,
            'stage_entered_at': now_utc().isoformat(),
            'sms_count':        0,
            'last_sms_at':      None,
            'last_from_number': None,
            'replied':          False,
            'replied_at':       None,
            'dormant':          False,
        })

    # Skip if already replied or dormant
    if cs.get('replied') or cs.get('dormant'):
        return 'skipped'

    # Respect DND — don't text people who opted out
    dnd_settings = contact.get('dndSettings') or {}
    sms_dnd = (dnd_settings.get('SMS') or {}).get('status') == 'active'
    if contact.get('dnd') or sms_dnd:
        cs['dormant'] = True   # treat DND as terminal — no point retrying
        cs['dnd'] = True
        add_tag(cid, 'dormant-sms-dnd')
        return 'dnd'

    # Don't SMS to a contact without a phone number
    if not (contact.get('phone') or '').strip():
        return 'no-phone'

    name  = f"{contact.get('firstName','')} {contact.get('lastName','')}".strip()
    addr1 = (contact.get('address1') or '').strip()

    # Reply detection — DEFENSE IN DEPTH, time-bounded.
    #
    # Round-1 fix (PR #1) made this run for EVERY contact regardless of
    # sms_count, to survive a wiped state file. But the fallback used
    # has_any_inbound() — i.e. "any inbound message ever" — which flagged
    # contacts who had replied weeks ago and were already triaged by Jeff.
    # That dumped ~96 duplicate tasks in one run.
    #
    # Round-2 fix (this hotfix):
    #   1. Always require a time anchor. Build it as the most recent of
    #      (state.last_sms_at, state.stage_entered_at, live GHL last
    #      outbound SMS). Inbound only counts if it's strictly newer than
    #      the anchor — i.e. a reply to *our most recent outreach*.
    #   2. If no anchor exists at all (no prior outreach in state OR in
    #      GHL), do NOT classify as replied. We cannot tell a fresh reply
    #      from a years-old historical message; the safe default is to
    #      let normal cadence run (which will set an anchor on the first
    #      send) and check on the next tick.
    #   3. Even after a positive classification, if the live contact
    #      already carries any replied-* / dnd-opt-out / not-interested /
    #      wrong-number tag, suppress task creation — Jeff has already
    #      been routed to this person. Update state and move on.
    # W1/W2: fetch the contact's messages once per lead and reuse the result
    # across latest_outbound_at / has_inbound_since / last_outbound_within. The
    # GHL conversations API is the slowest hop in this loop, so collapsing
    # three round trips into one materially shortens each tick.
    messages = _scan_messages(cid)

    candidates = [cs.get('last_sms_at'), cs.get('stage_entered_at')]
    ghl_last_out = latest_outbound_at(cid, messages=messages)
    if ghl_last_out:
        candidates.append(ghl_last_out)
    candidate_dts = [parse_iso(c) for c in candidates if c]
    candidate_dts = [d for d in candidate_dts if d]
    if candidate_dts:
        anchor_dt = max(candidate_dts)
        anchor = anchor_dt.isoformat()
        replied, when, reply_text = has_inbound_since(cid, anchor, messages=messages)
    else:
        # No anchor — no prior outreach we can confirm. Don't classify.
        replied, when, reply_text = False, None, None
    if replied:
        # W5: distinguish a real ambiguous-NEUTRAL verdict from a transient
        # Anthropic failure. classify_reply now returns None for 429/5xx/
        # exception. We retry up to REPLY_ATTEMPT_LIMIT ticks; after that we
        # fall back to POSITIVE so Jeff still sees the reply.
        verdict = classify_reply(reply_text or '')
        if verdict is None:
            attempts = (cs.get('reply_attempts') or 0) + 1
            cs['reply_attempts'] = attempts
            if attempts < REPLY_ATTEMPT_LIMIT:
                print(f'  defer reply classification for {cid} (attempt {attempts}/{REPLY_ATTEMPT_LIMIT})')
                # Do NOT mark replied=True — we want this tick's anchor preserved
                # so the next run picks up the same inbound and re-classifies.
                return 'reply-classify-deferred'
            print(f'  reply classify failed {attempts}x for {cid}; falling back POSITIVE')
            verdict = 'POSITIVE'
        # Successful classification — clear retry counter
        cs['reply_attempts'] = 0
        cs['replied']      = True
        cs['replied_at']   = when
        cs['reply_text']   = (reply_text or '')[:500]
        cs['reply_class']  = verdict

        # Tag-dedupe guard: if the live contact already carries a replied-*
        # tag, an earlier run (or a human) already routed this. Mark replied
        # in our state so we stop re-checking, but DO NOT create new tasks
        # or fire slack notifications.
        if already_routed_reply(contact):
            print(f'  skip {cid}: contact already has replied-* tag — task creation suppressed')
            return f'replied-{verdict.lower()}-already-routed'

        # W7: empty NEUTRAL reply — GHL occasionally surfaces inbound rows with
        # no body (likely MMS-without-text or stripped delivery receipts). Don't
        # waste Jeff/Mike on a blank task. We still mark replied=True so future
        # ticks bail out, but no tag/task/Slack noise.
        if verdict == 'NEUTRAL' and not (reply_text or '').strip():
            print(f'  skip {cid}: empty NEUTRAL reply — no task created, replied=True for bailout')
            return 'replied-neutral-empty'

        if verdict in ('HARD_STOP', 'HOSTILE'):
            # Legal-protection path: stop forever, no Jeff task, no Mike review
            set_dnd(cid, verdict.lower())
            add_tag(cid, 'dnd-opt-out')
            add_tag(cid, f'replied-{verdict.lower()}-{stage_name}')
            slack_post(f'🚫 *{name}* opted out ({verdict}) — DND set, no callback. {addr1}')
            return f'replied-{verdict.lower()}'

        if verdict == 'WRONG':
            set_dnd(cid, 'wrong-number')
            add_tag(cid, 'wrong-number')
            add_tag(cid, f'replied-wrong-{stage_name}')
            slack_post(f'☎️ *{name}* — wrong number, DND set. {addr1}')
            return 'replied-wrong'

        if verdict == 'NEGATIVE':
            # Polite no — don't waste Jeff's time, but no DND (still allowed to outreach later)
            add_tag(cid, 'not-interested')
            add_tag(cid, f'replied-negative-{stage_name}')
            slack_post(f'👎 *{name}* — declined politely, no callback task. {addr1}')
            return 'replied-negative'

        # POSITIVE or NEUTRAL → real lead, Jeff handles
        add_tag(cid, f'replied-stage-{stage_name}')
        create_task(cid, USER_JEFF,
                    f'Call back: {name} ({addr1})',
                    f'Seller replied to {stage_name.upper()} SMS. Reply: "{(reply_text or "")[:200]}". Call back today.',
                    due_in_days=0)
        create_task(cid, USER_MIKE,
                    f'REVIEW: Did Jeff call {name} back?',
                    f'Verify Jeff completed the callback. Reply text: "{(reply_text or "")[:200]}"',
                    due_in_days=1)
        slack_post(f'💬 *{name}* replied ({verdict}) to {stage_name.upper()} — {addr1}. Jeff has callback task.')
        return f'replied-{verdict.lower()}'

    sms_count = cs.get('sms_count', 0)
    cfg = STAGE_CONFIG[stage_name]

    # All max touches sent — wait dormant_wait, then mark dormant
    if sms_count >= cfg['max_touches']:
        d = days_since(cs.get('last_sms_at'))
        if d is not None and d >= cfg['dormant_wait']:
            cs['dormant'] = True
            add_tag(cid, 'dormant-sms')
            # Active stages get a follow-up task; reactivation stages just get tagged dormant
            if stage_name in ('qualified', 'lao', 'rr', 'mao'):
                create_task(cid, USER_JEFF,
                            f'Manual call attempt: {name} ({addr1})',
                            f'Seller never replied to {cfg["max_touches"]} SMS in stage {stage_name.upper()}. Try a manual call.',
                            due_in_days=0)
                create_task(cid, USER_MIKE,
                            f'REVIEW: Did Jeff call {name}?',
                            'Verify Jeff made the manual call.',
                            due_in_days=2)
                slack_post(f'📞 *{name}* went dormant in {stage_name.upper()} — no replies after {cfg["max_touches"]} SMS. Jeff to call manually. {addr1}')
            return 'dormant'
        return 'wait-dormant'

    # Should we send next SMS?
    interval = cfg['interval_days']
    if cs.get('last_sms_at'):
        d = days_since(cs['last_sms_at'])
        if d is None or d < interval:
            return 'wait'
    else:
        d = days_since(cs.get('stage_entered_at'))
        if d is None or d < interval:
            return 'wait'

    # Compose & send
    if not addr1:
        addr1 = (contact.get('city') or 'your property').strip() or 'your property'
    first = (contact.get('firstName') or 'there').strip() or 'there'
    template = TEMPLATES[stage_name][sms_count]
    try:
        message = template.format(first_name=first, address1=addr1)
    except (KeyError, IndexError, ValueError) as exc:
        # Sheet override slipped through validation OR a hardcoded template was
        # edited badly: fall back to the immutable HARDCODED_TEMPLATES for the
        # same stage/index so we still send something sensible. W6 belt-and-
        # braces.
        print(f'  template format error stage={stage_name} idx={sms_count}: {exc!r}; using hardcoded')
        fallback_stage = HARDCODED_TEMPLATES.get(stage_name) or HARDCODED_TEMPLATES['qualified']
        fallback_idx   = min(sms_count, len(fallback_stage) - 1)
        message = fallback_stage[fallback_idx].format(first_name=first, address1=addr1)
    state_code = (contact.get('state') or '').strip().upper()
    from_num   = from_number_for(state_code, sms_count, stage_name)

    # Defense-in-depth: even if state file says we should send, check the live
    # GHL conversation for an outbound SMS in the last 4 hours. If something
    # else (a previous run with a stale state file, a manual send by Jeff, an
    # accidental retry) has already messaged this contact recently, skip and
    # don't double-tap them.
    sent_recently, recent_when = last_outbound_within(cid, hours=4, messages=messages)
    if sent_recently:
        print(f'  skip {cid}: outbound SMS already sent within last 4h at {recent_when}')
        # Best-effort: align our state with reality so we don't keep retrying
        # the same touch on every cron tick.
        cs['last_sms_at'] = cs.get('last_sms_at') or recent_when
        return 'skip-recent-outbound'

    ok, info = send_sms(cid, message, from_num)
    if ok:
        cs['sms_count']        = sms_count + 1
        cs['last_sms_at']      = now_utc().isoformat()
        cs['last_from_number'] = from_num
        add_tag(cid, f'stage-{stage_name}-sms{sms_count + 1}')
        return f'sent#{sms_count + 1}'
    return f'fail:{info[:60]}'


def in_business_hours_et():
    """9 AM - 8 PM Eastern. Handles EST/EDT correctly via zoneinfo."""
    h = datetime.now(ET).hour
    return 9 <= h < 20


def read_sheet_config():
    """Read kill switch and live templates from Google Sheet.
    Returns (kill_switch_on: bool, templates: dict).
    Falls back to HARDCODED_TEMPLATES if anything fails."""
    if not SHEET_ID:
        return True, {k: list(v) for k, v in HARDCODED_TEMPLATES.items()}
    token_json = os.environ.get('GOOGLE_TOKEN_JSON', '')
    if not token_json:
        return True, {k: list(v) for k, v in HARDCODED_TEMPLATES.items()}
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        SCOPES = ['https://www.googleapis.com/auth/drive',
                  'https://www.googleapis.com/auth/spreadsheets']
        creds = Credentials.from_authorized_user_info(json.loads(token_json), SCOPES)
        if not creds.valid and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        svc = build('sheets', 'v4', credentials=creds)

        # Kill switch — Settings!B2
        kill_on = True
        try:
            r = svc.spreadsheets().values().get(
                spreadsheetId=SHEET_ID, range="Settings!B2"
            ).execute()
            val = (r.get('values') or [[]])[0]
            if val and str(val[0]).strip().upper() in ('OFF', 'FALSE', 'NO', 'DISABLED'):
                kill_on = False
        except Exception:
            pass

        # Templates — Templates!A2:C200. Start from the immutable hardcoded
        # set so a half-filled sheet can never partially-clobber what we ship.
        templates = {k: list(v) for k, v in HARDCODED_TEMPLATES.items()}
        try:
            r = svc.spreadsheets().values().get(
                spreadsheetId=SHEET_ID, range="Templates!A2:C200"
            ).execute()
            rows = r.get('values', [])
            built = {}
            for row in rows:
                if len(row) < 3:
                    continue
                stage = (row[0] or '').strip().lower()
                try:
                    idx = int(row[1]) - 1
                except Exception:
                    continue
                msg = row[2]
                if not msg or not stage:
                    continue
                built.setdefault(stage, [])
                while len(built[stage]) <= idx:
                    built[stage].append('')
                built[stage][idx] = msg
            # Merge: only override stages where the sheet has all required slots
            # AND every slot contains the {first_name} and {address1} placeholders
            # we render at send-time. Otherwise the format() call in process_lead
            # silently drops the values and we ship a template variable to the
            # seller. W6 hardening.
            REQUIRED_PLACEHOLDERS = ('{first_name}', '{address1}')
            for stage, msgs in built.items():
                expected = len(HARDCODED_TEMPLATES.get(stage, []))
                if not (expected and len(msgs) >= expected and all(msgs[:expected])):
                    continue
                bad = [
                    i for i, m in enumerate(msgs[:expected])
                    if not all(p in m for p in REQUIRED_PLACEHOLDERS)
                ]
                if bad:
                    print(
                        f'  Sheet template override REJECTED for stage={stage}: '
                        f'slots {bad} missing {REQUIRED_PLACEHOLDERS}; using hardcoded.'
                    )
                    continue
                templates[stage] = msgs[:expected]
        except Exception:
            pass

        return kill_on, templates
    except Exception as e:
        print(f'  Sheet config read failed: {e}; using defaults.')
        return True, {k: list(v) for k, v in HARDCODED_TEMPLATES.items()}


def process_call_needed_cadence(state):
    """For contacts tagged 'from-call-needed', create a Jeff+Mike task pair every 48h
    until they reply OR 6 days have elapsed. After 6 days, remove the tag so the
    standard SMS sequence takes over. Dedups against existing open tasks."""
    # Search GHL by tag
    page = 1
    processed = 0
    transitioned = 0
    while True:
        # NOTE: GHL's contact search endpoint expects POST despite the URL.
        # We pass the tag filter in the body — the OLD behavior here used a
        # GET with a query string that fell back to a *location-wide* fetch
        # of every contact (~1357 in this account) any time the POST 404'd,
        # which then triggered the call-needed branch on every contact and
        # could create thousands of stray tasks. W8: just bail loudly.
        r = http('POST', 'https://services.leadconnectorhq.com/contacts/search',
                 headers=GHL_H,
                 json={'locationId': GHL_LOCATION,
                       'pageLimit': 100,
                       'page': page,
                       'filters': [{'field': 'tags', 'operator': 'contains', 'value': 'from-call-needed'}]})
        if r.status_code != 200:
            print(
                f'  call-needed search failed (status={r.status_code}); '
                f'aborting this tick — no location-wide fallback. '
                f'body={r.text[:200] if hasattr(r, "text") else ""!r}'
            )
            slack_post(
                f':warning: SMS follow-up: call-needed search returned '
                f'{r.status_code}. Cadence skipped this tick.'
            )
            break
        contacts = r.json().get('contacts', []) or []
        if not contacts:
            break
        for c in contacts:
            tags = c.get('tags', []) or []
            if 'from-call-needed' not in tags:
                continue
            cid = c.get('id')
            if not cid: continue
            cs = state.setdefault(cid, {})

            # Has the seller replied? (any inbound message in last 6 days)
            anchor = cs.get('cn_started') or cs.get('stage_entered_at') or now_utc().isoformat()
            replied, _, _ = has_inbound_since(cid, anchor)
            if replied:
                # Stop the cadence — standard reply handler in main loop will process tasks
                http('DELETE', f'https://services.leadconnectorhq.com/contacts/{cid}/tags',
                     headers=GHL_H, json={'tags': ['from-call-needed']})
                cs['cn_done'] = True
                continue

            # Init cadence start tracker
            if 'cn_started' not in cs:
                cs['cn_started'] = now_utc().isoformat()
                cs['cn_attempts'] = 0
                cs['cn_last_at'] = None

            elapsed = days_since(cs['cn_started']) or 0
            if elapsed >= 6:
                # Transition to standard SMS sequence
                http('DELETE', f'https://services.leadconnectorhq.com/contacts/{cid}/tags',
                     headers=GHL_H, json={'tags': ['from-call-needed']})
                cs['cn_done'] = True
                transitioned += 1
                continue

            # Time for the next task pair? Every 48h.
            last = cs.get('cn_last_at')
            if last:
                d = days_since(last) or 0
                if d < 2.0:
                    continue

            name  = f"{c.get('firstName','')} {c.get('lastName','')}".strip() or '(no name)'
            addr  = (c.get('address1') or c.get('city') or '').strip()
            jeff_title = f'CALL: {name} ({addr})'
            jeff_body  = 'Lead has not been reached yet. Try again.'
            mike_title = f'REVIEW: Did Jeff call {name}? ({addr})'
            mike_body  = 'Verify Jeff attempted the call. Mark complete after confirming.'

            j_made = create_task(cid, USER_JEFF, jeff_title, jeff_body, due_in_days=0)
            m_made = create_task(cid, USER_MIKE, mike_title, mike_body, due_in_days=1)
            if j_made or m_made:
                cs['cn_attempts'] = (cs.get('cn_attempts') or 0) + 1
                cs['cn_last_at'] = now_utc().isoformat()
                processed += 1
                slack_post(f'📞 Manual call retry queued: *{name}* ({addr}) — attempt {cs["cn_attempts"]}/3')
        if len(contacts) < 100:
            break
        page += 1
        time.sleep(0.2)
    return processed, transitioned


def write_status(success, summary='', error=''):
    """Write last-run status so dashboards can surface failures."""
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump({
                'success':   success,
                'timestamp': now_utc().isoformat(),
                'summary':   summary,
                'error':     error[:500],
            }, f, indent=2)
    except Exception:
        pass


def _count_sent(counts):
    """Return the total number of successful sends across all stages.

    `counts` is the per-result dict built up in main(); successful sends
    show up as `sent#1`, `sent#2`, ... `sent#6`.
    """
    return sum(v for k, v in (counts or {}).items() if k.startswith('sent#'))


def update_cadence_health(counts):
    """Update cadence_health.json with today's send count and post a Slack
    alert if the last CADENCE_STUCK_DAYS in-business-hours days all had
    zero sends. Safe to call from any tick: outside-business-hours runs
    are recorded but don't count toward the streak."""
    today_et = datetime.now(ET).date().isoformat()
    in_bh = in_business_hours_et()
    sends = _count_sent(counts)

    try:
        with open(CADENCE_HEALTH_FILE) as f:
            health = json.load(f)
    except Exception:
        health = {}
    days = health.get('days') or []

    # Find or append today's entry.
    today_entry = next((d for d in days if d.get('date') == today_et), None)
    if today_entry is None:
        today_entry = {'date': today_et, 'sends': 0, 'had_business_hour_run': False}
        days.append(today_entry)
    today_entry['sends'] = (today_entry.get('sends') or 0) + sends
    if in_bh:
        today_entry['had_business_hour_run'] = True

    # Keep last 30 days only.
    days = sorted(days, key=lambda d: d.get('date') or '')[-30:]
    health['days'] = days

    # Compute the streak of consecutive in-business-hours days with zero
    # sends, ignoring today (still in progress) and ignoring days that
    # never had a business-hour run (e.g. workflow disabled, holidays).
    streak = 0
    for d in reversed(days[:-1]):  # exclude today
        if not d.get('had_business_hour_run'):
            continue
        if (d.get('sends') or 0) > 0:
            break
        streak += 1

    last_alerted = health.get('last_alerted_at')
    last_alerted_dt = parse_iso(last_alerted) if last_alerted else None
    suppress_window_days = CADENCE_STUCK_DAYS  # don't alert more than once per streak window

    if streak >= CADENCE_STUCK_DAYS:
        already_alerted_recently = (
            last_alerted_dt is not None
            and (now_utc() - last_alerted_dt).days < suppress_window_days
        )
        if not already_alerted_recently:
            slack_post(
                f':warning: ACQ SMS cadence looks STUCK — '
                f'{streak} consecutive in-business-hours days with zero sends. '
                f'Check sms_state.json, kill switch (Settings!B2), '
                f'and pipeline stage assignments.'
            )
            health['last_alerted_at'] = now_utc().isoformat()
        else:
            print(
                f'  cadence health: streak={streak} days zero sends, '
                f'but already alerted at {last_alerted}; suppressing.'
            )

    try:
        with open(CADENCE_HEALTH_FILE, 'w') as f:
            json.dump(health, f, indent=2, sort_keys=True)
    except Exception as e:
        print(f'  cadence_health write failed: {e}')


def main():
    et_now = datetime.now(ET)
    print(f'[{et_now.strftime("%Y-%m-%d %I:%M %p ET")}] SMS Follow-Up starting...')
    counts = {}

    try:
        # Kill switch + live templates from Google Sheet
        kill_on, live_templates = read_sheet_config()
        if not kill_on:
            print('!! KILL SWITCH IS OFF — Settings!B2 in dashboard sheet says OFF. Skipping all SMS sends.')
            print('   (Dashboard will still update.)')
            # Don't update cadence_health when the kill switch is OFF — that's
            # a deliberate human action, not a "stuck" state.
            write_status(True, 'kill-switch off; no sends')
            return
        global TEMPLATES
        TEMPLATES = live_templates
        print(f'SMS Automation: ON  |  Templates loaded for stages: {list(TEMPLATES.keys())}')

        if not in_business_hours_et():
            print(f'Outside business hours (9 AM - 8 PM ET); current ET hour: {et_now.hour}. Skipping sends.')
            # Outside-hours runs still record (so an all-day-quiet day shows
            # `had_business_hour_run=False` and doesn't count toward the
            # streak), but no Slack alert here.
            update_cadence_health(counts)
            write_status(True, f'outside business hours (hour={et_now.hour} ET)')
            return

        state    = load_state()
        entries  = fetch_active_leads()
        print(f'Active leads in stages 1-7: {len(entries)}')

        # Build/refresh shared contacts cache for the dashboards (avoids each one
        # re-fetching every contact).
        contacts_cache = {}
        for e in entries:
            contact = get_contact(e['cid'])
            if not contact:
                continue
            contacts_cache[e['cid']] = contact
            result = process_lead(e, contact, state)
            counts[result] = counts.get(result, 0) + 1
            time.sleep(0.3)

        try:
            with open(CONTACTS_CACHE, 'w') as f:
                json.dump({'fetched_at': now_utc().isoformat(),
                           'contacts': contacts_cache}, f)
        except Exception as e:
            print(f'  contacts cache write failed: {e}')

        cn_processed, cn_transitioned = process_call_needed_cadence(state)
        if cn_processed or cn_transitioned:
            print(f'Call-needed cadence: {cn_processed} retry tasks created, {cn_transitioned} graduated to SMS')

        save_state(state)
        update_cadence_health(counts)
        print('\nSummary:', json.dumps(counts, indent=2))
        write_status(True, json.dumps(counts))
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f'\n!! SMS run failed: {e}\n{tb}')
        write_status(False, json.dumps(counts), f'{e}: {tb[-300:]}')
        raise


if __name__ == '__main__':
    main()
