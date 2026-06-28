export const CURRENT_CANVAS_SCHEMA_VERSION = 2;

export type DefaultCanvasDocData = {
  schemaVersion: number;
  nodes: [];
  edges: [];
  strokes: [];
  viewport: { x: number; y: number; zoom: number };
};

export function createDefaultCanvasDocData(): DefaultCanvasDocData {
  return {
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export const DEFAULT_CANVAS_DOC_JSON = JSON.stringify(createDefaultCanvasDocData());
