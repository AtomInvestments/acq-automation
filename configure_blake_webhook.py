"""Configure the ElevenLabs Conversational AI post-call webhook for Blake.

The post-call webhook URL is a *workspace-level* setting in ElevenLabs ConvAI,
not per-agent. It's not always exposed in the UI on every plan tier. This
script reaches the relevant API surface directly.

Usage:
    # Discovery mode (default) — GET the workspace settings + Blake's agent
    # config and print where webhook fields live. Run this FIRST to confirm
    # the schema before applying.
    python configure_blake_webhook.py

    # Apply mode — PATCH the post-call webhook URL onto workspace settings.
    python configure_blake_webhook.py --apply --url https://acq-automation.mithchell.workers.dev/webhook

Env:
    ELEVENLABS_API_KEY      ElevenLabs account API key (required)
    BLAKE_AGENT_ID          ElevenLabs agent_id for Blake (optional; defaults
                            to the known production id)

The post-call webhook URL is set on workspace settings via
`PATCH /v1/convai/settings`. If that endpoint shape differs in the deployed
ElevenLabs API, run --discover first to see the actual field path; we'll
adjust the PATCH body to match.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
DEFAULT_BLAKE_AGENT_ID = "agent_5001ks3cp069f9rtfz6e81ypgnrd"

# Candidate endpoints to probe in discovery mode. Order: most likely to hold
# the post-call webhook config first.
DISCOVERY_ENDPOINTS = [
    "/convai/settings",
    "/convai/workspace/settings",
]


def el_request(
    method: str, path: str, api_key: str, body: dict | None = None
) -> tuple[int, dict | str]:
    """Make a request to the ElevenLabs API. Returns (status, parsed_or_text).
    Does NOT raise on non-2xx — we want the body even on errors."""
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
            text = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(text)
            except json.JSONDecodeError:
                return resp.status, text
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(text)
        except json.JSONDecodeError:
            return e.code, text


def scrub(payload, depth=0, max_depth=8):
    """Recursively replace any value that *looks* like a secret with a marker.
    Heuristic: long base64-ish strings, things containing 'token'/'key'/'secret'
    in the key path."""
    if depth > max_depth:
        return "<truncated>"
    SECRET_HINTS = ("token", "key", "secret", "auth", "password")

    if isinstance(payload, dict):
        out = {}
        for k, v in payload.items():
            k_low = str(k).lower()
            if any(h in k_low for h in SECRET_HINTS) and isinstance(v, str):
                out[k] = f"<scrubbed:{len(v)}chars>"
            else:
                out[k] = scrub(v, depth + 1, max_depth)
        return out
    if isinstance(payload, list):
        return [scrub(x, depth + 1, max_depth) for x in payload]
    return payload


def discover(api_key: str, agent_id: str) -> None:
    print("=" * 70)
    print("DISCOVERY — ElevenLabs Conversational AI webhook surface")
    print("=" * 70)

    for ep in DISCOVERY_ENDPOINTS:
        print(f"\n--- GET {ep}")
        status, body = el_request("GET", ep, api_key)
        print(f"HTTP {status}")
        if isinstance(body, dict):
            print(json.dumps(scrub(body), indent=2)[:4000])
        else:
            print(str(body)[:2000])

    print(f"\n--- GET /convai/agents/{agent_id}")
    status, body = el_request("GET", f"/convai/agents/{agent_id}", api_key)
    print(f"HTTP {status}")
    if isinstance(body, dict):
        # The agent config is large. Print the top-level keys and any
        # webhook-related subtrees.
        print(f"top-level keys: {list(body.keys())}")
        for path_key in ("platform_settings", "conversation_config", "webhook"):
            if path_key in body:
                print(f"\n[{path_key}]:")
                print(json.dumps(scrub(body[path_key]), indent=2)[:3000])
        # Also surface anything that mentions 'webhook' anywhere in the tree.
        hits = []
        _walk(body, [], "webhook", hits)
        if hits:
            print("\n--- 'webhook' field hits in agent config ---")
            for path, value in hits[:20]:
                print(f"  {'.'.join(path)} = {value!r}")
        else:
            print("\n(no 'webhook' fields found in agent config)")
    else:
        print(str(body)[:2000])


def _walk(node, path, needle, out):
    if isinstance(node, dict):
        for k, v in node.items():
            if needle in str(k).lower():
                # Truncate long string values
                disp = v if not isinstance(v, str) or len(v) < 200 else v[:200] + "..."
                out.append((path + [str(k)], disp))
            _walk(v, path + [str(k)], needle, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk(v, path + [f"[{i}]"], needle, out)


def apply_webhook(api_key: str, url: str) -> int:
    """PATCH the post-call webhook URL onto workspace settings.

    We try the most likely endpoint + body shape first. If the deployed
    ElevenLabs API uses a different shape, this prints the error response so
    we can adjust.
    """
    print(f"Setting post-call webhook URL to: {url}")

    # Most likely shape: PATCH /v1/convai/settings with conversation_initiation
    # or post_call config under a known key. We'll try the conventional name.
    body_candidates = [
        {
            "conversation_initiation_client_data_webhook": None,  # leave untouched
            "webhooks": {"post_call_webhook_id": None},  # newer naming
        },
        # Fallback: simpler shape
        {"post_call_webhook_url": url},
    ]

    # First, just send the simple URL field — this is the documented shape
    # for the workspace settings endpoint as of late 2024 / early 2025.
    target_body = {"webhooks": {"post_call_webhook": {"url": url}}}
    print(f"Attempting: PATCH /convai/settings  body={json.dumps(target_body)}")
    status, body = el_request("PATCH", "/convai/settings", api_key, body=target_body)
    print(f"HTTP {status}")
    if isinstance(body, (dict, list)):
        print(json.dumps(scrub(body), indent=2)[:2000])
    else:
        print(str(body)[:2000])

    if 200 <= status < 300:
        print("\n✓ Post-call webhook URL set on workspace settings.")
        return 0

    print(
        "\n✗ PATCH did not succeed. The ElevenLabs API surface for the "
        "post-call webhook URL probably differs from what we tried.\n"
        "Re-run without --apply to dump the discovery output and we'll adjust the body shape."
    )
    return 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="Actually PATCH the webhook URL.")
    p.add_argument("--url", help="Webhook URL to set (required with --apply).")
    p.add_argument(
        "--agent-id",
        default=os.environ.get("BLAKE_AGENT_ID", DEFAULT_BLAKE_AGENT_ID),
        help="Blake agent_id (defaults to known production id).",
    )
    args = p.parse_args()

    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: ELEVENLABS_API_KEY env var is required.", file=sys.stderr)
        return 2

    if args.apply:
        if not args.url:
            print("ERROR: --url is required with --apply.", file=sys.stderr)
            return 2
        return apply_webhook(api_key, args.url)
    else:
        discover(api_key, args.agent_id)
        return 0


if __name__ == "__main__":
    sys.exit(main())
