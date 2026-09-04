"""Filtered reassignment of a video's frames
(PATCH /projects/{id}/videos/{source}/assign with `from_assignee_id` /
`only_unfinished`).

The operational case: an annotator stops working. The admin hands what they
had not finished to someone else — or back to the pool — while leaving the
work they did complete credited to them.

Items are seeded through the bulk route and then shaped directly through
`storage`, because ownership and status have to differ *within* one video
and no HTTP route can set them per item.
"""
from __future__ import annotations

import pytest

from app.core import storage


# --- helpers ---------------------------------------------------------------

@pytest.fixture
def project(client, admin_headers) -> dict:
    r = client.post(
        "/api/v1/projects",
        json={"name": "reassign-proj", "type": "pose_detection"},
        headers=admin_headers,
    )
    return r.json()


def _annotator(client, admin_headers, username: str) -> int:
    from app.schemas.user import UserRole
    from app.services import user as user_service

    user_service.ensure_seed_user(username, "secret", UserRole.annotator)
    return next(
        u["id"] for u in client.get("/api/v1/users", headers=admin_headers).json()
        if u["username"] == username
    )


def _seed(client, headers, project_id: int, specs: list[dict], source: str = "vid"):
    """Create one frame per spec, then shape it.

    Each spec: {"owner": uid|None, "status": str, "annotation": bool}.
    Returns the created item ids, in frame order.
    """
    client.post(
        f"/api/v1/projects/{project_id}/items/bulk",
        json={
            "items": [
                {"payload": {"source_video": source, "frame_index": i}}
                for i in range(1, len(specs) + 1)
            ]
        },
        headers=headers,
    )
    items = sorted(
        storage.list_items(project_id), key=lambda i: i["payload"]["frame_index"]
    )
    ids = []
    for item, spec in zip(items, specs):
        item["assigned_to"] = spec.get("owner")
        item["status"] = spec.get("status", "pending")
        storage.save_item(item)
        if spec.get("annotation"):
            storage.save_annotation(
                project_id,
                {
                    "id": storage.next_id("annotations"),
                    "item_id": item["id"],
                    "annotator_id": spec["owner"],
                    "value": {"keypoints": [[1, 2, 2]]},
                    "created_at": "2026-01-01T00:00:00",
                    "updated_at": "2026-01-01T00:00:00",
                },
            )
        ids.append(item["id"])
    return ids


def _reassign(client, headers, project_id: int, body: dict, source: str = "vid"):
    return client.patch(
        f"/api/v1/projects/{project_id}/videos/{source}/assign",
        json=body,
        headers=headers,
    )


def _owners(project_id: int) -> dict[int, int | None]:
    return {
        i["payload"]["frame_index"]: i["assigned_to"]
        for i in storage.list_items(project_id)
    }


def _ann_files(project_id: int, item_id: int) -> list[str]:
    d = storage.project_dir(project_id) / "annotations"
    return sorted(p.name for p in d.glob(f"{item_id}__*.json"))


# --- the filters ------------------------------------------------------------

def test_from_assignee_leaves_other_annotators_untouched(
    client, admin_headers, project
):
    a = _annotator(client, admin_headers, "ann-a")
    b = _annotator(client, admin_headers, "ann-b")
    c = _annotator(client, admin_headers, "ann-c")
    _seed(
        client, admin_headers, project["id"],
        [{"owner": a}, {"owner": b}, {"owner": a}],
    )

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": c, "from_assignee_id": a},
    )

    assert r.status_code == 200, r.text
    assert r.json()["reassigned"] == 2
    assert _owners(project["id"]) == {1: c, 2: b, 3: c}


def test_only_unfinished_leaves_done_and_reviewed_with_owner(
    client, admin_headers, project
):
    a = _annotator(client, admin_headers, "ann-a")
    c = _annotator(client, admin_headers, "ann-c")
    _seed(
        client, admin_headers, project["id"],
        [
            {"owner": a, "status": "pending"},
            {"owner": a, "status": "in_progress"},
            {"owner": a, "status": "done"},
            {"owner": a, "status": "reviewed"},
        ],
    )

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": c, "from_assignee_id": a, "only_unfinished": True},
    )

    assert r.status_code == 200, r.text
    assert r.json()["reassigned"] == 2
    assert _owners(project["id"]) == {1: c, 2: c, 3: a, 4: a}


def test_unfinished_frames_return_to_pool_when_assignee_is_null(
    client, admin_headers, project
):
    a = _annotator(client, admin_headers, "ann-a")
    _seed(
        client, admin_headers, project["id"],
        [{"owner": a, "status": "pending"}, {"owner": a, "status": "done"}],
    )

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": None, "from_assignee_id": a, "only_unfinished": True},
    )

    assert r.status_code == 200, r.text
    assert _owners(project["id"]) == {1: None, 2: a}


