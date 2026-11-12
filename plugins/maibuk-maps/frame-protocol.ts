/**
 * The Maps Frame wire protocol (#745): the messages the Map editor page and its
 * drawing Frame exchange over the Frame's MessagePort. The host never parses
 * them (`docs/plugins/frame-ui.md`), so this file is the one place both sides
 * agree on. The Frame script mirrors these shapes as JSDoc typedefs and cannot
 * import this module: a Frame script is a classic script in an opaque origin,
 * so a relative import would fail closed.
 *
 * The Worker sends the whole scene on every change and when a Frame connects,
 * and the author's PDF Font once as the Frame connects; it asks the Frame to
 * rasterize an export SVG, since only the Frame's document has a canvas, and to
 * clean and measure one uploaded picture, since only it has a DOM. An uploaded
 * picture's bytes travel to the Frame once per asset, the way the font does.
 * The Frame reports a finished Pencil stroke, a finished Pen line, a finished
 * Area Fill outline, an
 * Eraser
 * drag, a drawn Shape, a Bucket pour, a dropped Stamp, a picked Element, a
 * Select drag that moved one, a Map Label's bend dragged from its handle, the
 * pixels an export asked for, and what one uploaded picture measured. Points
 * are page millimetres, the same space as `page.widthMm/heightMm`. Every
 * inbound message is validated here, and a malformed one is dropped. This
 * module imports only its own files.
 */

import type { MapAssetMime } from "./assets";
import type { MapDocument, MapPoint, ShapeKind } from "./maps";
import { isShapeKind } from "./maps";
import { canMove, type SceneShape, sceneRender } from "./scene";
import { resolveColor, styleOf } from "./styles";

/** The editor tool the Frame should honour. */
export type MapTool =
  | "select"
  | "pencil"
  | "pen"
  | "bucket"
  | "area"
  | "eraser"
  | "insert"
  | ShapeKind;

/** One Element as the Frame draws it: its render primitives, its flags, and its selection. */
export interface FrameSceneElement {
  id: string;
  /**
   * The paths and text the Frame draws, from `sceneShapes`; empty for an
   * Element with nothing to draw yet. A path carries the Clip Path id that
   * keeps it inside its Fill's area when it is a scattered Stamp, and a
   * hit-only path, such as a Map Label's baseline, only marks where its Element
   * can be picked.
   */
  shapes: SceneShape[];
  /** The Soft Edge filter the Element draws with, or null for a sharp edge. */
  filter: string | null;
  hidden: boolean;
  locked: boolean;
  selected: boolean;
  /**
   * Whether a Select drag may move it (#766): a shown, unlocked Map Line or
   * Stamp, the same rule the Worker applies to a drag. The Frame previews a
   * drag only for these, so it never shows a move the Worker would refuse.
   */
  movable: boolean;
  /**
   * The fields a Map Label's bend handle needs (#751): where its baseline sits,
   * how long and how turned it is, and the sagitta it arches by. Absent on
   * every other Element.
   */
  label?: FrameLabelLayout;
}

/** The baseline a Map Label's bend handle is placed on and dragged against. */
export interface FrameLabelLayout {
  x: number;
  y: number;
  /** The baseline's turn, in degrees clockwise about (x, y). */
  rotation: number;
  /** The baseline chord's length, in page millimetres. */
  width: number;
  /** The signed sagitta the baseline bows by, in page millimetres. */
  bend: number;
}

/**
 * The surface's accessible name while a Pen line is in progress, in the app
 * language, with `{{count}}` where the point count goes. The Frame cannot read
 * the Plugin's catalogs and counts its own draft, so the Worker sends both
 * plural forms and the Frame picks by count: `one` for a count of 1, `other` for
 * everything else, the categories both shipped languages use.
 */
export interface PenDraftLabel {
  one: string;
  other: string;
}

