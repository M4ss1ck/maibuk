/**
 * The Maps geometry (#746, #747): the Eraser's split of a Map Line, the Roughen
 * pass that gives a line the rough ink look, and the outline an exact Shape
 * draws. All pure functions over page millimetres, so the editor can test a cut,
 * a roughened line, and a Shape without a Frame, and the same seed always draws
 * the same wobble.
 *
 * This module imports only `./maps` and npm packages.
 */

import { createNoise2D } from "simplex-noise";
import {
  DEFAULT_POLYGON_SIDES,
  MIN_SHAPE_SIZE_MM,
  type MapLineElement,
  type MapPoint,
  type MapShape,
  type ShapeKind,
} from "./maps";

/** One piece of a Map Line the Eraser left behind; a cut always opens a line. */
export interface ErasedLine {
  points: MapPoint[];
  curves: boolean[];
  closed: false;
}

/** The shape both functions need: its points, one flag per segment, and whether it closes. */
export interface LineGeometry {
  points: readonly MapPoint[];
  curves: readonly boolean[];
  closed: boolean;
}

/** The step Roughen resamples a line at, in page millimetres. */
const ROUGHEN_SPACING_MM = 1;

/** How long one wobble of the Roughen noise is, in page millimetres. */
const ROUGHEN_WAVELENGTH_MM = 6;

/** How many layers of noise a roughened line's wobble adds up from. */
const ROUGHEN_OCTAVES = 3;

/** Ternary-search steps that find the nearest spot on a segment; more than enough. */
const SEARCH_STEPS = 48;

/** Bisection steps that place a cut on the boundary of the eraser; more than enough. */
const BISECT_STEPS = 40;

/** How many samples an ellipse's outline takes. */
const ELLIPSE_SAMPLES = 64;

/** How many samples one rounded rectangle corner takes. */
const CORNER_SAMPLES = 8;

/** A stable number for one Element id, so Roughen and the rough ink look never drift. */
export function seedFor(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A seeded PRNG (mulberry32), which `createNoise2D` wants in place of
 * `Math.random` and `scatterPoints` wants in place of it too: the same seed
 * always draws the same noise, and scatters the same points.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point `t` of the way from `a` to `b`. */
function pointAt(a: MapPoint, b: MapPoint, t: number): MapPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** The smallest and largest coordinate of a set of points, in page millimetres. */
export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box `points` fill, in page millimetres, or null for no points. */
export function pointsBounds(points: readonly MapPoint[]): MapBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (minX === Number.POSITIVE_INFINITY) return null;
  return { minX, minY, maxX, maxY };
}

/** The distance from a point to the nearest spot on segment `a`-`b`. */
function distanceToSegment(point: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
}

/** The `t` where `reach` crosses `radius`, between an uncovered and a covered spot. */
function bisectBoundary(
  reach: (t: number) => number,
  radius: number,
  uncovered: number,
  covered: number
): number {
  let outside = uncovered;
  let inside = covered;
  for (let step = 0; step < BISECT_STEPS; step++) {
    const middle = (outside + inside) / 2;
    if (reach(middle) <= radius) inside = middle;
    else outside = middle;
  }
  return (outside + inside) / 2;
}

/**
 * The stretch of segment `a`-`b` that lies within `radius` of segment `c`-`d`,
 * as a `t` range, or null when the eraser misses it. The distance from a point
 * sliding along a line to a segment is convex, so the covered stretch is one
 * range: a ternary search finds its nearest spot and bisection finds its ends.
 */
function coveredRange(
  a: MapPoint,
  b: MapPoint,
  c: MapPoint,
  d: MapPoint,
  radius: number
): [number, number] | null {
  const reach = (t: number) => distanceToSegment(pointAt(a, b, t), c, d);
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const one = low + (high - low) / 3;
    const two = high - (high - low) / 3;
    if (reach(one) < reach(two)) high = two;
    else low = one;
  }
  const nearest = (low + high) / 2;
  if (reach(nearest) > radius) return null;
  const start = reach(0) <= radius ? 0 : bisectBoundary(reach, radius, 0, nearest);
  const end = reach(1) <= radius ? 1 : bisectBoundary(reach, radius, 1, nearest);
  return [start, end];
}

