/**
 * The Maps scene (#745): pure functions that turn Map Lines into SVG and edit
 * the Elements list without mutating it. The Frame draws what `sceneToSvg`
 * returns, and the list preview is the same SVG at page size, so what the
 * author draws and what the list shows cannot drift apart.
 *
 * Points are page millimetres, the same space as `page.widthMm/heightMm`.
 * This module imports only `./maps`, its own files, and rough.js for the
 * roughened ink look.
 */

import { RoughGenerator } from "roughjs/bin/generator.js";
import { cumulativeLengths, seedFor } from "./geometry";
import type { MapDocument, MapElement, MapLineElement, MapPoint } from "./maps";

/** The Atlas Map Style's water, which an empty Map shows. */
export const EMPTY_MAP_COLOR = "#d7e6ec";

/** Ramer-Douglas-Peucker distance below which a Pencil point is noise. */
export const SMOOTH_TOLERANCE_MM = 0.5;

/** Consecutive Pencil points closer than this are the same point. */
const DUPLICATE_DISTANCE_MM = 0.05;

/** The ink a Map Line is drawn in until Map Styles choose another. */
export const LINE_STROKE = "#1f2933";

/** A Map Line's width in page millimetres. */
const LINE_STROKE_WIDTH_MM = 0.6;

/** The background a Map is drawn on; the Atlas Map Style's water. */
function background(widthMm: number, heightMm: number): string {
  return `<rect width="${number(widthMm)}" height="${number(heightMm)}" fill="${EMPTY_MAP_COLOR}"/>`;
}

/** A point-to-point distance, for dropping near-duplicate Pencil points. */
function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** The squared distance from `point` to the nearest spot on segment `a`-`b`. */
function squaredSegmentDistance(point: MapPoint, a: MapPoint, b: MapPoint): number {
  let x = a[0];
  let y = a[1];
  const dx = b[0] - x;
  const dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  const px = point[0] - x;
  const py = point[1] - y;
  return px * px + py * py;
}

/** Drops each point that sits on the same spot as the point before it. */
function dropNearDuplicates(points: readonly MapPoint[]): MapPoint[] {
  const kept: MapPoint[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (last === undefined || distance(point, last) >= DUPLICATE_DISTANCE_MM) {
      kept.push([point[0], point[1]]);
    }
  }
  return kept;
}

/** Ramer-Douglas-Peucker, without recursion, so a long stroke cannot overflow the stack. */
function simplify(points: readonly MapPoint[], tolerance: number): MapPoint[] {
  if (points.length <= 2) return points.map((point) => [point[0], point[1]]);

  const toleranceSquared = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const segments: [number, number][] = [[0, points.length - 1]];
  while (segments.length > 0) {
    const [start, end] = segments.pop() as [number, number];
    let farthest = 0;
    let farthestIndex = -1;
    for (let index = start + 1; index < end; index++) {
      const squared = squaredSegmentDistance(points[index], points[start], points[end]);
      if (squared > farthest) {
        farthest = squared;
        farthestIndex = index;
      }
    }
    if (farthest > toleranceSquared && farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      segments.push([start, farthestIndex], [farthestIndex, end]);
    }
  }

  return points.filter((_point, index) => keep[index] === 1).map((point) => [point[0], point[1]]);
}

/**
 * Turns a raw Pencil stroke into the points a Map Line keeps: near-duplicate
 * points fall away, then Ramer-Douglas-Peucker removes what the hand meant as
 * a straight stretch. A click without movement returns no points at all.
 */
export function smoothStroke(raw: readonly MapPoint[]): MapPoint[] {
  const deduped = dropNearDuplicates(raw);
  if (deduped.length < 2) return [];
  return simplify(deduped, SMOOTH_TOLERANCE_MM);
}

