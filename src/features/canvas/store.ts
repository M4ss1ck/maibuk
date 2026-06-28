import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import { recordTombstone } from "../sync/tombstones";
import { parseCanvasDoc, serializeCanvasDoc, type CanvasDocLoadError } from "./serialization";
import {
  createDefaultCanvasDoc,
  type Canvas,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPosition,
  type CanvasStroke,
  type CanvasViewport,
  type CreateCanvasInput,
  type ReorderCanvasItem,
  type UpdateCanvasInput,
  type UpdateEdgePatch,
  type UpdateNoteRefNodePatch,
  type UpdateTextNodePatch,
} from "./types";

const HISTORY_LIMIT = 100;

export type CanvasLoadState = "idle" | "loading" | "ready" | "missing" | "error";
export type CanvasSaveState = "idle" | "saving" | "error";

function generateId(): string {
  return crypto.randomUUID();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cloneDoc(doc: CanvasDoc): CanvasDoc {
  return structuredClone(doc);
}

function sortCanvases(canvases: Canvas[]): Canvas[] {
  return [...canvases].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return b.updatedAt - a.updatedAt;
  });
}

function toModel(row: Record<string, unknown>, doc: CanvasDoc): Canvas {
  return {
    id: row.id as string,
    title: row.title as string,
    doc,
    pinned: Boolean(row.pinned),
    order: row.order as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    contentUpdatedAt: (row.content_updated_at as number | null) ?? (row.updated_at as number),
  };
}

function hasNode(doc: CanvasDoc, id: string | null): boolean {
  return id !== null && doc.nodes.some((node) => node.id === id);
}

function hasEdge(doc: CanvasDoc, id: string | null): boolean {
  return id !== null && doc.edges.some((edge) => edge.id === id);
}

function capHistory(history: CanvasDoc[]): CanvasDoc[] {
  return history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history;
}

function editorResetState() {
  return {
    current: null,
    doc: createDefaultCanvasDoc(),
    selectedNodeId: null,
    selectedEdgeId: null,
    loadState: "idle" as CanvasLoadState,
    saveState: "idle" as CanvasSaveState,
    editorError: null,
    docLoadError: null,
    docWriteBlocked: false,
    corruptDocReplacementAllowed: false,
    editorReadOnly: false,
    dirty: false,
    revision: 0,
    savedRevision: 0,
    past: [],
    future: [],
    liveBaseDoc: null,
  };
}

export interface CanvasStoreState {
  canvases: Canvas[];
  galleryLoaded: boolean;
  galleryLoading: boolean;
  galleryError: string | null;
  current: Canvas | null;
  doc: CanvasDoc;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  loadState: CanvasLoadState;
  saveState: CanvasSaveState;
  editorError: string | null;
  docLoadError: CanvasDocLoadError | null;
  docWriteBlocked: boolean;
  corruptDocReplacementAllowed: boolean;
  editorReadOnly: boolean;
  dirty: boolean;
  revision: number;
  savedRevision: number;
  past: CanvasDoc[];
  future: CanvasDoc[];
  liveBaseDoc: CanvasDoc | null;
  toolMode: "select" | "pen" | "eraser";
  penWidth: number;
  penColor: string;
  addStroke: (stroke: CanvasStroke) => void;
  removeStroke: (id: string) => void;
  setToolMode: (mode: "select" | "pen" | "eraser") => void;
  setPenWidth: (width: number) => void;
  setPenColor: (color: string) => void;
  loadCanvases: () => Promise<void>;
  createCanvas: (input?: CreateCanvasInput) => Promise<Canvas>;
  deleteCanvas: (id: string) => Promise<void>;
  renameCanvas: (id: string, title: string) => Promise<void>;
  updateCanvas: (id: string, input: UpdateCanvasInput) => Promise<void>;
  reorderCanvases: (items: ReorderCanvasItem[]) => Promise<void>;
  loadCanvas: (id: string) => Promise<void>;
  closeCanvas: () => void;
  resetEditorState: () => void;
  commit: (next: CanvasDoc) => void;
  undo: () => void;
  redo: () => void;
  beginLiveChange: () => void;
  moveNodeLive: (id: string, position: CanvasPosition) => void;
  endLiveChange: () => void;
  addNode: (node: CanvasNode) => void;
  updateTextNode: (id: string, patch: UpdateTextNodePatch) => void;
  updateNoteRefNode: (id: string, patch: UpdateNoteRefNodePatch) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: CanvasEdge) => void;
  updateEdge: (id: string, patch: UpdateEdgePatch) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  setViewport: (viewport: CanvasViewport) => void;
  replaceCorruptDocWithDefault: () => Promise<void>;
  persistCorruptDocReplacement: (canvasId: string, doc: CanvasDoc) => Promise<void>;
  persistCanvas: (canvasId: string, doc: CanvasDoc, revision: number) => Promise<void>;
  persistCurrent: () => Promise<void>;
  markSaved: (revision: number) => void;
}

