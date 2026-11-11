/**
 * The Maps data model (#737, #744; ADR 0039). A Map is one JSON document under
 * its own Plugin storage key, `map:<id>`, and `index` lists every Map with just
 * what the list page draws (Book, name, page size, last change, a small
 * preview), so the list never loads a whole Map.
 *
 * Every write goes through one queue, so overlapping creates, renames, saves,
 * and deletes never read a stale index. The index is the list's source of truth;
 * each write orders its two keys so a failure in the middle never lists a Map
 * that cannot be loaded:
 *
 * - create writes the Map, then the index, and removes the Map if the index
 *   write fails;
 * - rename and save write the Map, then the index, and restore the old Map if
 *   the index write fails;
 * - delete removes the index entry first, then the Map. A failure between the
 *   two leaves an unlisted key, never a listed Map with no data.
 *
 * This module imports only its own files.
 */

import { sceneToSvg } from "./scene";
import { SCALE_BAR_STAMP_REF } from "./stamps";
import { isTextureId, type TextureId } from "./textures";

/** The Plugin's data format version; `migrateData` owns every change to it. */
export const DATA_VERSION = 1;

/** The storage key of the list the Maps page reads. */
export const INDEX_KEY = "index";

/** The storage key of one Map. */
export function mapKey(id: string): string {
  return `map:${id}`;
}

/** The page sizes a Map is created with; print size and DPI come at export. */
export const PAGE_PRESETS = ["portrait", "landscape", "spread", "square"] as const;
export type PagePreset = (typeof PAGE_PRESETS)[number];

/**
 * Each preset's page in millimetres: a 6×9 in trade page upright or on its
 * side, a 12×9 in double-page spread, and an 8×8 in square.
 */
const PAGE_SIZES: Readonly<Record<PagePreset, { widthMm: number; heightMm: number }>> = {
  portrait: { widthMm: 152.4, heightMm: 228.6 },
  landscape: { widthMm: 228.6, heightMm: 152.4 },
  spread: { widthMm: 304.8, heightMm: 228.6 },
  square: { widthMm: 203.2, heightMm: 203.2 },
};

export interface MapPage {
  preset: PagePreset;
  widthMm: number;
  heightMm: number;
}

/** The five element kinds a Map holds (#737 Decision 6). */
export const MAP_ELEMENT_KINDS = ["line", "fill", "stamp", "label", "image"] as const;
export type MapElementKind = (typeof MAP_ELEMENT_KINDS)[number];

/** A point on the page, in millimetres from its top-left corner. */
export type MapPoint = [number, number];

/**
 * What every element shares. A kind's own fields (points, anchor, stamp, text,
 * asset) arrive with the ticket that draws it; z-order is array order.
 */
export interface MapElementBase {
  id: string;
  name: string;
  hidden: boolean;
  locked: boolean;
}

/** A Map Line: the points a Pencil stroke was simplified to (#745), and its line style (#746). */
export interface MapLineElement extends MapElementBase {
  kind: "line";
  points: MapPoint[];
  /** What the line is: a coast, a river, a road, a border, a ripple, or plain ink. */
  style: LineStyleId;
  /** Whether the area the line encloses takes the Fills of the Map. */
  enclosesFills: boolean;
  /** Whether the last point joins back to the first. */
  closed: boolean;
  /** One flag per segment: `true` curves it, `false` draws it straight. */
  curves: boolean[];
  /** Whether the line is drawn with the rough ink look. */
  roughened: boolean;
  /**
   * The exact Shape the line is, when it is one (#747). `points` and `curves`
   * then hold the outline its numbers draw, so render, erase, and fills read
   * them unchanged; the outline is always recomputed from here, never edited.
   */
  shape?: MapShape;
  /** The Shape kind a line was, once the Eraser or Roughen made it point by point. */
  convertedFrom?: ShapeKind;
  /** How far the line's edge fades out, in page millimetres; absent or 0 draws a sharp edge. */
  softEdge?: number;
}

/** What covers a Fill's area: its colour, its texture, or the Stamps it scatters. */
export interface MapFillContent {
  /** The flat colour, under a texture or a scatter when the Fill has one of them. */
  color?: string;
  /** The texture painted over the area, from `textures.ts`. */
  texture?: TextureId;
  /** The Stamps scattered over the area. */
  scatter?: MapFillScatter;
}

/** The Stamp a Fill scatters over its area, how far apart the Stamps sit, and the seed that places them. */
export interface MapFillScatter {
  /** The `stampRef` of the one kind of Stamp scattered over the area. */
  stamp: string;
  /** The smallest distance between two scattered Stamps, in page millimetres; each Stamp draws this wide. */
  spacing: number;
  /** The seed the points are sampled from, so the same Fill scatters the same way each render. */
  seed: number;
}

