import { useMemo, useState } from 'react';

interface Annotator {
  id: number;
  username: string;
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
 * Per-video "split" control: pick annotators, preview the blocks, confirm.
 *
 * Selection order is meaningful — the first annotator picked gets the earliest
 * frames — so the picked list is kept as an array, not a Set.
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

  function toggle(id: number) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function close() {
    setOpen(false);
    setPicked([]);
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        disabled={off}
        onClick={() => setOpen((v) => !v)}
        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-40 leading-none"
        title={
          nothingToSplit
            ? 'No unassigned frames to split'
            : `Split the ${unassigned} unassigned frames between annotators`
        }
        aria-label="Split unassigned frames between annotators"
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
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={close} aria-hidden />
          <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border bg-white p-3 shadow-lg text-left">
            <p className="text-xs font-medium text-slate-700">
              Split "{sourceVideo}"
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {unassigned} unassigned {unassigned === 1 ? 'frame' : 'frames'} in
              contiguous blocks, in the order you pick. Frames that already have
              an annotator stay put.
            </p>

            <div className="mt-2 max-h-44 overflow-y-auto rounded border">
              {users.length === 0 && (
                <p className="p-2 text-[11px] text-slate-500">No users to assign to.</p>
              )}
              {users.map((u) => {
                const at = picked.indexOf(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={at !== -1}
                      onChange={() => toggle(u.id)}
                    />
                    <span className="flex-1 truncate">{u.username}</span>
                    {at !== -1 && (
                      <span className="tabular-nums text-[11px] text-slate-500">
                        {sizes[at]}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {picked.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-600 tabular-nums">
                {sizes.join(' · ')}
                {sizes.some((s) => s === 0) && (
                  <span className="text-amber-600">
                    {' '}
                    — fewer frames than annotators; some get none.
                  </span>
                )}
              </p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
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
                className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-900 disabled:opacity-40"
              >
                Split
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  );
}
