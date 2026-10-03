/**
 * A section change moves its rows behind one clip edge, not each row on its
 * own: the edge sweeps the section's stack and, at any moment, the rows above
 * it are full height, the rows below it are 0, and at most one row is cut. A
 * per-row curve would leave every row shrinking at once, so several labels
 * would be clipped at once and show stacked slivers of text.
 */

/**
 * A CSS cubic-bezier timing function as a plain function. The curve is defined
 * by two control points; the returned function takes t in [0, 1] and returns
 * the eased progress, 0 and 1 exactly at the ends.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): (t: number) => number {
  const sample = (a: number, b: number, s: number) => {
    const u = 1 - s;
    return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
  };
  const slope = (a: number, b: number, s: number) => {
    const u = 1 - s;
    return 3 * u * u * a + 6 * u * s * (b - a) + 3 * s * s * (1 - b);
  };
  return (t: number) => {
    const x = Math.min(1, Math.max(0, t));
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton's method first: the curve is smooth and this converges in a few
    // steps. A flat slope (a curve that starts or ends vertical) sends it
    // nowhere, so bisection takes over.
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = sample(x1, x2, s) - x;
      if (Math.abs(error) < 1e-6) break;
      const derivative = slope(x1, x2, s);
      if (Math.abs(derivative) < 1e-6) break;
      s -= error / derivative;
      if (s < 0) s = 0;
      else if (s > 1) s = 1;
    }
    let low = 0;
    let high = 1;
    for (let i = 0; i < 32; i++) {
      const value = sample(x1, x2, s) - x;
      if (Math.abs(value) < 1e-6) break;
      if (value < 0) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return sample(y1, y2, s);
  };
}

/** How many steps a swept edge is sampled at, per phase. */
export const OUTLINE_EDGE_SAMPLES = 16;

/**
 * One clip edge sweeping a section's rows, as per-row height keyframes.
 *
 * Row i's top is the sum of the rows above it. The edge starts at `from` (the
 * space the section paints at now) and travels to `to` along `ease`; at each
 * step the edge sits at `e`, every row's top above `e` is full, everything at
 * or below it is empty, and the one row the edge crosses is cut to the part of
 * it above `e`. Each keyframe entry pairs the step's progress with every row's
 * height at that step.
 *
 * Beyond the uniform offsets, a keyframe also sits on every row boundary the
 * edge crosses, found by bisection. The browser interpolates linearly between
 * keyframes, so without them a segment that spans a boundary would move two
 * rows at once and clip both; with a keyframe exactly on the boundary, only
 * one row changes between any two keyframes.
 */
export function edgeKeyframes(
  naturals: readonly number[],
  from: number,
  to: number,
  ease: (t: number) => number,
  samples = OUTLINE_EDGE_SAMPLES
): { offset: number; heights: number[] }[] {
  const tops: number[] = [];
  let top = 0;
  for (const natural of naturals) {
    tops.push(top);
    top += natural;
  }
  const stackBottom = top;

  const uniforms: number[] = [];
  for (let k = 0; k <= samples; k++) {
    uniforms.push(k / samples);
  }

  const lowEdge = Math.min(from, to);
  const highEdge = Math.max(from, to);
  const crossings: number[] = [];
  for (const boundary of [...tops, stackBottom]) {
    // Only a boundary the edge passes through in the interior needs a keyframe:
    // one the edge starts or ends on is already an endpoint.
    if (boundary <= lowEdge || boundary >= highEdge) continue;
    const target = (boundary - from) / (to - from);
    // `ease` is monotonic non-decreasing, so bisection finds the progress that
    // lands the edge exactly on the boundary.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (ease(mid) < target) low = mid;
      else high = mid;
    }
    crossings.push((low + high) / 2);
  }

  crossings.sort((a, b) => a - b);
  // Uniform offsets are kept exactly, so a crossing that lands on one is
  // already covered; a crossing closer than 1e-6 to a kept offset is dropped.
  const merged = uniforms.sort((a, b) => a - b);
  for (const crossing of crossings) {
    const duplicate = merged.some(
      (offset) => Math.abs(offset - crossing) <= 1e-6
    );
    if (!duplicate) merged.push(crossing);
  }
  merged.sort((a, b) => a - b);
  merged[0] = 0;
  merged[merged.length - 1] = 1;

  return merged.map((offset) => {
    const edge = from + (to - from) * ease(offset);
    const heights = naturals.map((natural, i) =>
      Math.min(natural, Math.max(0, edge - tops[i]))
    );
    return { offset, heights };
  });
}