/**
 * An Area Fill's own outline (#750): the closed area it covers instead of the
 * face its anchor sits in. `points`, `curves`, and `roughened` read exactly as a
 * Map Line's, with one flag per segment and the closing segment included, so
 * `curves.length` is `points.length`, and the first point is not repeated.
 */
export interface MapFillOutline {
  points: MapPoint[];
  curves: boolean[];
  roughened: boolean;
}

/**
 * A Fill (#748, #750): what covers one area of the Map. It is an Area Fill when
 * it carries an `outline`, covering that outline and never stroked; otherwise it
 * is a Bucket Fill, covering the face its anchor lies in and following that face
 * when the Map Lines around it move.
 */
export interface MapFillElement extends MapElementBase {
  kind: "fill";
  /** The point the Fill sits on: a Bucket Fill's face, and an Area Fill's selection point. */
  anchor: MapPoint;
  /** The Area Fill's own outline; a Bucket Fill carries none. */
  outline?: MapFillOutline;
  /** What covers the area: a colour, a texture, scattered Stamps, or any combination. */
  content: MapFillContent;
  /** How far the Fill's edge fades out, in page millimetres; absent or 0 draws a sharp edge. */
  softEdge?: number;
}

/** The units a scale bar reads in. */
export const STAMP_SCALE_UNITS = ["km", "mi"] as const;
export type StampScaleUnit = (typeof STAMP_SCALE_UNITS)[number];

/**
 * A scale bar's reading: the distance the Map page's full width stands for, in
 * `unit`. Only the scale bar Stamp carries one.
 */
export interface MapStampScale {
  unit: StampScaleUnit;
  span: number;
}

/** Where a Stamp sits and how big it is: its centre in page millimetres, its art box's width, and its turn in degrees. */
export interface MapStampTransform {
  x: number;
  y: number;
  size: number;
  rotation: number;
}

/**
 * A Stamp: one picture at one spot on the page (#749). Its art comes from the
 * built-in set by `stampRef`, `base:<id>`, or from a Custom Stamp's image; an
 * art part with no colour of its own draws in `color`.
 */
export interface MapStampElement extends MapElementBase {
  kind: "stamp";
  /** The art it draws, such as `base:marker`; a ref this build does not know draws nothing. */
  stampRef: string;
  transform: MapStampTransform;
  /** The ink a one-colour part of the art takes. */
  color: string;
  /** The scale bar's reading; no other Stamp carries one. */
  scale?: MapStampScale;
}

/** The width a new Stamp's art box starts at, in page millimetres. */
export const DEFAULT_STAMP_SIZE_MM = 12;

/**
 * The room a new scale bar starts with, in page millimetres: the longest bar it
 * may draw, which `scaleBarLayout` turns into the round distance it labels.
 */
export const DEFAULT_SCALE_BAR_SIZE_MM = 40;

/** The smallest art box a Stamp keeps, in page millimetres. */
export const MIN_STAMP_SIZE_MM = 1;

/**
 * The ink a Map Line is drawn in until Map Styles choose another. It lives here,
 * beside the Elements that carry it, so the model never reads the scene for it:
 * `scene.ts` imports this module, and a cycle back would leave the default
 * Stamp colour undefined on the way in.
 */
export const LINE_STROKE = "#1f2933";

/** The ink a new Stamp takes until the author or the Map Style picks another. */
export const DEFAULT_STAMP_COLOR = LINE_STROKE;

/** The reading a new scale bar takes: the page's full width stands for 1000 km. */
export const DEFAULT_STAMP_SCALE: MapStampScale = { unit: "km", span: 1000 };

/**
 * The bundled fonts a Map Label can take, by id (#751); every one is a SIL OFL
 * face the Plugin ships, so the Frame and an export draw the same letterforms
 * with nothing loaded from the network.
 */
export const MAP_LABEL_FONTS = [
  "im-fell-english",
  "cinzel",
  "uncial-antiqua",
  "medieval-sharp",
] as const;

/** The font ids a Map Label takes: the bundled ones, plus `pdf` for the author's PDF Font. */
export type MapLabelFont = (typeof MAP_LABEL_FONTS)[number] | "pdf";

/** The family name each font id draws in, so the Frame and an export ask for the same face. */
export const MAP_LABEL_FONT_FAMILIES: Readonly<Record<MapLabelFont, string>> = {
  "im-fell-english": "IM Fell English",
  cinzel: "Cinzel",
  "uncial-antiqua": "Uncial Antiqua",
  "medieval-sharp": "MedievalSharp",
  pdf: "Maibuk PDF Font",
};

