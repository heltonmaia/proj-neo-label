import { useEffect, useState } from 'react';

import { userLabel } from '@/lib/userLabel';

interface Annotator {
  id: number;
  username: string;
  email?: string | null;
}

/** An annotator holding frames of one video, with how many are still open. */
export interface Holder {
  id: number;
  /** Frames of this video they own that are `pending` or `in_progress`. */
  unfinished: number;
  /** Every frame of this video they own. */
  total: number;
}

interface Props {
  sourceVideo: string;
  holders: Holder[];
  /** Everyone, assignable or not — only used to name the holders, and a
   *  legacy account with no email can still be holding frames. */
  users: Annotator[];
  inFlight: boolean;
  disabled?: boolean;
  onRemove: (p: { annotatorId: number; includeFinished: boolean }) => void;
}

/**
 * Per-video "remove this annotator" control.
 *
 * Releases one annotator's frames back to the unassigned pool. Handing them to
 * someone else is then the dropdown's or the assign button's job. This is the
 * one verb the admin asked for, in place of a from→to handover dialog and a
 * project-wide "annotator left" sweep: free the frames, then use the controls
 * that already exist.
 *
 * `includeFinished` is off by default, so done and reviewed frames stay with
 * the person who did them — ticking it is occasionally what an admin wants
 * but never the safe default. Nothing here changes who authored an
 * annotation; only who may edit the frame.
 *
 * Dialog rather than a popover for the same reason as `SplitVideoButton`: both
 * mount points clip an absolutely-positioned child (the list view's table is
 * `overflow-x-auto`, the grid card `overflow-hidden`).
 */
export function RemoveAnnotatorButton({
  sourceVideo,
  holders,
  users,
  inFlight,
  disabled,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const [annotatorId, setAnnotatorId] = useState<number | ''>('');
  const [includeFinished, setIncludeFinished] = useState(false);

  const nobodyHolds = holders.length === 0;
  const off = inFlight || disabled || nobodyHolds;
  const holder = holders.find((h) => h.id === annotatorId);
  const releasing = holder ? (includeFinished ? holder.total : holder.unfinished) : 0;
  const ready = holder != null && releasing > 0;

  function openDialog() {
    // A single holder needs no picking.
    setAnnotatorId(holders.length === 1 ? holders[0].id : '');
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setAnnotatorId('');
    setIncludeFinished(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function nameOf(id: number): string {
    const u = users.find((x) => x.id === id);
    return u ? userLabel(u) : `#${id}`;
  }

  return (
    <>
      <button
        type="button"
        disabled={off}
        onClick={openDialog}
        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40 leading-none"
        title={
          nobodyHolds
            ? 'No annotator holds frames of this video'
            : "Remove an annotator — their frames go back to the pool"
        }
        aria-label="Remove an annotator from this video"
      >
        {inFlight ? (
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-annotator-title"
            onClick={(e) => e.stopPropagation()}
            // `resize` needs a non-visible overflow to take effect.
            className="flex flex-col resize overflow-hidden bg-white rounded-xl shadow-2xl ring-1 ring-slate-200
                       w-[28rem] min-w-[22rem] max-w-[95vw] max-h-[90vh] text-left"
          >
            <div className="p-4 pb-2">
              <h2
                id="remove-annotator-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Remove annotator from "{sourceVideo}"
              </h2>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Their frames go back to the unassigned pool, where the dropdown or
                the assign button can hand them to someone else. Other annotators'
                frames are never touched.
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 border-y space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">Annotator</span>
                <select
                  value={annotatorId}
                  onChange={(e) =>
                    setAnnotatorId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                >
                  {holders.length !== 1 && <option value="">— pick an annotator —</option>}
                  {holders.map((h) => (
                    <option key={h.id} value={h.id}>
                      {nameOf(h.id)} ({h.unfinished} of {h.total} unfinished)
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFinished}
                  onChange={(e) => setIncludeFinished(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  Also release finished frames
                  <span className="block text-slate-500">
                    Off: done and reviewed frames stay credited to them and out
                    of the pool. Frames a reviewer sent back count as unfinished.
                    Who authored an annotation never changes either way.
                  </span>
                </span>
              </label>

              {holder && (
                <p className="text-xs tabular-nums text-slate-600">
                  {releasing === 0 ? (
                    <span className="text-amber-600">
                      Nothing to release — {nameOf(holder.id)} has no unfinished
                      frames here. Tick the box to release the finished ones.
                    </span>
                  ) : (
                    <>
                      <strong>{releasing}</strong> {releasing === 1 ? 'frame' : 'frames'}{' '}
                      will go back to the pool
                      {includeFinished && holder.unfinished < holder.total && (
                        <span className="text-amber-600">
                          , including {holder.total - holder.unfinished} already finished
                        </span>
                      )}
                      .
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="px-4 py-3 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400 select-none">
                Drag the corner to resize
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => {
                    if (!ready || holder == null) return;
                    onRemove({ annotatorId: holder.id, includeFinished });
                    close();
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