def test_item_sent_back_by_curation_counts_as_unfinished(
    client, admin_headers, project
):
    """`send_back` parks an item at in_progress — it is unfinished work the
    departing annotator was meant to fix, so it must move."""
    a = _annotator(client, admin_headers, "ann-a")
    c = _annotator(client, admin_headers, "ann-c")
    iid, _ = _seed(
        client, admin_headers, project["id"],
        [
            {"owner": a, "status": "done", "annotation": True},
            # Stays put: proves the move came from the send_back, not from the
            # filters being ignored.
            {"owner": a, "status": "done", "annotation": True},
        ],
    )
    client.post(
        f"/api/v1/items/{iid}/review",
        json={"action": "send_back", "note": "left ear off"},
        headers=admin_headers,
    )

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": c, "from_assignee_id": a, "only_unfinished": True},
    )

    assert r.status_code == 200, r.text
    assert _owners(project["id"]) == {1: c, 2: a}


# --- the annotation-follows rule -------------------------------------------

def test_reassigning_never_rewrites_annotation_authorship(
    client, admin_headers, project
):
    """`annotator_id` records who did the work. Reassignment changes who may
    edit an item, not who annotated it — including for unfinished work, which
    an admin may hand around several times while it is being fixed."""
    a = _annotator(client, admin_headers, "ann-a")
    c = _annotator(client, admin_headers, "ann-c")
    unfinished, finished = _seed(
        client, admin_headers, project["id"],
        [
            {"owner": a, "status": "in_progress", "annotation": True},
            {"owner": a, "status": "done", "annotation": True},
        ],
    )

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": c, "from_assignee_id": a},
    )

    assert r.status_code == 200, r.text
    for iid in (unfinished, finished):
        assert _ann_files(project["id"], iid) == [f"{iid}__{a}.json"]
        assert storage.load_annotation(project["id"], iid, a)["annotator_id"] == a


def test_new_owner_still_sees_the_previous_annotation(client, admin_headers, project):
    """Leaving the file under its author is only safe because the lookup falls
    back to it — the new assignee must still inherit the partial work."""
    a = _annotator(client, admin_headers, "ann-a")
    c = _annotator(client, admin_headers, "ann-c")
    (iid,) = _seed(
        client, admin_headers, project["id"],
        [{"owner": a, "status": "in_progress", "annotation": True}],
    )

    _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": c, "from_assignee_id": a, "only_unfinished": True},
    )

    detail = client.get(f"/api/v1/items/{iid}", headers=admin_headers).json()
    assert detail["assigned_to"] == c
    assert detail["annotation"]["value"] == {"keypoints": [[1, 2, 2]]}


# --- error shapes -----------------------------------------------------------

def test_unknown_video_is_404(client, admin_headers, project):
    a = _annotator(client, admin_headers, "ann-a")
    _seed(client, admin_headers, project["id"], [{"owner": a}])

    r = _reassign(
        client, admin_headers, project["id"], {"assignee_id": a}, source="nope"
    )

    assert r.status_code == 404, r.text


def test_filter_matching_no_frame_is_409(client, admin_headers, project):
    """Distinct from 404: the video is here, the filter just found nothing —
    telling the admin 'not found' would be a lie."""
    a = _annotator(client, admin_headers, "ann-a")
    b = _annotator(client, admin_headers, "ann-b")
    _seed(client, admin_headers, project["id"], [{"owner": a, "status": "done"}])

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": b, "from_assignee_id": a, "only_unfinished": True},
    )

    assert r.status_code == 409, r.text


def test_unknown_from_assignee_is_400(client, admin_headers, project):
    a = _annotator(client, admin_headers, "ann-a")
    _seed(client, admin_headers, project["id"], [{"owner": a}])

    r = _reassign(
        client, admin_headers, project["id"],
        {"assignee_id": a, "from_assignee_id": 999_999},
    )

    assert r.status_code == 400, r.text


# --- regression -------------------------------------------------------------

def test_unfiltered_reassign_still_moves_every_frame(client, admin_headers, project):
    """Both filters default to off, so the existing call is unchanged."""
    a = _annotator(client, admin_headers, "ann-a")
    b = _annotator(client, admin_headers, "ann-b")
    c = _annotator(client, admin_headers, "ann-c")
    _seed(
        client, admin_headers, project["id"],
        [{"owner": a}, {"owner": b, "status": "done"}, {"owner": None}],
    )

    r = _reassign(client, admin_headers, project["id"], {"assignee_id": c})

    assert r.status_code == 200, r.text
    assert r.json() == {"reassigned": 3, "assignee_id": c}
    assert _owners(project["id"]) == {1: c, 2: c, 3: c}
