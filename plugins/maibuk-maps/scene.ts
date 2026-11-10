/**
 * The Maps scene (#745): pure functions that turn Map Lines into SVG and edit
 * the Elements list without mutating it. The Frame draws what `sceneToSvg`
 * returns, and the list preview is the same SVG at page size, so what the
 * author draws and what the list shows cannot drift apart.
 *
 * Points are page millimetres, the same space as `page.widthMm/heightMm`.
 * This module imports only `./maps` and its own files.
 */

import type { MapDocument, MapElement, MapPoint } from "./maps";

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

/**
 * The SVG path `d` through `points`: a straight `L` for two points, and a
 * Catmull-Rom spline written as cubic Beziers beyond that.
 */
export function linePath(points: readonly MapPoint[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${number(points[0][0])} ${number(points[0][1])} L ${number(points[1][0])} ${number(
      points[1][1]
    )}`;
  }

  let path = `M ${number(points[0][0])} ${number(points[0][1])}`;
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[index - 1] ?? points[index];
    const start = points[index];
    const end = points[index + 1];
    const next = points[index + 2] ?? end;
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
  return path;
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

/** One Map Line as a path, marked when it is the selection. */
function lineElement(element: Extract<MapElement, { kind: "line" }>, selected: boolean): string {
  const attributes = [
    `d="${escapeAttribute(linePath(element.points))}"`,
    `stroke="${LINE_STROKE}"`,
    `stroke-width="${LINE_STROKE_WIDTH_MM}"`,
    'fill="none"',
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
    `data-element-id="${escapeAttribute(element.id)}"`,
  ];
  if (selected) attributes.push('data-selected="true"');
  return `<path ${attributes.join(" ")}/>`;
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
    return {
      ...element,
      points: element.points.map(([x, y]): MapPoint => [x + dx, y + dy]),
    };
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
