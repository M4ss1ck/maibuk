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
import { faceAt, findFaces, type Face } from "./faces";
import {
  cumulativeLengths,
  linePath,
  type MapBounds,
  pointsBounds,
  roundedMm,
  seedFor,
} from "./geometry";
import {
  DEFAULT_STAMP_SCALE,
  isAreaFill,
  labelBaselinePath,
  labelFontFamily,
  type MapDocument,
  type MapElement,
  type MapFillElement,
  type MapFillOutline,
  type MapFillScatter,
  type MapLabelElement,
  type MapLineElement,
  type MapPoint,
  type MapStampElement,
  type MapStampTransform,
} from "./maps";
import { scatterPoints } from "./scatter";
import { SCALE_BAR_STAMP_REF, type StampArt, scaleBarLayout, stampArt } from "./stamps";
import { lineRole, resolveColor, styleOf, type MapStyleId } from "./styles";
import { TEXTURE_IDS, texturePattern, texturePatternId, type TextureId } from "./textures";

/** Ramer-Douglas-Peucker distance below which a Pencil point is noise. */
export const SMOOTH_TOLERANCE_MM = 0.5;

/** Consecutive Pencil points closer than this are the same point. */
const DUPLICATE_DISTANCE_MM = 0.05;

/** A Map Line's width in page millimetres. */
const LINE_STROKE_WIDTH_MM = 0.6;

/** The background a Map is drawn on; a Map Style's water. */
function background(widthMm: number, heightMm: number, style: MapStyleId): string {
  return `<rect width="${roundedMm(widthMm)}" height="${roundedMm(heightMm)}" fill="${resolveColor(
    style,
    undefined,
    "water"
  )}"/>`;
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
  /** How the fill treats a path that doubles back, such as a face with holes. */
  fillRule?: "evenodd";
  /** How opaque the whole shape is, 0 to 1. */
  opacity: number;
  /** An SVG transform, when the shape is placed or turned rather than drawn in page coordinates. */
  transform?: string;
  /** The Clip Path id that keeps the shape inside its Element's area, when it has one. */
  clip?: string;
  /**
   * Whether the shape only marks where its Element can be picked, painting no
   * ink: a Map Label's baseline, whose text sits on top of it.
   */
  hitOnly?: true;
}

/**
 * The font family drawn text takes: a system sans stack, so the Frame (whose
 * body font is the host's sans) and an exported SVG, which has no host theme,
 * draw the same face. The Frame's script and an export both read this one.
 */
export const TEXT_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** One piece of text the Frame draws, in page millimetres. */
export interface TextShape {
  text: string;
  /** Where the text starts; unused when `path` places it along a baseline. */
  x: number;
  y: number;
  /** The text's height in page millimetres. */
  size: number;
  fill: string;
  /** The font family the text is drawn in, so a Frame and an export agree. */
  font: string;
  anchor: "start" | "middle" | "end";
  /** An SVG transform, when the text turns with its Element. */
  transform?: string;
  /** The baseline the text runs along, as a Map Label's does; absent draws it at `x`, `y`. */
  path?: TextPathShape;
  /** The room each letter takes beyond its own width, in page millimetres. */
  letterSpacing?: number;
  /** The halo drawn behind the text, so it reads over drawn land and water. */
  halo?: TextHalo;
}

/** The path a piece of text follows, and the definitions id it is drawn under. */
export interface TextPathShape {
  id: string;
  d: string;
}

/** The stroke drawn behind a piece of text: its colour and its width in page millimetres. */
export interface TextHalo {
  color: string;
  width: number;
}

/** One primitive an Element draws: a path to stroke or fill, or a piece of text. */
export type SceneShape = LineShape | TextShape;

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

