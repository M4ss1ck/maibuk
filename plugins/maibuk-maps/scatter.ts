/**
 * The Maps scatter (#750): the points a Fill scatters its Stamps on. Pure
 * functions over page millimetres, so a Fill scatters the same Stamps in the
 * same spots every render, and the editor can place them without a Frame.
 *
 * The points come from `poisson-disk-sampling`, sampled over the area's box at
 * the Fill's spacing and then kept only where they fall inside the area: a point
 * inside an odd number of the area's rings is inside it, so a face's holes are
 * left empty. The sampler's first spot comes from a seeded PRNG, so one seed
 * always gives one set of points and a new seed scatters a new set.
 *
 * This module imports only `./maps`, `./geometry`, and npm packages.
 */

import PoissonDiskSampling from "poisson-disk-sampling";
import { seededRandom } from "./geometry";
import type { MapPoint } from "./maps";

/** How many spots the sampler tries around each point before it accepts the point as placed. */
const SCATTER_TRIES = 10;

/** The spacing a Fill's scatter starts with, and the range the properties panel offers, in millimetres. */
export const DEFAULT_SCATTER_SPACING_MM = 5;
export const MIN_SCATTER_SPACING_MM = 1;
export const MAX_SCATTER_SPACING_MM = 30;

/**
 * The seed a Fill takes when it first scatters: a fresh value, so two Fills
 * never scatter the same way. It is never 0, which no seed needs and which
 * reads as a Fill that never picked one.
 */
export function newScatterSeed(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return (bytes[0] % 0x7fff_ffff) + 1;
}

/** One area's box: the smallest rectangle that holds every ring. */
interface AreaBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** The smallest and largest coordinate of every ring, or null when no ring has an area. */
function boundsOf(rings: readonly (readonly MapPoint[])[]): AreaBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const ring of rings) {
    // Two points draw no area, and a Fill never scatters over one.
    if (ring.length < 3) continue;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      found = true;
    }
  }
  if (!found) return null;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Whether `point` lies inside an odd number of `rings`: inside a face's outer
 * ring, and outside every ring cut out of it. Rings may repeat their first point
 * or not; the walk closes each one itself.
 */
function insideRings(rings: readonly (readonly MapPoint[])[], point: MapPoint): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      // An edge that does not cross the ray to the right of the point never counts.
      const startsAbove = a[1] > point[1];
      const endsAbove = b[1] > point[1];
      if (startsAbove === endsAbove) continue;
      if (point[0] < a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
    }
  }
  return inside;
}

/**
 * The points one Fill scatters its Stamps on, inside the area `rings` enclose
 * and at least `spacingMm` apart (about one spacing, since the spots the box
 * leaves outside the area are dropped). The same `rings`, `spacingMm`, and
 * `seed` always give the same points, in the same order. Rings with no area, a
 * spacing that draws nothing, or an area with no room scatter no points at all.
 */
export function scatterPoints(
  rings: readonly (readonly MapPoint[])[],
  spacingMm: number,
  seed: number
): MapPoint[] {
  if (!Number.isFinite(spacingMm) || spacingMm <= 0) return [];
  const bounds = boundsOf(rings);
  if (bounds === null || bounds.width <= 0 || bounds.height <= 0) return [];
  const sampler = new PoissonDiskSampling(
    {
      shape: [bounds.width, bounds.height],
      minDistance: spacingMm,
      tries: SCATTER_TRIES,
    },
    seededRandom(seed)
  );
  return sampler
    .fill()
    .map(([x, y]): MapPoint => [x + bounds.minX, y + bounds.minY])
    .filter((point) => insideRings(rings, point));
}