/** Every font id a Map Label takes, bundled and PDF alike. */
const LABEL_FONT_IDS: readonly string[] = [...MAP_LABEL_FONTS, "pdf"];

/** The font a new Map Label takes, and the one an id this build does not know reads as. */
export const DEFAULT_LABEL_FONT: MapLabelFont = "im-fell-english";

/** The baseline a new Map Label starts with, in page millimetres. */
export const DEFAULT_LABEL_WIDTH_MM = 40;

/** The shortest baseline a Map Label keeps, in page millimetres. */
export const MIN_LABEL_WIDTH_MM = 1;

/** The cap size a new Map Label starts at, in page millimetres. */
export const DEFAULT_LABEL_SIZE_MM = 6;

/** The smallest cap size a Map Label keeps, in page millimetres. */
export const MIN_LABEL_SIZE_MM = 1;

/** The halo a new Map Label starts with, as a stroke width in page millimetres. */
export const DEFAULT_LABEL_HALO_MM = 0.8;

/**
 * How small a bend the bend handle treats as straight, in page millimetres: a
 * drag that lands this close to the chord leaves the name flat instead of
 * almost flat.
 */
export const BEND_SNAP_MM = 0.5;

/**
 * A Map Label (#751): a name written on the Map. Its text runs along a baseline
 * `width` millimetres long, centred on (x, y) and turned by `rotation`; `bend`
 * lifts the middle of that baseline toward the top of the page, so a name can
 * arch over the land it names.
 */
export interface MapLabelElement extends MapElementBase {
  kind: "label";
  /** The name as the author wrote it. */
  text: string;
  /** The centre of the baseline, in page millimetres. */
  x: number;
  y: number;
  /** How far the baseline turns, in degrees clockwise about (x, y). */
  rotation: number;
  /** The baseline chord's length, in page millimetres. */
  width: number;
  /**
   * The signed sagitta of the baseline, in page millimetres: how far its middle
   * leaves the chord, toward the top of the page when positive.
   */
  bend: number;
  /** The font id it draws in, from `MAP_LABEL_FONTS`, or `pdf` for the PDF Font. */
  font: string;
  /** The cap size, which is the text's font size, in page millimetres. */
  size: number;
  /** The room each letter takes beyond its own width, in page millimetres. */
  letterSpacing: number;
  /** The ink it draws in; absent takes the Map Style's label colour, else the map ink. */
  color?: string;
  /** The halo behind the text, as a stroke width in page millimetres; 0 draws none. */
  halo: number;
}

