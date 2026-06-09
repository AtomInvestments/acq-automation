"""
O2 entry-offer A/B/C SMS send pipeline.

Wires:
- The deterministic variant assigner (sms_variant_assigner.py) → assigns A/B/C once per contact
- The existing GHL conversations send path (POST /conversations/messages, type=SMS)
  This is the same surface sms_followup.py uses — GHL relays through the location's SMS-registered
  numbers. No Twilio API call; no SmarterContact; no GHL workflow Send-SMS step.

Gating:
- `o2_test_config.json::global.sms_paused` — TOP-LEVEL kill switch. When true, the script logs
  but never calls send_sms(). Default true. Flipping false is a deliberate strategic decision
  separate from this PR.
- `o2_test_config.json::campaigns.o2_entry_offer.active` — per-campaign on/off.

Outcome tracking (sms_test_state.json):
  For each contact: {variant, sent_at, replied, replied_at, qualified, qualified_at,
                     appointment_set, contract}
The dashboard generator (sms_test_dashboard.py) consumes this file + the GHL pipeline + the
SMS Variant custom field to produce site/sms-test.html.

This script targets the "fresh inbound, never-messaged-before" pool — defined as opportunities
in the ACQ pipeline stage 0 (Unqualified / fresh inbound) with NO outbound SMS history.
Once an O2 send fires, the contact moves into the normal sms_followup.py qualified/lao/rr/mao
cadence on whatever the dispatcher promotes them to.
"""
import json
import os
import time
from datetime import datetime, timezone
from typing import Optional

import requests

from sms_variant_assigner import (
    STATE_FILE as VARIANT_STATE_FILE,
    assign_variant,
    load_state as load_variant_state,
    save_state as save_variant_state,
)

GHL_TOKEN = os.environ.get("GHL_TOKEN", "")
GHL_LOCATION = "RCkiUmWqXX4BYQ39JXmm"
PIPELINE_ID = "O8wzIa6E3SgD8HLg6gh9"
STAGE_UNQUALIFIED = "c1d23905-7096-439c-9a31-f8db5b2b53d0"  # ACQ stage 0
STAGE_QUALIFIED = "a17517be-8d1a-49fd-bd53-b9128a66e242"
STAGE_CONTRACT = "5f7b3c70-6e9c-43b1-a8f2-7e3e3a3bcb55"  # placeholder; verify in GHL

CONFIG_FILE = "o2_test_config.json"
TEST_STATE_FILE = "sms_test_state.json"

GHL_H = {
    "Authorization": f"Bearer {GHL_TOKEN}",
    "Version": "2021-07-28",
    "Content-Type": "application/json",
}

HTTP_TIMEOUT = 30


def http(method: str, url: str, **kw):
    kw.setdefault("timeout", HTTP_TIMEOUT)
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


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_config() -> dict:
    with open(CONFIG_FILE) as f:
        return json.load(f)


def save_config(cfg: dict) -> None:
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def load_test_state() -> dict:
    if os.path.exists(TEST_STATE_FILE):
        try:
            return json.load(open(TEST_STATE_FILE))
        except Exception:
            return {}
    return {}


def save_test_state(state: dict) -> None:
    with open(TEST_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)


def find_variant_field_id() -> Optional[str]:
    """Look up the GHL custom field ID for 'contact.sms_variant'. Returns None if not provisioned."""
    r = http(
        "GET",
        f"https://services.leadconnectorhq.com/locations/{GHL_LOCATION}/customFields",
        headers={"Authorization": f"Bearer {GHL_TOKEN}", "Version": "2021-07-28"},
        params={"model": "contact"},
    )
    if r.status_code != 200:
        return None
    for cf in r.json().get("customFields", []):
        if cf.get("fieldKey") == "contact.sms_variant":
            return cf.get("id")
    return None


