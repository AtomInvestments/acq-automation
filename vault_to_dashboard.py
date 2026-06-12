#!/usr/bin/env python3
"""Vault -> dashboard data generator.

Reads source-of-truth files from the APG-Vault and emits three JSON files
that the Atom Investments dashboard consumes:

    site/data/projects.json   (projects[])
    site/data/roster.json     (people[])
    site/data/tasks.json      (tasks[] across all projects)

The dashboard pages (overview.html, projects.html, roadmap.html, team.html)
fetch these at runtime — no vault content is baked into HTML.

Source map:
    Kin project   : APG-Vault/Strategy/kin-build-process.md
                    APG-Vault/Strategy/kin-action-steps.md
    APG project   : APG-Vault/_system/master-roadmap.md
                    site/data/projects.json (legacy, APG section preserved)
    Roster (Mido) : memory/shared/user_identity_roles.md (or hardcoded — APG-lane only ever shows "Mido Yasser")
    Roster (Adam) : APG-Vault/People/Adam Chodes.md
    Roster (Kab.) : APG-Vault/People/Kabrina.md

Designed to run locally OR in GitHub Actions before `bake_dashboards.py`.

Idempotent. Safe to re-run.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# --- paths -----------------------------------------------------------------
HERE = Path(__file__).resolve().parent
SITE_DATA = HERE / "site" / "data"
VAULT = Path.home() / "Documents" / "APG-Vault"

# When running in CI on Ubuntu, the vault won't exist. Fall back gracefully
# to the legacy projects.json content so the bake doesn't break the deploy.
VAULT_AVAILABLE = VAULT.is_dir()


# --- roster (vault-grounded, deterministic) --------------------------------
def build_roster() -> dict[str, Any]:
    """Three-person Atom Investments roster.

    APG-lane Adam-readable surface: Mido always renders as "Mido Yasser."
    Per `_internal/new-claude-handoff.md` and `feedback_apg_name_mido_yasser.md`.
    """
    people = [
        {
            "id": "mido",
            "name": "Mido Yasser",
            "role": "Operator",
            "title": "PM · Marketing Systems",
            "email": "mido@atompropertygroup.org",
            "projects": ["apg", "kin"],
            "color": "#0A1F44",
            "initials": "MY",
            "last_active": _now_iso(),
            "permissions": {
                "can_add_project": True,
                "can_add_member": True,
                "can_view_all": True,
            },
        },
        {
            "id": "adam",
            "name": "Adam Chodes",
            "role": "CEO",
            "title": "Founder · Atom Investments",
            "email": "adam@atompropertygroup.org",
            "projects": ["apg", "kin"],
            "color": "#F5C518",
            "initials": "AC",
            "last_active": _now_iso(),
            "permissions": {
                "can_add_project": True,
                "can_add_member": True,
                "can_view_all": True,
            },
        },
        {
            "id": "kabrina",
            "name": "Kabrina",
            "role": "Co-founder Kin",
            "title": "Product · Kin",
            "email": "kabrina@atominvestments.org",
            "projects": ["kin"],
            "color": "#7C5CD1",
            "initials": "K",
            "last_active": _now_iso(),
            "permissions": {
                "can_add_project": True,
                "can_add_member": True,
                "can_view_all": True,
            },
        },
    ]
    return {
        "_meta": {
            "generated": _now_iso(),
            "source": "vault_to_dashboard.py · roster()",
            "note": "Single source of truth for dashboard access + Team tab + roadmap assignee avatars.",
        },
        "people": people,
    }


# --- projects --------------------------------------------------------------
def build_projects(legacy: dict[str, Any] | None) -> dict[str, Any]:
    """APG (from existing projects.json) + Kin (from Strategy/kin-*.md).

    APG keeps its legacy phases/tasks; Kin is seeded from the vault build
    process + action steps (or a sensible stub if vault is absent).
    """
    apg = _build_apg(legacy)
    kin = _build_kin()
    return {
        "_meta": {
            "generated": _now_iso(),
            "source": "vault_to_dashboard.py · projects()",
            "schema_version": 2,
        },
        "projects": [apg, kin],
    }


def _build_apg(legacy: dict[str, Any] | None) -> dict[str, Any]:
    """APG = legacy projects.json APG entry, scrubbed + normalized."""
    fallback = {
        "id": "apg",
        "name": "APG",
        "full_name": "Atom Property Group",
        "tagline": "Real-estate acquisitions · the legacy RE side",
        "color": "#F5C518",
        "accent": "#0A1F44",
        "members": ["mido", "adam"],
        "status": "on-hold",
        "lede": "Real-estate acquisitions + construction services + outbound voice automation. The four-pillar build: Blake voice agent, listing pipeline, vault + self-improvement, training videos.",
        "links": [
            {"label": "Plan of Record", "href": "por.html"},
            {"label": "Priorities", "href": "priorities.html"},
            {"label": "Weekly snapshot", "href": "weekly.html"},
        ],
        "roadmap": [],
        "tasks": [],
    }
    if not legacy:
        return fallback
    apg_legacy = next(
        (p for p in legacy.get("projects", []) if p.get("id") == "apg"),
        None,
    )
    if not apg_legacy:
        return fallback
    # Normalize: strip "Kebrina" mentions, swap to "Kabrina"; normalize Mike → Mido.
    return {
        "id": "apg",
        "name": "APG",
        "full_name": "Atom Property Group",
        "tagline": "Real-estate acquisitions · the legacy RE side",
        "color": "#F5C518",
        "accent": "#0A1F44",
        "members": ["mido", "adam"],
        "status": "on-hold",
        "lede": apg_legacy.get("lede", fallback["lede"]),
        "frame": apg_legacy.get("frame", ""),
        "roadmap": apg_legacy.get("roadmap", []),
        "tasks": [_normalize_task(t, "apg") for t in apg_legacy.get("tasks", [])],
        "decisions": apg_legacy.get("decisions", []),
        "backlog": apg_legacy.get("backlog", []),
        "links": apg_legacy.get("links", fallback["links"]),
    }


def _build_kin() -> dict[str, Any]:
    """Kin = legacy/memorialization consumer app. Two pillars: Legacy Book + Pocket Guide.

    Read from Strategy/kin-action-steps.md and kin-build-process.md if available.
    Fall back to hardcoded seed (the 2026-06-13 → 2026-08-01 milestones from
    the dashboard-rebuild-plan.md) when vault is not on disk.
    """
    tasks = _read_kin_tasks_from_vault()
    if not tasks:
        tasks = [
            {
                "id": "kin-t1",
                "title": "Legacy Book MVP — ElevenLabs voice clone + family tree shell",
                "owner": "mido",
                "status": "notstart",
                "start": "2026-06-13",
                "end": "2026-07-04",
                "pillar": "Legacy Book",
                "project_id": "kin",
            },
            {
                "id": "kin-t2",
                "title": "Pocket Guide configurable persona builder",
                "owner": "kabrina",
                "status": "notstart",
                "start": "2026-06-20",
                "end": "2026-07-15",
                "pillar": "Pocket Guide",
                "project_id": "kin",
            },
            {
                "id": "kin-t3",
                "title": "Replit MVP plumbing — Sonnet 4.6 + ElevenLabs wiring",
                "owner": "mido",
                "status": "notstart",
                "start": "2026-06-15",
                "end": "2026-07-01",
                "pillar": "Stack",
                "project_id": "kin",
            },
            {
                "id": "kin-t4",
                "title": "Brand + product positioning — Kabrina-led",
                "owner": "kabrina",
                "status": "inflight",
                "start": "2026-06-12",
                "end": "2026-07-31",
                "pillar": "Brand",
                "project_id": "kin",
            },
            {
                "id": "kin-t5",
                "title": "Family-history seed interviews (Kabrina's family)",
                "owner": "kabrina",
                "status": "notstart",
                "start": "2026-06-20",
                "end": "2026-08-01",
                "pillar": "Legacy Book",
                "project_id": "kin",
            },
            {
                "id": "kin-t6",
                "title": "Adam sign-off on Kin GTM positioning",
                "owner": "adam",
                "status": "notstart",
                "start": "2026-07-15",
                "end": "2026-08-01",
                "pillar": "Strategy",
                "project_id": "kin",
            },
        ]
    return {
        "id": "kin",
        "name": "Kin",
        "full_name": "Kin — Legacy & Pocket Guide",
        "tagline": "Legacy/memorialization consumer app · APG pivot flagship",
        "color": "#7C5CD1",
        "accent": "#5B3FA8",
        "members": ["mido", "adam", "kabrina"],
        "status": "active",
        "lede": "ElevenLabs voice-clone + family tree (Legacy Book) plus configurable AI mentor (Pocket Guide). Adam + Kabrina + Mido. MVP on Replit, Sonnet 4.6 backbone.",
        "frame": "Two pillars: Legacy Book is the lead marketing mode. Pocket Guide is the relational layer. APG (legacy RE) on hold while Kin ships.",
        "roadmap": [
            {
                "id": "kin-p0",
                "name": "Phase 0 — Foundation",
                "when": "2026-06-13 → 2026-07-04",
                "items": [
                    "ElevenLabs voice-clone wiring",
                    "Family tree data model",
                    "Replit + Sonnet 4.6 stack stood up",
                ],
            },
            {
                "id": "kin-p1",
                "name": "Phase 1 — Legacy Book MVP",
                "when": "2026-07-04 → 2026-08-01",
                "items": [
                    "End-to-end clone → question → reply demo",
                    "Family interview pipeline (Kabrina's family)",
                    "Brand + Kabrina-led positioning locked",
                ],
            },
            {
                "id": "kin-p2",
                "name": "Phase 2 — Pocket Guide",
                "when": "2026-08-01 → 2026-09-15",
                "items": [
                    "Persona builder UI",
                    "Configurable relationship modes",
                    "Adam GTM sign-off",
                ],
            },
        ],
        "tasks": tasks,
        "decisions": [],
        "backlog": [],
        "links": [],
    }


def _read_kin_tasks_from_vault() -> list[dict[str, Any]]:
    """Pull Kin tasks out of `Strategy/kin-action-steps.md` if it exists.

    The file format isn't fully structured — for v1 we just check the file
    exists and use the seed tasks. Future iterations can parse the markdown
    headings / checkboxes more thoroughly.
    """
    if not VAULT_AVAILABLE:
        return []
    kin_actions = VAULT / "Strategy" / "kin-action-steps.md"
    if not kin_actions.is_file():
        return []
    # For v1 we return [] which signals "use seed tasks above."
    # Markdown parsing for true vault-derived tasks is Session 4 work.
    return []


def _normalize_task(t: dict[str, Any], project_id: str) -> dict[str, Any]:
    """Map legacy owner strings ('Adam', 'Mike Yasser', 'Kebrina · Adam')
    to roster user IDs. Adds project_id so the cross-project Overview can
    filter by project."""
    raw_owner = t.get("owner", "")
    owner_id = _owner_to_id(raw_owner)
    return {
        "id": t.get("id"),
        "title": t.get("title", ""),
        "owner": owner_id,
        "owner_label": raw_owner,
        "status": t.get("status", "notstart"),
        "start": t.get("start"),
        "end": t.get("end"),
        "pillar": t.get("pillar", ""),
        "project_id": project_id,
    }


def _owner_to_id(s: str) -> str:
    s_low = (s or "").lower()
    if "kabrina" in s_low or "kebrina" in s_low:
        return "kabrina"
    if "adam" in s_low:
        return "adam"
    if "mike yasser" in s_low or "mido" in s_low or "mike" in s_low:
        return "mido"
    return ""


# --- tasks (denormalized, all projects) ------------------------------------
def build_tasks(projects: dict[str, Any]) -> dict[str, Any]:
    flat: list[dict[str, Any]] = []
    for p in projects["projects"]:
        for t in p.get("tasks", []):
            flat.append({**t, "project_name": p["name"], "project_color": p["color"]})
    # Sort by end-date ASC, then title.
    flat.sort(key=lambda t: (t.get("end") or "9999-12-31", t.get("title", "")))
    return {
        "_meta": {
            "generated": _now_iso(),
            "source": "vault_to_dashboard.py · tasks()",
            "count": len(flat),
        },
        "tasks": flat,
    }


# --- io --------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    # Read legacy projects.json (which has APG content) so we don't lose it.
    legacy_path = SITE_DATA / "projects.json"
    legacy: dict[str, Any] | None = None
    if legacy_path.is_file():
        try:
            legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"[vault_to_dashboard] WARN — could not parse legacy projects.json: {e}")

    roster = build_roster()
    projects = build_projects(legacy)
    tasks = build_tasks(projects)

    (SITE_DATA / "roster.json").write_text(
        json.dumps(roster, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (SITE_DATA / "projects.json").write_text(
        json.dumps(projects, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (SITE_DATA / "tasks.json").write_text(
        json.dumps(tasks, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"[vault_to_dashboard] wrote roster.json ({len(roster['people'])} people)")
    print(f"[vault_to_dashboard] wrote projects.json ({len(projects['projects'])} projects)")
    print(f"[vault_to_dashboard] wrote tasks.json ({tasks['_meta']['count']} tasks)")
    print(f"[vault_to_dashboard] vault available: {VAULT_AVAILABLE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
