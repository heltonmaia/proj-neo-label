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
  /** Assignable destinations. The pool is offered separately. */
  users: Annotator[];
  inFlight: boolean;
  disabled?: boolean;
  onReassign: (p: {
    fromId: number;
    toId: number | null;
    onlyUnfinished: boolean;
  }) => void;
}

/**
 * Per-video "hand this annotator's frames to someone else" control.
 *
 * Exists for the case an annotator stops working: their unfinished frames go
 * to a replacement (or back to the pool) while the frames they completed stay
 * credited to them. That last part is why `onlyUnfinished` defaults to on —
 * clearing it also moves their finished work, which is occasionally what an
 * admin wants but never the safe default.
 *
 * Dialog rather than a popover for the same reason as `SplitVideoButton`: both
 * mount points clip an absolutely-positioned child (the list view's table is
 * `overflow-x-auto`, the grid card `overflow-hidden`).
 */
export function ReassignAnnotatorButton({
  sourceVideo,
  holders,
  users,
  inFlight,
  disabled,
  onReassign,
}: Props) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | '' | 'pool'>('');
  const [onlyUnfinished, setOnlyUnfinished] = useState(true);

  const nobodyHolds = holders.length === 0;
  const off = inFlight || disabled || nobodyHolds;

  const from = holders.find((h) => h.id === fromId);
  const moving = from ? (onlyUnfinished ? from.unfinished : from.total) : 0;
  const ready = from != null && toId !== '' && moving > 0;

  function close() {
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
        onClick={() => setOpen(true)}
        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40 leading-none"
        title={
          nobodyHolds
            ? 'No annotator holds frames of this video'
            : "Hand one annotator's frames to someone else"
        }
        aria-label="Reassign one annotator's frames"
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
            <polyline points="16 3 21 3 21 8" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <polyline points="8 21 3 21 3 16" />
            <line x1="3" y1="21" x2="10" y2="14" />
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
            aria-labelledby="reassign-title"
            onClick={(e) => e.stopPropagation()}
            // `resize` needs a non-visible overflow to take effect.
            className="flex flex-col resize overflow-hidden bg-white rounded-xl shadow-2xl ring-1 ring-slate-200
                       w-[28rem] min-w-[22rem] max-w-[95vw] max-h-[90vh] text-left"
          >
            <div className="p-4 pb-2">
              <h2 id="reassign-title" className="text-base font-semibold text-slate-900 truncate">
                Reassign in "{sourceVideo}"
              </h2>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Hand one annotator's frames to someone else, or back to the pool.
                Other annotators' frames are never touched.
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 border-y space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">From</span>
                <select
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">— pick an annotator —</option>
                  {holders.map((h) => (
                    <option key={h.id} value={h.id}>
                      {nameOf(h.id)} ({h.unfinished} of {h.total} unfinished)
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-700">To</span>
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
                  onChange={(e) => setOnlyUnfinished(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  Only unfinished frames
                  <span className="block text-slate-500">
                    Leaves done and reviewed frames credited to them. Frames a
                    reviewer sent back count as unfinished.
                  </span>
                </span>
              </label>

              {from && (
                <p className="text-xs tabular-nums text-slate-600">
                  {moving === 0 ? (
                    <span className="text-amber-600">
                      Nothing to move — {nameOf(from.id)} has no{' '}
                      {onlyUnfinished ? 'unfinished ' : ''}frames here.
                    </span>
                  ) : (
                    <>
                      <strong>{moving}</strong> {moving === 1 ? 'frame' : 'frames'} will
                      move{!onlyUnfinished && from.unfinished < from.total && (
                        <span className="text-amber-600">
                          , including {from.total - from.unfinished} already finished
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
                    if (!ready || from == null) return;
                    onReassign({
                      fromId: from.id,
                      toId: toId === 'pool' ? null : (toId as number),
                      onlyUnfinished,
                    });
                    close();
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Reassign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