def fetch_o2_eligible() -> list:
    """Opportunities in the Unqualified stage, no outbound SMS yet.

    The 'no outbound SMS yet' check happens per-contact via _has_outbound (cheap-ish; we
    only call it for ones that pass the stage filter). This keeps the candidate pool to
    the fresh inbound cohort the O2 wedge is designed for.
    """
    entries = []
    page = 1
    while True:
        r = http(
            "GET",
            "https://services.leadconnectorhq.com/opportunities/search",
            headers={"Authorization": f"Bearer {GHL_TOKEN}", "Version": "2021-07-28"},
            params={
                "location_id": GHL_LOCATION,
                "pipeline_id": PIPELINE_ID,
                "pipeline_stage_id": STAGE_UNQUALIFIED,
                "limit": 100,
                "page": page,
            },
        )
        if r.status_code != 200:
            break
        opps = r.json().get("opportunities", []) or []
        if not opps:
            break
        for o in opps:
            if not o.get("contactId"):
                continue
            entries.append({"cid": o["contactId"], "oid": o["id"]})
        if len(opps) < 100:
            break
        page += 1
        time.sleep(0.15)
    return entries


def _has_outbound_sms(contact_id: str) -> bool:
    """True if any outbound SMS has gone to this contact (regardless of campaign)."""
    r = http(
        "GET",
        "https://services.leadconnectorhq.com/conversations/search",
        headers=GHL_H,
        params={"locationId": GHL_LOCATION, "contactId": contact_id, "limit": 5},
    )
    if r.status_code != 200:
        return False
    for conv in r.json().get("conversations", []) or []:
        cid = conv.get("id")
        if not cid:
            continue
        rm = http(
            "GET",
            f"https://services.leadconnectorhq.com/conversations/{cid}/messages",
            headers=GHL_H,
            params={"limit": 30},
        )
        if rm.status_code != 200:
            continue
        msgs = (rm.json().get("messages") or {}).get("messages", [])
        for m in msgs:
            if m.get("direction") == "outbound":
                mtype = m.get("messageType") or m.get("type") or ""
                if "SMS" in str(mtype).upper() or str(mtype) == "1":
                    return True
    return False


def get_contact(cid: str) -> Optional[dict]:
    r = http("GET", f"https://services.leadconnectorhq.com/contacts/{cid}", headers=GHL_H)
    return r.json().get("contact") if r.status_code == 200 else None


def render_template(template: str, contact: dict) -> Optional[str]:
    """Render the template with contact merge fields.

    Returns None if a required merge field is missing — caller skips the send rather
    than ship a `{first_name}` literal to the seller.
    """
    first = (contact.get("firstName") or "").strip()
    addr = (contact.get("address1") or "").strip()
    if not first or not addr:
        return None

    # Variant B: offer range. Pull from custom fields (MAO / 70% ARV) if present.
    offer_low = "—"
    offer_high = "—"
    for cf in contact.get("customFields") or []:
        # MAO sits at id zNcoeZfYp1CpVXjV5YhG; 70% ARV at R7QUzOdOnJXgoGRPwxdF.
        if cf.get("id") == "zNcoeZfYp1CpVXjV5YhG":
            try:
                offer_high = f"${int(float(cf.get('value') or 0)):,}"
            except Exception:
                pass
        if cf.get("id") == "R7QUzOdOnJXgoGRPwxdF":
            try:
                offer_low = f"${int(float(cf.get('value') or 0) * 0.85):,}"
            except Exception:
                pass

    # Variant C: noticing phrase. Pull from property_type / city / lead source as a proxy
    # until O7 ships the structured property metadata payload.
    prop_type = ""
    for cf in contact.get("customFields") or []:
        if cf.get("id") == "7xsc1QHTleEFjRJChOgA":  # Property Type
            prop_type = (cf.get("value") or "").strip().lower()
            break
    if prop_type in ("2-family", "two family", "duplex"):
        noticing = "2-family"
    elif prop_type in ("3-family", "three family", "triplex"):
        noticing = "3-family"
    elif "brick" in prop_type:
        noticing = "brick"
    elif "corner" in prop_type:
        noticing = "corner lot"
    elif prop_type:
        noticing = prop_type
    else:
        noticing = "property in that pocket"  # less-specific fallback

    try:
        return template.format(
            first_name=first,
            address1=addr,
            offer_low=offer_low,
            offer_high=offer_high,
            noticing=noticing,
        )
    except (KeyError, ValueError):
        return None


