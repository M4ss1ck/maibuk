/**
 * The Maps faces (#748): the areas Map Lines enclose, which a Fill follows. Pure
 * functions over page millimetres, so the editor can pour a Fill, ask whether a
 * click landed in a face, and place a Fill's anchor without a Frame.
 *
 * A face comes from the Map Lines that enclose Fills, noded first: an end that
 * nearly meets another line is snapped onto it, then every segment is split at
 * every crossing and touch. `@turf/polygonize` turns the noded segments into
 * rings, and each ring bounds a face: the area just inside it, with the rings
 * directly inside it as its holes. A small closed line inside a big one
 * therefore gives the inner face and the ring around it, which is what a Fill
 * needs, rather than one face with no hole.
 *
 * Rings are closed: the first point is repeated at the end.
 *
 * This module imports only `./maps`, `./geometry`, and npm packages.
 */

import polygonize from "@turf/polygonize";
import type { FeatureCollection, LineString } from "geojson";
import polylabel from "polylabel";
import { linePath } from "./geometry";
import type { MapLineElement, MapPoint } from "./maps";

/** How far two ends of Map Lines may be apart and still close the area between them. */
export const GAP_TOLERANCE_MM = 2;

/** The area one Fill covers: the ring around it, the rings cut out of it, and its size. */
export interface Face {
  outer: MapPoint[];
  holes: MapPoint[][];
  /** The area inside `outer` with the holes taken out, in square millimetres. */
  area: number;
}

/** One noded stretch of a Map Line: the two ends it runs between. */
export type NodedSegment = [MapPoint, MapPoint];

/** Points closer than this are the same point, in page millimetres. */
const EPSILON_MM = 1e-6;

/**
 * The area a face has to cover to be one a Fill can sit in, in square
 * millimetres. A ring whose own children tile it exactly — an island cut into
 * its provinces — hands back the difference of two sums of the same vertices,
 * which is this much noise rather than ground.
 */
const SMALLEST_FACE_AREA_MM2 = 1e-3;

/** How many samples a curved segment is flattened to. */
const CURVE_SAMPLES = 8;

/** How close the pole of inaccessibility has to be, in page millimetres. */
const LABEL_PRECISION_MM = 0.1;

/** A coarser pole is enough to say which ring sits inside which. */
const INTERIOR_PRECISION_MM = 0.5;

/** The commands `linePath` writes: an absolute move, line, cubic, and a close. */
const PATH_COMMAND = /([MLCZ])([^MLCZ]*)/g;

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** A point `t` of the way from `a` to `b`. */
function pointAt(a: MapPoint, b: MapPoint, t: number): MapPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The point of segment `a`-`b` nearest `point`, and how far along the segment it lies. */
function nearestOnSegment(
  point: MapPoint,
  a: MapPoint,
  b: MapPoint
): { t: number; point: MapPoint } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return { t, point: pointAt(a, b, t) };
}

/** A point on the cubic `start`-`one`-`two`-`end` at `t`. */
function cubicAt(
  start: MapPoint,
  one: MapPoint,
  two: MapPoint,
  end: MapPoint,
  t: number
): MapPoint {
  const rest = 1 - t;
  const first = rest * rest * rest;
  const second = 3 * rest * rest * t;
  const third = 3 * rest * t * t;
  const fourth = t * t * t;
  return [
    first * start[0] + second * one[0] + third * two[0] + fourth * end[0],
    first * start[1] + second * one[1] + third * two[1] + fourth * end[1],
  ];
}

/**
 * A Map Line's outline as points. `linePath` is the one place a curved segment
 * becomes geometry, so its path is sampled here rather than a second Catmull-Rom
 * spline written for fills; what a Fill follows is then exactly what the Frame
 * draws.
 */
function flattenLine(line: MapLineElement): MapPoint[] {
  const points: MapPoint[] = [];
  for (const [, command, args] of linePath(line).matchAll(PATH_COMMAND)) {
    const numbers = args.trim().split(/\s+/).map(Number);
    if (command === "C") {
      const start = points[points.length - 1];
      const one: MapPoint = [numbers[0], numbers[1]];
      const two: MapPoint = [numbers[2], numbers[3]];
      const end: MapPoint = [numbers[4], numbers[5]];
      for (let step = 1; step <= CURVE_SAMPLES; step++) {
        points.push(cubicAt(start, one, two, end, step / CURVE_SAMPLES));
      }
    } else if (command !== "Z") {
      points.push([numbers[0], numbers[1]]);
    }
  }
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  // A straight closing segment is a `Z`, which carries no point of its own.
  if (line.closed && (first[0] !== last[0] || first[1] !== last[1])) {
    points.push([first[0], first[1]]);
  }
  return points;
}

