"""
SMS A/B/C variant assignment.

Design:
- Each contact is assigned to a variant exactly ONCE per campaign.
- Assignment is deterministic: sha256(contact_id + campaign_id) -> 0..99 -> bucketed by weight.
  This means re-running with the same input always lands the same contact in the same variant,
  so if our local state file (sms_variant_state.json) gets wiped we still re-derive the same split.
- We ALSO persist the assignment to a GHL contact custom field ("contact.sms_variant" for O2).
  GHL is the source of truth — local state is a write-through cache.
- Initial split is configurable per-campaign (weights). Default 33/33/34.
- Multi-campaign: keying by campaign_id means we can add a second test (e.g. O7 specificity)
  without colliding with O2.

The actual send pipeline (o2_entry_offer.py) calls `assign_variant(cid, campaign_id, config)`
once per contact and either reads the existing assignment from GHL or computes + writes a new one.
"""
import hashlib
import json
import os
from typing import Optional

import requests

GHL_BASE = "https://services.leadconnectorhq.com"
HTTP_TIMEOUT = 30

# Local cache file — survives across runs via the same persist-state-to-main pattern
# sms_followup.py uses. NOT authoritative; only there to avoid hammering GHL on the
# next tick when we already know the assignment.
STATE_FILE = "sms_variant_state.json"


def _http(method: str, url: str, headers: dict, **kw):
    kw.setdefault("timeout", HTTP_TIMEOUT)
    return requests.request(method, url, headers=headers, **kw)


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            return json.load(open(STATE_FILE))
        except Exception:
            return {}
    return {}


def save_state(state: dict) -> None:
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, sort_keys=True)


def deterministic_variant(contact_id: str, campaign_id: str, weights: dict) -> str:
    """Hash-based split. Returns 'A' / 'B' / 'C' (or whatever keys are in `weights`).

    Why deterministic: the same contact_id always maps to the same variant, so a wiped
    local cache (or a parallel worker that never wrote our state file) still produces
    the same answer. The 33/33/34 split lands within +/- a few % of even given enough N.
    """
    seed = f"{contact_id}|{campaign_id}".encode("utf-8")
    bucket = int(hashlib.sha256(seed).hexdigest(), 16) % 100  # 0..99
    cumulative = 0
    # Sort by key so the bucketing is stable across runs even if dict order shifts.
    for variant in sorted(weights.keys()):
        cumulative += int(weights[variant])
        if bucket < cumulative:
            return variant
    # Fallback (rounding gap) — give to the last variant.
    return sorted(weights.keys())[-1]


def get_variant_from_ghl(contact_id: str, ghl_token: str, field_id: str) -> Optional[str]:
    """Return existing variant assignment from GHL contact custom field, or None.

    field_id is the GHL custom field ID for the SMS Variant field. Looks at the
    contact's customFields array for a match.
    """
    headers = {
        "Authorization": f"Bearer {ghl_token}",
        "Version": "2021-07-28",
    }
    r = _http("GET", f"{GHL_BASE}/contacts/{contact_id}", headers=headers)
    if r.status_code != 200:
        return None
    contact = r.json().get("contact") or {}
    for cf in contact.get("customFields") or []:
        if cf.get("id") == field_id:
            val = (cf.get("value") or "").strip().upper()
            if val in ("A", "B", "C"):
                return val
    return None


def write_variant_to_ghl(contact_id: str, variant: str, ghl_token: str, field_id: str) -> bool:
    """Write the variant assignment to the GHL contact custom field.

    Uses the direct REST API (PUT) because the MCP contacts_update-contact has a
    known bug for custom field updates (per tyler/feedback_ghl_api.md).
    """
    headers = {
        "Authorization": f"Bearer {ghl_token}",
        "Version": "2021-07-28",
        "Content-Type": "application/json",
    }
    payload = {"customFields": [{"id": field_id, "value": variant}]}
    r = _http("PUT", f"{GHL_BASE}/contacts/{contact_id}", headers=headers, json=payload)
    return r.status_code in (200, 201)


def assign_variant(
    contact_id: str,
    campaign: dict,
    campaign_id: str,
    ghl_token: str,
    field_id: Optional[str],
    state: dict,
) -> str:
    """Return the variant for `contact_id` under `campaign_id`.

    Read-before-write order:
      1. Local cache (sms_variant_state.json) — fast path.
      2. GHL custom field — authoritative; populates cache on hit.
      3. Compute deterministic_variant() — write to GHL + cache.

    `field_id` is the GHL custom field ID. If None (field not yet provisioned in GHL
    by an admin), we still return a deterministic answer and write the cache so the
    pipeline is testable; the GHL write is skipped with a warning so the next run
    can backfill once the field exists.
    """
    key = f"{campaign_id}:{contact_id}"
    cached = state.get(key)
    if cached in ("A", "B", "C"):
        return cached

    if field_id:
        existing = get_variant_from_ghl(contact_id, ghl_token, field_id)
        if existing:
            state[key] = existing
            return existing

    weights = {v: cfg.get("weight", 0) for v, cfg in (campaign.get("variants") or {}).items()}
    variant = deterministic_variant(contact_id, campaign_id, weights)

    if field_id:
        ok = write_variant_to_ghl(contact_id, variant, ghl_token, field_id)
        if not ok:
            print(f"  variant write to GHL failed for {contact_id} (variant={variant}); cache only")
    else:
        print(f"  WARNING: no field_id for {campaign_id}; cache-only assignment for {contact_id}={variant}")

    state[key] = variant
    return variant