/** The exact Shapes a Map Line can be (#747). */
export const SHAPE_KINDS = ["ellipse", "rectangle", "polygon"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** The smallest Shape a drag draws, on either side, in page millimetres. */
export const MIN_SHAPE_SIZE_MM = 1;

/** The Shape the Place command draws with no drag, in page millimetres. */
export const DEFAULT_SHAPE_SIZE_MM = 40;

/** The sides a new polygon takes, and the range a polygon keeps. */
export const DEFAULT_POLYGON_SIDES = 6;
export const MIN_POLYGON_SIDES = 3;
export const MAX_POLYGON_SIDES = 12;

/**
 * An exact Shape a Map Line carries (#747): its outline is drawn from these
 * numbers alone, so a resize or a turn never loses it to rounding. Points are
 * page millimetres, and the angle is degrees clockwise about (cx, cy).
 */
export interface MapShape {
  kind: ShapeKind;
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  /** A polygon's side count, from `MIN_POLYGON_SIDES` to `MAX_POLYGON_SIDES`. */
  sides: number;
  /** A rectangle's corner radius in page millimetres, up to half its shorter side. */
  cornerRadius: number;
}

/** The line styles a Map Line can take (#746); the render primitives arrive with the Frame slice. */
export const LINE_STYLE_IDS = ["coast", "river", "road", "border", "coastRipple", "plain"] as const;
export type LineStyleId = (typeof LINE_STYLE_IDS)[number];

/** The Encloses Fills a style gives a Map Line when the author picks it. */
export const LINE_STYLE_DEFAULT_ENCLOSES: Readonly<Record<LineStyleId, boolean>> = {
  coast: true,
  river: false,
  road: false,
  border: true,
  coastRipple: false,
  plain: true,
};

/** The land colour a new Fill takes, chosen to read against the page's water. */
export const DEFAULT_FILL_COLOR = "#c8d5a3";

/** The curve flags of a line with `pointCount` points, every segment curved. */
export function curvedSegments(pointCount: number, closed: boolean): boolean[] {
  return Array.from({ length: pointCount - 1 + (closed ? 1 : 0) }, () => true);
}

/** Every other Element kind, whose geometry lands with its own ticket. */
export interface MapOtherElement extends MapElementBase {
  kind: Exclude<MapElementKind, "line" | "fill" | "stamp" | "label">;
}

export type MapElement =
  | MapLineElement
  | MapFillElement
  | MapStampElement
  | MapLabelElement
  | MapOtherElement;

/**
 * Whether an Element is a Fill that covers its own outline (#750), rather than
 * the face its anchor sits in: no move of a Map Line carries it along.
 */
export function isAreaFill(
  element: MapElement
): element is MapFillElement & { outline: MapFillOutline } {
  return element.kind === "fill" && element.outline !== undefined;
}

/** One stored Map, exactly as `map:<id>` holds it. */
export interface MapDocument {
  id: string;
  bookId: string | null;
  name: string;
  page: MapPage;
  styleId: string;
  overrides: Record<string, unknown>;
  elements: MapElement[];
  createdAt: number;
  updatedAt: number;
  dataVersion: number;
}

/** One row of `index`: what the list page draws, without the Map's elements. */
export interface MapIndexEntry {
  id: string;
  bookId: string | null;
  name: string;
  preset: PagePreset;
  updatedAt: number;
  /** A small `data:image/svg+xml` picture of the Map. */
  preview: string;
}

/** The Map Style a new Map starts in. */
export const DEFAULT_STYLE_ID = "atlas";

/** The longest Map name the store keeps. */
export const MAX_NAME_LENGTH = 120;

/** The slice of the SDK storage API the store uses. */
export interface MapStorage {
  get(input: { key: string }): Promise<unknown>;
  set(input: { key: string; value: unknown }): Promise<null>;
  delete(input: { key: string }): Promise<null>;
}

export interface NewMap {
  name: string;
  bookId: string | null;
  preset: PagePreset;
}

export interface MapStore {
  /** Every Map, most recently changed first, from the index alone. */
  list(): Promise<MapIndexEntry[]>;
  /** One whole Map, or null when it is absent or damaged. */
  load(id: string): Promise<MapDocument | null>;
  create(input: NewMap): Promise<MapIndexEntry>;
  rename(id: string, name: string): Promise<MapIndexEntry>;
  /** Writes an edited Map and its index entry; refuses a document that fails validation. */
  save(doc: MapDocument): Promise<void>;
  /** Deletes a Map; deleting one that is gone does nothing. */
  remove(id: string): Promise<void>;
}

/** A random id from the Worker's `getRandomValues` (a sandboxed Worker may lack `randomUUID`). */
export function randomMapId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The picture the index carries for a Map: the drawn scene, at page size. */
export function mapPreview(map: Pick<MapDocument, "page" | "elements">): string {
  return `data:image/svg+xml,${encodeURIComponent(sceneToSvg(map))}`;
}

function indexEntryFor(map: MapDocument): MapIndexEntry {
  return {
    id: map.id,
    bookId: map.bookId,
    name: map.name,
    preset: map.page.preset,
    updatedAt: map.updatedAt,
    preview: mapPreview(map),
  };
}

function isPagePreset(value: unknown): value is PagePreset {
  return typeof value === "string" && (PAGE_PRESETS as readonly string[]).includes(value);
}

function isMapElementKind(value: unknown): value is MapElementKind {
  return typeof value === "string" && (MAP_ELEMENT_KINDS as readonly string[]).includes(value);
}

function isLineStyleId(value: unknown): value is LineStyleId {
  return typeof value === "string" && (LINE_STYLE_IDS as readonly string[]).includes(value);
}

/** Whether a value names one of the units a scale bar reads in. */
export function isStampScaleUnit(value: unknown): value is StampScaleUnit {
  return typeof value === "string" && (STAMP_SCALE_UNITS as readonly string[]).includes(value);
}

/** Whether a value names one of the Shapes a Map Line can be. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === "string" && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** Whether a value names a font a Map Label can take. */
export function isLabelFont(value: unknown): value is MapLabelFont {
  return typeof value === "string" && LABEL_FONT_IDS.includes(value);
}

/** The family name a font id draws in; an id this build does not know draws IM Fell English. */
export function labelFontFamily(font: string): string {
  return MAP_LABEL_FONT_FAMILIES[isLabelFont(font) ? font : DEFAULT_LABEL_FONT];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMapPoint(value: unknown): value is MapPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isCurveFlags(value: unknown, length: number): value is boolean[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((flag) => typeof flag === "boolean")
  );
}

/** Whether a line's style fields are present and well formed; a missing one is normalized on load. */
function isLineStyleFields(element: Record<string, unknown>, pointCount: number): boolean {
  if (element.style !== undefined && !isLineStyleId(element.style)) return false;
  if (element.enclosesFills !== undefined && typeof element.enclosesFills !== "boolean")
    return false;
  if (element.closed !== undefined && typeof element.closed !== "boolean") return false;
  if (element.roughened !== undefined && typeof element.roughened !== "boolean") return false;
  if (element.curves !== undefined) {
    const segments = pointCount - 1 + (element.closed === true ? 1 : 0);
    if (!isCurveFlags(element.curves, segments)) return false;
  }
  return true;
}

/** Whether a Stamp's scale is present and well formed, or absent. */
function isStampScale(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const scale = value as Record<string, unknown>;
  return isStampScaleUnit(scale.unit) && isFiniteNumber(scale.span) && scale.span > 0;
}

/** Whether a Stamp's place and size are present and well formed. */
function isStampTransform(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const transform = value as Record<string, unknown>;
  return (
    isFiniteNumber(transform.x) &&
    isFiniteNumber(transform.y) &&
    isFiniteNumber(transform.size) &&
    transform.size > 0 &&
    isFiniteNumber(transform.rotation)
  );
}

/** Whether a Soft Edge is absent, or a blur amount that draws one. */
function isSoftEdge(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0);
}