/** One flattened Map Line: its outline points, and whether the outline closes. */
interface FlatLine {
  points: MapPoint[];
  closed: boolean;
}

/** One segment of a flattened line, by the two point indices it joins. */
interface Segment {
  line: number;
  index: number;
}

/** A point where a segment has to be split, and how far along the segment it lies. */
interface Cut {
  t: number;
  point: MapPoint;
}

/** A segment's ends, in either order, so two lines drawn on top of each other match. */
function segmentKey(a: MapPoint, b: MapPoint): string {
  const one = `${a[0]},${a[1]}`;
  const two = `${b[0]},${b[1]}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

/** Where two segments cross inside both of them, or null when they do not. */
function crossing(
  a: MapPoint,
  b: MapPoint,
  c: MapPoint,
  d: MapPoint
): { t: number; u: number; point: MapPoint } | null {
  const runX = b[0] - a[0];
  const runY = b[1] - a[1];
  const spanX = d[0] - c[0];
  const spanY = d[1] - c[1];
  const denominator = runX * spanY - runY * spanX;
  // Parallel and collinear segments cross nowhere to split: a shared stretch is
  // one of the duplicates the noded list drops.
  if (denominator === 0) return null;
  const offsetX = c[0] - a[0];
  const offsetY = c[1] - a[1];
  const t = (offsetX * spanY - offsetY * spanX) / denominator;
  const u = (offsetX * runY - offsetY * runX) / denominator;
  // An end that lands on a segment is a touch, which the caller adds as itself.
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u, point: [a[0] + runX * t, a[1] + runY * t] };
}

/** A segment's range on each axis, widened so two ranges that only touch still meet. */
interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Whether two widened ranges overlap on both axes, so their segments can cross or touch. */
function rangesOverlap(one: Bounds, two: Bounds): boolean {
  return (
    one.minX <= two.maxX && two.minX <= one.maxX && one.minY <= two.maxY && two.minY <= one.maxY
  );
}

/**
 * The Map Lines that enclose Fills, split into segments that meet only at their
 * ends. An open line's dangling end that lies within `toleranceMm` of another
 * line (or of the other end of its own line) is snapped onto the nearest point
 * of it, which closes the hand-drawn gap a Fill has to follow; a wider gap stays
 * open. An end that already touches another line is not dangling and stays put,
 * so lines that meet exactly, as a Template's shared borders do, keep their
 * junctions. Every segment is then cut at every crossing and touching point, and a
 * segment that repeats another one, or has no length, is dropped.
 */
export function nodeLines(
  lines: readonly MapLineElement[],
  toleranceMm = GAP_TOLERANCE_MM
): NodedSegment[] {
  const tolerance = Number.isFinite(toleranceMm) ? Math.max(0, toleranceMm) : 0;
  const flat: FlatLine[] = lines
    .filter((line) => line.enclosesFills === true)
    .map((line) => ({ points: flattenLine(line), closed: line.closed }))
    .filter((line) => line.points.length >= 2);

  const segments: Segment[] = [];
  flat.forEach((line, lineIndex) => {
    for (let index = 0; index < line.points.length - 1; index++) {
      const a = line.points[index];
      const b = line.points[index + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      segments.push({ line: lineIndex, index });
    }
  });

  const ends = (segment: Segment): [MapPoint, MapPoint] => {
    const points = flat[segment.line].points;
    return [points[segment.index], points[segment.index + 1]];
  };

  // Whether an end already touches another line: such an end is not dangling.
  // A line's own segments are left out, so it never counts the stretch it
  // already runs along.
  function touchesOther(point: MapPoint, lineIndex: number): boolean {
    return segments.some((segment) => {
      if (segment.line === lineIndex) return false;
      const [a, b] = ends(segment);
      return distance(point, nearestOnSegment(point, a, b).point) <= EPSILON_MM;
    });
  }

  // The nearest point of another line, within the tolerance, for a dangling end.
  // Its two ends meeting each other is the second rule below.
  function nearestGap(point: MapPoint, lineIndex: number): MapPoint | null {
    let best: MapPoint | null = null;
    let bestDistance = tolerance;
    for (const segment of segments) {
      if (segment.line === lineIndex) continue;
      const [a, b] = ends(segment);
      const near = nearestOnSegment(point, a, b).point;
      const gap = distance(point, near);
      if (gap < bestDistance) {
        bestDistance = gap;
        best = near;
      }
    }
    return best;
  }

  // Which ends dangle is read before any end moves, so one snap never decides
  // whether another end counts as touching.
  const dangling = flat.map((line, lineIndex) =>
    line.closed
      ? [false, false]
      : [0, line.points.length - 1].map((end) => !touchesOther(line.points[end], lineIndex))
  );
  flat.forEach((line, lineIndex) => {
    if (line.closed) return;
    const last = line.points.length - 1;
    const [startDangles, endDangles] = dangling[lineIndex];
    for (const [end, dangles] of [
      [0, startDangles],
      [last, endDangles],
    ] as const) {
      if (!dangles) continue;
      const near = nearestGap(line.points[end], lineIndex);
      if (near !== null) line.points[end] = [near[0], near[1]];
    }
    // A line drawn almost back to its own start closes onto that start.
    if (startDangles && endDangles && distance(line.points[0], line.points[last]) <= tolerance) {
      line.points[last] = [line.points[0][0], line.points[0][1]];
    }
  });

  // Every segment's range, for the cheap reject the two pair loops below take
  // before their geometry: reconcileFills runs this on every edit.
  const bounds = segments.map((segment): Bounds => {
    const [a, b] = ends(segment);
    return {
      minX: Math.min(a[0], b[0]) - EPSILON_MM,
      maxX: Math.max(a[0], b[0]) + EPSILON_MM,
      minY: Math.min(a[1], b[1]) - EPSILON_MM,
      maxY: Math.max(a[1], b[1]) + EPSILON_MM,
    };
  });

  const cuts: Cut[][] = segments.map(() => []);
  for (let one = 0; one < segments.length; one++) {
    const [a, b] = ends(segments[one]);
    for (let two = one + 1; two < segments.length; two++) {
      if (!rangesOverlap(bounds[one], bounds[two])) continue;
      const [c, d] = ends(segments[two]);
      const hit = crossing(a, b, c, d);
      if (hit === null) continue;
      cuts[one].push({ t: hit.t, point: hit.point });
      cuts[two].push({ t: hit.u, point: hit.point });
    }
  }

  // An end that lies on another segment, as a T junction or as the end the gap
  // tolerance just moved, splits that segment where it lands.
  for (const segment of segments) {
    for (const vertex of ends(segment)) {
      for (let other = 0; other < segments.length; other++) {
        if (segments[other] === segment) continue;
        const box = bounds[other];
        if (
          vertex[0] < box.minX ||
          vertex[0] > box.maxX ||
          vertex[1] < box.minY ||
          vertex[1] > box.maxY
        ) {
          continue;
        }
        const [a, b] = ends(segments[other]);
        const near = nearestOnSegment(vertex, a, b);
        if (near.t > 0 && near.t < 1 && distance(vertex, near.point) <= EPSILON_MM) {
          cuts[other].push({ t: near.t, point: vertex });
        }
      }
    }
  }

  const noded: NodedSegment[] = [];
  const seen = new Set<string>();
  const add = (a: MapPoint, b: MapPoint): void => {
    if (distance(a, b) <= EPSILON_MM) return;
    const key = segmentKey(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    noded.push([a, b]);
  };

  segments.forEach((segment, index) => {
    const [a, b] = ends(segment);
    const ordered = cuts[index]
      .filter((cut) => cut.t > 0 && cut.t < 1)
      .sort((one, two) => one.t - two.t);
    let previous = a;
    for (const cut of ordered) {
      if (distance(previous, cut.point) <= EPSILON_MM) continue;
      add(previous, cut.point);
      previous = cut.point;
    }
    add(previous, b);
  });

  return noded;
}

/** A ring's signed area: the sign says which way it runs, the size how much it covers. */
function signedArea(ring: readonly MapPoint[]): number {
  let total = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    total += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return total / 2;
}

/** Whether a point lies inside a closed ring. */
function insideRing(ring: readonly MapPoint[], point: MapPoint): boolean {
  let inside = false;
  for (let index = 0; index < ring.length - 1; index++) {
    const a = ring[index];
    const b = ring[index + 1];
    // An edge that does not cross the ray to the right of the point never counts.
    const startsAbove = a[1] > point[1];
    const endsAbove = b[1] > point[1];
    if (startsAbove === endsAbove) continue;
    if (point[0] < a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
  }
  return inside;
}

/** The same ring written the same way whichever point and direction it starts from. */
function ringKey(ring: readonly MapPoint[]): string {
  const keys = ring.slice(0, -1).map((point) => `${point[0]},${point[1]}`);
  let start = 0;
  for (let index = 1; index < keys.length; index++) {
    if (keys[index] < keys[start]) start = index;
  }
  const forward = [...keys.slice(start), ...keys.slice(0, start)];
  const backward = [forward[0], ...forward.slice(1).reverse()];
  const one = forward.join("|");
  const two = backward.join("|");
  return one < two ? one : two;
}

/**
 * The faces the rings bound. Turf 7.4 hands a ring nested inside another back as
 * a polygon of its own instead of as a hole, so each ring is taken as the
 * boundary of the face inside it, and the rings directly inside it are that
 * face's holes. A ring whose holes already cover it — the island's own ring
 * beside the province rings it is cut into — therefore bounds no face at all,
 * and is dropped: keeping it would hand a Fill an empty face that fights the
 * province beside it.
 */
function facesFromRings(rings: readonly MapPoint[][]): Face[] {
  const unique = new Map<string, MapPoint[]>();
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const key = ringKey(ring);
    if (!unique.has(key)) unique.set(key, ring);
  }

  const ringsWithArea = [...unique.values()].map((ring) => ({
    ring,
    area: Math.abs(signedArea(ring)),
    interior: polylabel([ring], INTERIOR_PRECISION_MM),
  }));

  const parents = ringsWithArea.map((entry, index) => {
    let parent = -1;
    ringsWithArea.forEach((other, otherIndex) => {
      if (otherIndex === index || other.area <= entry.area) return;
      if (!insideRing(other.ring, entry.interior)) return;
      if (parent === -1 || other.area < ringsWithArea[parent].area) parent = otherIndex;
    });
    return parent;
  });

  return ringsWithArea
    .map((entry, index) => {
      const holes = ringsWithArea
        .filter((_other, otherIndex) => parents[otherIndex] === index)
        .map((child) => child.ring);
      const holeArea = holes.reduce((total, hole) => total + Math.abs(signedArea(hole)), 0);
      return { outer: entry.ring, holes, area: entry.area - holeArea };
    })
    .filter((face) => face.area >= SMALLEST_FACE_AREA_MM2);
}

/** The faces the Map Lines enclose, which a Fill can cover. */
export function findFaces(
  lines: readonly MapLineElement[],
  toleranceMm = GAP_TOLERANCE_MM
): Face[] {
  const segments = nodeLines(lines, toleranceMm);
  if (segments.length === 0) return [];
  const collection: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: segments.map((segment) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [segment[0], segment[1]] },
    })),
  };
  const rings = polygonize(collection).features.map(
    (feature) => feature.geometry.coordinates[0] as MapPoint[]
  );
  return facesFromRings(rings);
}

/** The face `point` falls in: inside its outer ring, outside its holes, and the smallest such. */
export function faceAt(faces: readonly Face[], point: MapPoint): Face | null {
  let found: Face | null = null;
  for (const face of faces) {
    if (!insideRing(face.outer, point)) continue;
    if (face.holes.some((hole) => insideRing(hole, point))) continue;
    if (found === null || face.area < found.area) found = face;
  }
  return found;
}

/**
 * The point of a face farthest from its outline, holes included, for a Fill's
 * anchor: the place a Fill keeps its colour when the lines around it move.
 */
export function deepestPoint(face: Face): MapPoint {
  const [x, y] = polylabel([face.outer, ...face.holes], LABEL_PRECISION_MM);
  return [x, y];
}