/** Worker -> Frame: the whole scene to draw, plus the view the author is using. */
export interface FrameSceneMessage {
  kind: "scene";
  widthMm: number;
  heightMm: number;
  /** The page background colour. */
  background: string;
  elements: FrameSceneElement[];
  /**
   * The SVG definitions the shapes reference (#750): the texture patterns, the
   * scatter Clip Paths, and the Soft Edge filters. They arrive as the markup
   * `sceneToSvg` writes, so the Frame and the export use one definition of each.
   */
  defs: string[];
  tool: MapTool;
  zoom: number;
  panX: number;
  panY: number;
  /** The surface's accessible name while a Pen line is in progress. */
  penLabel: PenDraftLabel;
}

/**
 * Worker -> Frame: the author's PDF Font (#751), sent once when the Frame
 * connects. `bytes` is the installed font's regular style file, read through the
 * Plugin API's `fonts.read`; the Frame registers it as `family`, which is the
 * family a Map Label set to `pdf` asks for. A device with no PDF Font installed
 * sends none, and the label draws in a serif.
 */
export interface FrameFontMessage {
  kind: "font";
  family: string;
  bytes: ArrayBuffer;
}

/**
 * Worker -> Frame: an uploaded picture's bytes (#756), sent once per asset the
 * way the PDF Font is sent once. `data` is base64, so the Frame can keep the
 * picture as a `blob:` URL under `id` and a scene can name it by id instead of
 * carrying a picture through every scene message.
 */
export interface FrameAssetMessage {
  kind: "asset";
  id: string;
  mime: MapAssetMime;
  /** The picture's bytes, base64-encoded, exactly as the Library stores them. */
  data: string;
}

/**
 * Worker -> Frame: clean and measure one uploaded picture (#756). The Worker
 * has no DOM: the Frame is where an untrusted SVG is sanitized and where a
 * raster is decoded for its intrinsic size, before the Library keeps anything.
 */
export interface IngestAssetMessage {
  kind: "ingest-asset";
  requestId: number;
  mime: MapAssetMime;
  /** The uploaded bytes, base64-encoded, as the file arrived. */
  data: string;
}

/**
 * Frame -> Worker: what one `ingest-asset` produced. `data` is the bytes the
 * Library keeps, base64: the sanitized markup of an SVG, or the uploaded bytes
 * of a raster. `recolorable` says whether the picture draws in a single paint,
 * so a Custom Stamp can tint it.
 */
export interface AssetIngestedMessage {
  kind: "asset-ingested";
  requestId: number;
  data: string;
  /** The picture's intrinsic width in pixels. */
  width: number;
  /** The picture's intrinsic height in pixels. */
  height: number;
  recolorable: boolean;
}

/** Frame -> Worker: why an upload could not be ingested, under its `requestId`. */
export interface IngestErrorMessage {
  kind: "ingest-error";
  requestId: number;
  reason: "invalid-image";
}

/** Every message the Worker may send the Frame. */
export type WorkerToFrameMessage =
  | FrameSceneMessage
  | FrameFontMessage
  | FrameRasterizeMessage
  | FrameAssetMessage
  | IngestAssetMessage;

/** The picture a rasterize request asks for: PNG, or JPEG at a quality. */
export type RasterFormat = "png" | { jpeg: number };

/**
 * Worker -> Frame: draw one export SVG into a canvas of `widthPx` by `heightPx`
 * and answer with the encoded picture (#753). The Worker has no DOM and its CSP
 * refuses images; the Frame's page does not, so the rasterizing happens there.
 * `requestId` names the reply, because two exports can be in flight at once.
 */
export interface FrameRasterizeMessage {
  kind: "rasterize";
  requestId: number;
  svg: string;
  widthPx: number;
  heightPx: number;
  format: RasterFormat;
}

/** Frame -> Worker: the encoded picture one rasterize request asked for. */
export interface FrameRasterizedMessage {
  kind: "rasterized";
  requestId: number;
  bytes: ArrayBuffer;
}

