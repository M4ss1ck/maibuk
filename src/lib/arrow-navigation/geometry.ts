/** Pixel tolerance for edge comparisons. */
const EPS = 1;

export type Direction = "up" | "down" | "left" | "right";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Candidate<T> {
  rect: Rect;
  id: T;
}

function isEligible(origin: Rect, c: Rect, dir: Direction): boolean {
  switch (dir) {
    case "right":
      return c.left >= origin.right - EPS;
    case "left":
      return c.right <= origin.left + EPS;
    case "down":
      return c.top >= origin.bottom - EPS;
    case "up":
      return c.bottom <= origin.top + EPS;
  }
}

function primaryGap(origin: Rect, c: Rect, dir: Direction): number {
  let gap: number;
  switch (dir) {
    case "right":
      gap = c.left - origin.right;
      break;
    case "left":
      gap = origin.left - c.right;
      break;
    case "down":
      gap = c.top - origin.bottom;
      break;
    case "up":
      gap = origin.top - c.bottom;
      break;
  }
  return Math.max(0, gap);
}

function crossOffset(focus: Rect, c: Rect, dir: Direction): number {
  if (dir === "left" || dir === "right") {
    const overlap = Math.min(focus.bottom, c.bottom) - Math.max(focus.top, c.top);
    if (overlap > 0) return 0;
    return Math.max(focus.top - c.bottom, c.top - focus.bottom, 0);
  }
  const overlap = Math.min(focus.right, c.right) - Math.max(focus.left, c.left);
  if (overlap > 0) return 0;
  return Math.max(focus.left - c.right, c.left - focus.right, 0);
}

function pick<T>(origin: Rect, focus: Rect, candidates: Candidate<T>[], dir: Direction): T | null {
  let best: Candidate<T> | null = null;
  let bestGroup = Number.POSITIVE_INFINITY;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const { rect } = candidate;
    if (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0) continue;
    if (!isEligible(origin, rect, dir)) continue;

    const offset = crossOffset(focus, rect, dir);
    const group = offset > 0 ? 1 : 0;
    const score = primaryGap(origin, rect, dir) + 2 * offset;

    if (group < bestGroup || (group === bestGroup && score < bestScore)) {
      best = candidate;
      bestGroup = group;
      bestScore = score;
    }
  }

  return best ? best.id : null;
}

/**
 * Picks the candidate nearest to `from` in `dir`, preferring candidates whose
 * cross-axis interval overlaps `from` over merely offset ones.
 */
export function pickInDirection<T>(
  from: Rect,
  candidates: Candidate<T>[],
  dir: Direction
): T | null {
  return pick(from, from, candidates, dir);
}

/**
 * Picks the pane to move into when `dir` leaves the pane holding focus:
 * eligibility and distance come from `fromPane`, cross-axis alignment from `from`.
 */
export function pickPane<T>(
  from: Rect,
  fromPane: Rect,
  panes: Candidate<T>[],
  dir: Direction
): T | null {
  return pick(fromPane, from, panes, dir);
}