/** A number with two decimals, so the same points always produce the same path. */
function number(value: number): string {
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
  let path = `M ${number(points[0][0])} ${number(points[0][1])}`;
  for (let index = 0; index < segments; index++) {
    const start = points[index];
    const end = points[(index + 1) % count];
    if (curves[index] !== true || count === 2) {
      // A straight closing segment is what `Z` draws, so it is not written twice.
      if (!(closed && index === segments - 1)) {
        path += ` L ${number(end[0])} ${number(end[1])}`;
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
    path += ` C ${number(controlOne[0])} ${number(controlOne[1])} ${number(
      controlTwo[0]
    )} ${number(controlTwo[1])} ${number(end[0])} ${number(end[1])}`;
  }
  return closed ? `${path} Z` : path;
}

/** One path the Frame draws for a Map Line, and everything it draws it with. */
export interface LineShape {
  /** The SVG path `d`. */
  d: string;
  /** The stroke colour, or null for a shape that is filled instead. */
  stroke: string | null;
  /** The stroke width in page millimetres; 0 when the shape has no stroke. */
  strokeWidth: number;
  /** The `stroke-dasharray` pattern, or null for a solid line. */
  dash: string | null;
  /** The fill colour, or null for an unfilled line. */
  fill: string | null;
  /** How opaque the whole shape is, 0 to 1. */
  opacity: number;
}

/** A river's water-blue ink. */
const RIVER_INK = "#3b6e8f";

/** A river's width at its start and its end, in page millimetres. */
const RIVER_START_WIDTH_MM = 0.2;
const RIVER_END_WIDTH_MM = 1.4;

/** A closed river has no start or end to taper between, so it keeps one width. */
const RIVER_CLOSED_WIDTH_MM = 0.8;

/** The coast, road, and border widths, and the road and border dash patterns. */
const COAST_STROKE_WIDTH_MM = 0.9;
const ROAD_STROKE_WIDTH_MM = 0.5;
const ROAD_DASH = "2 1.2";
const BORDER_STROKE_WIDTH_MM = 0.6;
const BORDER_DASH = "3 1 0.5 1";

/** A coast ripple's offset copies, their width, and how far each one fades. */
const RIPPLE_OFFSETS_MM = [1.2, 2.4, 3.6] as const;
const RIPPLE_OPACITIES = [0.6, 0.4, 0.2] as const;
const RIPPLE_STROKE_WIDTH_MM = 0.4;

/** The rough.js look a roughened line is drawn with. */
const ROUGH_ROUGHNESS = 1.2;
const ROUGH_BOWING = 1;

/** The rough.js generator, which needs no DOM and shares no state between calls. */
const roughGenerator = new RoughGenerator();

/** One stroke-only shape in the Map Style's ink. */
function strokeShape(
  d: string,
  strokeWidth: number,
  options: { stroke?: string; dash?: string; opacity?: number } = {}
): LineShape {
  return {
    d,
    stroke: options.stroke ?? LINE_STROKE,
    strokeWidth,
    dash: options.dash ?? null,
    fill: null,
    opacity: options.opacity ?? 1,
  };
}

/** The left-hand normal of the segment `a`-`b`, or null when the two points coincide. */
function leftNormal(a: MapPoint, b: MapPoint): MapPoint | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return [-dy / length, dx / length];
}

/**
 * The left-hand normal at every point of a line: the average of the normals of
 * the segments meeting there, so an offset copy stays evenly spaced along a
 * bend. An open line's ends have one segment each to face away from.
 */
function vertexNormals(points: readonly MapPoint[], closed: boolean): MapPoint[] {
  const count = points.length;
  return points.map((_point, index) => {
    const outgoing =
      index < count - 1 || closed ? leftNormal(points[index], points[(index + 1) % count]) : null;
    const incoming =
      index > 0 || closed ? leftNormal(points[(index - 1 + count) % count], points[index]) : null;
    const x = (outgoing?.[0] ?? 0) + (incoming?.[0] ?? 0);
    const y = (outgoing?.[1] ?? 0) + (incoming?.[1] ?? 0);
    const length = Math.hypot(x, y);
    if (length === 0) return outgoing ?? incoming ?? [0, 0];
    return [x / length, y / length];
  });
}

/** A copy of a line shifted `offsetMm` to its left, for a coast ripple. */
function offsetPoints(points: readonly MapPoint[], closed: boolean, offsetMm: number): MapPoint[] {
  const normals = vertexNormals(points, closed);
  return points.map((point, index): MapPoint => {
    const normal = normals[index];
    return [point[0] + normal[0] * offsetMm, point[1] + normal[1] * offsetMm];
  });
}

/**
 * An open river as one filled polygon: the left side going out and the right
 * side coming back, each point half a width off the centreline. The width runs
 * from 0.2mm at the start to 1.4mm at the end, so the river narrows upstream.
 */
function taperedRiverPath(points: readonly MapPoint[]): string {
  const normals = vertexNormals(points, false);
  const lengths = cumulativeLengths(points);
  const total = lengths[lengths.length - 1];

  const left: MapPoint[] = [];
  const right: MapPoint[] = [];
  for (let index = 0; index < points.length; index++) {
    const along = total === 0 ? 0 : lengths[index] / total;
    const half = (RIVER_START_WIDTH_MM + (RIVER_END_WIDTH_MM - RIVER_START_WIDTH_MM) * along) / 2;
    const normal = normals[index];
    const point = points[index];
    left.push([point[0] + normal[0] * half, point[1] + normal[1] * half]);
    right.push([point[0] - normal[0] * half, point[1] - normal[1] * half]);
  }

  const outline = [...left, ...right.reverse()];
  const first = outline[0];
  let path = `M ${number(first[0])} ${number(first[1])}`;
  for (const point of outline.slice(1)) {
    path += ` L ${number(point[0])} ${number(point[1])}`;
  }
  return `${path} Z`;
}

/** A line's shapes before Roughen touches them, by its line style. */
function styleShapes(element: MapLineElement, d: string): LineShape[] {
  switch (element.style) {
    case "coast":
      return [strokeShape(d, COAST_STROKE_WIDTH_MM)];
    case "river":
      return element.closed
        ? [strokeShape(d, RIVER_CLOSED_WIDTH_MM, { stroke: RIVER_INK })]
        : [
            {
              d: taperedRiverPath(element.points),
              stroke: null,
              strokeWidth: 0,
              dash: null,
              fill: RIVER_INK,
              opacity: 1,
            },
          ];
    case "road":
      return [strokeShape(d, ROAD_STROKE_WIDTH_MM, { dash: ROAD_DASH })];
    case "border":
      return [strokeShape(d, BORDER_STROKE_WIDTH_MM, { dash: BORDER_DASH })];
    case "coastRipple": {
      const shapes = [strokeShape(d, COAST_STROKE_WIDTH_MM)];
      RIPPLE_OFFSETS_MM.forEach((offset, index) => {
        const offsetPath = linePath({
          points: offsetPoints(element.points, element.closed, offset),
          curves: element.curves,
          closed: element.closed,
        });
        shapes.push(
          strokeShape(offsetPath, RIPPLE_STROKE_WIDTH_MM, { opacity: RIPPLE_OPACITIES[index] })
        );
      });
      return shapes;
    }
    case "plain":
      return [strokeShape(d, LINE_STROKE_WIDTH_MM)];
  }
}

/** The first point a path `d` starts at, which a closed outline must come back to. */
const PATH_START = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)/;

