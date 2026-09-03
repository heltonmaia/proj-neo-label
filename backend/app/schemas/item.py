import enum
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ItemStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    done = "done"
    reviewed = "reviewed"


class ItemCreate(BaseModel):
    payload: dict[str, Any]


class ItemBulkCreate(BaseModel):
    items: list[ItemCreate]


class ItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    payload: dict[str, Any]
    status: ItemStatus
    created_at: datetime
    assigned_to: int | None = None
    review_note: str | None = None


class ReassignRequest(BaseModel):
    """Move frames of one video to `assignee_id` (None = back to the pool).

    Both filters default to off, so a body carrying only `assignee_id` moves
    every frame — the original behavior.

    `from_assignee_id=None` means **no filter**, NOT "currently unassigned";
    handing out unassigned frames is what `/split` is for.
    """

    assignee_id: int | None = None
    from_assignee_id: int | None = None
    only_unfinished: bool = False


class RotateRequest(BaseModel):
    degrees: int  # 90 (clockwise), 180, or 270 (counter-clockwise)


class VideoSplitIn(BaseModel):
    """Annotators to divide a video's unassigned frames between.

    Order is meaningful: the first id receives the earliest block of frames.
    """

    assignee_ids: list[int] = Field(min_length=1)

    @field_validator("assignee_ids")
    @classmethod
    def _reject_duplicates(cls, v: list[int]) -> list[int]:
        if len(set(v)) != len(v):
            raise ValueError("assignee_ids must not name the same annotator twice")
        return v


class ItemReviewIn(BaseModel):
    """Curation actions:
      - approve   -> status='reviewed', clears any prior note.
      - unapprove -> status='done' (revert a prior approval). Annotation stays.
      - send_back -> status='in_progress', preserves keypoints, stores the
                     optional note so the assignee sees what to fix.
    """
    action: Literal["approve", "unapprove", "send_back"]
    note: str | None = None


class AnnotationUpsert(BaseModel):
    value: dict[str, Any]


class AnnotationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int
    annotator_id: int
    value: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ItemDetail(ItemRead):
    annotation: AnnotationRead | None = None