/** Frame -> Worker: why a rasterize request could not be answered. */
export interface FrameRasterizeErrorMessage {
  kind: "rasterized";
  requestId: number;
  error: string;
}

/** Frame -> Worker: a finished Pencil stroke, in page millimetres. */
export interface FrameStrokeMessage {
  kind: "stroke";
  points: MapPoint[];
}

/**
 * Frame -> Worker: a finished Pen line. `curves` carries one flag per segment,
 * the same count a Map Line keeps: `points.length - 1`, plus the closing
 * segment when `closed`.
 */
export interface FrameLineMessage {
  kind: "line";
  points: MapPoint[];
  curves: boolean[];
  closed: boolean;
}

/**
 * Frame -> Worker: an Area Fill's outline (#750), which always closes. A
 * freehand outline carries the raw pointer points with no `curves` and the
 * Worker smooths them exactly as the Pencil does; a point-by-point outline
 * carries `curves` with one flag per segment, the closing one included.
 */
export interface FrameAreaMessage {
  kind: "area";
  points: MapPoint[];
  /** One flag per segment of a point-by-point outline; empty for a freehand stroke. */
  curves: boolean[];
  /** Whether the points are a raw freehand stroke to smooth, or a point-by-point outline. */
  freehand: boolean;
}

/** Frame -> Worker: one Eraser drag and how far it reaches. */
export interface FrameEraseMessage {
  kind: "erase";
  points: MapPoint[];
  radiusMm: number;
}

/** Frame -> Worker: the Element the author picked, or none. */
export interface FrameSelectMessage {
  kind: "select";
  id: string | null;
}

/**
 * Frame -> Worker: a Shape drawn by dragging between two page-millimetre
 * corners (#747). `constrain` is Shift, which squares the box on its longer side.
 */
export interface FrameShapeMessage {
  kind: "shape";
  shape: ShapeKind;
  start: MapPoint;
  end: MapPoint;
  constrain: boolean;
}

/**
 * Frame -> Worker: a Bucket pour at one page point (#748). The point is where
 * the author clicked, tapped, or left the keyboard crosshair, and the Worker
 * pours the current Fill colour into the face it falls in.
 */
export interface FramePourMessage {
  kind: "pour";
  point: MapPoint;
}

/**
 * Frame -> Worker: a Stamp dropped at one page point by the Insert tool (#749).
 * The point is where the author clicked or tapped, and the Worker centres the
 * Stamp it has picked there.
 */
export interface FrameInsertMessage {
  kind: "insert";
  point: MapPoint;
}

/**
 * Frame -> Worker: a Select drag that moved one Element by `dx`, `dy` page
 * millimetres (#766). The Frame previews the drag itself and sends this once,
 * on release, so the whole drag is one undo step; a press that never passed
 * the drag threshold, or one Escape cancelled, sends none.
 */
export interface FrameMoveMessage {
  kind: "move";
  id: string;
  dx: number;
  dy: number;
}

/**
 * Frame -> Worker: a Map Label's bend dragged from its handle (#751). `bend` is
 * the signed sagitta the pointer asks for, in page millimetres, so the whole
 * drag is one message and one undo step. A press that leaves the bend where it
 * was sends none.
 */
export interface FrameBendMessage {
  kind: "bendLabel";
  id: string;
  bend: number;
}

/** Every message a Frame may send the Worker. */
export type FrameToWorkerMessage =
  | FrameStrokeMessage
  | FrameLineMessage
  | FrameAreaMessage
  | FrameEraseMessage
  | FrameSelectMessage
  | FrameShapeMessage
  | FramePourMessage
  | FrameInsertMessage
  | FrameMoveMessage
  | FrameBendMessage
  | FrameRasterizedMessage
  | FrameRasterizeErrorMessage
  | AssetIngestedMessage
  | IngestErrorMessage;

function isPoint(value: unknown): value is MapPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

