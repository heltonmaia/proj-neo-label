"""The pruner must refuse to orphan work.

Prod carries eight pre-Google records holding thousands of item assignments
and annotations, and four projects list one of them as owner. Only a record
that nothing points at may be removed, so these tests pin the refusals as
hard as the removal itself.
"""
from __future__ import annotations

import pytest

from app.core import storage
from app.schemas.user import UserRole
from app.services import user as user_service


def _legacy(username: str) -> int:
    """A pre-Google record: no email, so it can never sign in again."""
    user_service.ensure_seed_user(username, "secret", UserRole.annotator)
    return user_service.get_by_username(username).id


def _project(pid: int, owner_id: int) -> None:
    storage.save_project(
        {
            "id": pid,
            "name": f"p{pid}",
            "type": "pose_detection",
            "keypoint_schema": "infant",
            "owner_id": owner_id,
            "created_at": "2026-01-01T00:00:00Z",
        }
    )


def _ids(users: list[dict]) -> set[int]:
    return {u["id"] for u in users}


def test_removes_a_legacy_record_that_nothing_references():
    orphan = _legacy("annotator6")
    keeper = _legacy("annotator1")
    _project(1, owner_id=keeper)

    from scripts.prune_unreferenced_users import prune

    preview = prune(apply=False)
    assert _ids(preview) == {orphan}
    assert user_service.get_by_username("annotator6") is not None  # dry run kept it

    removed = prune(apply=True)
    assert _ids(removed) == {orphan}
    assert user_service.get_by_username("annotator6") is None
    assert user_service.get_by_username("annotator1") is not None


@pytest.mark.parametrize("kind", ["owns_project", "assigned_item", "annotation"])
def test_refuses_to_remove_a_referenced_record(kind):
    uid = _legacy("annotator1")
    _project(1, owner_id=999)

    if kind == "owns_project":
        _project(2, owner_id=uid)
    elif kind == "assigned_item":
        storage.save_item(
            {
                "id": 1,
                "project_id": 1,
                "payload": {"source_video": "v", "frame_index": 1},
                "status": "pending",
                "created_at": "2026-01-01T00:00:00Z",
                "assigned_to": uid,
            }
        )
    else:
        storage.save_annotation(
            1,
            {
                "id": 1,
                "item_id": 1,
                "annotator_id": uid,
                "value": {"keypoints": []},
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        )

    from scripts.prune_unreferenced_users import prune

    assert prune(apply=True) == []
    assert user_service.get_by_username("annotator1") is not None


def test_never_removes_a_record_that_has_an_email():
    """An address means a usable account; the allowlist decides those, not this."""
    user_service.get_or_provision_google_user("live@x.com", None, None, UserRole.annotator)

    from scripts.prune_unreferenced_users import prune

    assert prune(apply=True) == []
    assert user_service.get_by_email("live@x.com") is not None


def test_is_idempotent():
    _legacy("annotator6")
    from scripts.prune_unreferenced_users import prune

    assert len(prune(apply=True)) == 1
    assert prune(apply=False) == []