/** One stroke-only shape in the given ink. */
function strokeShape(
  d: string,
  strokeWidth: number,
  stroke: string,
  options: { dash?: string; opacity?: number } = {}
): LineShape {
  return {
    d,
    stroke,
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
  let path = `M ${roundedMm(first[0])} ${roundedMm(first[1])}`;
  for (const point of outline.slice(1)) {
    path += ` L ${roundedMm(point[0])} ${roundedMm(point[1])}`;
  }
  return `${path} Z`;
}

/** A line's shapes before Roughen touches them, by its line style and the Map Style's ink. */
function styleShapes(element: MapLineElement, d: string, style: MapStyleId): LineShape[] {
  // A river follows the river role unless the line overrides it; every other
  // line style draws in the ink role.
  const ink = resolveColor(style, element.color, lineRole(element.style));
  switch (element.style) {
    case "coast":
      return [strokeShape(d, COAST_STROKE_WIDTH_MM, ink)];
    case "river":
      return element.closed
        ? [strokeShape(d, RIVER_CLOSED_WIDTH_MM, ink)]
        : [
            {
              d: taperedRiverPath(element.points),
              stroke: null,
              strokeWidth: 0,
              dash: null,
              fill: ink,
              opacity: 1,
            },
          ];
    case "road":
      return [strokeShape(d, ROAD_STROKE_WIDTH_MM, ink, { dash: ROAD_DASH })];
    case "border":
      return [strokeShape(d, BORDER_STROKE_WIDTH_MM, ink, { dash: BORDER_DASH })];
    case "coastRipple": {
      const shapes = [strokeShape(d, COAST_STROKE_WIDTH_MM, ink)];
      RIPPLE_OFFSETS_MM.forEach((offset, index) => {
        const offsetPath = linePath({
          points: offsetPoints(element.points, element.closed, offset),
          curves: element.curves,
          closed: element.closed,
        });
        shapes.push(
          strokeShape(offsetPath, RIPPLE_STROKE_WIDTH_MM, ink, {
            opacity: RIPPLE_OPACITIES[index],
          })
        );
      });
      return shapes;
    }
    case "plain":
      return [strokeShape(d, LINE_STROKE_WIDTH_MM, ink)];
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
export function lineShapes(element: MapLineElement, style: MapStyleId): LineShape[] {
  const d = linePath(element);
  if (d === "") return [];
  const shapes = styleShapes(element, d, style);
  return element.roughened
    ? shapes.flatMap((shape) => roughenShape(shape, element.id, element.closed))
    : shapes;
}

/** The faces the Map Lines of one scene enclose, computed once for all its Fills. */
function sceneFaces(elements: readonly MapElement[]): Face[] {
  return findFaces(
    elements.filter((element): element is MapLineElement => element.kind === "line")
  );
}

/** Whether a point is the same corner it closed a ring back to. */
function samePoint(a: MapPoint, b: MapPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** One closed ring as a path, without writing its repeated first point twice. */
function ringPath(ring: readonly MapPoint[]): string {
  const points =
    ring.length > 1 && samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  if (points.length === 0) return "";
  let path = `M ${roundedMm(points[0][0])} ${roundedMm(points[0][1])}`;
  for (const point of points.slice(1)) path += ` L ${roundedMm(point[0])} ${roundedMm(point[1])}`;
  return `${path} Z`;
}

/** A face's outline as one path: the ring around it, then each hole cut out. */
function fillPath(face: Face): string {
  return [face.outer, ...face.holes].map(ringPath).join(" ");
}

/** What one pass over a scene collects: the definitions an SVG needs, and the textures it paints. */
interface SceneCollector {
  /** The Clip Path and filter definitions, in Element order. */
  defs: string[];
  /** The textures the scene paints with, so each one is defined once. */
  textures: Set<TextureId>;
}

/** The area one Fill covers: the exact path it paints, and the rings that bound it. */
interface FillArea {
  /** The SVG path `d` of the area, ready to fill and to clip against. */
  d: string;
  /** The rings the area covers, which scatter samples its points inside. */
  rings: MapPoint[][];
}

/** The paint rough.js is asked for only so that it draws a filled outline; the Fill applies its own. */
const ROUGH_FILL_PLACEHOLDER = "#000000";

/**
 * An Area Fill's outline as rough.js draws it: the hand-inked wobble a Roughened
 * Map Line gets, from the same seed, as one closed outline the Fill paints
 * inside. Rough.js answers a filled path with a single shape that has no stroke,
 * so the Fill stays unstroked, and the placeholder paint is never written.
 */
function roughenedFillPath(d: string, id: string): string {
  const drawable = roughGenerator.path(d, {
    seed: seedFor(id) || 1,
    roughness: ROUGH_ROUGHNESS,
    bowing: ROUGH_BOWING,
    fill: ROUGH_FILL_PLACEHOLDER,
    fillStyle: "solid",
    stroke: "none",
  });
  const [path] = roughGenerator.toPaths(drawable);
  return path === undefined ? d : path.d;
}

/** The area an Area Fill's own outline covers, curved or roughened as the outline asks. */
function outlineArea(outline: MapFillOutline, id: string): FillArea | null {
  const d = linePath({ points: outline.points, curves: outline.curves, closed: true });
  if (d === "") return null;
  return {
    d: outline.roughened ? roughenedFillPath(d, id) : d,
    // Scatter samples the outline's own points: its clipped edge cuts whatever a
    // curve or the ink wobble draws past them, so no Stamp lands outside.
    rings: [[...outline.points]],
  };
}

/**
 * The area one Fill covers (#750): its own outline when it is an Area Fill, or
 * the face its anchor lies in when it is a Bucket Fill. A Bucket Fill whose
 * anchor is in no face draws nothing.
 */
function fillArea(element: MapFillElement, faces: readonly Face[]): FillArea | null {
  if (element.outline !== undefined) return outlineArea(element.outline, element.id);
  const face = faceAt(faces, element.anchor);
  if (face === null) return null;
  return { d: fillPath(face), rings: [face.outer, ...face.holes] };
}

/** One paint of a Fill's area: unstroked, in `fill`, with the area's holes cut out. */
function areaPaint(area: FillArea, fill: string): LineShape {
  return {
    d: area.d,
    stroke: null,
    strokeWidth: 0,
    dash: null,
    fill,
    fillRule: "evenodd",
    opacity: 1,
  };
}

/** The id the Clip Path that keeps a Fill's scattered Stamps inside its area takes. */
function scatterClipId(elementId: string): string {
  return `fill-clip-${seedFor(elementId).toString(16)}`;
}

/**
 * The Stamps a Fill scatters over its area (#750), drawn exactly as Stamp
 * Elements are and clipped to the area, so the ones near its edge are cut off
 * cleanly. Each Stamp is drawn one scatter spacing wide, so the Stamps sit
 * apart instead of piling up.
 */
function scatteredShapes(
  element: MapFillElement,
  area: FillArea,
  scatter: MapFillScatter,
  pageWidthMm: number,
  pageHeightMm: number,
  style: MapStyleId,
  collector: SceneCollector
): LineShape[] {
  const clip = scatterClipId(element.id);
  const shapes: LineShape[] = [];
  const art = stampArt(scatter.stamp);
  const ink = resolveColor(style, undefined, "ink");
  if (art !== undefined) {
    for (const point of scatterPoints(
      area.rings,
      scatter.spacing,
      scatter.seed,
      pageWidthMm,
      pageHeightMm
    )) {
      const transform = artTransform(
        { x: point[0], y: point[1], size: scatter.spacing, rotation: 0 },
        art
      );
      for (const shape of artShapes(art, transform, ink)) {
        shapes.push({ ...shape, clip });
      }
    }
  }
  if (shapes.length === 0) return shapes;
  collector.defs.push(
    `<clipPath id="${clip}"><path d="${escapeAttribute(area.d)}" clip-rule="evenodd"/></clipPath>`
  );
  return shapes;
}

/**
 * The shapes one Fill's content draws (#750): its colour, the texture painted
 * over it, and the Stamps it scatters, in that order, each one clipped to the
 * area. A Fill of an old `{color}` document draws the one filled path it always
 * did.
 */
function fillShapes(
  element: MapFillElement,
  area: FillArea,
  pageWidthMm: number,
  pageHeightMm: number,
  style: MapStyleId,
  collector: SceneCollector
): LineShape[] {
  const { color, texture, scatter } = element.content;
  const shapes: LineShape[] = [];
  if (color !== undefined) shapes.push(areaPaint(area, resolveColor(style, color, "land")));
  if (texture !== undefined) {
    collector.textures.add(texture);
    shapes.push(areaPaint(area, `url(#${texturePatternId(texture, style)})`));
  }
  if (scatter !== undefined) {
    shapes.push(
      ...scatteredShapes(element, area, scatter, pageWidthMm, pageHeightMm, style, collector)
    );
  }
  return shapes;
}

/** The scale bar's bar height, as a fraction of its length. */
const SCALE_BAR_HEIGHT_RATIO = 0.12;

/** The scale bar's label height, as a fraction of the bar's height. */
const SCALE_BAR_LABEL_RATIO = 0.9;

/** The scale bar's segment outline width, in page millimetres. */
const SCALE_BAR_STROKE_WIDTH_MM = 0.2;

/** A number for an SVG transform, with three decimals at most. */
function roundedTransform(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** A rectangle as a closed path, in the space its transform places. */
function rectanglePath(x: number, y: number, width: number, height: number): string {
  return `M ${roundedMm(x)} ${roundedMm(y)} L ${roundedMm(x + width)} ${roundedMm(y)} L ${roundedMm(
    x + width
  )} ${roundedMm(y + height)} L ${roundedMm(x)} ${roundedMm(y + height)} Z`;
}

/**
 * The SVG transform that puts an art box on the page: moved to the Stamp's
 * point, turned, scaled so the box is `size` wide, and centred on the box's
 * middle, so the art's own coordinates never move.
 */
function artTransform(transform: MapStampTransform, art: StampArt): string {
  const [minX, minY, width, height] = art.viewBox;
  const { x, y, size, rotation } = transform;
  return [
    `translate(${roundedMm(x)} ${roundedMm(y)})`,
    ...(rotation === 0 ? [] : [`rotate(${roundedMm(rotation)})`]),
    `scale(${roundedTransform(size / width)})`,
    `translate(${roundedMm(-minX - width / 2)} ${roundedMm(-minY - height / 2)})`,
  ].join(" ");
}

/** The shapes built-in art draws: one per part, a part with no colour of its own taking `color`. */
function artShapes(art: StampArt, transform: string, color: string): LineShape[] {
  return art.parts.map((part) => ({
    d: part.d,
    stroke: part.stroke === undefined ? null : (part.stroke ?? color),
    strokeWidth: part.strokeWidth ?? 0,
    dash: null,
    fill: part.fill ?? color,
    opacity: 1,
    transform,
  }));
}

/** How many segments a scale bar splits into: five when the distance starts with a five, else four. */
function scaleBarSegments(distance: number): number {
  const leading = Math.round(distance / 10 ** Math.floor(Math.log10(distance)));
  return leading === 5 ? 5 : 4;
}

/**
 * The scale bar (#749): `size` millimetres of room turned into the longest round
 * distance the page's scale can label, drawn as alternating filled and empty
 * segments in the Stamp's colour, with its distance written at the right end.
 * The bar straddles the Stamp's point and turns with it.
 */
function scaleBarShapes(element: MapStampElement, pageWidthMm: number, ink: string): SceneShape[] {
  const scale = element.scale ?? DEFAULT_STAMP_SCALE;
  const { distance, lengthMm } = scaleBarLayout(pageWidthMm, scale.span, element.transform.size);
  if (!(lengthMm > 0)) return [];

  const height = lengthMm * SCALE_BAR_HEIGHT_RATIO;
  const segments = scaleBarSegments(distance);
  const segmentWidth = lengthMm / segments;
  const left = -lengthMm / 2;
  const top = -height / 2;
  const { x, y, rotation } = element.transform;
  const transform = [
    `translate(${roundedMm(x)} ${roundedMm(y)})`,
    ...(rotation === 0 ? [] : [`rotate(${roundedMm(rotation)})`]),
  ].join(" ");

  const shapes: SceneShape[] = [];
  for (let index = 0; index < segments; index++) {
    const d = rectanglePath(left + index * segmentWidth, top, segmentWidth, height);
    shapes.push(
      index % 2 === 0
        ? {
            d,
            stroke: null,
            strokeWidth: 0,
            dash: null,
            fill: ink,
            opacity: 1,
            transform,
          }
        : {
            d,
            stroke: ink,
            strokeWidth: SCALE_BAR_STROKE_WIDTH_MM,
            dash: null,
            fill: null,
            opacity: 1,
            transform,
          }
    );
  }

  const label = {
    y: top + height + height * SCALE_BAR_LABEL_RATIO,
    size: height * SCALE_BAR_LABEL_RATIO,
    fill: ink,
    font: TEXT_FONT_FAMILY,
    transform,
  };
  shapes.push({ text: "0", x: left, anchor: "start", ...label });
  shapes.push({ text: `${distance} ${scale.unit}`, x: left + lengthMm, anchor: "end", ...label });
  return shapes;
}

/** The shapes one Stamp draws: its built-in art, or the scale bar its reading lays out. */
function stampShapes(
  element: MapStampElement,
  pageWidthMm: number,
  style: MapStyleId
): SceneShape[] {
  const ink = resolveColor(style, element.color, "ink");
  if (element.stampRef === SCALE_BAR_STAMP_REF) return scaleBarShapes(element, pageWidthMm, ink);
  const art = stampArt(element.stampRef);
  if (art === undefined || !(element.transform.size > 0)) return [];
  return artShapes(art, artTransform(element.transform, art), ink);
}

/** The id a Map Label's baseline path takes, from the Element's own id. */
function labelPathId(elementId: string): string {
  return `label-path-${seedFor(elementId).toString(16)}`;
}

/**
 * The primitives one Map Label draws (#751): its text running along the
 * baseline, the halo behind that text, and the baseline itself as a hit path the
 * Frame picks the Element by. Both serializers draw the text over the baseline
 * the definitions hold, so a straight label and a curved one take one path.
 */
function labelShapes(
  element: MapLabelElement,
  style: MapStyleId,
  collector: SceneCollector
): SceneShape[] {
  const d = labelBaselinePath(element);
  const id = labelPathId(element.id);
  collector.defs.push(`<path id="${id}" d="${escapeAttribute(d)}"/>`);
  const text: TextShape = {
    text: element.text,
    x: element.x,
    y: element.y,
    size: element.size,
    fill: resolveColor(style, element.color, "label"),
    font: labelFontFamily(element.font),
    anchor: "middle",
    path: { id, d },
    ...(element.letterSpacing === 0 ? {} : { letterSpacing: element.letterSpacing }),
    ...(element.halo > 0
      ? { halo: { color: resolveColor(style, undefined, "halo"), width: element.halo } }
      : {}),
  };
  return [
    { d, stroke: null, strokeWidth: 0, dash: null, fill: null, opacity: 1, hitOnly: true },
    text,
  ];
}

/** The render primitives one Element is drawn from: a line's, a fill's content, or a Stamp's picture. */
function elementShapes(
  element: MapElement,
  area: FillArea | null,
  pageWidthMm: number,
  pageHeightMm: number,
  style: MapStyleId,
  collector: SceneCollector
): SceneShape[] {
  if (element.kind === "line") return lineShapes(element, style);
  if (element.kind === "fill") {
    return area === null
      ? []
      : fillShapes(element, area, pageWidthMm, pageHeightMm, style, collector);
  }
  if (element.kind === "stamp") return stampShapes(element, pageWidthMm, style);
  if (element.kind === "label") return labelShapes(element, style, collector);
  return [];
}

/** How far a Soft Edge's blur reaches, in standard deviations, so its region can hold all of it. */
const SOFT_EDGE_REACH = 3;

/** Room a Soft Edge's filter region keeps beyond the blur, for a stroke, a ripple, or a curve, in mm. */
const SOFT_EDGE_PADDING_MM = 6;

/** The blur amount that makes an Element's edge fade, in page millimetres, or null for a sharp edge. */
function softEdgeOf(element: MapElement): number | null {
  const softEdge =
    element.kind === "line" || element.kind === "fill" ? element.softEdge : undefined;
  return softEdge !== undefined && softEdge > 0 ? softEdge : null;
}

/** The id an Element's Soft Edge filter takes, from the Element's own id. */
function softEdgeFilterId(elementId: string): string {
  return `soft-edge-${seedFor(elementId).toString(16)}`;
}

/**
 * The `<filter>` one Element's Soft Edge draws: a Gaussian blur of `softEdgeMm`
 * whose region is widened to hold the whole blur, in page space with explicit
 * bounds, so a browser and Inkscape cut nothing off it. The blur blends in
 * sRGB, the space both renderers agree on, so the fade looks the same in each.
 */
function softEdgeFilter(id: string, softEdgeMm: number, bounds: MapBounds): string {
  const { minX, minY, maxX, maxY } = bounds;
  const padding = softEdgeMm * SOFT_EDGE_REACH + SOFT_EDGE_PADDING_MM;
  const x = minX - padding;
  const y = minY - padding;
  const width = maxX - minX + padding * 2;
  const height = maxY - minY + padding * 2;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB" x="${roundedMm(
    x
  )}" y="${roundedMm(y)}" width="${roundedMm(width)}" height="${roundedMm(height)}"><feGaussianBlur stdDeviation="${roundedMm(
    softEdgeMm
  )}"/></filter>`;
}

/** One whole scene, ready to draw: the primitives, the Soft Edges, and the definitions they use. */
export interface SceneRender {
  shapes: SceneShape[][];
  /** The Soft Edge filter each Element draws with, by array index; null for a sharp edge. */
  filters: (string | null)[];
  /** The SVG definitions the shapes reference: texture patterns, Clip Paths, and filters. */
  defs: string[];
}

/** Every Element's primitives, its Soft Edge, and the definitions its SVG needs, in one pass. */
export function sceneRender(
  elements: readonly MapElement[],
  pageWidthMm: number,
  pageHeightMm: number,
  styleId?: string
): SceneRender {
  const style = styleOf(styleId);
  const needsFaces = elements.some((element) => element.kind === "fill");
  const faces = needsFaces ? sceneFaces(elements) : [];
  const collector: SceneCollector = { defs: [], textures: new Set() };
  const shapes: SceneShape[][] = [];
  const filters: (string | null)[] = [];

  for (const element of elements) {
    const area = element.kind === "fill" ? fillArea(element, faces) : null;
    shapes.push(elementShapes(element, area, pageWidthMm, pageHeightMm, style, collector));

    const softEdge = softEdgeOf(element);
    const outline = element.kind === "line" ? element.points : (area?.rings.flat() ?? []);
    const bounds = softEdge === null ? null : pointsBounds(outline);
    if (softEdge === null || bounds === null) {
      filters.push(null);
      continue;
    }
    const id = softEdgeFilterId(element.id);
    collector.defs.push(softEdgeFilter(id, softEdge, bounds));
    filters.push(id);
  }

  return {
    shapes,
    filters,
    defs: [
      ...TEXTURE_IDS.filter((texture) => collector.textures.has(texture)).map((texture) =>
        texturePattern(texture, style)
      ),
      ...collector.defs,
    ],
  };
}

/** Every Element's render primitives, in array order, from one pass over the faces. */
export function sceneShapes(
  elements: readonly MapElement[],
  pageWidthMm: number,
  pageHeightMm: number,
  styleId?: string
): SceneShape[][] {
  return sceneRender(elements, pageWidthMm, pageHeightMm, styleId).shapes;
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

/** Whether a shape is text rather than a path. */
function isTextShape(shape: SceneShape): shape is TextShape {
  return "text" in shape;
}

/** One drawn primitive as an SVG path, with only the attributes it needs. */
function shapePath(shape: LineShape): string {
  const attributes = [`d="${escapeAttribute(shape.d)}"`];
  if (shape.transform !== undefined)
    attributes.push(`transform="${escapeAttribute(shape.transform)}"`);
  if (shape.stroke === null) {
    attributes.push('stroke="none"');
  } else {
    attributes.push(`stroke="${escapeAttribute(shape.stroke)}"`);
    attributes.push(`stroke-width="${roundedMm(shape.strokeWidth)}"`);
  }
  attributes.push(shape.fill === null ? 'fill="none"' : `fill="${escapeAttribute(shape.fill)}"`);
  if (shape.fillRule !== undefined) attributes.push(`fill-rule="${shape.fillRule}"`);
  if (shape.dash !== null) attributes.push(`stroke-dasharray="${escapeAttribute(shape.dash)}"`);
  if (shape.opacity !== 1) attributes.push(`opacity="${roundedMm(shape.opacity)}"`);
  attributes.push('stroke-linecap="round"', 'stroke-linejoin="round"');
  const path = `<path ${attributes.join(" ")}/>`;
  // A clip on the path itself would be read in its transformed coordinates, so
  // a group in page space carries it instead, as the Frame does.
  return shape.clip === undefined ? path : `<g clip-path="url(#${shape.clip})">${path}</g>`;
}

/** Whether a shape only marks where its Element can be picked, painting no ink. */
function isHitOnlyShape(shape: SceneShape): boolean {
  return !isTextShape(shape) && shape.hitOnly === true;
}

/** The text's own markup, and the baseline path it follows when it has one. */
function textContent(shape: TextShape): string {
  if (shape.path === undefined) return escapeAttribute(shape.text);
  return `<textPath href="#${escapeAttribute(shape.path.id)}" startOffset="50%">${escapeAttribute(
    shape.text
  )}</textPath>`;
}

/** One piece of text as SVG, with only the attributes it needs. */
function shapeText(shape: TextShape): string {
  const attributes: string[] = [];
  // A text on a path starts where its textPath's startOffset puts it, never at
  // an `x` and `y` of its own: Chromium drops the textPath outright when the
  // same <text> also carries an `x`, lays the run out at the origin, and paints
  // nothing (#751). So only a text drawn at a point writes x and y.
  if (shape.path === undefined) {
    attributes.push(`x="${roundedMm(shape.x)}"`, `y="${roundedMm(shape.y)}"`);
  }
  attributes.push(
    `font-size="${roundedMm(shape.size)}"`,
    `font-family="${escapeAttribute(shape.font)}"`
  );
  if (shape.letterSpacing !== undefined) {
    attributes.push(`letter-spacing="${roundedMm(shape.letterSpacing)}"`);
  }
  attributes.push(`text-anchor="${shape.anchor}"`);
  if (shape.transform !== undefined) {
    attributes.push(`transform="${escapeAttribute(shape.transform)}"`);
  }
  const body = textContent(shape);
  const fill = `fill="${escapeAttribute(shape.fill)}"`;
  // The halo is a copy of the text, written first and stroked alone, so the ink
  // sits on top of it in the same place, with the same letterforms.
  const halo =
    shape.halo === undefined
      ? ""
      : `<text ${[
          ...attributes,
          'fill="none"',
          `stroke="${escapeAttribute(shape.halo.color)}"`,
          `stroke-width="${roundedMm(shape.halo.width)}"`,
          'stroke-linejoin="round"',
        ].join(" ")}>${body}</text>`;
  return `${halo}<text ${[...attributes, fill].join(" ")}>${body}</text>`;
}

/** One Element as a group of primitives, marked when it is the selection and blurred when it has a Soft Edge. */
function elementGroup(
  element: MapElement,
  shapes: readonly SceneShape[],
  selected: boolean,
  softEdgeFilterId: string | null
): string {
  const attributes = [`data-element-id="${escapeAttribute(element.id)}"`];
  if (selected) attributes.push('data-selected="true"');
  if (softEdgeFilterId !== null) attributes.push(`filter="url(#${softEdgeFilterId})"`);
  const primitives = shapes
    .filter((shape) => !isHitOnlyShape(shape))
    .map((shape) => (isTextShape(shape) ? shapeText(shape) : shapePath(shape)));
  return `<g ${attributes.join(" ")}>${primitives.join("")}</g>`;
}

export interface SceneOptions {
  /** The Element the editor has selected, marked for the Frame to style. */
  selectedId?: string;
  /** The SVG's pixel width; its height follows the page's proportions. */
  widthPx?: number;
}

/** A whole Map as SVG: the page in its Style's water, then every visible Element. */
export function sceneToSvg(
  map: Pick<MapDocument, "page" | "elements"> & { styleId?: string },
  options: SceneOptions = {}
): string {
  const { widthMm, heightMm } = map.page;
  const style = styleOf(map.styleId);
  const pixelSize =
    options.widthPx !== undefined && Number.isFinite(options.widthPx) && options.widthPx > 0
      ? ` width="${roundedMm(options.widthPx)}" height="${roundedMm(
          (heightMm * options.widthPx) / widthMm
        )}"`
      : "";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${roundedMm(widthMm)} ${roundedMm(
      heightMm
    )}"${pixelSize}>`,
    background(widthMm, heightMm, style),
  ];

  const render = sceneRender(map.elements, widthMm, heightMm, style);
  if (render.defs.length > 0) parts.push(`<defs>${render.defs.join("")}</defs>`);
  map.elements.forEach((element, index) => {
    // An Element with nothing to draw writes no group: a hidden one, a Fill in
    // no face, or a Stamp whose art this build does not know.
    if (element.hidden || render.shapes[index].length === 0) return;
    parts.push(
      elementGroup(
        element,
        render.shapes[index],
        options.selectedId === element.id,
        render.filters[index]
      )
    );
  });

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

/**
 * Whether the move Commands may move an Element: an unlocked Map Line, Stamp,
 * Map Label, or Area Fill, the Elements `moveElement` knows how to shift. A
 * Select drag also needs it shown (#766), since a hidden Element is never drawn
 * to press.
 */
export function canMove(element: MapElement): boolean {
  return (
    !element.locked &&
    (element.kind === "line" ||
      element.kind === "stamp" ||
      element.kind === "label" ||
      isAreaFill(element))
  );
}

/**
 * Moves one Element by a page-millimetre offset; a locked Element stays put. An
 * Area Fill moves with its outline, so it keeps covering the same shape at its
 * new place; a Bucket Fill follows the Map Lines that enclose it instead, and
 * never moves on its own.
 */
export function moveElement(
  elements: readonly MapElement[],
  id: string,
  dx: number,
  dy: number
): MapElement[] {
  return elements.map((element) => {
    if (element.id !== id || element.locked) return element;
    if (element.kind === "stamp") {
      return {
        ...element,
        transform: {
          ...element.transform,
          x: element.transform.x + dx,
          y: element.transform.y + dy,
        },
      };
    }
    // A Map Label's baseline is centred on its own point, so the point is all
    // that moves: its width, bend, and turn stay as the author set them.
    if (element.kind === "label") return { ...element, x: element.x + dx, y: element.y + dy };
    if (element.kind === "fill") {
      const { outline } = element;
      if (outline === undefined) return element;
      return {
        ...element,
        anchor: [element.anchor[0] + dx, element.anchor[1] + dy],
        outline: {
          ...outline,
          points: outline.points.map(([x, y]): MapPoint => [x + dx, y + dy]),
        },
      };
    }
    if (element.kind !== "line") return element;
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