/**
 * The `d`s rough.js draws a stroke as, from the same seed for the same Element,
 * so a roughened line keeps its wobble between renders. Only strokes roughen: a
 * river's filled polygon is left alone. Rough.js offsets both ends of every
 * stroke, so a closed outline comes back just short of where it started; the
 * last drawn point returns to the first one, so the ink loop meets itself.
 */
function roughenShape(shape: LineShape, id: string, closed: boolean): LineShape[] {
  if (shape.stroke === null || shape.d === "") return [shape];
  const drawable = roughGenerator.path(shape.d, {
    seed: seedFor(id) || 1,
    roughness: ROUGH_ROUGHNESS,
    bowing: ROUGH_BOWING,
    disableMultiStroke: true,
  });
  const paths = roughGenerator.toPaths(drawable).map((path) => ({ ...shape, d: path.d }));
  if (paths.length === 0) return paths;
  const start = PATH_START.exec(paths[0].d);
  if (!closed || start === null) return paths;
  const last = paths[paths.length - 1];
  return [...paths.slice(0, -1), { ...last, d: `${last.d} L ${start[1]} ${start[2]}` }];
}

/**
 * The render primitives one Map Line is drawn from (#746): the same list the
 * Frame draws and `sceneToSvg` writes, so the preview and the Frame cannot
 * drift. A roughened line's strokes come from rough.js instead of `linePath`.
 */
export function lineShapes(element: MapLineElement): LineShape[] {
  const d = linePath(element);
  if (d === "") return [];
  const shapes = styleShapes(element, d);
  return element.roughened
    ? shapes.flatMap((shape) => roughenShape(shape, element.id, element.closed))
    : shapes;
}

/** Escapes text for an XML attribute. */
function escapeAttribute(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] as string
  );
}