def send_sms(contact_id: str, message: str, from_number: str) -> tuple[bool, str]:
    body = {
        "type": "SMS",
        "contactId": contact_id,
        "message": message,
        "fromNumber": from_number,
    }
    r = http(
        "POST",
        "https://services.leadconnectorhq.com/conversations/messages",
        headers=GHL_H,
        json=body,
    )
    if r.status_code in (200, 201):
        return True, r.json().get("messageId", "")
    return False, f"{r.status_code} {r.text[:200]}"


def add_tag(contact_id: str, tag: str) -> None:
    try:
        http(
            "POST",
            f"https://services.leadconnectorhq.com/contacts/{contact_id}/tags",
            headers=GHL_H,
            json={"tags": [tag]},
        )
    except Exception:
        pass


def process_campaign(campaign_id: str, campaign: dict, cfg: dict) -> dict:
    """Send O2 to the eligible cohort, assigning variants on first touch."""
    counts = {"considered": 0, "sent": 0, "skipped_has_outbound": 0,
              "skipped_render": 0, "skipped_no_phone": 0, "skipped_dnd": 0, "failed": 0}

    variant_field_id = find_variant_field_id()
    if not variant_field_id:
        print("  NOTE: contact.sms_variant not yet provisioned in GHL — cache-only assignment.")
        print("  Admin task: add a TEXT custom field named 'SMS Variant' (key contact.sms_variant) "
              "and rerun. The deterministic hash means existing assignments stay stable on backfill.")

    variant_state = load_variant_state()
    test_state = load_test_state()

    sms_paused = bool(cfg.get("global", {}).get("sms_paused", True))
    from_number = campaign.get("from_number", "")
    variants_cfg = campaign.get("variants", {})

    entries = fetch_o2_eligible()
    print(f"  O2 eligible candidates: {len(entries)} (Unqualified stage)")

    for e in entries:
        cid = e["cid"]
        counts["considered"] += 1

        contact = get_contact(cid)
        if not contact:
            continue

        # Skip anyone who's already been outbound-SMS'd (likely already in cadence)
        if _has_outbound_sms(cid):
            counts["skipped_has_outbound"] += 1
            continue

        # Phone present?
        if not (contact.get("phone") or "").strip():
            counts["skipped_no_phone"] += 1
            continue

        # DND respect
        if contact.get("dnd"):
            counts["skipped_dnd"] += 1
            continue

        # Variant assignment (deterministic + persistent)
        variant = assign_variant(
            contact_id=cid,
            campaign=campaign,
            campaign_id=campaign_id,
            ghl_token=GHL_TOKEN,
            field_id=variant_field_id,
            state=variant_state,
        )

        template = (variants_cfg.get(variant) or {}).get("template", "")
        message = render_template(template, contact)
        if not message:
            counts["skipped_render"] += 1
            continue

        # Initialize per-contact outcome row (idempotent — only stamp on actual send)
        row = test_state.setdefault(cid, {
            "variant": variant,
            "sent_at": None,
            "replied": False,
            "replied_at": None,
            "qualified": False,
            "qualified_at": None,
            "appointment_set": False,
            "contract": False,
            "campaign_id": campaign_id,
        })

        # Guard: don't double-send
        if row.get("sent_at"):
            continue

        if sms_paused:
            # Dry-run: log what would have shipped, don't actually send.
            print(f"  [PAUSED] would send variant={variant} to {cid}: {message[:80]}...")
            continue

        ok, info = send_sms(cid, message, from_number)
        if ok:
            row["sent_at"] = now_iso()
            row["variant"] = variant
            add_tag(cid, f"o2-test-{variant.lower()}")
            counts["sent"] += 1
            # Stamp campaign start once
            if not campaign.get("started_at"):
                campaign["started_at"] = now_iso()
        else:
            counts["failed"] += 1
            print(f"  send fail {cid}: {info}")

        time.sleep(0.3)

    save_variant_state(variant_state)
    save_test_state(test_state)
    return counts


