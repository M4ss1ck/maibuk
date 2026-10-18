/** Frames to wait for a Virtualizer-mounted row before giving up. */
export const REVEAL_VIRTUAL_ROW_FRAMES = 3;

export interface RevealVirtualRowOptions {
  /** The scroll view the Virtualizer renders into. */
  getScroll: () => HTMLElement | null;
  /** The mounted row for `id`, or null when the Virtualizer has not mounted it. */
  findRow: (id: string) => HTMLElement | null;
  /** Where the row sits by estimate, or null when `id` is not in the list at all. */
  estimatedTop: (id: string) => number | null;
  id: string;
  /** Runs once the row is mounted; the row is already scrolled into view. */
  onRow: (row: HTMLElement) => void;
  /** Runs when the row never mounts within `frames` retries, or the list is gone. */
  onMissing?: () => void;
  frames?: number;
}

/**
 * Brings a virtualized row into view and runs `onRow` on it. A row the
 * Virtualizer has not mounted gets the scroll view moved to its estimated
 * offset, then is checked again on the next animation frame, at most `frames`
 * times. Returns a cancel function: callers call it on unmount and before a
 * superseding reveal, so a late frame never touches a row that is gone.
 */
export function revealVirtualRow({
  getScroll,
  findRow,
  estimatedTop,
  id,
  onRow,
  onMissing,
  frames = REVEAL_VIRTUAL_ROW_FRAMES,
}: RevealVirtualRowOptions): () => void {
  let pending: number | null = null;
  let cancelled = false;

  const attempt = (framesLeft: number): void => {
    pending = null;
    if (cancelled) return;
    const row = findRow(id);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      onRow(row);
      return;
    }
    const scroll = getScroll();
    const top = estimatedTop(id);
    if (!scroll || top === null || framesLeft === 0) {
      onMissing?.();
      return;
    }
    scroll.scrollTop = top;
    pending = requestAnimationFrame(() => attempt(framesLeft - 1));
  };

  attempt(frames);

  return () => {
    cancelled = true;
    if (pending !== null) cancelAnimationFrame(pending);
  };
}
