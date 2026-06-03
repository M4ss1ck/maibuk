export interface SnapResult {
  /** Amount to add to the moving object's coordinate to align it to `line`. */
  delta: number;
  /** The target guide line the object snapped to. */
  line: number;
}

/**
 * Find the smallest adjustment that aligns any of `positions` (candidate edges
 * or centers of the moving object) to any of `targets` (guide lines), provided
 * it is within `threshold`. Returns null when nothing is close enough.
 */
export function snapAxis(positions: number[], targets: number[], threshold: number): SnapResult | null {
  let best: SnapResult | null = null;
  for (const p of positions) {
    for (const t of targets) {
      const delta = t - p;
      if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, line: t };
      }
    }
  }
  return best;
}