/** One drawn primitive as an SVG path, with only the attributes it needs. */
function shapePath(shape: LineShape): string {
  const attributes = [`d="${escapeAttribute(shape.d)}"`];
  if (shape.stroke === null) {
    attributes.push('stroke="none"');
  } else {
    attributes.push(`stroke="${escapeAttribute(shape.stroke)}"`);
    attributes.push(`stroke-width="${number(shape.strokeWidth)}"`);
  }
  attributes.push(shape.fill === null ? 'fill="none"' : `fill="${escapeAttribute(shape.fill)}"`);
  if (shape.dash !== null) attributes.push(`stroke-dasharray="${escapeAttribute(shape.dash)}"`);
  if (shape.opacity !== 1) attributes.push(`opacity="${number(shape.opacity)}"`);
  attributes.push('stroke-linecap="round"', 'stroke-linejoin="round"');
  return `<path ${attributes.join(" ")}/>`;
}

/** One Map Line as a group of paths, marked when it is the selection. */
function lineElement(element: Extract<MapElement, { kind: "line" }>, selected: boolean): string {
  const attributes = [`data-element-id="${escapeAttribute(element.id)}"`];
  if (selected) attributes.push('data-selected="true"');
  const paths = lineShapes(element).map(shapePath).join("");
  return `<g ${attributes.join(" ")}>${paths}</g>`;
}

export interface SceneOptions {
  /** The Element the editor has selected, marked for the Frame to style. */
  selectedId?: string;
  /** The SVG's pixel width; its height follows the page's proportions. */
  widthPx?: number;
}

/** A whole Map as SVG: the page in its background, then every visible Element. */
export function sceneToSvg(
  map: Pick<MapDocument, "page" | "elements">,
  options: SceneOptions = {}
): string {
  const { widthMm, heightMm } = map.page;
  const pixelSize =
    options.widthPx !== undefined && Number.isFinite(options.widthPx) && options.widthPx > 0
      ? ` width="${number(options.widthPx)}" height="${number(
          (heightMm * options.widthPx) / widthMm
        )}"`
      : "";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${number(widthMm)} ${number(
      heightMm
    )}"${pixelSize}>`,
    background(widthMm, heightMm),
  ];

  for (const element of map.elements) {
    if (element.hidden) continue;
    if (element.kind === "line") {
      parts.push(lineElement(element, options.selectedId === element.id));
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

/** Appends an Element, so it takes the top of the z-order. */
export function addElement(elements: readonly MapElement[], element: MapElement): MapElement[] {
  return [...elements, element];
}

/** Removes one Element; an id that is not there changes nothing else. */
export function removeElement(elements: readonly MapElement[], id: string): MapElement[] {
  return elements.filter((element) => element.id !== id);
}

/** Renames one Element. */
export function renameElement(
  elements: readonly MapElement[],
  id: string,
  name: string
): MapElement[] {
  return elements.map((element) => (element.id === id ? { ...element, name } : element));
}

/** Hides or shows one Element. */
export function setHidden(
  elements: readonly MapElement[],
  id: string,
  hidden: boolean
): MapElement[] {
  return elements.map((element) => (element.id === id ? { ...element, hidden } : element));
}

/** Locks or unlocks one Element; a locked Element does not move. */
export function setLocked(
  elements: readonly MapElement[],
  id: string,
  locked: boolean
): MapElement[] {
  return elements.map((element) => (element.id === id ? { ...element, locked } : element));
}

/** Moves one Element by a page-millimetre offset; a locked Element stays put. */
export function moveElement(
  elements: readonly MapElement[],
  id: string,
  dx: number,
  dy: number
): MapElement[] {
  return elements.map((element) => {
    if (element.id !== id || element.locked || element.kind !== "line") return element;
    const moved: MapLineElement = {
      ...element,
      points: element.points.map(([x, y]): MapPoint => [x + dx, y + dy]),
    };
    // A Shape's outline follows its own numbers, so its centre moves with it.
    if (element.shape !== undefined) {
      moved.shape = { ...element.shape, cx: element.shape.cx + dx, cy: element.shape.cy + dy };
    }
    return moved;
  });
}

/**
 * Moves one Element one place along the array: "forward" toward its end, which
 * the Elements list draws at the top, and "backward" toward its start, the
 * bottom. Naming the array direction leaves the editor no compensation.
 */
export function reorder(
  elements: readonly MapElement[],
  id: string,
  direction: "forward" | "backward"
): MapElement[] {
  const index = elements.findIndex((element) => element.id === id);
  const target = direction === "forward" ? index + 1 : index - 1;
  if (index === -1 || target < 0 || target >= elements.length) return [...elements];
  const reordered = [...elements];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered;
}