export const useCanvasStore = create<CanvasStoreState>((set, get) => ({
  canvases: [],
  galleryLoaded: false,
  galleryLoading: false,
  galleryError: null,
  ...editorResetState(),
  toolMode: "select",
  penWidth: 3,
  penColor: "#ef4444",

  loadCanvases: async () => {
    set({ galleryLoading: true, galleryError: null });
    try {
      const db = await getDatabase();
      const rows = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM canvases ORDER BY pinned DESC, "order" ASC, updated_at DESC',
      );
      const canvases = rows.map((row) => toModel(row, parseCanvasDoc(row.doc as string).doc));
      set({ canvases: sortCanvases(canvases), galleryLoaded: true, galleryLoading: false });
    } catch (error) {
      set({ galleryError: String(error), galleryLoading: false });
    }
  },

  createCanvas: async (input = {}) => {
    const db = await getDatabase();
    const id = generateId();
    const now = nowSeconds();
    const doc = createDefaultCanvasDoc();
    const rows = await db.select<{ max_order: number | null }[]>(
      'SELECT MAX("order") AS max_order FROM canvases',
    );
    const canvas: Canvas = {
      id,
      title: input.title ?? "",
      doc,
      pinned: false,
      order: (rows[0]?.max_order ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
      contentUpdatedAt: now,
    };
    await db.execute(
      'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        canvas.id,
        canvas.title,
        serializeCanvasDoc(canvas.doc),
        0,
        canvas.order,
        now,
        now,
        now,
      ],
    );
    set((state) => ({ canvases: sortCanvases([...state.canvases, canvas]) }));
    return canvas;
  },

  deleteCanvas: async (id) => {
    const db = await getDatabase();
    const rows = await db.select<{ title: string }[]>("SELECT title FROM canvases WHERE id = ?", [id]);
    if (rows[0]) {
      await recordTombstone({ entityType: "canvas", entityId: id, title: rows[0].title });
    }
    await db.execute("DELETE FROM canvases WHERE id = ?", [id]);
    set((state) => ({
      canvases: state.canvases.filter((canvas) => canvas.id !== id),
      ...(state.current?.id === id ? editorResetState() : {}),
    }));
  },

  renameCanvas: async (id, title) => get().updateCanvas(id, { title }),

  updateCanvas: async (id, input) => {
    const db = await getDatabase();
    const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM canvases WHERE id = ?", [id]);
    if (!rows[0]) return;
    const parsed = parseCanvasDoc(rows[0].doc as string);
    const existing = toModel(rows[0], parsed.doc);
    const now = nowSeconds();
    const updated: Canvas = {
      ...existing,
      ...input,
      updatedAt: now,
      contentUpdatedAt:
        input.title !== undefined && input.title !== existing.title ? now : existing.contentUpdatedAt,
    };
    await db.execute(
      'UPDATE canvases SET title = ?, pinned = ?, "order" = ?, updated_at = ?, content_updated_at = ? WHERE id = ?',
      [
        updated.title,
        updated.pinned ? 1 : 0,
        updated.order,
        updated.updatedAt,
        updated.contentUpdatedAt,
        id,
      ],
    );
    set((state) => ({
      canvases: sortCanvases(state.canvases.map((canvas) => (canvas.id === id ? updated : canvas))),
      current: state.current?.id === id ? { ...state.current, ...updated, doc: state.doc } : state.current,
    }));
  },

  reorderCanvases: async (items) => {
    const db = await getDatabase();
    const now = nowSeconds();
    for (const item of items) {
      await db.execute('UPDATE canvases SET "order" = ?, updated_at = ? WHERE id = ?', [
        item.order,
        now,
        item.id,
      ]);
    }
    const orderById = new Map(items.map((item) => [item.id, item.order]));
    set((state) => ({
      canvases: sortCanvases(
        state.canvases.map((canvas) => {
          const order = orderById.get(canvas.id);
          return order === undefined ? canvas : { ...canvas, order, updatedAt: now };
        }),
      ),
    }));
  },

  loadCanvas: async (id) => {
    set({
      ...editorResetState(),
      loadState: "loading",
    });
    try {
      const db = await getDatabase();
      const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM canvases WHERE id = ?", [id]);
      if (!rows[0]) {
        set({ loadState: "missing" });
        return;
      }
      const result = parseCanvasDoc(rows[0].doc as string);
      const current = toModel(rows[0], result.doc);
      if (!result.ok) {
        set({
          current,
          doc: result.doc,
          loadState: "error",
          docLoadError: result.error,
          docWriteBlocked: true,
          editorReadOnly: true,
        });
        return;
      }
      set({ current, doc: result.doc, loadState: "ready" });
    } catch (error) {
      set({ loadState: "error", editorError: String(error), editorReadOnly: true });
    }
  },

  closeCanvas: () => set({ ...editorResetState(), toolMode: "select" }),
  resetEditorState: () => set(editorResetState()),

  commit: (next) => {
    const state = get();
    if (state.editorReadOnly || next === state.doc) return;
    const past = capHistory([...state.past, cloneDoc(state.doc)]);
    set({
      doc: next,
      past,
      future: [],
      dirty: true,
      revision: state.revision + 1,
      ...(!state.docWriteBlocked ? { docLoadError: null } : {}),
    });
  },

  undo: () => {
    const state = get();
    if (state.editorReadOnly || state.past.length === 0) return;
    const previous = cloneDoc(state.past[state.past.length - 1]);
    set({
      doc: previous,
      past: state.past.slice(0, -1),
      future: [cloneDoc(state.doc), ...state.future],
      dirty: true,
      revision: state.revision + 1,
      liveBaseDoc: null,
      selectedNodeId: hasNode(previous, state.selectedNodeId) ? state.selectedNodeId : null,
      selectedEdgeId: hasEdge(previous, state.selectedEdgeId) ? state.selectedEdgeId : null,
    });
  },

  redo: () => {
    const state = get();
    if (state.editorReadOnly || state.future.length === 0) return;
    const next = cloneDoc(state.future[0]);
    set({
      doc: next,
      future: state.future.slice(1),
      past: capHistory([...state.past, cloneDoc(state.doc)]),
      dirty: true,
      revision: state.revision + 1,
      liveBaseDoc: null,
      selectedNodeId: hasNode(next, state.selectedNodeId) ? state.selectedNodeId : null,
      selectedEdgeId: hasEdge(next, state.selectedEdgeId) ? state.selectedEdgeId : null,
    });
  },

  beginLiveChange: () => {
    const state = get();
    if (state.editorReadOnly || state.liveBaseDoc) return;
    set({ liveBaseDoc: cloneDoc(state.doc) });
  },

  moveNodeLive: (id, position) => {
    const state = get();
    if (state.editorReadOnly || !state.liveBaseDoc) return;
    const node = state.doc.nodes.find((candidate) => candidate.id === id);
    if (!node || (node.position.x === position.x && node.position.y === position.y)) return;
    set({
      doc: {
        ...state.doc,
        nodes: state.doc.nodes.map((candidate) =>
          candidate.id === id ? { ...candidate, position: { ...position } } : candidate,
        ),
      },
      dirty: true,
      revision: state.revision + 1,
    });
  },

  endLiveChange: () => {
    const state = get();
    if (!state.liveBaseDoc) return;
    const changed = state.doc.nodes.some((node) => {
      const baseNode = state.liveBaseDoc?.nodes.find((candidate) => candidate.id === node.id);
      return (
        baseNode !== undefined &&
        (baseNode.position.x !== node.position.x || baseNode.position.y !== node.position.y)
      );
    });
    set({
      liveBaseDoc: null,
      ...(changed
        ? { past: capHistory([...state.past, state.liveBaseDoc]), future: [] }
        : {}),
    });
  },

  addNode: (node) => {
    const state = get();
    if (state.editorReadOnly) return;
    const id = node.id || generateId();
    if (state.doc.nodes.some((candidate) => candidate.id === id)) return;
    get().commit({ ...state.doc, nodes: [...state.doc.nodes, { ...node, id }] });
  },

  updateTextNode: (id, patch) => {
    const state = get();
    const node = state.doc.nodes.find((candidate) => candidate.id === id);
    if (!node || node.kind !== "text") return;
    const color = patch.color === "" ? undefined : patch.color;
    if (
      (patch.html === undefined || patch.html === node.html) &&
      (patch.color === undefined || color === node.color)
    ) {
      return;
    }
    get().commit({
      ...state.doc,
      nodes: state.doc.nodes.map((candidate) =>
        candidate.id === id ? { ...node, ...patch, color } : candidate,
      ),
    });
  },

  updateNoteRefNode: (id, patch) => {
    const state = get();
    const node = state.doc.nodes.find((candidate) => candidate.id === id);
    if (!node || node.kind !== "noteRef") return;
    const label = patch.label?.trim() || undefined;
    if (
      (patch.noteId === undefined || patch.noteId === node.noteId) &&
      (patch.label === undefined || label === node.label)
    ) {
      return;
    }
    get().commit({
      ...state.doc,
      nodes: state.doc.nodes.map((candidate) =>
        candidate.id === id ? { ...node, ...patch, label } : candidate,
      ),
    });
  },

  removeNode: (id) => {
    const state = get();
    if (!state.doc.nodes.some((node) => node.id === id)) return;
    const removedEdgeIds = new Set(
      state.doc.edges
        .filter((edge) => edge.source === id || edge.target === id)
        .map((edge) => edge.id),
    );
    get().commit({
      ...state.doc,
      nodes: state.doc.nodes.filter((node) => node.id !== id),
      edges: state.doc.edges.filter((edge) => !removedEdgeIds.has(edge.id)),
    });
    set({
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      selectedEdgeId:
        state.selectedEdgeId && removedEdgeIds.has(state.selectedEdgeId)
          ? null
          : state.selectedEdgeId,
    });
  },

  addEdge: (edge) => {
    const state = get();
    if (
      state.editorReadOnly ||
      !hasNode(state.doc, edge.source) ||
      !hasNode(state.doc, edge.target)
    ) {
      return;
    }
    const duplicate = state.doc.edges.some(
      (candidate) =>
        candidate.source === edge.source &&
        candidate.target === edge.target &&
        (candidate.sourceHandle ?? null) === (edge.sourceHandle ?? null) &&
        (candidate.targetHandle ?? null) === (edge.targetHandle ?? null),
    );
    if (duplicate) return;
    const id = edge.id || generateId();
    if (state.doc.edges.some((candidate) => candidate.id === id)) return;
    get().commit({ ...state.doc, edges: [...state.doc.edges, { ...edge, id }] });
  },

  addStroke: (stroke) => {
    const state = get();
    if (state.editorReadOnly) return;
    const id = stroke.id || generateId();
    if (state.doc.strokes.some((candidate) => candidate.id === id)) return;
    get().commit({ ...state.doc, strokes: [...state.doc.strokes, { ...stroke, id }] });
  },

  removeStroke: (id) => {
    const state = get();
    if (!state.doc.strokes.some((stroke) => stroke.id === id)) return;
    get().commit({
      ...state.doc,
      strokes: state.doc.strokes.filter((stroke) => stroke.id !== id),
    });
  },

  setToolMode: (toolMode) => set({ toolMode }),
  setPenWidth: (penWidth) => set({ penWidth }),
  setPenColor: (penColor) => set({ penColor }),

  updateEdge: (id, patch) => {
    const state = get();
    const edge = state.doc.edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    const normalized = {
      ...patch,
      ...(patch.label !== undefined ? { label: patch.label.trim() || undefined } : {}),
    };
    const changed =
      ("label" in patch && normalized.label !== edge.label) ||
      ("directed" in patch && normalized.directed !== edge.directed) ||
      ("sourceHandle" in patch && normalized.sourceHandle !== edge.sourceHandle) ||
      ("targetHandle" in patch && normalized.targetHandle !== edge.targetHandle);
    if (!changed) return;
    get().commit({
      ...state.doc,
      edges: state.doc.edges.map((candidate) =>
        candidate.id === id ? { ...candidate, ...normalized } : candidate,
      ),
    });
  },

  removeEdge: (id) => {
    const state = get();
    if (!state.doc.edges.some((edge) => edge.id === id)) return;
    get().commit({ ...state.doc, edges: state.doc.edges.filter((edge) => edge.id !== id) });
    if (state.selectedEdgeId === id) set({ selectedEdgeId: null });
  },

  selectNode: (id) => set({ selectedNodeId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedNodeId: null }),
  clearSelection: () => set({ selectedNodeId: null, selectedEdgeId: null }),
  deleteSelection: () => {
    const { selectedNodeId, selectedEdgeId } = get();
    if (selectedNodeId) get().removeNode(selectedNodeId);
    else if (selectedEdgeId) get().removeEdge(selectedEdgeId);
  },

  setViewport: (viewport) => {
    const state = get();
    if (
      state.editorReadOnly ||
      (state.doc.viewport.x === viewport.x &&
        state.doc.viewport.y === viewport.y &&
        state.doc.viewport.zoom === viewport.zoom)
    ) {
      return;
    }
    set({
      doc: { ...state.doc, viewport: { ...viewport } },
      dirty: true,
      revision: state.revision + 1,
    });
  },

  replaceCorruptDocWithDefault: async () => {
    const state = get();
    if (!state.current || !state.docLoadError) return;
    const replacementDoc = createDefaultCanvasDoc();
    const replacementRevision = state.revision + 1;
    set({
      doc: replacementDoc,
      corruptDocReplacementAllowed: true,
      docWriteBlocked: false,
      editorReadOnly: false,
      loadState: "ready",
      dirty: true,
      revision: replacementRevision,
      past: [],
      future: [],
      liveBaseDoc: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      saveState: "saving",
    });
    try {
      await get().persistCorruptDocReplacement(state.current.id, replacementDoc);
      set({
        docLoadError: null,
        corruptDocReplacementAllowed: false,
        dirty: false,
        savedRevision: replacementRevision,
        saveState: "idle",
      });
    } catch (error) {
      set({
        docWriteBlocked: true,
        editorReadOnly: true,
        corruptDocReplacementAllowed: false,
        saveState: "error",
        editorError: String(error),
      });
    }
  },

  persistCorruptDocReplacement: async (canvasId, doc) => {
    const state = get();
    if (!state.corruptDocReplacementAllowed || state.current?.id !== canvasId) {
      throw new Error("Canvas document replacement is not allowed");
    }
    const db = await getDatabase();
    const now = nowSeconds();
    await db.execute(
      "UPDATE canvases SET doc = ?, updated_at = ?, content_updated_at = ? WHERE id = ?",
      [serializeCanvasDoc(doc), now, now, canvasId],
    );
  },

  persistCanvas: async (canvasId, doc, revision) => {
    const state = get();
    if (
      state.current?.id !== canvasId ||
      state.docWriteBlocked ||
      state.editorReadOnly ||
      state.docLoadError ||
      state.corruptDocReplacementAllowed
    ) {
      return;
    }
    set({ saveState: "saving", editorError: null });
    try {
      const db = await getDatabase();
      const now = nowSeconds();
      await db.execute(
        "UPDATE canvases SET doc = ?, updated_at = ?, content_updated_at = ? WHERE id = ?",
        [serializeCanvasDoc(doc), now, now, canvasId],
      );
      if (get().current?.id !== canvasId) return;
      set((currentState) => ({
        canvases: currentState.canvases.map((canvas) =>
          canvas.id === canvasId
            ? { ...canvas, doc, updatedAt: now, contentUpdatedAt: now }
            : canvas,
        ),
        current:
          currentState.current?.id === canvasId
            ? { ...currentState.current, doc, updatedAt: now, contentUpdatedAt: now }
            : currentState.current,
      }));
      get().markSaved(revision);
    } catch (error) {
      if (get().current?.id === canvasId) {
        set({ saveState: "error", editorError: String(error), dirty: true });
      }
    }
  },

  persistCurrent: async () => {
    const state = get();
    if (
      !state.current ||
      state.docWriteBlocked ||
      state.editorReadOnly ||
      state.docLoadError ||
      state.corruptDocReplacementAllowed
    ) {
      return;
    }
    await get().persistCanvas(state.current.id, cloneDoc(state.doc), state.revision);
  },

  markSaved: (revision) => {
    const state = get();
    if (state.revision === revision) {
      set({ dirty: false, savedRevision: revision, saveState: "idle" });
    } else {
      set({ savedRevision: Math.max(state.savedRevision, revision), saveState: "idle" });
    }
  },
}));