/** The stretches of segment `a`-`b` the eraser leaves, in order, as `t` ranges. */
function survivingRanges(
  a: MapPoint,
  b: MapPoint,
  eraserPath: readonly MapPoint[],
  radius: number
): Array<[number, number]> {
  const covered: Array<[number, number]> = [];
  if (eraserPath.length === 1) {
    const spot = coveredRange(a, b, eraserPath[0], eraserPath[0], radius);
    if (spot !== null) covered.push(spot);
  } else {
    for (let index = 0; index < eraserPath.length - 1; index++) {
      const range = coveredRange(a, b, eraserPath[index], eraserPath[index + 1], radius);
      if (range !== null) covered.push(range);
    }
  }
  if (covered.length === 0) return [[0, 1]];

  covered.sort((one, two) => one[0] - two[0]);
  const merged: Array<[number, number]> = [];
  for (const range of covered) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  const survivors: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) survivors.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1) survivors.push([cursor, 1]);
  return survivors;
}

/** One surviving stretch of one segment, as the eraser left it. */
interface Survivor {
  segment: number;
  start: number;
  end: number;
}

/** Whether `previous` runs straight into `next` at a vertex, across a closed line's seam too. */
function joins(previous: Survivor, next: Survivor, segmentCount: number): boolean {
  return (
    previous.end === 1 && next.start === 0 && next.segment === (previous.segment + 1) % segmentCount
  );
}

/**
 * The parts of a Map Line that lie outside `radiusMm` of the Eraser path, or
 * null when the eraser never touches the line. A cut through the middle of an
 * open line leaves two lines; a closed line opens into one line that starts
 * just after the cut. Cuts land on the straight chord, so a cut segment is
 * drawn straight and an untouched one keeps its curve flag.
 */
export function eraseLines(
  line: LineGeometry,
  eraserPath: readonly MapPoint[],
  radiusMm: number
): ErasedLine[] | null {
  const { points, curves, closed } = line;
  if (points.length < 2 || eraserPath.length === 0) return null;
  const radius = Number.isFinite(radiusMm) ? Math.max(0, radiusMm) : 0;
  const segmentCount = closed ? points.length : points.length - 1;

  const survivors: Survivor[] = [];
  let touched = false;
  for (let segment = 0; segment < segmentCount; segment++) {
    const a = points[segment];
    const b = points[(segment + 1) % points.length];
    const kept = survivingRanges(a, b, eraserPath, radius);
    if (kept.length !== 1 || kept[0][0] !== 0 || kept[0][1] !== 1) touched = true;
    for (const [start, end] of kept) survivors.push({ segment, start, end });
  }
  if (!touched) return null;
  if (survivors.length === 0) return [];

  // A closed line has no natural start, so it starts just after its first cut;
  // walking from there keeps the seam out of the middle of the one piece.
  let first = 0;
  if (closed) {
    const breakAt = survivors.findIndex(
      (survivor, index) =>
        !joins(survivors[(index + survivors.length - 1) % survivors.length], survivor, segmentCount)
    );
    if (breakAt !== -1) first = breakAt;
  }
  const ordered = survivors.map(
    (_survivor, offset) => survivors[(first + offset) % survivors.length]
  );

  const pieces: ErasedLine[] = [];
  let piecePoints: MapPoint[] = [];
  let pieceCurves: boolean[] = [];
  let atVertex = false;
  for (const survivor of ordered) {
    const a = points[survivor.segment];
    const b = points[(survivor.segment + 1) % points.length];
    const start: MapPoint = survivor.start === 0 ? [a[0], a[1]] : pointAt(a, b, survivor.start);
    const end: MapPoint = survivor.end === 1 ? [b[0], b[1]] : pointAt(a, b, survivor.end);
    const whole = survivor.start === 0 && survivor.end === 1;
    const curved = whole && curves[survivor.segment] === true;
    if (atVertex && piecePoints.length > 0) {
      piecePoints.push(end);
      pieceCurves.push(curved);
    } else {
      if (piecePoints.length >= 2) {
        pieces.push({ points: piecePoints, curves: pieceCurves, closed: false });
      }
      piecePoints = [start, end];
      pieceCurves = [curved];
    }
    atVertex = survivor.end === 1;
  }
  if (piecePoints.length >= 2) {
    pieces.push({ points: piecePoints, curves: pieceCurves, closed: false });
  }
  return pieces;
}