/** Whether a value is a finite number a picture may be measured by. */
function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Reads one inbound Frame message, or returns null when it is malformed and
 * must be dropped. A stroke needs a list of finite `[x, y]` pairs; a stroke of
 * fewer than two points is still well formed, and the editor simply draws no
 * line from it. A Pen line also needs a flag per segment and a boolean
 * `closed`; an Area Fill needs a boolean `freehand`, and no `curves` at all
 * when it is freehand, else one flag per segment of its closed outline; an
 * Eraser drag needs at least one point and a finite reach; a Shape
 * needs a known kind, two finite corners, and a boolean `constrain`; a pour or
 * an insert needs one finite page point; a move needs an Element id and a
 * finite offset; a bend needs an Element id and a finite bend; a rasterize
 * reply needs a finite request id and either an `ArrayBuffer` of bytes or a
 * non-empty error, never both; an ingest reply needs a finite request id and
 * either a positive picture size with its bytes and whether it draws in one
 * paint, or the single reason an upload was refused.
 */
export function parseFrameMessage(data: unknown): FrameToWorkerMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.kind === "stroke") {
    if (!Array.isArray(message.points) || !message.points.every(isPoint)) return null;
    return { kind: "stroke", points: message.points.map(([x, y]) => [x, y]) };
  }
  if (message.kind === "line") {
    if (!Array.isArray(message.points) || message.points.length < 2) return null;
    if (!message.points.every(isPoint)) return null;
    if (typeof message.closed !== "boolean") return null;
    const segments = message.points.length - 1 + (message.closed ? 1 : 0);
    if (
      !Array.isArray(message.curves) ||
      message.curves.length !== segments ||
      !message.curves.every((flag) => typeof flag === "boolean")
    ) {
      return null;
    }
    return {
      kind: "line",
      points: message.points.map(([x, y]) => [x, y]),
      curves: message.curves.map((flag) => flag === true),
      closed: message.closed,
    };
  }
  if (message.kind === "area") {
    if (!Array.isArray(message.points) || message.points.length < 2) return null;
    if (!message.points.every(isPoint)) return null;
    if (typeof message.freehand !== "boolean") return null;
    if (!Array.isArray(message.curves)) return null;
    const segments = message.freehand ? 0 : message.points.length;
    if (
      message.curves.length !== segments ||
      !message.curves.every((flag) => typeof flag === "boolean")
    ) {
      return null;
    }
    return {
      kind: "area",
      points: message.points.map(([x, y]) => [x, y]),
      curves: message.curves.map((flag) => flag === true),
      freehand: message.freehand,
    };
  }
  if (message.kind === "erase") {
    if (!Array.isArray(message.points) || message.points.length === 0) return null;
    if (!message.points.every(isPoint)) return null;
    if (
      typeof message.radiusMm !== "number" ||
      !Number.isFinite(message.radiusMm) ||
      message.radiusMm < 0
    ) {
      return null;
    }
    return {
      kind: "erase",
      points: message.points.map(([x, y]) => [x, y]),
      radiusMm: message.radiusMm,
    };
  }
  if (message.kind === "select") {
    if (message.id !== null && typeof message.id !== "string") return null;
    return { kind: "select", id: message.id };
  }
  if (message.kind === "shape") {
    if (!isShapeKind(message.shape)) return null;
    if (!isPoint(message.start) || !isPoint(message.end)) return null;
    if (typeof message.constrain !== "boolean") return null;
    return {
      kind: "shape",
      shape: message.shape,
      start: [message.start[0], message.start[1]],
      end: [message.end[0], message.end[1]],
      constrain: message.constrain,
    };
  }
  if (message.kind === "pour") {
    if (!isPoint(message.point)) return null;
    return { kind: "pour", point: [message.point[0], message.point[1]] };
  }
  if (message.kind === "insert") {
    if (!isPoint(message.point)) return null;
    return { kind: "insert", point: [message.point[0], message.point[1]] };
  }
  if (message.kind === "move") {
    if (typeof message.id !== "string" || message.id === "") return null;
    if (typeof message.dx !== "number" || !Number.isFinite(message.dx)) return null;
    if (typeof message.dy !== "number" || !Number.isFinite(message.dy)) return null;
    return { kind: "move", id: message.id, dx: message.dx, dy: message.dy };
  }
  if (message.kind === "bendLabel") {
    if (typeof message.id !== "string" || message.id === "") return null;
    if (typeof message.bend !== "number" || !Number.isFinite(message.bend)) return null;
    return { kind: "bendLabel", id: message.id, bend: message.bend };
  }
  if (message.kind === "rasterized") {
    if (typeof message.requestId !== "number" || !Number.isFinite(message.requestId)) return null;
    if (message.bytes !== undefined) {
      if (!(message.bytes instanceof ArrayBuffer)) return null;
      // One answer is either the picture or the reason, never both.
      if (message.error !== undefined) return null;
      return { kind: "rasterized", requestId: message.requestId, bytes: message.bytes };
    }
    if (typeof message.error === "string" && message.error !== "") {
      return { kind: "rasterized", requestId: message.requestId, error: message.error };
    }
    return null;
  }
  if (message.kind === "asset-ingested") {
    if (typeof message.requestId !== "number" || !Number.isFinite(message.requestId)) return null;
    if (typeof message.data !== "string" || message.data === "") return null;
    if (!isPositiveNumber(message.width) || !isPositiveNumber(message.height)) return null;
    if (typeof message.recolorable !== "boolean") return null;
    return {
      kind: "asset-ingested",
      requestId: message.requestId,
      data: message.data,
      width: message.width,
      height: message.height,
      recolorable: message.recolorable,
    };
  }
  if (message.kind === "ingest-error") {
    if (typeof message.requestId !== "number" || !Number.isFinite(message.requestId)) return null;
    if (message.reason !== "invalid-image") return null;
    return { kind: "ingest-error", requestId: message.requestId, reason: "invalid-image" };
  }
  return null;
}

