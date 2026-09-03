import { useEffect, useState } from 'react';

import { userLabel } from '@/lib/userLabel';

interface Annotator {
  id: number;
  username: string;
  email?: string | null;
}

/** One video the departing annotator holds frames in. */
export interface AffectedVideo {
  sourceVideo: string;
  unfinished: number;
  total: number;
}

export interface DepartureProgress {
  done: number;
  of: number;
  moved: number;
  failed: string[];
}

interface Props {
  users: Annotator[];
  /** Videos the given annotator holds frames in, across the whole project. */
  affectedFor: (annotatorId: number) => AffectedVideo[];
  /** Annotators holding at least one frame anywhere in the project. */
  holderIds: number[];
  progress: DepartureProgress | null;
  onRun: (p: {
    fromId: number;
    toId: number | null;
    onlyUnfinished: boolean;
    videos: string[];
  }) => void;
}

/**
 * Project-level "this annotator left" sweep.
 *
 * The backend operation is per-video, so this walks the affected videos and
 * calls it once each. That keeps one endpoint instead of two, at the cost of
 * atomicity: a failure part-way leaves the earlier videos moved. Re-running is
 * safe — the frames already moved no longer match `from`, so they are skipped
 * — which is why the failure path just names the videos to retry.
 */
export function AnnotatorDepartureButton({
  users,
  affectedFor,
  holderIds,
  progress,
  onRun,
}: Props) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | '' | 'pool'>('');
  const [onlyUnfinished, setOnlyUnfinished] = useState(true);

  const running = progress != null && progress.done < progress.of;
  const affected = fromId === '' ? [] : affectedFor(fromId);
  const videos = affected.filter((v) => (onlyUnfinished ? v.unfinished > 0 : v.total > 0));
  const moving = videos.reduce((n, v) => n + (onlyUnfinished ? v.unfinished : v.total), 0);
  const ready = fromId !== '' && toId !== '' && videos.length > 0 && !running;

  function close() {
    if (running) return;
    setOpen(false);
    setFromId('');
    setToId('');
    setOnlyUnfinished(true);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, running]);

  function nameOf(id: number): string {
    const u = users.find((x) => x.id === id);
    return u ? userLabel(u) : `#${id}`;
  }

  const candidates = users.filter((u) => holderIds.includes(u.id));

  return (
    <>
      <button
        type="button"
        disabled={candidates.length === 0}
        onClick={() => setOpen(true)}
        className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
        title="Hand every frame one annotator has not finished to someone else, across all videos"
      >
        Annotator left…
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="departure-title"
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col resize overflow-hidden bg-white rounded-xl shadow-2xl ring-1 ring-slate-200
                       w-[30rem] min-w-[22rem] max-w-[95vw] max-h-[90vh] text-left"
          >
            <div className="p-4 pb-2">
              <h2 id="departure-title" className="text-base font-semibold text-slate-900">
                An annotator left
              </h2>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Hands over their unfinished frames across every video in this
                project at once. Runs one video at a time — if it stops part-way
                the videos already done stay done, and re-running skips them.
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 border-y space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">Who left</span>
                <select
                  value={fromId}
                  disabled={running}
                  onChange={(e) => setFromId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 w-full border rounded px-2 py-1.5 text-sm disabled:bg-slate-50"
                >
                  <option value="">— pick an annotator —</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-700">Hand their work to</span>
                <select
                  value={toId}
                  disabled={running}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setToId(raw === '' ? '' : raw === 'pool' ? 'pool' : Number(raw));
                  }}
                  className="mt-1 w-full border rounded px-2 py-1.5 text-sm disabled:bg-slate-50"
                >
                  <option value="">— pick a destination —</option>
                  <option value="pool">— back to the unassigned pool —</option>
                  {users
                    .filter((u) => u.id !== fromId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {userLabel(u)}
                      </option>
                    ))}
                </select>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyUnfinished}
                  disabled={running}
                  onChange={(e) => setOnlyUnfinished(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  Only unfinished frames
                  <span className="block text-slate-500">
                    Leaves what they finished credited to them.
                  </span>
                </span>
              </label>

              {fromId !== '' && (
                <div className="text-xs text-slate-600 tabular-nums">
                  {videos.length === 0 ? (
                    <span className="text-amber-600">
                      {nameOf(fromId)} has no {onlyUnfinished ? 'unfinished ' : ''}
                      frames in this project.
                    </span>
                  ) : (
                    <>
                      <p>
                        <strong>{moving}</strong> {moving === 1 ? 'frame' : 'frames'} across{' '}
                        <strong>{videos.length}</strong>{' '}
                        {videos.length === 1 ? 'video' : 'videos'}:
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {videos.map((v) => (
                          <li key={v.sourceVideo} className="flex justify-between gap-2">
                            <span className="font-mono truncate" title={v.sourceVideo}>
                              {v.sourceVideo}
                            </span>
                            <span className="text-slate-500 whitespace-nowrap">
                              {onlyUnfinished ? v.unfinished : v.total}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {progress && (
                <div className="text-xs tabular-nums border-t pt-2">
                  <p className="text-slate-700">
                    {progress.done} of {progress.of} videos · {progress.moved} frames moved
                  </p>
                  {progress.failed.length > 0 && (
                    <p className="mt-1 text-red-600 break-words">
                      Failed, retry these: {progress.failed.join(', ')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={running}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
              >
                {progress && !running ? 'Close' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  // `ready` already rules out the empty selection, and TS
                  // narrows `fromId` to number through it.
                  if (!ready) return;
                  onRun({
                    fromId,
                    toId: toId === 'pool' ? null : (toId as number),
                    onlyUnfinished,
                    videos: videos.map((v) => v.sourceVideo),
                  });
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {running ? 'Working…' : `Hand over ${moving || ''}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