/** Whether an Area Fill's outline is present and well formed, or absent. */
function isFillOutline(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const outline = value as Record<string, unknown>;
  if (!Array.isArray(outline.points) || outline.points.length < 3) return false;
  if (!outline.points.every(isMapPoint)) return false;
  if (!isCurveFlags(outline.curves, outline.points.length)) return false;
  return typeof outline.roughened === "boolean";
}

/** Whether the Stamps a Fill scatters are present and well formed, or absent. */
function isFillScatter(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const scatter = value as Record<string, unknown>;
  return (
    typeof scatter.stamp === "string" &&
    scatter.stamp !== "" &&
    isFiniteNumber(scatter.spacing) &&
    scatter.spacing > 0 &&
    isFiniteNumber(scatter.seed)
  );
}

/** Whether a Fill's content covers something: at least one of a colour, a texture, or a scatter. */
function isFillContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const content = value as Record<string, unknown>;
  if (content.color !== undefined && typeof content.color !== "string") return false;
  if (content.texture !== undefined && !isTextureId(content.texture)) return false;
  if (content.scatter !== undefined && !isFillScatter(content.scatter)) return false;
  return (
    content.color !== undefined || content.texture !== undefined || content.scatter !== undefined
  );
}

/**
 * Whether a Map Label's fields are all present and well formed. A font id this
 * build does not know is not malformed: it reads back as IM Fell English, so a
 * document written by a build with more fonts still opens.
 */
function isLabelFields(element: Record<string, unknown>): boolean {
  if (typeof element.text !== "string") return false;
  if (!isFiniteNumber(element.x) || !isFiniteNumber(element.y)) return false;
  if (!isFiniteNumber(element.rotation)) return false;
  if (!isFiniteNumber(element.width) || element.width <= 0) return false;
  if (!isFiniteNumber(element.bend)) return false;
  if (element.font !== undefined && typeof element.font !== "string") return false;
  if (!isFiniteNumber(element.size) || element.size <= 0) return false;
  if (!isFiniteNumber(element.letterSpacing)) return false;
  if (!isFiniteNumber(element.halo) || element.halo < 0) return false;
  return element.color === undefined || typeof element.color === "string";
}

function isMapElement(value: unknown): value is MapElement {
  if (typeof value !== "object" || value === null) return false;
  const element = value as Record<string, unknown>;
  if (
    typeof element.id !== "string" ||
    !isMapElementKind(element.kind) ||
    typeof element.name !== "string" ||
    typeof element.hidden !== "boolean" ||
    typeof element.locked !== "boolean"
  ) {
    return false;
  }
  if (element.kind === "line") {
    if (!Array.isArray(element.points) || element.points.length < 2) return false;
    if (!element.points.every(isMapPoint)) return false;
    return isLineStyleFields(element, element.points.length) && isSoftEdge(element.softEdge);
  }
  if (element.kind === "fill") {
    if (!isMapPoint(element.anchor)) return false;
    if (element.outline !== undefined && !isFillOutline(element.outline)) return false;
    return isFillContent(element.content) && isSoftEdge(element.softEdge);
  }
  if (element.kind === "stamp") {
    return (
      typeof element.stampRef === "string" &&
      element.stampRef !== "" &&
      typeof element.color === "string" &&
      isStampTransform(element.transform) &&
      (element.scale === undefined || isStampScale(element.scale))
    );
  }
  if (element.kind === "label") return isLabelFields(element);
  return true;
}