/**
 * The distance along a polyline to each of its points: the first entry is 0 and
 * the last is the whole length. One pass, so a tapered shape reads every point's
 * place without walking the line again.
 */
export function cumulativeLengths(points: readonly MapPoint[]): number[] {
  const lengths: number[] = [0];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]
    );
    lengths.push(total);
  }
  return lengths;
}

/** The length of a polyline, for the arc length Roughen's noise follows. */
export function polylineLength(points: readonly MapPoint[]): number {
  const lengths = cumulativeLengths(points);
  return lengths[lengths.length - 1];
}

/** Three layers of simplex noise, each half as loud and twice as fine as the one before. */
function fractalNoise(noise: (x: number, y: number) => number, x: number, y: number): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < ROUGHEN_OCTAVES; octave++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * The same Map Line resampled at about a millimetre and pushed along its normal
 * by fractal noise, for the rough ink look. Every original point stays where it
 * is and in order; the ends of an open line do not move, and a closed line
 * stays closed with its seam continuous. The same seed always draws the same
 * wobble, so the line does not shimmer between renders.
 */
export function roughen(
  points: readonly MapPoint[],
  closed: boolean,
  strength: number,
  seed: number
): MapPoint[] {
  if (points.length < 2) return points.map(([x, y]): MapPoint => [x, y]);
  const amount = Number.isFinite(strength) ? Math.max(0, Math.min(5, strength)) : 0;
  const noise = createNoise2D(seededRandom(seed));
  const vertices: MapPoint[] = closed
    ? [...points.map(([x, y]): MapPoint => [x, y]), [points[0][0], points[0][1]]]
    : points.map(([x, y]): MapPoint => [x, y]);
  const total = polylineLength(vertices);
  // A closed line's noise runs around a circle of the line's own length, so the
  // wobble meets itself at the seam instead of jumping there.
  const loopRadius = total / (2 * Math.PI);

  const noiseAt = (travelled: number): number => {
    if (!closed || total === 0) {
      return fractalNoise(noise, travelled / ROUGHEN_WAVELENGTH_MM, 0);
    }
    const angle = (2 * Math.PI * travelled) / total;
    const unit = loopRadius / ROUGHEN_WAVELENGTH_MM;
    return fractalNoise(noise, unit * Math.cos(angle), unit * Math.sin(angle));
  };

  const roughened: MapPoint[] = [[vertices[0][0], vertices[0][1]]];
  let travelled = 0;
  for (let index = 0; index < vertices.length - 1; index++) {
    const start = vertices[index];
    const end = vertices[index + 1];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length > 0) {
      const normal: MapPoint = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
      for (let step = ROUGHEN_SPACING_MM; step < length; step += ROUGHEN_SPACING_MM) {
        const base = pointAt(start, end, step / length);
        const offset = noiseAt(travelled + step) * amount;
        roughened.push([base[0] + normal[0] * offset, base[1] + normal[1] * offset]);
      }
    }
    travelled += length;
    // The closing segment ends on the first point, which is already there.
    if (!closed || index < vertices.length - 2) roughened.push([end[0], end[1]]);
  }
  return roughened;
}

/** One Shape's outline: its points, and one straight-segment flag per segment. */
export interface ShapeOutline {
  points: MapPoint[];
  curves: boolean[];
}

/** A point turned `degrees` clockwise about `center`, in page millimetres. */
function rotateAbout(point: MapPoint, center: MapPoint, degrees: number): MapPoint {
  if (degrees === 0) return point;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

/** An ellipse sampled round its box, the first sample at the top. */
function ellipsePoints(shape: MapShape): MapPoint[] {
  const radiusX = shape.width / 2;
  const radiusY = shape.height / 2;
  return Array.from({ length: ELLIPSE_SAMPLES }, (_sample, index): MapPoint => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / ELLIPSE_SAMPLES;
    return [shape.cx + radiusX * Math.cos(angle), shape.cy + radiusY * Math.sin(angle)];
  });
}

