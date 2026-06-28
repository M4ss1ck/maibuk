export const CURRENT_CANVAS_SCHEMA_VERSION = 1;

export type DefaultCanvasDocData = {
  schemaVersion: number;
  nodes: [];
  edges: [];
  viewport: { x: number; y: number; zoom: number };
};

export function createDefaultCanvasDocData(): DefaultCanvasDocData {
  return {
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

export const DEFAULT_CANVAS_DOC_JSON = JSON.stringify(createDefaultCanvasDocData());
