"""Tests for the COCO-keypoints ZIP importer (POST /projects/{id}/import-coco).

Like the raw-image importer tests, these run the real ffmpeg path: images are
generated with ffmpeg's lavfi source and probed back with ffprobe, both already
hard dependencies of the feature.
"""
from __future__ import annotations

import io
import json
import subprocess
import zipfile

import pytest


# --- helpers ---------------------------------------------------------------

def _img_bytes(w: int, h: int, color: str = "red", fmt: str = "mjpeg") -> bytes:
    """A real JPEG/PNG of size w x h via ffmpeg, returned as bytes (no temp file)."""
    cmd = [
        "ffmpeg", "-v", "error",
        "-f", "lavfi", "-i", f"color=c={color}:s={w}x{h}",
        "-frames:v", "1", "-f", "image2pipe", "-vcodec", fmt, "-",
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode())
    return r.stdout


def _detailed_img_bytes(w: int, h: int) -> bytes:
    """A JPEG carrying real detail.

    `_img_bytes` paints a flat colour, which survives a re-encode
    byte-for-byte — so asserting "was not re-encoded" against it would pass
    either way. A test pattern has enough high-frequency content that any
    re-encode changes the bytes.
    """
    cmd = [
        "ffmpeg", "-v", "error",
        "-f", "lavfi", "-i", f"testsrc2=s={w}x{h}",
        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode())
    return r.stdout


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def _probe_format(path) -> str:
    r = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path),
        ],
        capture_output=True, text=True,
    )
    return r.stdout.strip()


def _full_keypoints() -> list[int]:
    """17 COCO keypoints, all labeled and visible, inside a 320x240 frame."""
    out: list[int] = []
    for k in range(17):
        out += [10 + k * 5, 20 + k * 5, 2]
    return out


def _coco_zip(ext: str = ".jpg", fmt: str = "mjpeg", n: int = 1) -> bytes:
    """A flat COCO-keypoints bundle: annotations.json beside n annotated images."""
    images, annotations, files = [], [], {}
    for i in range(1, n + 1):
        name = f"frame_{i:03d}{ext}"
        files[name] = _img_bytes(320, 240, fmt=fmt)
        images.append({"id": i, "file_name": name, "width": 320, "height": 240})
        annotations.append(
            {"id": i, "image_id": i, "category_id": 1, "keypoints": _full_keypoints()}
        )
    files["annotations.json"] = json.dumps(
        {
            "images": images,
            "annotations": annotations,
            "categories": [{"id": 1, "name": "infant", "supercategory": "person"}],
        }
    ).encode()
    return _zip(files)


def _frames_dir(data_dir, project_id: int, source: str):
    return data_dir / "projects" / str(project_id) / "frames" / source


# --- fixtures --------------------------------------------------------------

@pytest.fixture
def pose_project(client, admin_headers) -> dict:
    r = client.post(
        "/api/v1/projects",
        json={"name": "coco-proj", "type": "pose_detection"},
        headers=admin_headers,
    )
    return r.json()


def _post_coco(client, headers, project_id, zip_bytes, name="bundle.zip", **data):
    return client.post(
        f"/api/v1/projects/{project_id}/import-coco",
        files={"file": (name, zip_bytes, "application/zip")},
        data={k: str(v) for k, v in data.items()},
        headers=headers,
    )


def _export_labels(client, headers, project_id) -> list[str]:
    r = client.get(
        f"/api/v1/projects/{project_id}/export",
        params={"format": "yolo"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    return [n for n in names if n.endswith(".txt") and "labels/" in n]


# --- tests -----------------------------------------------------------------

def test_png_source_is_exportable(client, admin_headers, pose_project):
    """A PNG imported through the COCO path must still reach the export.

    Regression: frames used to keep the source's .png suffix, and the
    exporter's JPEG-only size probe then dropped them from every export
    silently — the items annotated fine but the dataset came out empty.
    """
    r = _post_coco(client, admin_headers, pose_project["id"], _coco_zip(".png", "png"))
    assert r.status_code == 201, r.text
    assert r.json() == {
        "items_created": 1,
        "annotations_created": 1,
        "skipped_images": 0,
        "skipped_labels": 0,
        "source_videos": ["bundle"],
    }

    assert len(_export_labels(client, admin_headers, pose_project["id"])) == 1


def test_png_frame_is_stored_as_real_jpeg(
    client, admin_headers, pose_project, _isolated_data_dir
):
    """The converted frame is a JPEG in content, not merely in name."""
    r = _post_coco(client, admin_headers, pose_project["id"], _coco_zip(".png", "png"))
    assert r.status_code == 201, r.text

    frames = sorted(_frames_dir(_isolated_data_dir, pose_project["id"], "bundle").iterdir())
    assert [f.name for f in frames] == ["f_000001.jpg"]
    assert _probe_format(frames[0]) == "mjpeg"


def test_jpeg_source_is_not_re_encoded(
    client, admin_headers, pose_project, _isolated_data_dir
):
    """A JPEG source is copied byte-for-byte — no generation loss on import."""
    original = _detailed_img_bytes(320, 240)
    z = _zip(
        {
            "frame_001.jpg": original,
            "annotations.json": json.dumps(
                {
                    "images": [
                        {"id": 1, "file_name": "frame_001.jpg", "width": 320, "height": 240}
                    ],
                    "annotations": [
                        {"id": 1, "image_id": 1, "category_id": 1,
                         "keypoints": _full_keypoints()}
                    ],
                }
            ).encode(),
        }
    )
    r = _post_coco(client, admin_headers, pose_project["id"], z)
    assert r.status_code == 201, r.text

    stored = _frames_dir(_isolated_data_dir, pose_project["id"], "bundle") / "f_000001.jpg"
    assert stored.read_bytes() == original