function isIndexEntry(value: unknown): value is MapIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    (entry.bookId === null || typeof entry.bookId === "string") &&
    typeof entry.name === "string" &&
    isPagePreset(entry.preset) &&
    typeof entry.updatedAt === "number" &&
    typeof entry.preview === "string"
  );
}

function isMapDocument(value: unknown): value is MapDocument {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Record<string, unknown>;
  const page = map.page as Record<string, unknown> | null | undefined;
  return (
    typeof map.id === "string" &&
    typeof map.name === "string" &&
    (map.bookId === null || typeof map.bookId === "string") &&
    Array.isArray(map.elements) &&
    map.elements.every(isMapElement) &&
    typeof page === "object" &&
    page !== null &&
    isPagePreset(page.preset) &&
    typeof page.widthMm === "number" &&
    typeof page.heightMm === "number"
  );
}

/** A new Stamp's fields; its id and name belong to whoever places it. */
export interface NewStamp {
  id: string;
  name: string;
  stampRef: string;
  /** The page point the art is centred on. */
  point: MapPoint;
  size?: number;
  rotation?: number;
  color?: string;
  scale?: MapStampScale;
}

/**
 * A Stamp of `stampRef` centred on `point`: upright, at the default size, in the
 * map ink, and, when it is the scale bar, reading the default scale.
 */
export function newStamp(input: NewStamp): MapStampElement {
  const scale =
    input.scale ?? (input.stampRef === SCALE_BAR_STAMP_REF ? DEFAULT_STAMP_SCALE : undefined);
  const size =
    input.size ??
    (input.stampRef === SCALE_BAR_STAMP_REF ? DEFAULT_SCALE_BAR_SIZE_MM : DEFAULT_STAMP_SIZE_MM);
  return {
    id: input.id,
    kind: "stamp",
    name: input.name,
    hidden: false,
    locked: false,
    stampRef: input.stampRef,
    transform: {
      x: input.point[0],
      y: input.point[1],
      size,
      rotation: input.rotation ?? 0,
    },
    color: input.color ?? DEFAULT_STAMP_COLOR,
    ...(scale === undefined ? {} : { scale }),
  };
}

/** A new Map Label's fields; its id and name belong to whoever places it. */
export interface NewLabel {
  id: string;
  name: string;
  /** The name to write, in the caller's language: the model supplies no wording. */
  text: string;
  /** The centre of the baseline. */
  point: MapPoint;
  width?: number;
  bend?: number;
  rotation?: number;
  font?: string;
  size?: number;
  letterSpacing?: number;
  color?: string;
  halo?: number;
}

/**
 * A Map Label writing `text` along a baseline centred on `point`: upright and
 * straight, 40 mm long, with a halo, in the bundled IM Fell English.
 */
export function newLabel(input: NewLabel): MapLabelElement {
  return {
    id: input.id,
    kind: "label",
    name: input.name,
    hidden: false,
    locked: false,
    text: input.text,
    x: input.point[0],
    y: input.point[1],
    rotation: input.rotation ?? 0,
    width: input.width ?? DEFAULT_LABEL_WIDTH_MM,
    bend: input.bend ?? 0,
    font: input.font ?? DEFAULT_LABEL_FONT,
    size: input.size ?? DEFAULT_LABEL_SIZE_MM,
    letterSpacing: input.letterSpacing ?? 0,
    halo: input.halo ?? DEFAULT_LABEL_HALO_MM,
    ...(input.color === undefined ? {} : { color: input.color }),
  };
}

