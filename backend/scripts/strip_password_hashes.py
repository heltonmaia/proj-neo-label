"""Drop leftover password hashes from users.json.

No HTTP route accepts a password any more — `POST /auth/login` and the
password break-glass are gone — so every `hashed_password` still on disk is
inert. This removes them, so nothing password-shaped is stored at all.

The user RECORDS are kept. They are load-bearing: item assignments
(`assigned_to`) and annotations (`annotator_id`) reference these ids, and
some projects are owned by one of them. Deleting a record would orphan that
work; only the hash is removed. Dry-run by default.

    python -m scripts.strip_password_hashes           # preview
    python -m scripts.strip_password_hashes --apply    # commit
"""

from __future__ import annotations

import sys

from app.core import storage

_FIELD = "hashed_password"


def strip(apply: bool) -> list[dict]:
    """Remove `hashed_password` from every record that still carries one.

    Returns the affected records (as they were before the change), so the
    caller can report them. Idempotent: a second run finds nothing.
    """
    users = storage.load_users()
    affected = [dict(u) for u in users if u.get(_FIELD)]
    if apply and affected:
        for u in users:
            u.pop(_FIELD, None)
        storage.save_users(users)
    return affected


def main() -> None:
    apply = "--apply" in sys.argv
    affected = strip(apply=apply)
    verb = "Stripped" if apply else "Would strip"
    print(f"{verb} the password hash from {len(affected)} user(s):")
    for u in affected:
        print(
            f"  - id={u.get('id')} {u.get('username')!r} "
            f"role={u.get('role')} email={u.get('email') or '(none)'}"
        )
    if not affected:
        print("  (nothing to do — no password hash is stored)")
    elif not apply:
        print("\nDry run. Re-run with --apply to commit.")


if __name__ == "__main__":
    main()
