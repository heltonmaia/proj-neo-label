"""Picking one annotation per item when several files exist.

Annotation files are keyed `{item_id}__{annotator_id}.json`, so an item can
end up with more than one: an admin annotates it while it is unassigned (the
file lands under *them*), it is later assigned to an annotator, and that
annotator saves — a second file. Production carries such pairs today.

Every consumer that reduces annotations to one-per-item must resolve that the
same way `storage.find_any_annotation_for_item` does — most recently updated
wins — or the winner comes down to `glob` order, which is filesystem-dependent
and can differ between two runs over identical data.
"""
from __future__ import annotations

import pytest

from app.core import storage
from app.services import item as item_service


@pytest.fixture
def project(client, admin_headers) -> dict:
    r = client.post(
        "/api/v1/projects",
        json={"name": "dedup-proj", "type": "pose_detection"},
        headers=admin_headers,
    )
    return r.json()


def _write_ann(pid: int, iid: int, uid: int, kps, updated_at: str) -> None:
    storage.save_annotation(
        pid,
        {
            "id": storage.next_id("annotations"),
            "item_id": iid,
            "annotator_id": uid,
            "value": {"keypoints": kps},
            "created_at": updated_at,
            "updated_at": updated_at,
        },
    )


def _one_item(client, headers, project_id: int) -> int:
    client.post(
        f"/api/v1/projects/{project_id}/items/bulk",
        json={"items": [{"payload": {"image_url": "/x.jpg"}}]},
        headers=headers,
    )
    return storage.list_items(project_id)[0]["id"]


def test_latest_annotation_wins_regardless_of_which_file_is_older(
    client, admin_headers, project
):
    pid = project["id"]
    iid = _one_item(client, admin_headers, pid)
    _write_ann(pid, iid, 101, [[1, 1, 2]], "2026-01-01T00:00:00")
    _write_ann(pid, iid, 202, [[9, 9, 2]], "2026-06-01T00:00:00")

    picked = item_service.latest_annotations_by_item(pid)

    assert picked[iid]["annotator_id"] == 202
    assert picked[iid]["value"] == {"keypoints": [[9, 9, 2]]}


def test_order_of_writes_does_not_change_the_winner(client, admin_headers, project):
    """Same data, opposite write order — the newer must still win, which is
    exactly what a dict comprehension over `glob` cannot promise."""
    pid = project["id"]
    iid = _one_item(client, admin_headers, pid)
    _write_ann(pid, iid, 202, [[9, 9, 2]], "2026-06-01T00:00:00")
    _write_ann(pid, iid, 101, [[1, 1, 2]], "2026-01-01T00:00:00")

    picked = item_service.latest_annotations_by_item(pid)

    assert picked[iid]["annotator_id"] == 202


def test_single_annotation_is_returned_unchanged(client, admin_headers, project):
    pid = project["id"]
    iid = _one_item(client, admin_headers, pid)
    _write_ann(pid, iid, 101, [[1, 1, 2]], "2026-01-01T00:00:00")

    picked = item_service.latest_annotations_by_item(pid)

    assert set(picked) == {iid}
    assert picked[iid]["annotator_id"] == 101


def test_export_uses_the_newer_annotation(client, admin_headers, project):
    """End-to-end: the JSON export must carry the winner, not whichever file
    the filesystem happened to hand over last."""
    pid = project["id"]
    iid = _one_item(client, admin_headers, pid)
    _write_ann(pid, iid, 101, [[1, 1, 2]], "2026-01-01T00:00:00")
    _write_ann(pid, iid, 202, [[9, 9, 2]], "2026-06-01T00:00:00")

    rows = list(item_service._iter_export_rows(pid))

    assert len(rows) == 1
    # The row carries the annotation's `value` directly, not the record.
    assert rows[0]["annotation"] == {"keypoints": [[9, 9, 2]]}
