"""Configure the Blake ElevenLabs Conversational AI agent with the eight GHL tools.

Reads:
  - ELEVENLABS_API_KEY  (required) — ElevenLabs account API key.
  - BLAKE_GHL_PIT       (required) — GHL Private Integration Token Blake uses
                                     to call services.leadconnectorhq.com.
  - BLAKE_AGENT_ID      (optional) — ElevenLabs agent_id to update. If missing,
                                     the script searches by name "Blake" and
                                     falls back to printing available agents.

Usage:
    # Dry run (default) — print what would be sent, do not PATCH.
    python configure_blake_agent.py

    # Apply the config:
    python configure_blake_agent.py --apply

    # Target a specific agent (overrides env var + name search):
    python configure_blake_agent.py --apply --agent-id <id>

Reference spec for the 8 tools is the source-of-truth markdown at
    APG-Vault/_system/Blake/elevenlabs-tools-config.md
This script is the executable mirror of that spec.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
GHL_BASE = "https://services.leadconnectorhq.com"
APG_LOCATION_ID = "RCkiUmWqXX4BYQ39JXmm"

# ---- GHL custom field IDs (APG sub-account) ----
CF_BEDS = "xXEm77wvbxEbiqsw3lAz"
CF_BATHS = "EtKof5yT7KAWmoaNQqJZ"
CF_SQFT = "8kqwjqtJyTTeQ8SIaLQz"
CF_ASKING = "6q7syt4puxfP7E03Xxhd"
CF_MOTIVATION = "rbYZAdhvuvX1NQgexhxy"
CF_TIMELINE = "v47I1Mi63RBpCD5N5RrH"

# ---- ACQ pipeline stage IDs ----
STAGE_UNQUALIFIED = "c1d23905-7096-439c-9a31-f8db5b2b53d0"
STAGE_QUALIFIED = "a17517be-8d1a-49fd-bd53-b9128a66e242"
STAGE_LAO = "d43fddd8-3a17-46b2-a193-cf18619f654f"
STAGE_DEAD = "b9b560b0-30cb-47fc-a4ca-1e55ca2531e2"
STAGE_FU_15 = "4aa78ab3-85dc-46d1-a683-d97b0c7a23ee"

# Mike's GHL user ID — matches the user the existing automation writes notes as.
# When RJ is provisioned in GHL, swap this for RJ's user ID and update the
# create_callback_task_for_rj tool's `assignedTo` value.
USER_MIKE = "Vj4WwH1ovxGN5Hv5Kq17"
USER_RJ = os.environ.get("RJ_GHL_USER_ID", USER_MIKE)


def shared_headers(pit: str) -> list[dict]:
    """Auth + version + content-type headers attached to every GHL call."""
    return [
        {"type": "value", "name": "Authorization", "value": f"Bearer {pit}"},
        {"type": "value", "name": "Version", "value": "2021-07-28"},
        {"type": "value", "name": "Content-Type", "value": "application/json"},
        {"type": "value", "name": "Accept", "value": "application/json"},
    ]


def build_tools(pit: str) -> list[dict]:
    """Return the eight GHL-backed tool definitions for Blake."""
    h = shared_headers(pit)

    return [
        # 1. Lookup contact by phone — first call on every conversation
        {
            "type": "webhook",
            "name": "lookup_contact_by_phone",
            "description": (
                "Look up the seller's GHL contact record by their phone number. "
                "Call this at the start of every conversation. Returns contact id, "
                "name, address, current stage, prior call notes."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/search",
                "method": "POST",
                "request_headers": h,
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "locationId": {"type": "string", "const": APG_LOCATION_ID},
                        "filters": {
                            "type": "array",
                            "items": {"type": "object"},
                            "default": [
                                {"field": "phone", "operator": "contains", "value": "PHONE_PLACEHOLDER"}
                            ],
                        },
                        "pageLimit": {"type": "number", "const": 1},
                    },
                    "required": ["locationId", "filters"],
                },
                "request_parameters": [
                    {
                        "id": "phone",
                        "type": "string",
                        "description": "Caller's phone number, E.164 format preferred (e.g. +16095551234).",
                        "required": True,
                    }
                ],
            },
        },
        # 2. Read recent notes
        {
            "type": "webhook",
            "name": "read_recent_notes",
            "description": (
                "Fetch the most recent notes (prior call summaries, Slack mentions) for "
                "this contact. Use to avoid repeating questions the seller already "
                "answered in earlier touchpoints."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/{{contact_id}}/notes",
                "method": "GET",
                "request_headers": h,
                "path_params_schema": [
                    {
                        "id": "contact_id",
                        "type": "string",
                        "description": "GHL contact id from lookup_contact_by_phone.",
                        "required": True,
                    }
                ],
            },
        },
        # 3. Update seller data (custom fields)
        # Uses direct REST endpoint (mcp__ghl-mcp__contacts_update-contact is
        # broken for custom fields — see tyler/feedback_ghl_api.md memory).
        {
            "type": "webhook",
            "name": "update_seller_data",
            "description": (
                "Write the seller's property details and motivation to GHL custom "
                "fields. Send only the fields you confirmed in the conversation; "
                "leave others null. Beds, baths, sqft are numbers as strings. "
                "Asking price is a number as string. Motivation and timeline are "
                "short phrases. Call as soon as each field is confirmed."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/{{contact_id}}",
                "method": "PUT",
                "request_headers": h,
                "path_params_schema": [
                    {"id": "contact_id", "type": "string", "required": True}
                ],
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "customFields": {
                            "type": "array",
                            "description": "Array of {id, value} pairs. Field IDs: "
                                f"beds={CF_BEDS}, baths={CF_BATHS}, sqft={CF_SQFT}, "
                                f"asking_price={CF_ASKING}, motivation={CF_MOTIVATION}, "
                                f"timeline={CF_TIMELINE}",
                        },
                    },
                    "required": ["customFields"],
                },
            },
        },
        # 4. Set lead temp
        {
            "type": "webhook",
            "name": "set_lead_temp",
            "description": (
                "Set the lead temperature based on call outcome. Use 'hot-lead' if "
                "motivated and ready to move soon. 'warm-lead' if interested but "
                "not urgent. 'nurture-lead' if interested with 6+ month timeline. "
                "'cold-lead' if they're not really sellers."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/{{contact_id}}",
                "method": "PUT",
                "request_headers": h,
                "path_params_schema": [
                    {"id": "contact_id", "type": "string", "required": True}
                ],
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "tags": {
                            "type": "array",
                            "items": {
                                "type": "string",
                                "enum": ["hot-lead", "warm-lead", "nurture-lead", "cold-lead"],
                            },
                        }
                    },
                    "required": ["tags"],
                },
            },
        },
        # 5. Save call summary — the canonical "APG Lead Summary" note
        {
            "type": "webhook",
            "name": "save_call_summary",
            "description": (
                "Write a structured 'APG Lead Summary' note to the contact in GHL. "
                "ALWAYS call this at the end of every call — this is the canonical "
                "record. Dashboard call rating + summary fields parse this note. "
                "The body MUST start with 'APG Lead Summary' and include Lead Temp, "
                "Rating, Summary, and Next step lines."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/{{contact_id}}/notes",
                "method": "POST",
                "request_headers": h,
                "path_params_schema": [
                    {"id": "contact_id", "type": "string", "required": True}
                ],
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "userId": {"type": "string", "const": USER_MIKE},
                        "body": {
                            "type": "string",
                            "description": (
                                "Multi-line note body. Format:\n"
                                "APG Lead Summary (Blake call · YYYY-MM-DD)\n\n"
                                "Lead Temp: Hot|Warm|Nurture|Cold\n"
                                "Rating: N/10\n"
                                "Reason: <one sentence>\n\n"
                                "What they said: <3-5 sentence summary>\n\n"
                                "Next step: <concrete action — RJ callback in 4h, FU 1.5mo, DNC>"
                            ),
                        },
                    },
                    "required": ["userId", "body"],
                },
            },
        },
        # 6. Create callback task for RJ (HOT leads only)
        {
            "type": "webhook",
            "name": "create_callback_task_for_rj",
            "description": (
                "Create a callback task for RJ (the human acquisitions partner). "
                "ONLY call this when the lead is HOT — they confirmed they want "
                "to talk to a human about selling soon. Due time = ISO timestamp "
                "4 hours from call end."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/{{contact_id}}/tasks",
                "method": "POST",
                "request_headers": h,
                "path_params_schema": [
                    {"id": "contact_id", "type": "string", "required": True}
                ],
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Short task title, e.g. 'Hot lead from Blake — call back'",
                        },
                        "body": {
                            "type": "string",
                            "description": "Multi-line context: summary one-liner, asking price, timeline, motivation",
                        },
                        "dueDate": {
                            "type": "string",
                            "description": "ISO 8601 timestamp, default = call end time + 4 hours",
                        },
                        "completed": {"type": "boolean", "const": False},
                        "assignedTo": {"type": "string", "const": USER_RJ},
                    },
                    "required": ["title", "body", "dueDate", "assignedTo"],
                },
            },
        },
        # 7. Move opportunity to a different pipeline stage
        {
            "type": "webhook",
            "name": "move_to_stage",
            "description": (
                "Move the opportunity to a different pipeline stage based on the call "
                "outcome. Hot lead ready for an offer call → Stage 2 LAO. Cold lead → "
                "Stage 0 Unqualified. Wants to be left alone → Dead Deals. Interested "
                "but not now → Follow Up 1.5 mo."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/opportunities/{{opportunity_id}}",
                "method": "PUT",
                "request_headers": h,
                "path_params_schema": [
                    {"id": "opportunity_id", "type": "string", "required": True}
                ],
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "pipelineStageId": {
                            "type": "string",
                            "enum": [
                                STAGE_QUALIFIED,
                                STAGE_LAO,
                                STAGE_UNQUALIFIED,
                                STAGE_DEAD,
                                STAGE_FU_15,
                            ],
                            "description": (
                                f"Stage IDs: qualified={STAGE_QUALIFIED}, "
                                f"LAO={STAGE_LAO}, unqualified={STAGE_UNQUALIFIED}, "
                                f"dead={STAGE_DEAD}, follow_up_1_5mo={STAGE_FU_15}"
                            ),
                        }
                    },
                    "required": ["pipelineStageId"],
                },
            },
        },
        # 8. Set DND (STOP, hostile, wrong number)
        {
            "type": "webhook",
            "name": "set_dnd",
            "description": (
                "Mark this contact as Do Not Disturb. Call immediately if the seller "
                "asks to be removed, says STOP, is hostile, or it's clearly a wrong "
                "number. DND is permanent — never call this on a soft 'not interested' "
                "(use set_lead_temp with 'cold-lead' instead)."
            ),
            "api_schema": {
                "url": f"{GHL_BASE}/contacts/{{contact_id}}",
                "method": "PUT",
                "request_headers": h,
                "path_params_schema": [
                    {"id": "contact_id", "type": "string", "required": True}
                ],
                "request_body_schema": {
                    "type": "object",
                    "properties": {
                        "dnd": {"type": "boolean", "const": True},
                        "tags": {
                            "type": "array",
                            "items": {"type": "string", "const": "dnd-opt-out"},
                        },
                    },
                    "required": ["dnd"],
                },
            },
        },
    ]


# ---- ElevenLabs API helpers ----

def el_request(method: str, path: str, api_key: str, body: dict | None = None) -> dict:
    """Make a request to the ElevenLabs API. Raises on non-2xx."""
    url = f"{ELEVENLABS_BASE}{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("xi-api-key", api_key)
    req.add_header("Accept", "application/json")
    data = None
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode("utf-8")
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"!! ElevenLabs {method} {path} returned {e.code}", file=sys.stderr)
        print(f"   Response body: {body_text[:1000]}", file=sys.stderr)
        raise


def find_blake_agent(api_key: str) -> str | None:
    """Search ElevenLabs agents for one named 'Blake'. Returns agent_id or None."""
    result = el_request("GET", "/convai/agents?page_size=100", api_key)
    agents = result.get("agents", []) or []
    for agent in agents:
        name = (agent.get("name") or "").strip().lower()
        if name == "blake" or name.startswith("blake"):
            return agent.get("agent_id") or agent.get("id")
    print("!! Could not find an agent named 'Blake' in this account.", file=sys.stderr)
    print(f"   {len(agents)} agents found:", file=sys.stderr)
    for a in agents[:20]:
        print(f"     - {a.get('name','(unnamed)')} :: {a.get('agent_id') or a.get('id')}", file=sys.stderr)
    return None


def apply_tools(api_key: str, agent_id: str, tools: list[dict]) -> None:
    """PATCH the agent with the new tool list."""
    payload = {
        "conversation_config": {
            "agent": {
                "prompt": {
                    "tools": tools,
                }
            }
        }
    }
    el_request("PATCH", f"/convai/agents/{agent_id}", api_key, body=payload)
    print(f"✓ Patched agent {agent_id} with {len(tools)} tools.")


# ---- Main ----

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="Actually PATCH the agent. Without this, prints config only.")
    p.add_argument("--agent-id", help="Override agent_id. Otherwise uses BLAKE_AGENT_ID env or searches by name.")
    args = p.parse_args()

    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    pit = os.environ.get("BLAKE_GHL_PIT", "").strip()

    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY env var is required.", file=sys.stderr)
        return 2
    if not pit:
        print("ERROR: BLAKE_GHL_PIT env var is required.", file=sys.stderr)
        return 2

    tools = build_tools(pit)

    if not args.apply:
        # Dry-run: scrub the PIT from the printed config and emit JSON.
        scrubbed = json.loads(json.dumps(tools).replace(pit, "<BLAKE_GHL_PIT>"))
        print(json.dumps(scrubbed, indent=2))
        print(f"\n[dry-run] {len(tools)} tools built. Re-run with --apply to PATCH the agent.", file=sys.stderr)
        return 0

    agent_id = args.agent_id or os.environ.get("BLAKE_AGENT_ID", "").strip() or find_blake_agent(api_key)
    if not agent_id:
        print("ERROR: No agent_id provided and no agent named 'Blake' found.", file=sys.stderr)
        print("   Set BLAKE_AGENT_ID env var or pass --agent-id <id>.", file=sys.stderr)
        return 3

    apply_tools(api_key, agent_id, tools)
    return 0


if __name__ == "__main__":
    sys.exit(main())