/** The corners of a rectangle in drawing order, as their signs from the centre. */
const CORNER_SIGNS: ReadonlyArray<MapPoint> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * A rectangle's four corners, or one eight-sample arc per corner when it is
 * rounded: each arc turns about a centre inset by the radius, so the straight
 * edges between arcs join the inset points.
 */
function rectanglePoints(shape: MapShape): MapPoint[] {
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const radius = Math.max(0, shape.cornerRadius);
  if (radius === 0) {
    return CORNER_SIGNS.map(
      ([signX, signY]): MapPoint => [shape.cx + signX * halfWidth, shape.cy + signY * halfHeight]
    );
  }
  const points: MapPoint[] = [];
  CORNER_SIGNS.forEach(([signX, signY], corner) => {
    const arcX = shape.cx + signX * (halfWidth - radius);
    const arcY = shape.cy + signY * (halfHeight - radius);
    for (let sample = 0; sample < CORNER_SAMPLES; sample++) {
      const turned = 180 + 90 * corner + (90 * sample) / (CORNER_SAMPLES - 1);
      const angle = (turned * Math.PI) / 180;
      points.push([arcX + radius * Math.cos(angle), arcY + radius * Math.sin(angle)]);
    }
  });
  return points;
}

/** A regular polygon scaled to the shape's box, the first vertex at the top. */
function polygonPoints(shape: MapShape): MapPoint[] {
  const radiusX = shape.width / 2;
  const radiusY = shape.height / 2;
  return Array.from({ length: shape.sides }, (_side, index): MapPoint => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / shape.sides;
    return [shape.cx + radiusX * Math.cos(angle), shape.cy + radiusY * Math.sin(angle)];
  });
}

/**
 * The outline of an exact Shape (#747), straight segments only and turned about
 * its centre. A Map Line that carries a Shape keeps these points, so the Frame,
 * the preview, the Eraser, and fills all read one outline.
 */
export function shapeOutline(shape: MapShape): ShapeOutline {
  const center: MapPoint = [shape.cx, shape.cy];
  const corners =
    shape.kind === "ellipse"
      ? ellipsePoints(shape)
      : shape.kind === "rectangle"
        ? rectanglePoints(shape)
        : polygonPoints(shape);
  return {
    points: corners.map((point) => rotateAbout(point, center, shape.rotation)),
    curves: corners.map(() => false),
  };
}

/**
 * The Shape a drag from `start` to `end` draws (#747). `constrain` (Shift)
 * squares the box on its longer side, growing the way the drag went. A drag
 * smaller than `MIN_SHAPE_SIZE_MM` on either side draws no Shape at all.
 */
export function shapeFromCorners(
  kind: ShapeKind,
  start: MapPoint,
  end: MapPoint,
  constrain: boolean
): MapShape | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const width = constrain ? side : Math.abs(dx);
  const height = constrain ? side : Math.abs(dy);
  if (width < MIN_SHAPE_SIZE_MM || height < MIN_SHAPE_SIZE_MM) return null;
  return {
    kind,
    cx: constrain ? start[0] + (dx < 0 ? -width : width) / 2 : start[0] + dx / 2,
    cy: constrain ? start[1] + (dy < 0 ? -height : height) / 2 : start[1] + dy / 2,
    width,
    height,
    rotation: 0,
    sides: DEFAULT_POLYGON_SIDES,
    cornerRadius: 0,
  };
}

/** A corner or side a transform handle grips, or the handle above the box that turns it (#795). */
export type TransformHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

/**
 * A box a transform handle resizes or turns (#795): its centre and size in page
 * millimetres, and its turn in degrees clockwise about that centre.
 */
export interface TransformBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** How far a turn sticks to a right angle, in degrees. */
export const RIGHT_ANGLE_STICK_DEGREES = 2;

/** The step a Shift turn snaps to, in degrees. */
export const TURN_SNAP_DEGREES = 15;

