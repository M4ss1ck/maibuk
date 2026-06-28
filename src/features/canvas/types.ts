import { createDefaultCanvasDocData } from "../../lib/canvas/defaultDoc";

export { CURRENT_CANVAS_SCHEMA_VERSION } from "../../lib/canvas/defaultDoc";

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
  color?: string;
};

export type NoteRefCanvasNode = BaseCanvasNode & {
  kind: "noteRef";
  noteId: string;
  label?: string;
};

export type CanvasNode = LightweightCanvasNode | NoteRefCanvasNode;

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  directed?: boolean;
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

export type UpdateTextNodePatch = Partial<Pick<LightweightCanvasNode, "html" | "color">>;

export type UpdateNoteRefNodePatch = Partial<Pick<NoteRefCanvasNode, "noteId" | "label">>;

export type UpdateEdgePatch = Partial<
  Pick<CanvasEdge, "label" | "directed" | "sourceHandle" | "targetHandle">
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
