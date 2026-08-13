import { CURRENT_CANVAS_SCHEMA_VERSION } from "@/lib/canvas/defaultDoc";
import {
  createDefaultCanvasDoc,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPosition,
  type CanvasStroke,
  type CanvasViewport,
} from "@/features/canvas/types";

export type CanvasDocLoadErrorCode = "corrupt-json" | "unsupported-version" | "invalid-shape";

export type CanvasDocLoadError = {
  code: CanvasDocLoadErrorCode;
  message: string;
  cause?: unknown;
};

export type ParseCanvasDocResult =
  | { ok: true; doc: CanvasDoc; migrated: boolean }
  | { ok: false; doc: CanvasDoc; error: CanvasDocLoadError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizedOptionalWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 160 ? value : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function isFinitePosition(value: unknown): value is CanvasPosition {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

export function isValidCanvasStroke(value: unknown): value is CanvasStroke {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.points) &&
    value.points.length >= 1 &&
    value.points.every(isFinitePosition) &&
    typeof value.color === "string" &&
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    value.width > 0
  );
}

export function normalizeStroke(stroke: CanvasStroke): CanvasStroke {
  return {
    id: stroke.id,
    points: stroke.points.map((p) => ({ x: p.x, y: p.y })),
    color: stroke.color,
    width: stroke.width,
  };
}

export function isValidCanvasNode(value: unknown): value is CanvasNode {
  if (!isRecord(value) || typeof value.id !== "string" || !isFinitePosition(value.position)) {
    return false;
  }

  if (value.kind === "text") return typeof value.html === "string";
  if (value.kind === "noteRef") return typeof value.noteId === "string";
  return false;
}

export function isValidCanvasEdge(value: unknown): value is CanvasEdge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string"
  );
}

export function normalizeViewport(value: unknown): CanvasViewport {
  if (!isRecord(value)) return createDefaultCanvasDoc().viewport;
  const { x, y, zoom } = value;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return createDefaultCanvasDoc().viewport;
  }
  return { x, y, zoom };
}

function normalizeNode(node: CanvasNode): CanvasNode {
  if (node.kind === "text") {
    return {
      id: node.id,
      kind: "text",
      position: { ...node.position },
      html: node.html,
      textColor: normalizedOptionalString(node.textColor),
      backgroundColor: normalizedOptionalString(node.backgroundColor),
      width: normalizedOptionalWidth(node.width),
    };
  }

  return {
    id: node.id,
    kind: "noteRef",
    position: { ...node.position },
    noteId: node.noteId,
    label: normalizedOptionalString(node.label),
  };
}

function migrateToCurrent(
  value: Record<string, unknown>,
  fromVersion: number
): {
  value: Record<string, unknown>;
  migrated: boolean;
} {
  let migrated = false;
  let nodes = Array.isArray(value.nodes) ? value.nodes : [];
  let strokes = Array.isArray(value.strokes) ? value.strokes : [];

  if (fromVersion < 2) {
    migrated = true;
    nodes = nodes.map((node) => {
      if (isRecord(node) && node.kind === "text" && typeof node.text === "string") {
        const { text, ...rest } = node;
        return { ...rest, html: `<p>${escapeHtml(text)}</p>` };
      }
      return node;
    });
    strokes = [];
  }

  if (fromVersion < 3) {
    migrated = true;
    nodes = nodes.map((node) => {
      if (!isRecord(node) || node.kind !== "text") return node;
      const { color, ...rest } = node;
      return { ...rest, textColor: color };
    });
  }

  return { value: { ...value, nodes, strokes }, migrated };
}

function normalizeEdge(edge: CanvasEdge): CanvasEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: normalizedOptionalString(edge.sourceHandle),
    targetHandle: normalizedOptionalString(edge.targetHandle),
    label: normalizedOptionalString(edge.label),
    directed: typeof edge.directed === "boolean" ? edge.directed : undefined,
  };
}

export function normalizeParsedCanvasDoc(value: unknown): ParseCanvasDocResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      doc: createDefaultCanvasDoc(),
      error: { code: "invalid-shape", message: "Canvas document must be an object" },
    };
  }

  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return {
      ok: false,
      doc: createDefaultCanvasDoc(),
      error: { code: "invalid-shape", message: "Canvas document has an invalid schema version" },
    };
  }

  if (schemaVersion > CURRENT_CANVAS_SCHEMA_VERSION) {
    return {
      ok: false,
      doc: createDefaultCanvasDoc(),
      error: {
        code: "unsupported-version",
        message: `Canvas schema version ${schemaVersion} is not supported`,
      },
    };
  }

  const { value: source, migrated } = migrateToCurrent(value, schemaVersion);

  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
    return {
      ok: false,
      doc: createDefaultCanvasDoc(),
      error: { code: "invalid-shape", message: "Canvas document nodes and edges must be arrays" },
    };
  }

  const nodes = source.nodes.filter(isValidCanvasNode).map(normalizeNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = source.edges
    .filter(isValidCanvasEdge)
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map(normalizeEdge);
  const strokes = (Array.isArray(source.strokes) ? source.strokes : [])
    .filter(isValidCanvasStroke)
    .map(normalizeStroke);

  return {
    ok: true,
    migrated,
    doc: {
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes,
      edges,
      strokes,
      viewport: normalizeViewport(source.viewport),
    },
  };
}

export function parseCanvasDoc(raw: string | null | undefined): ParseCanvasDocResult {
  if (raw == null || raw.trim().length === 0) {
    return { ok: true, doc: createDefaultCanvasDoc(), migrated: false };
  }

  try {
    return normalizeParsedCanvasDoc(JSON.parse(raw));
  } catch (cause) {
    return {
      ok: false,
      doc: createDefaultCanvasDoc(),
      error: { code: "corrupt-json", message: "Canvas document contains invalid JSON", cause },
    };
  }
}

export function serializeCanvasDoc(doc: CanvasDoc): string {
  return JSON.stringify(doc);
}
