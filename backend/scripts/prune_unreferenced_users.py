"""Remove pre-Google user records that nothing references.

`reconcile_users.py` deliberately never touches emailless records; this is
the narrow, safe way to drop the ones that are genuinely empty.

Two conditions must BOTH hold before a record goes:

1. It has no email, so it cannot sign in (password login is gone) and the
   allowlist has no say over it.
2. Nothing points at its id — it owns no project, no item is assigned to it,
   and no annotation is authored by it.

The second condition is what makes this safe. Those records are not clutter:
an audit of prod on 2026-08-29 found 3126 item assignments and 3447
annotations hanging off them, and four of the five projects list one as
`owner_id`. Removing a referenced record would orphan real annotation
history, so the script refuses rather than trusting the caller to know.

Dry-run by default.

    python -m scripts.prune_unreferenced_users           # preview
    python -m scripts.prune_unreferenced_users --apply    # commit
"""

from __future__ import annotations

import sys

from app.core import storage


def referenced_ids() -> set[int]:
    """Every user id reachable from project, item, or annotation data."""
    refs: set[int] = set()
    for project in storage.list_projects():
        owner = project.get("owner_id")
        if owner is not None:
            refs.add(owner)
        pid = project["id"]
        for item in storage.list_items(pid):
            uid = item.get("assigned_to")
            if uid is not None:
                refs.add(uid)
        for ann in storage.list_annotations_for_project(pid):
            uid = ann.get("annotator_id")
            if uid is not None:
                refs.add(uid)
    return refs


def prune(apply: bool) -> list[dict]:
    """Drop emailless, unreferenced users. Returns the records removed."""
    refs = referenced_ids()
    users = storage.load_users()

    def drop(u: dict) -> bool:
        has_email = bool((u.get("email") or "").strip())
        return not has_email and u.get("id") not in refs

    removed = [dict(u) for u in users if drop(u)]
    if apply and removed:
        storage.save_users([u for u in users if not drop(u)])
    return removed


def main() -> None:
    apply = "--apply" in sys.argv
    removed = prune(apply=apply)
    verb = "Removed" if apply else "Would remove"
    print(f"{verb} {len(removed)} unreferenced legacy user(s):")
    for u in removed:
        print(f"  - id={u.get('id')} {u.get('username')!r} role={u.get('role')}")
    if not removed:
        print("  (nothing to do — every emailless record still has work attached)")
    elif not apply:
        print("\nDry run. Re-run with --apply to commit.")


if __name__ == "__main__":
    main()
