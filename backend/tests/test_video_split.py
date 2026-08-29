"""Tests for splitting a video's unassigned frames across annotators
(POST /projects/{id}/videos/{source}/split).

Items are created through the bulk route rather than a real upload — the
split only reads `payload.source_video` / `payload.frame_index` and writes
`assigned_to`, so no frames on disk are needed.
"""
from __future__ import annotations

import pytest


# --- helpers ---------------------------------------------------------------

@pytest.fixture
def pose_project(client, admin_headers) -> dict:
    r = client.post(
        "/api/v1/projects",
        json={"name": "split-proj", "type": "pose_detection"},
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


def _seed_frames(client, headers, project_id: int, n: int, source: str = "vid") -> None:
    """n pending, unassigned frames of one source, frame_index 1..n."""
    client.post(
        f"/api/v1/projects/{project_id}/items/bulk",
        json={
            "items": [
                {"payload": {"source_video": source, "frame_index": i}}
                for i in range(1, n + 1)
            ]
        },
        headers=headers,
    )


def _split(client, headers, project_id: int, assignee_ids, source: str = "vid"):
    return client.post(
        f"/api/v1/projects/{project_id}/videos/{source}/split",
        json={"assignee_ids": assignee_ids},
        headers=headers,
    )


def _items(client, headers, project_id: int) -> list[dict]:
    return client.get(
        f"/api/v1/projects/{project_id}/items",
        params={"limit": 500},
        headers=headers,
    ).json()["items"]


def _owner_by_frame(client, headers, project_id: int) -> dict[int, int | None]:
    return {
        i["payload"]["frame_index"]: i["assigned_to"]
        for i in _items(client, headers, project_id)
    }


# --- tests -----------------------------------------------------------------

def test_splits_into_contiguous_blocks_in_frame_order(
    client, admin_headers, pose_project
):
    """Each annotator gets one unbroken run of frames, in frame_index order."""
    pid = pose_project["id"]
    a = _annotator(client, admin_headers, "ana")
    b = _annotator(client, admin_headers, "bruno")
    c = _annotator(client, admin_headers, "carla")
    _seed_frames(client, admin_headers, pid, 240)

    r = _split(client, admin_headers, pid, [a, b, c])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assigned"] == 240
    assert body["skipped"] == 0
    assert body["blocks"] == [
        {"assignee_id": a, "count": 80, "first_frame": 1, "last_frame": 80},
        {"assignee_id": b, "count": 80, "first_frame": 81, "last_frame": 160},
        {"assignee_id": c, "count": 80, "first_frame": 161, "last_frame": 240},
    ]

    owners = _owner_by_frame(client, admin_headers, pid)
    assert {owners[i] for i in range(1, 81)} == {a}
    assert {owners[i] for i in range(81, 161)} == {b}
    assert {owners[i] for i in range(161, 241)} == {c}


def test_remainder_goes_to_the_earliest_blocks(client, admin_headers, pose_project):
    """100 across 3 is 34/33/33 — never a dropped frame."""
    pid = pose_project["id"]
    ids = [_annotator(client, admin_headers, n) for n in ("ana", "bruno", "carla")]
    _seed_frames(client, admin_headers, pid, 100)

    body = _split(client, admin_headers, pid, ids).json()
    assert [blk["count"] for blk in body["blocks"]] == [34, 33, 33]
    assert body["assigned"] == 100


def test_frames_that_already_have_an_owner_are_left_alone(
    client, admin_headers, pose_project
):
    """The split only touches the free pool; owned frames are reported as skipped.

    The mixed state is built in two rounds — assign the whole source while it
    holds only frames 1..4, then add 5..10, which stay free.
    """
    pid = pose_project["id"]
    owner = _annotator(client, admin_headers, "already")
    a = _annotator(client, admin_headers, "ana")
    b = _annotator(client, admin_headers, "bruno")

    _seed_frames(client, admin_headers, pid, 4)
    client.patch(
        f"/api/v1/projects/{pid}/videos/vid/assign",
        json={"assignee_id": owner},
        headers=admin_headers,
    )
    client.post(
        f"/api/v1/projects/{pid}/items/bulk",
        json={
            "items": [
                {"payload": {"source_video": "vid", "frame_index": i}}
                for i in range(5, 11)
            ]
        },
        headers=admin_headers,
    )

    body = _split(client, admin_headers, pid, [a, b]).json()
    assert body["assigned"] == 6
    assert body["skipped"] == 4
    assert body["blocks"] == [
        {"assignee_id": a, "count": 3, "first_frame": 5, "last_frame": 7},
        {"assignee_id": b, "count": 3, "first_frame": 8, "last_frame": 10},
    ]

    owners = _owner_by_frame(client, admin_headers, pid)
    assert {owners[i] for i in range(1, 5)} == {owner}
    assert {owners[i] for i in (5, 6, 7)} == {a}
    assert {owners[i] for i in (8, 9, 10)} == {b}


def test_409_when_no_frame_is_free(client, admin_headers, pose_project):
    pid = pose_project["id"]
    a = _annotator(client, admin_headers, "ana")
    _seed_frames(client, admin_headers, pid, 5)
    client.patch(
        f"/api/v1/projects/{pid}/videos/vid/assign",
        json={"assignee_id": a},
        headers=admin_headers,
    )

    r = _split(client, admin_headers, pid, [a])
    assert r.status_code == 409


def test_404_when_the_video_has_no_frames(client, admin_headers, pose_project):
    a = _annotator(client, admin_headers, "ana")
    r = _split(client, admin_headers, pose_project["id"], [a], source="ghost")
    assert r.status_code == 404


def test_400_for_an_unknown_assignee(client, admin_headers, pose_project):
    pid = pose_project["id"]
    _seed_frames(client, admin_headers, pid, 3)
    r = _split(client, admin_headers, pid, [9999])
    assert r.status_code == 400


@pytest.mark.parametrize("ids", [[], "dup"])
def test_422_for_an_empty_or_duplicated_assignee_list(
    client, admin_headers, pose_project, ids
):
    pid = pose_project["id"]
    a = _annotator(client, admin_headers, "ana")
    _seed_frames(client, admin_headers, pid, 3)
    payload = [a, a] if ids == "dup" else []
    assert _split(client, admin_headers, pid, payload).status_code == 422


def test_annotators_cannot_split(client, admin_headers, auth_headers, pose_project):
    pid = pose_project["id"]
    a = _annotator(client, admin_headers, "ana")
    _seed_frames(client, admin_headers, pid, 3)
    assert _split(client, auth_headers, pid, [a]).status_code == 403


def test_existing_annotation_survives_the_reassignment(
    client, admin_headers, pose_project
):
    """A frame annotated while unassigned stays readable after it gets an owner."""
    pid = pose_project["id"]
    a = _annotator(client, admin_headers, "ana")
    _seed_frames(client, admin_headers, pid, 2)
    item_id = _items(client, admin_headers, pid)[0]["id"]
    kps = [[10, 20, 2]] + [[0, 0, 0]] * 16
    client.put(
        f"/api/v1/items/{item_id}/annotation",
        json={"value": {"keypoints": kps}},
        headers=admin_headers,
    )

    assert _split(client, admin_headers, pid, [a]).status_code == 200

    detail = client.get(f"/api/v1/items/{item_id}", headers=admin_headers).json()
    assert detail["assigned_to"] == a
    assert detail["annotation"]["value"]["keypoints"] == kps


def test_video_summary_reports_how_many_frames_are_free(
    client, admin_headers, pose_project
):
    """`GET /videos` carries an `unassigned` count.

    The split UI needs it twice over: to preview the block sizes before
    committing, and to tell a genuinely free video apart from a split one —
    both report `assigned_to: null`, but only the free one has frames to give.
    """
    pid = pose_project["id"]
    a = _annotator(client, admin_headers, "ana")
    b = _annotator(client, admin_headers, "bruno")
    _seed_frames(client, admin_headers, pid, 10)

    def _summary() -> dict:
        return client.get(f"/api/v1/projects/{pid}/videos", headers=admin_headers).json()[0]

    assert _summary() == {
        "source_video": "vid",
        "frames": 10,
        "done": 0,
        "reviewed": 0,
        "assigned_to": None,
        "unassigned": 10,
    }

    _split(client, admin_headers, pid, [a, b])

    after = _summary()
    assert after["assigned_to"] is None    # mixed, not free
    assert after["unassigned"] == 0        # ...which this is what distinguishes
