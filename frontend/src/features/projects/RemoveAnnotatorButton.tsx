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
  /** Everyone, assignable or not. Only used to *name* the holders — a legacy
   *  emailless account can still hold frames and must be nameable. */
  users: Annotator[];
  /** Where the frames may go: accounts that can actually sign in. Never offer
   *  a legacy account as a destination, or the work lands where nobody can
   *  reach it. */
  destinations: Annotator[];
  inFlight: boolean;
  disabled?: boolean;
  onRemove: (p: {
    annotatorId: number;
    toId: number | null;
    keepFinished: boolean;
  }) => void;
}

/**
 * Per-video "remove this annotator" control.
 *
 * Takes one annotator off a video and says, in the same breath, where their
 * frames go: to a replacement, or back to the unassigned pool. The
 * destination is a required choice rather than an implicit "pool", because
 * removing someone mid-video is normally a hand-over, and leaving the frames
 * in limbo is the rarer intent.
 *
 * Every frame they hold moves, finished ones included, so their name is off
 * the video and off its rows — a removal that left them on the done frames
 * read as "it didn't work". `keepFinished` opts back into the narrower move
 * for the case where completed work should stay theirs; the dialog then says
 * plainly that this keeps them on the video. Nothing here changes who
 * *authored* an annotation, only who may edit the frame.
 *
 * Dialog rather than a popover for the same reason as `SplitVideoButton`: the
 * row lives in a table wrapped in `overflow-x-auto`, which clips an
 * absolutely-positioned child at the section edge.
 */
export function RemoveAnnotatorButton({
  sourceVideo,
  holders,
  users,
  destinations,
  inFlight,
  disabled,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const [annotatorId, setAnnotatorId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | '' | 'pool'>('');
  const [keepFinished, setKeepFinished] = useState(false);

  const nobodyHolds = holders.length === 0;
  const off = inFlight || disabled || nobodyHolds;
  const holder = holders.find((h) => h.id === annotatorId);
  const moving = holder ? (keepFinished ? holder.unfinished : holder.total) : 0;
  const ready = holder != null && toId !== '' && moving > 0;
  const leftBehind = holder ? holder.total - holder.unfinished : 0;

  function openDialog() {
    // A single holder needs no picking. The destination always does.
    setAnnotatorId(holders.length === 1 ? holders[0].id : '');
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setAnnotatorId('');
    setToId('');
    setKeepFinished(false);
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
            : 'Remove an annotator and hand their frames to someone else'
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
                Their frames move in one step to whoever you pick, or back to the
                unassigned pool. Other annotators' frames are never touched.
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 border-y space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">Remove</span>
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

              <label className="block">
                <span className="text-xs font-medium text-slate-700">Their frames go to</span>
                <select
                  value={toId}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setToId(raw === '' ? '' : raw === 'pool' ? 'pool' : Number(raw));
                  }}
                  className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— pick a destination —</option>
                  <option value="pool">— back to the unassigned pool —</option>
                  {destinations
                    .filter((u) => u.id !== annotatorId)
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
                  checked={keepFinished}
                  onChange={(e) => setKeepFinished(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  Keep their finished frames assigned to them
                  <span className="block text-slate-500">
                    Off: everything they hold moves and their name leaves this
                    video. On: done and reviewed frames stay theirs. Who authored
                    an annotation never changes either way.
                  </span>
                </span>
              </label>

              {holder && (
                <p className="text-xs tabular-nums text-slate-600">
                  {moving === 0 ? (
                    <span className="text-amber-600">
                      Nothing to move — {nameOf(holder.id)} has only finished frames
                      here, and the box above keeps those with them.
                    </span>
                  ) : (
                    <>
                      <strong>{moving}</strong> {moving === 1 ? 'frame' : 'frames'}{' '}
                      {toId === ''
                        ? 'will move once you pick a destination'
                        : toId === 'pool'
                          ? 'will go back to the unassigned pool'
                          : `will go to ${nameOf(toId as number)}`}
                      {!keepFinished && leftBehind > 0 && (
                        <span className="text-slate-500">
                          , including {leftBehind} already finished
                        </span>
                      )}
                      {keepFinished && leftBehind > 0 && (
                        <span className="text-amber-600">
                          ; {leftBehind} finished stay with {nameOf(holder.id)}, so their
                          name remains on this video
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
                    onRemove({
                      annotatorId: holder.id,
                      toId: toId === 'pool' ? null : (toId as number),
                      keepFinished,
                    });
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