/** The smallest side a handle leaves when a caller names no minimum, in page millimetres. */
const MIN_TRANSFORM_SIZE_MM = 0.01;

/** One handle gesture: the box it starts on, where the pointer started and sits, and its modifiers. */
export interface TransformGesture {
  box: TransformBox;
  handle: TransformHandle;
  /** Where the press landed, in page millimetres. */
  start: MapPoint;
  /** Where the pointer sits now, in page millimetres. */
  point: MapPoint;
  /** Keep the box's aspect: always for a Stamp or a Map Image, and Shift on a Shape's corner. */
  aspect?: boolean;
  /** Resize about the centre (Alt) rather than anchor the opposite corner or side. */
  fromCentre?: boolean;
  /** Snap the turn to 15° steps (Shift). */
  snap?: boolean;
  /** The narrowest and shortest the box may become, in page millimetres. */
  minWidth?: number;
  minHeight?: number;
}

/** A turn inside one circle, in degrees. */
function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The shortest way round from one angle to another, in degrees, between -180 and 180. */
function turnedBy(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** The angle from a centre to a point, in degrees. */
function angleAt(point: MapPoint, center: MapPoint): number {
  return (Math.atan2(point[1] - center[1], point[0] - center[0]) * 180) / Math.PI;
}

/**
 * The box a rotate-handle drag asks for (#795): the angle the pointer sweeps
 * about the box's centre added to the turn it already had. With `snap` (Shift)
 * the turn lands on a 15° step; without it, a turn within 2° of a right angle
 * sticks to it, so straightening an Element needs no modifier. The centre and
 * the size never change.
 */
function turnBox(gesture: TransformGesture): TransformBox {
  const { box } = gesture;
  const center: MapPoint = [box.x, box.y];
  let rotation = normalizeDegrees(
    box.rotation + turnedBy(angleAt(gesture.start, center), angleAt(gesture.point, center))
  );
  if (gesture.snap === true) {
    rotation = normalizeDegrees(Math.round(rotation / TURN_SNAP_DEGREES) * TURN_SNAP_DEGREES);
  } else {
    const right = Math.round(rotation / 90) * 90;
    if (Math.abs(turnedBy(rotation, right)) <= RIGHT_ANGLE_STICK_DEGREES) {
      rotation = normalizeDegrees(right);
    }
  }
  return { ...box, rotation };
}

/**
 * The box a corner or side drag asks for (#795). The drag works in the box's
 * own turned frame, so a turned Element's handles move along its sides. A corner
 * anchors the opposite corner, a side the opposite side, and Alt anchors the
 * centre. `aspect` keeps the box's proportions; a side handle always moves one
 * axis. A drag can never reach zero or cross over its anchor: the side it grows
 * stops at `minWidth`/`minHeight` instead of flipping.
 */
function resizeBox(gesture: TransformGesture): TransformBox {
  const { box, handle } = gesture;
  const angle = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toLocal = (point: MapPoint): MapPoint => [
    (point[0] - box.x) * cos + (point[1] - box.y) * sin,
    -(point[0] - box.x) * sin + (point[1] - box.y) * cos,
  ];
  const signX = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const signY = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const halfWidth = Math.max(MIN_TRANSFORM_SIZE_MM, box.width) / 2;
  const halfHeight = Math.max(MIN_TRANSFORM_SIZE_MM, box.height) / 2;
  const startLocal = toLocal(gesture.start);
  const pointLocal = toLocal(gesture.point);
  // Where the grabbed corner, or the middle of the grabbed side, sits now.
  const grabbed: MapPoint = [signX * halfWidth, signY * halfHeight];
  const reached: MapPoint = [
    grabbed[0] + pointLocal[0] - startLocal[0],
    grabbed[1] + pointLocal[1] - startLocal[1],
  ];
  const minWidth = Math.max(MIN_TRANSFORM_SIZE_MM, gesture.minWidth ?? MIN_TRANSFORM_SIZE_MM);
  const minHeight = Math.max(MIN_TRANSFORM_SIZE_MM, gesture.minHeight ?? MIN_TRANSFORM_SIZE_MM);
  const anchor: MapPoint = [-signX * halfWidth, -signY * halfHeight];
  // An axis no handle grips keeps the size it had.
  let width =
    signX === 0
      ? halfWidth * 2
      : Math.max(
          minWidth,
          gesture.fromCentre === true ? 2 * Math.abs(reached[0]) : signX * (reached[0] - anchor[0])
        );
  let height =
    signY === 0
      ? halfHeight * 2
      : Math.max(
          minHeight,
          gesture.fromCentre === true ? 2 * Math.abs(reached[1]) : signY * (reached[1] - anchor[1])
        );
  if (gesture.aspect === true) {
    const scale = Math.max(width / (halfWidth * 2), height / (halfHeight * 2));
    width = halfWidth * 2 * scale;
    height = halfHeight * 2 * scale;
  }
  const center: MapPoint =
    gesture.fromCentre === true
      ? [0, 0]
      : [anchor[0] + (signX * width) / 2, anchor[1] + (signY * height) / 2];
  return {
    x: box.x + center[0] * cos - center[1] * sin,
    y: box.y + center[0] * sin + center[1] * cos,
    width,
    height,
    rotation: box.rotation,
  };
}

/**
 * The box one handle gesture draws (#795): a corner or side resized in the box's
 * own frame, or the whole box turned about its centre. Pure, so the Map editor,
 * the Frame's live preview, and the tests share one set of rules.
 */
export function transformBox(gesture: TransformGesture): TransformBox {
  if (gesture.handle === "rotate") return turnBox(gesture);
  return resizeBox(gesture);
}

/**
 * A Map Line that stops being an exact Shape (#747): the Eraser cut it or
 * Roughen redrew it, so it keeps the points it had and remembers what it was.
 * A line that never was a Shape comes back exactly as it is.
 */
export function convertShapeLine(line: MapLineElement): MapLineElement {
  const { shape, ...rest } = line;
  return shape === undefined ? line : { ...rest, convertedFrom: shape.kind };
}

/** A number with two decimals, so the same points always produce the same path. */
export function roundedMm(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** What `linePath` needs from a Map Line: its points, one flag per segment, and whether it closes. */
export interface LinePathInput {
  points: readonly MapPoint[];
  curves: readonly boolean[];
  closed: boolean;
}

/**
 * The SVG path `d` through a Map Line: a straight `L` for a segment its flag
 * marks straight, and a Catmull-Rom spline written as cubic Beziers for a
 * curved one, using the neighbours across the seam of a closed line. A closed
 * line ends with `Z`. Two points make a straight line whatever their flag says,
 * which keeps every Pencil line from #745 drawing exactly as it did.
 */
export function linePath(line: LinePathInput): string {
  const { points, curves, closed } = line;
  if (points.length < 2) return "";

  const count = points.length;
  const segments = count - 1 + (closed ? 1 : 0);
  let path = `M ${roundedMm(points[0][0])} ${roundedMm(points[0][1])}`;
  for (let index = 0; index < segments; index++) {
    const start = points[index];
    const end = points[(index + 1) % count];
    if (curves[index] !== true || count === 2) {
      // A straight closing segment is what `Z` draws, so it is not written twice.
      if (!(closed && index === segments - 1)) {
        path += ` L ${roundedMm(end[0])} ${roundedMm(end[1])}`;
      }
      continue;
    }
    const previous = closed ? points[(index - 1 + count) % count] : (points[index - 1] ?? start);
    const next = closed ? points[(index + 2) % count] : (points[index + 2] ?? end);
    const controlOne: MapPoint = [
      start[0] + (end[0] - previous[0]) / 6,
      start[1] + (end[1] - previous[1]) / 6,
    ];
    const controlTwo: MapPoint = [
      end[0] - (next[0] - start[0]) / 6,
      end[1] - (next[1] - start[1]) / 6,
    ];
    path += ` C ${roundedMm(controlOne[0])} ${roundedMm(controlOne[1])} ${roundedMm(
      controlTwo[0]
    )} ${roundedMm(controlTwo[1])} ${roundedMm(end[0])} ${roundedMm(end[1])}`;
  }
  return closed ? `${path} Z` : path;
}
