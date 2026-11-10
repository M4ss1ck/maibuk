/**
 * The Maps Frame wire protocol (#745): the messages the Map editor page and its
 * drawing Frame exchange over the Frame's MessagePort. The host never parses
 * them (`docs/plugins/frame-ui.md`), so this file is the one place both sides
 * agree on. The Frame script mirrors these shapes as JSDoc typedefs and cannot
 * import this module: a Frame script is a classic script in an opaque origin,
 * so a relative import would fail closed.
 *
 * The Worker sends the whole scene on every change and when a Frame connects;
 * the Frame reports a finished Pencil stroke, a finished Pen line, an Eraser
 * drag, a drawn Shape, and a picked Element. Points are page millimetres, the
 * same space as `page.widthMm/heightMm`. Every inbound message is validated
 * here, and a malformed one is dropped. This module imports only its own files.
 */

import type { MapDocument, MapPoint, ShapeKind } from "./maps";
import { isShapeKind } from "./maps";
import { EMPTY_MAP_COLOR, type LineShape, lineShapes } from "./scene";

/** The editor tool the Frame should honour. */
export type MapTool = "select" | "pencil" | "pen" | "eraser" | ShapeKind;

/** One Element as the Frame draws it: its render primitives, its flags, and its selection. */
export interface FrameSceneElement {
  id: string;
  /** The paths the Frame strokes and fills, from `lineShapes`; empty for an Element with no path yet. */
  shapes: LineShape[];
  hidden: boolean;
  locked: boolean;
  selected: boolean;
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
  tool: MapTool;
  zoom: number;
  panX: number;
  panY: number;
  /** The surface's accessible name while a Pen line is in progress. */
  penLabel: PenDraftLabel;
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

/** Every message a Frame may send the Worker. */
export type FrameToWorkerMessage =
  | FrameStrokeMessage
  | FrameLineMessage
  | FrameEraseMessage
  | FrameSelectMessage
  | FrameShapeMessage;

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

/**
 * Reads one inbound Frame message, or returns null when it is malformed and
 * must be dropped. A stroke needs a list of finite `[x, y]` pairs; a stroke of
 * fewer than two points is still well formed, and the editor simply draws no
 * line from it. A Pen line also needs a flag per segment and a boolean
 * `closed`; an Eraser drag needs at least one point and a finite reach; a Shape
 * needs a known kind, two finite corners, and a boolean `constrain`.
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
  return null;
}

/** The scene one open Map sends its Frame. */
export function sceneMessage(
  map: Pick<MapDocument, "page" | "elements">,
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
  return {
    kind: "scene",
    widthMm: map.page.widthMm,
    heightMm: map.page.heightMm,
    background: EMPTY_MAP_COLOR,
    elements: map.elements.map((element) => ({
      id: element.id,
      shapes: element.kind === "line" ? lineShapes(element) : [],
      hidden: element.hidden,
      locked: element.locked,
      selected: element.id === view.selectedId,
    })),
    tool: view.tool,
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
    penLabel: view.penLabel,
  };
}
