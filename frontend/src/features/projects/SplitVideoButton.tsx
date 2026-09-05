import { useEffect, useMemo, useState } from 'react';

import { userLabel } from '@/lib/userLabel';

interface Annotator {
  id: number;
  username: string;
  email?: string | null;
}

interface Props {
  sourceVideo: string;
  /** Frames still in the admin pool — the only ones a split can move. */
  unassigned: number;
  users: Annotator[];
  inFlight: boolean;
  disabled?: boolean;
  onSplit: (assigneeIds: number[]) => void;
}

/** Block sizes for `total` frames across `n` annotators: the remainder goes to
 *  the earliest blocks, mirroring the backend's `_even_chunks`. */
function blockSizes(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Per-video "assign the free frames" control: pick one or more annotators,
 * preview the blocks, confirm. One annotator takes every unassigned frame;
 * several get contiguous blocks. Frames that already have an owner stay put,
 * which is what makes this the safe follow-up to `RemoveAnnotatorButton`.
 *
 * The picker is a centred dialog rather than a popover anchored to the button.
 * The row sits in a table wrapped in `overflow-x-auto`, which clipped a
 * popover at the section edge. The dialog escapes that, and is user-resizable
 * (`resize` + a non-visible `overflow`) because a project can have far more
 * annotators than fit a fixed box.
 */
export function SplitVideoButton({
  sourceVideo,
  unassigned,
  users,
  inFlight,
  disabled,
  onSplit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  const sizes = useMemo(
    () => blockSizes(unassigned, picked.length),
    [unassigned, picked.length],
  );

  const nothingToSplit = unassigned === 0;
  const off = inFlight || disabled || nothingToSplit;

  function close() {
    setOpen(false);
    setPicked([]);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function toggle(id: number) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={off}
        onClick={() => setOpen(true)}
        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40 leading-none"
        title={
          nothingToSplit
            ? 'No unassigned frames to hand out'
            : `Assign the ${unassigned} unassigned frames to one or more annotators`
        }
        aria-label="Assign unassigned frames to annotators"
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
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
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
            aria-labelledby="split-title"
            onClick={(e) => e.stopPropagation()}
            // `resize` needs a non-visible overflow to take effect; the inner
            // list does the scrolling, so hidden is right here.
            className="flex flex-col resize overflow-hidden bg-white rounded-xl shadow-2xl ring-1 ring-slate-200
                       w-[26rem] h-[26rem] min-w-[20rem] min-h-[16rem] max-w-[95vw] max-h-[90vh] text-left"
          >
            <div className="p-4 pb-2">
              <h2 id="split-title" className="text-base font-semibold text-slate-900 truncate">
                Assign free frames of "{sourceVideo}"
              </h2>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                {unassigned} unassigned {unassigned === 1 ? 'frame' : 'frames'} go to
                the annotators you pick. One annotator takes them all; several get
                contiguous blocks in the order you pick — the first annotator gets
                the earliest frames. Frames that already have an annotator stay put.
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto border-y mx-4">
              {users.length === 0 && (
                <p className="p-3 text-xs text-slate-500">No users to assign to.</p>
              )}
              {users.map((u) => {
                const at = picked.indexOf(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 px-2 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                  >
                    <input type="checkbox" checked={at !== -1} onChange={() => toggle(u.id)} />
                    <span className="flex-1 truncate" title={userLabel(u)}>{userLabel(u)}</span>
                    {at !== -1 && (
                      <span className="tabular-nums text-xs text-slate-500 whitespace-nowrap">
                        #{at + 1} · {sizes[at]}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="px-4 py-3">
              {picked.length > 0 && (
                <p className="mb-2 text-xs text-slate-600 tabular-nums break-words">
                  {sizes.join(' · ')}
                  {sizes.some((s) => s === 0) && (
                    <span className="text-amber-600">
                      {' '}
                      — fewer frames than annotators; some get none.
                    </span>
                  )}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
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
                    disabled={picked.length === 0}
                    onClick={() => {
                      onSplit(picked);
                      close();
                    }}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Assign
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
