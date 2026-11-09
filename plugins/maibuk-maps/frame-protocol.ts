/**
 * The Maps Frame wire protocol (#745): the messages the Map editor page and its
 * drawing Frame exchange over the Frame's MessagePort. The host never parses
 * them (`docs/plugins/frame-ui.md`), so this file is the one place both sides
 * agree on. The Frame script mirrors these shapes as JSDoc typedefs and cannot
 * import this module: a Frame script is a classic script in an opaque origin,
 * so a relative import would fail closed.
 *
 * The Worker sends the whole scene on every change and when a Frame connects;
 * the Frame reports a finished Pencil stroke and a picked Element. Points are
 * page millimetres, the same space as `page.widthMm/heightMm`. Every inbound
 * message is validated here, and a malformed one is dropped. This module
 * imports only its own files.
 */

import type { MapDocument, MapPoint } from "./maps";
import { EMPTY_MAP_COLOR, linePath } from "./scene";

/** The editor tool the Frame should honour. */
export type MapTool = "select" | "pencil";

/** One Element as the Frame draws it: the path, its flags, and its selection. */
export interface FrameSceneElement {
  id: string;
  /** The SVG path `d`, from `linePath`; empty for an Element with no path yet. */
  d: string;
  hidden: boolean;
  locked: boolean;
  selected: boolean;
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
}

/** Frame -> Worker: a finished Pencil stroke, in page millimetres. */
export interface FrameStrokeMessage {
  kind: "stroke";
  points: MapPoint[];
}

/** Frame -> Worker: the Element the author picked, or none. */
export interface FrameSelectMessage {
  kind: "select";
  id: string | null;
}

/** Every message a Frame may send the Worker. */
export type FrameToWorkerMessage = FrameStrokeMessage | FrameSelectMessage;

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
 * line from it.
 */
export function parseFrameMessage(data: unknown): FrameToWorkerMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.kind === "stroke") {
    if (!Array.isArray(message.points) || !message.points.every(isPoint)) return null;
    return { kind: "stroke", points: message.points.map(([x, y]) => [x, y]) };
  }
  if (message.kind === "select") {
    if (message.id !== null && typeof message.id !== "string") return null;
    return { kind: "select", id: message.id };
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
  }
): FrameSceneMessage {
  return {
    kind: "scene",
    widthMm: map.page.widthMm,
    heightMm: map.page.heightMm,
    background: EMPTY_MAP_COLOR,
    elements: map.elements.map((element) => ({
      id: element.id,
      d: element.kind === "line" ? linePath(element.points) : "",
      hidden: element.hidden,
      locked: element.locked,
      selected: element.id === view.selectedId,
    })),
    tool: view.tool,
    zoom: view.zoom,
    panX: view.panX,
    panY: view.panY,
  };
}
