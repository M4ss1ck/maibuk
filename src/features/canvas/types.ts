import { createDefaultCanvasDocData } from "@/lib/canvas/defaultDoc";

export { CURRENT_CANVAS_SCHEMA_VERSION } from "@/lib/canvas/defaultDoc";

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasPosition = {
  x: number;
  y: number;
};

export type BaseCanvasNode = {
  id: string;
  position: CanvasPosition;
};

export type LightweightCanvasNode = BaseCanvasNode & {
  kind: "text";
  html: string;
  textColor?: string;
  backgroundColor?: string;
  width?: number;
};

export type NoteRefCanvasNode = BaseCanvasNode & {
  kind: "noteRef";
  noteId: string;
  label?: string;
};

export type ImageCanvasNode = BaseCanvasNode & {
  kind: "image";
  /** The picture embedded as a `data:image/` URL; never a hotlink. */
  src: string;
  /** Width in Canvas units. */
  width: number;
  /** Height in Canvas units. */
  height: number;
  alt?: string;
  fileName?: string;
};

export type CanvasNode = LightweightCanvasNode | NoteRefCanvasNode | ImageCanvasNode;

export type CanvasToolMode = "select" | "pen" | "eraser" | "textNode" | "noteRef";

/** The tools that place one item and then return to Select. */
export function isPlacementTool(mode: CanvasToolMode): boolean {
  return mode === "textNode" || mode === "noteRef";
}

/** A just-placed Text Node, and the revision it was placed at. */
export type PristineTextNode = { id: string; revision: number };

/** The swatches offered by the pen and Connection color pickers. */
export const CANVAS_COLOR_PRESETS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export const CONNECTION_WIDTHS = [1, 2, 4, 6] as const;

export type ConnectionWidth = (typeof CONNECTION_WIDTHS)[number];

export const DEFAULT_CONNECTION_WIDTH: ConnectionWidth = 1;

export const CONNECTION_LINE_STYLES = ["solid", "dashed", "dotted"] as const;

export type ConnectionLineStyle = (typeof CONNECTION_LINE_STYLES)[number];

/** A hovered swatch color, shown on a Connection before it is committed. */
export type EdgeColorPreview = { edgeId: string; color: string };

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  directed?: boolean;
  /** Stroke color; unset means the theme default. */
  color?: string;
  /** Stroke width; unset means DEFAULT_CONNECTION_WIDTH. */
  width?: ConnectionWidth;
  /** Stroke pattern; unset means solid. */
  lineStyle?: ConnectionLineStyle;
};

export type CanvasStroke = {
  id: string;
  points: CanvasPosition[];
  color: string;
  width: number;
};

export type CanvasDoc = {
  schemaVersion: number;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  strokes: CanvasStroke[];
  viewport: CanvasViewport;
};

export type Canvas = {
  id: string;
  title: string;
  doc: CanvasDoc;
  pinned: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  contentUpdatedAt: number;
};

export type UpdateTextNodePatch = Partial<
  Pick<LightweightCanvasNode, "html" | "textColor" | "backgroundColor" | "width">
>;

export type ResizeTextNodeInput = {
  position: CanvasPosition;
  width: number;
};

export type UpdateNoteRefNodePatch = Partial<Pick<NoteRefCanvasNode, "noteId" | "label">>;

export type UpdateImageNodePatch = Partial<
  Pick<ImageCanvasNode, "src" | "width" | "height" | "alt" | "fileName" | "position">
>;

/** What the Canvas Image dialog is open for: placing a picture, replacing one, or its alt text. */
export type CanvasImageDialogTarget =
  | { kind: "place"; position: CanvasPosition }
  | { kind: "replace"; nodeId: string }
  | { kind: "altText"; nodeId: string };

export type UpdateEdgePatch = Partial<
  Pick<
    CanvasEdge,
    "label" | "directed" | "sourceHandle" | "targetHandle" | "color" | "width" | "lineStyle"
  >
>;

export type CreateCanvasInput = {
  title?: string;
};

export type UpdateCanvasInput = {
  title?: string;
  pinned?: boolean;
  order?: number;
};

export type ReorderCanvasItem = {
  id: string;
  order: number;
};

export function createDefaultCanvasDoc(): CanvasDoc {
  return createDefaultCanvasDocData();
}
