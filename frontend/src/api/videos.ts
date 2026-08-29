import { api } from './client';

export interface VideoSummary {
  source_video: string;
  frames: number;
  done: number;       // annotated (done + reviewed combined)
  reviewed: number;   // strict subset that's been signed off
  unassigned: number; // frames still in the admin pool
  // null means unassigned OR mixed — after a split a video is mixed, so read
  // `unassigned` to tell the two apart.
  assigned_to: number | null;
}

export interface SplitBlock {
  assignee_id: number;
  count: number;
  first_frame: number | null;
  last_frame: number | null;
}

export interface SplitResult {
  assigned: number;
  skipped: number;
  blocks: SplitBlock[];
}

export type ResizeMode = 'stretch' | 'pad';

export async function uploadVideo(
  projectId: number,
  file: File,
  fps: number,
  assigneeId: number | null,
  rotation: 0 | 90 | 180 | 270 = 0,
  resizeMode: ResizeMode = 'pad',
) {
  const form = new FormData();
  form.append('file', file);
  form.append('fps', String(fps));
  if (assigneeId !== null) form.append('assignee_id', String(assigneeId));
  form.append('rotation', String(rotation));
  form.append('resize_mode', resizeMode);
  const { data } = await api.post<{
    video: string;
    frames: number;
    duration_s: number | null;
    expected_frames: number | null;
  }>(
    `/projects/${projectId}/videos`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function listVideos(projectId: number) {
  const { data } = await api.get<VideoSummary[]>(`/projects/${projectId}/videos`);
  return data;
}

export async function reassignVideo(
  projectId: number,
  sourceVideo: string,
  assigneeId: number | null,
) {
  const { data } = await api.patch<{ reassigned: number; assignee_id: number | null }>(
    `/projects/${projectId}/videos/${encodeURIComponent(sourceVideo)}/assign`,
    { assignee_id: assigneeId },
  );
  return data;
}

/** Divide a video's unassigned frames into contiguous blocks, one per
 *  annotator, in the order given. Frames that already have an owner are
 *  left untouched. */
export async function splitVideo(
  projectId: number,
  sourceVideo: string,
  assigneeIds: number[],
) {
  const { data } = await api.post<SplitResult>(
    `/projects/${projectId}/videos/${encodeURIComponent(sourceVideo)}/split`,
    { assignee_ids: assigneeIds },
  );
  return data;
}

export interface CocoImportResult {
  items_created: number;
  annotations_created: number;
  skipped_images: number;
  skipped_labels: number;
  source_videos: string[];
}

export async function importCocoPose(
  projectId: number,
  file: File,
  assigneeId: number | null,
): Promise<CocoImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (assigneeId !== null) form.append('assignee_id', String(assigneeId));
  const { data } = await api.post<CocoImportResult>(
    `/projects/${projectId}/import-coco`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export interface ImageImportResult {
  items_created: number;
  skipped_files: number;
  source_video: string;
  resize_mode: ResizeMode;
}

export async function importImages(
  projectId: number,
  file: File,
  assigneeId: number | null,
  resizeMode: ResizeMode = 'pad',
): Promise<ImageImportResult> {
  const form = new FormData();
  form.append('file', file);
  if (assigneeId !== null) form.append('assignee_id', String(assigneeId));
  form.append('resize_mode', resizeMode);
  const { data } = await api.post<ImageImportResult>(
    `/projects/${projectId}/import-images`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function deleteVideo(projectId: number, sourceVideo: string) {
  const { data } = await api.delete<{ deleted: number }>(
    `/projects/${projectId}/videos/${encodeURIComponent(sourceVideo)}`,
  );
  return data;
}

export async function rotateVideo(
  projectId: number,
  sourceVideo: string,
  degrees: 90 | 180 | 270,
) {
  const { data } = await api.post<{ rotated: number; degrees: number }>(
    `/projects/${projectId}/videos/${encodeURIComponent(sourceVideo)}/rotate`,
    { degrees },
  );
  return data;
}