def reconcile_outcomes(cfg: dict) -> None:
    """Walk sms_test_state.json and refresh replied / qualified / contract flags from GHL.

    Cheap-ish: only refreshes contacts that have sent_at set and haven't yet hit terminal
    states. This is the loop the dashboard reads off of.
    """
    test_state = load_test_state()
    if not test_state:
        return

    for cid, row in test_state.items():
        if not row.get("sent_at"):
            continue
        if row.get("contract"):
            continue  # terminal

        contact = get_contact(cid)
        if not contact:
            continue

        # Reply: any inbound message after sent_at
        if not row.get("replied"):
            r = http(
                "GET",
                "https://services.leadconnectorhq.com/conversations/search",
                headers=GHL_H,
                params={"locationId": GHL_LOCATION, "contactId": cid, "limit": 5},
            )
            sent_at_dt = datetime.fromisoformat(row["sent_at"].replace("Z", "+00:00"))
            if r.status_code == 200:
                for conv in r.json().get("conversations", []) or []:
                    conv_id = conv.get("id")
                    if not conv_id:
                        continue
                    rm = http(
                        "GET",
                        f"https://services.leadconnectorhq.com/conversations/{conv_id}/messages",
                        headers=GHL_H,
                        params={"limit": 30},
                    )
                    if rm.status_code != 200:
                        continue
                    msgs = (rm.json().get("messages") or {}).get("messages", [])
                    for m in msgs:
                        if m.get("direction") != "inbound":
                            continue
                        try:
                            mdt = datetime.fromisoformat((m.get("dateAdded") or "").replace("Z", "+00:00"))
                        except Exception:
                            continue
                        if mdt > sent_at_dt:
                            row["replied"] = True
                            row["replied_at"] = mdt.isoformat()
                            break
                    if row["replied"]:
                        break

        # Qualified / Contract: check the contact's opportunity stage.
        r = http(
            "GET",
            "https://services.leadconnectorhq.com/opportunities/search",
            headers={"Authorization": f"Bearer {GHL_TOKEN}", "Version": "2021-07-28"},
            params={"location_id": GHL_LOCATION, "contact_id": cid, "limit": 10},
        )
        if r.status_code == 200:
            for o in r.json().get("opportunities", []) or []:
                stage = o.get("pipelineStageId")
                # Qualified or anything beyond
                terminal_qual_stages = {
                    "a17517be-8d1a-49fd-bd53-b9128a66e242",  # qualified
                    "d43fddd8-3a17-46b2-a193-cf18619f654f",  # lao
                    "23a159ad-ba39-4c74-9d07-c1beb219d9f2",  # rr
                    "43589167-14f0-4e09-ba2a-8b9bd3296a4a",  # mao
                }
                if stage in terminal_qual_stages and not row.get("qualified"):
                    row["qualified"] = True
                    row["qualified_at"] = now_iso()
                if stage == STAGE_CONTRACT and not row.get("contract"):
                    row["contract"] = True

        time.sleep(0.2)

    save_test_state(test_state)


def main():
    print(f"[{datetime.now().isoformat(timespec='seconds')}] O2 entry-offer A/B/C runner")
    if not GHL_TOKEN:
        print("!! GHL_TOKEN missing — aborting. (Set via GitHub Actions secret.)")
        return

    cfg = load_config()
    sms_paused = bool(cfg.get("global", {}).get("sms_paused", True))
    if sms_paused:
        print("  SMS_PAUSED=true — dry-run mode. Variant assignment + reconciliation still run.")

    campaigns = cfg.get("campaigns", {}) or {}
    for campaign_id, campaign in campaigns.items():
        if not campaign.get("active"):
            print(f"  campaign {campaign_id}: inactive, skipping")
            continue
        print(f"  campaign {campaign_id}: starting")
        counts = process_campaign(campaign_id, campaign, cfg)
        print(f"  campaign {campaign_id}: {json.dumps(counts)}")

    print("  reconciling outcomes...")
    reconcile_outcomes(cfg)

    # Persist campaign.started_at if it got stamped this run
    save_config(cfg)
    print("  done.")


if __name__ == "__main__":
    main()
