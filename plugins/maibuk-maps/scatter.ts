/**
 * The Maps scatter (#750): the points a Fill scatters its Stamps on. Pure
 * functions over page millimetres, so a Fill scatters the same Stamps in the
 * same spots every render, and the editor can place them without a Frame.
 *
 * The points come from `poisson-disk-sampling`, sampled over the whole page at
 * the Fill's spacing and then kept only where they fall inside the area: a point
 * inside an odd number of the area's rings is inside it, so a face's holes are
 * left empty. Sampling in page space, not over the area's own box, keeps a
 * point where it is when a Map Line moves the face under it. The sampler's
 * first spot comes from a seeded PRNG, so one seed always gives one set of
 * points and a new seed scatters a new set.
 *
 * This module imports only `./maps`, `./geometry`, and npm packages.
 */

import PoissonDiskSampling from "poisson-disk-sampling";
import { pointsBounds, seededRandom } from "./geometry";
import type { MapPoint } from "./maps";

/** How many spots the sampler tries around each point before it accepts the point as placed. */
const SCATTER_TRIES = 10;

/**
 * The spacing a Fill's scatter starts with, and the range the properties panel
 * offers, in millimetres. A scattered Stamp is drawn one spacing wide, so one
 * control sets both how far apart the Stamps sit and how big each one is.
 */
export const DEFAULT_SCATTER_SPACING_MM = 8;
export const MIN_SCATTER_SPACING_MM = 3;
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
 * and at least `spacingMm` apart (about one spacing, since the spots the page
 * leaves outside the area are dropped). The sampler walks the whole page, so the
 * same `pageWidthMm`, `pageHeightMm`, `spacingMm`, and `seed` always give the
 * same points, in the same order, however the area moves over them. Rings with
 * no area, a spacing that draws nothing, or a page with no room scatter no
 * points at all.
 */
export function scatterPoints(
  rings: readonly (readonly MapPoint[])[],
  spacingMm: number,
  seed: number,
  pageWidthMm: number,
  pageHeightMm: number
): MapPoint[] {
  if (!Number.isFinite(spacingMm) || spacingMm <= 0) return [];
  if (!(pageWidthMm > 0) || !(pageHeightMm > 0)) return [];
  // Two points draw no area, and a Fill never scatters over one.
  const area = rings.filter((ring) => ring.length >= 3);
  const bounds = pointsBounds(area.flat());
  if (bounds === null || bounds.minX === bounds.maxX || bounds.minY === bounds.maxY) return [];
  const sampler = new PoissonDiskSampling(
    {
      shape: [pageWidthMm, pageHeightMm],
      minDistance: spacingMm,
      tries: SCATTER_TRIES,
    },
    seededRandom(seed)
  );
  return sampler
    .fill()
    .map(([x, y]): MapPoint => [x, y])
    .filter((point) => insideRings(area, point));
}