/**
 * The rasterize request the Worker sends one Frame (#753): the export SVG, the
 * pixel size to draw it at, and the format. The Frame answers with the bytes,
 * or an error, under the same `requestId`.
 */
export function rasterizeMessage(
  requestId: number,
  svg: string,
  size: { widthPx: number; heightPx: number },
  format: RasterFormat
): FrameRasterizeMessage {
  return {
    kind: "rasterize",
    requestId,
    svg,
    widthPx: size.widthPx,
    heightPx: size.heightPx,
    format,
  };
}

/** The scene one open Map sends its Frame. */
export function sceneMessage(
  map: Pick<MapDocument, "page" | "elements"> & { styleId?: string },
  view: {
    selectedId: string | null;
    tool: MapTool;
    zoom: number;
    panX: number;
    panY: number;
    /** The localized Pen draft label's plural forms, with `{{count}}` for the point count. */
    penLabel: PenDraftLabel;
  }
): FrameSceneMessage {
  const style = styleOf(map.styleId);
  const render = sceneRender(map.elements, map.page.widthMm, map.page.heightMm, style);
  return {
    kind: "scene",
    widthMm: map.page.widthMm,
    heightMm: map.page.heightMm,
    background: resolveColor(style, undefined, "water"),
    elements: map.elements.map((element, index) => ({
      id: element.id,
      shapes: render.shapes[index],
      filter: render.filters[index],
      hidden: element.hidden,
      locked: element.locked,
      selected: element.id === view.selectedId,
      movable: !element.hidden && canMove(element),
      // A Map Label carries the baseline its bend handle is placed on; no other
      // Element has a curve to drag.
      ...(element.kind === "label"
        ? {
            label: {
              x: element.x,
              y: element.y,
              rotation: element.rotation,
              width: element.width,
              bend: element.bend,
            },
          }
        : {}),
    })),
    defs: render.defs,
    tool: view.tool,
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
    penLabel: view.penLabel,
  };
}