/** A coordinate for an SVG path, with two decimals at most. */
function roundedPathCoordinate(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The baseline a Map Label's text follows (#751), as one quadratic SVG path in
 * page millimetres: the chord, `width` long, centred on (x, y) and turned by
 * `rotation`, with its middle bowed `bend` millimetres toward the top of the
 * page. A quadratic reaches only half way to its control point, so the control
 * sits twice the bend off the chord and the apex lands where the author put it.
 * A bend of 0 keeps the control on the chord's middle, which draws straight, so
 * a straight label and a curved one take the same path.
 */
export function labelBaselinePath(label: MapLabelElement): string {
  const half = label.width / 2;
  const angle = (label.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = (dx: number, dy: number): MapPoint => [
    label.x + dx * cos - dy * sin,
    label.y + dx * sin + dy * cos,
  ];
  const start = place(-half, 0);
  const control = place(0, -2 * label.bend);
  const end = place(half, 0);
  return `M ${roundedPathCoordinate(start[0])} ${roundedPathCoordinate(start[1])} Q ${roundedPathCoordinate(control[0])} ${roundedPathCoordinate(control[1])} ${roundedPathCoordinate(end[0])} ${roundedPathCoordinate(end[1])}`;
}

/**
 * The bend a pointer at `point` asks for (#751): how far the point sits from
 * the label's chord line, toward the top of the label, in page millimetres.
 * This is the inverse of `labelBaselinePath`: a bend of 0 says the point is on
 * the chord, so dragging the curve's handle back to the chord straightens the
 * name. The drag reports the distance rounded to a tenth of a millimetre, and
 * snaps anything under half a millimetre to straight. The Frame mirrors this
 * arithmetic, since a Frame script cannot import this module.
 */
export function bendFromPoint(
  label: Pick<MapLabelElement, "x" | "y" | "rotation">,
  point: MapPoint
): number {
  const angle = (label.rotation * Math.PI) / 180;
  const dx = point[0] - label.x;
  const dy = point[1] - label.y;
  // The label's own frame turns clockwise with the page, so the distance
  // toward its top is the page offset projected on that turned normal.
  const bend = dx * Math.sin(angle) - dy * Math.cos(angle);
  const rounded = Math.round(bend * 10) / 10;
  return Math.abs(rounded) < BEND_SNAP_MM ? 0 : rounded;
}

/** The trimmed name, or a throw the page shows as "Give the Map a name". */
function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (trimmed === "") throw new Error("empty-name");
  return trimmed;
}

/** The largest corner radius a rectangle of `width` by `height` takes. */
function maxCornerRadius(width: number, height: number): number {
  return Math.min(width, height) / 2;
}

/**
 * A stored Shape with its numbers brought inside the ranges the model allows, or
 * null when it cannot be a Shape at all: an unknown kind, a size with no area, or
 * a number that is not finite. A Shape an older or a broken build wrote still
 * draws instead of being lost.
 */
export function normalizeShape(value: unknown): MapShape | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  if (!isShapeKind(stored.kind)) return null;
  const { cx, cy, width, height } = stored;
  if (!isFiniteNumber(cx) || !isFiniteNumber(cy)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const rotation = stored.rotation === undefined ? 0 : stored.rotation;
  const sides = stored.sides === undefined ? DEFAULT_POLYGON_SIDES : stored.sides;
  const cornerRadius = stored.cornerRadius === undefined ? 0 : stored.cornerRadius;
  if (!isFiniteNumber(rotation) || !isFiniteNumber(sides) || !isFiniteNumber(cornerRadius)) {
    return null;
  }
  return {
    kind: stored.kind,
    cx,
    cy,
    width,
    height,
    rotation,
    sides: Math.min(MAX_POLYGON_SIDES, Math.max(MIN_POLYGON_SIDES, Math.round(sides))),
    cornerRadius: Math.min(maxCornerRadius(width, height), Math.max(0, cornerRadius)),
  };
}

/**
 * A Map Line read from a document written before line styles existed (#745):
 * a Pencil line is plain, encloses Fills, open, all curves, and not roughened.
 * A Shape it carries is kept when it still makes one, and dropped when it does
 * not (#747), and an unknown Shape kind a line was converted from is dropped too.
 */
function normalizeLine(line: MapLineElement): MapLineElement {
  const { shape: storedShape, convertedFrom: storedConvertedFrom, ...lineFields } = line;
  const stored = lineFields as Partial<MapLineElement>;
  const style = stored.style ?? "plain";
  const closed = stored.closed ?? false;
  const shape = normalizeShape(storedShape);
  const convertedFrom = isShapeKind(storedConvertedFrom) ? storedConvertedFrom : null;
  return {
    ...lineFields,
    style,
    enclosesFills: stored.enclosesFills ?? LINE_STYLE_DEFAULT_ENCLOSES[style],
    closed,
    curves: stored.curves ?? curvedSegments(line.points.length, closed),
    roughened: stored.roughened ?? false,
    ...(shape === null ? {} : { shape }),
    ...(convertedFrom === null ? {} : { convertedFrom }),
  };
}

/**
 * An Element stored with a Soft Edge of 0 reads back sharp, which is what it
 * draws: absent and 0 are the same edge, so one of them is enough to store.
 */
export function normalizeSoftEdge<T extends MapLineElement | MapFillElement>(element: T): T {
  if (element.softEdge === undefined || element.softEdge > 0) return element;
  const sharp = { ...element };
  delete sharp.softEdge;
  return sharp;
}

/**
 * A Map Label read from a document: a font id this build does not know draws
 * IM Fell English, and every other field reads as it was stored.
 */
function normalizeLabel(label: MapLabelElement): MapLabelElement {
  if (isLabelFont(label.font)) return label;
  return { ...label, font: DEFAULT_LABEL_FONT };
}

/** A whole document with every Element in its current shape, for reading old Maps. */
function normalizeDocument(map: MapDocument): MapDocument {
  return {
    ...map,
    elements: map.elements.map((element) => {
      if (element.kind === "line") return normalizeSoftEdge(normalizeLine(element));
      if (element.kind === "fill") return normalizeSoftEdge(element);
      if (element.kind === "label") return normalizeLabel(element);
      return element;
    }),
  };
}

function newestFirst(entries: MapIndexEntry[]): MapIndexEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createMapStore(
  storage: MapStorage,
  options: { now?: () => number; newId?: () => string } = {}
): MapStore {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomMapId;
  let queue: Promise<unknown> = Promise.resolve();

  /** Runs `task` after every earlier write, whether it succeeded or not. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function readIndex(): Promise<MapIndexEntry[]> {
    const value = await storage.get({ key: INDEX_KEY });
    return Array.isArray(value) ? value.filter(isIndexEntry) : [];
  }

  async function writeIndex(entries: MapIndexEntry[]): Promise<void> {
    await storage.set({ key: INDEX_KEY, value: entries });
  }

  return {
    async list() {
      return newestFirst(await readIndex());
    },

    load(id) {
      return serial(async () => {
        const stored = await storage.get({ key: mapKey(id) });
        return isMapDocument(stored) ? normalizeDocument(stored) : null;
      });
    },

    create(input) {
      return serial(async () => {
        const name = cleanName(input.name);
        const at = now();
        const map: MapDocument = {
          id: newId(),
          bookId: input.bookId,
          name,
          page: { preset: input.preset, ...PAGE_SIZES[input.preset] },
          styleId: DEFAULT_STYLE_ID,
          overrides: {},
          elements: [],
          createdAt: at,
          updatedAt: at,
          dataVersion: DATA_VERSION,
        };
        const entry = indexEntryFor(map);
        const index = await readIndex();
        await storage.set({ key: mapKey(map.id), value: map });
        try {
          await writeIndex([...index, entry]);
        } catch (error) {
          await storage.delete({ key: mapKey(map.id) }).catch(() => null);
          throw error;
        }
        return entry;
      });
    },

    rename(id, nextName) {
      return serial(async () => {
        const name = cleanName(nextName);
        const stored = await storage.get({ key: mapKey(id) });
        if (!isMapDocument(stored)) throw new Error("not-found");
        const map: MapDocument = { ...normalizeDocument(stored), name, updatedAt: now() };
        const entry = indexEntryFor(map);
        const index = await readIndex();
        await storage.set({ key: mapKey(id), value: map });
        try {
          await writeIndex([...index.filter((row) => row.id !== id), entry]);
        } catch (error) {
          await storage.set({ key: mapKey(id), value: stored }).catch(() => null);
          throw error;
        }
        return entry;
      });
    },

    save(doc) {
      return serial(async () => {
        if (!isMapDocument(doc)) throw new Error("invalid-map");
        const stored = await storage.get({ key: mapKey(doc.id) });
        if (!isMapDocument(stored)) throw new Error("not-found");
        const map: MapDocument = { ...doc, updatedAt: now() };
        const entry = indexEntryFor(map);
        const index = await readIndex();
        await storage.set({ key: mapKey(map.id), value: map });
        try {
          await writeIndex([...index.filter((row) => row.id !== map.id), entry]);
        } catch (error) {
          await storage.set({ key: mapKey(map.id), value: stored }).catch(() => null);
          throw error;
        }
      });
    },

    remove(id) {
      return serial(async () => {
        const index = await readIndex();
        if (index.some((row) => row.id === id)) {
          await writeIndex(index.filter((row) => row.id !== id));
        }
        await storage.delete({ key: mapKey(id) });
      });
    },
  };
}

/**
 * Answers the host's `migrateData` request (`packaging.md`): rewrites stored
 * data written by `from` into the current `DATA_VERSION`. Version 1 is the
 * first, so there is nothing to rewrite yet; a version this build does not
 * know throws, which leaves the data untouched and refuses activation.
 */
export async function migrateMapsData(_storage: MapStorage, from: number): Promise<void> {
  if (from === DATA_VERSION) return;
  throw new Error(`Maps cannot migrate data from version ${from}`);
}
