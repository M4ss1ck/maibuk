import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createDefaultCanvasDoc } from "../../../../features/canvas/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { useCanvasStore } = await import("../../../../features/canvas/store");

async function insertCanvas(
  id: string,
  doc: string,
  options: { title?: string; pinned?: boolean; order?: number } = {},
) {
  await testDb.execute(
    'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, 1)',
    [id, options.title ?? id, doc, options.pinned ? 1 : 0, options.order ?? 0],
  );
}

const textNode = (id: string, x = 0) => ({
  id,
  kind: "text" as const,
  html: `<p>${id}</p>`,
  position: { x, y: 0 },
});

describe("useCanvasStore", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    useCanvasStore.getState().resetEditorState();
    useCanvasStore.setState({
      canvases: [],
      galleryLoaded: false,
      galleryLoading: false,
      galleryError: null,
    });
  });

  it("creates a canvas with the default document", async () => {
    const canvas = await useCanvasStore.getState().createCanvas({ title: "Map" });
    expect(canvas.doc).toEqual(createDefaultCanvasDoc());
    const rows = await testDb.select<Record<string, unknown>[]>(
      "SELECT title, doc FROM canvases WHERE id = ?",
      [canvas.id],
    );
    expect(rows).toEqual([{ title: "Map", doc: JSON.stringify(createDefaultCanvasDoc()) }]);
  });

  it("loads and sorts pinned canvases by order", async () => {
    const raw = JSON.stringify(createDefaultCanvasDoc());
    await insertCanvas("later", raw, { order: 2 });
    await insertCanvas("pinned", raw, { pinned: true, order: 5 });
    await insertCanvas("first", raw, { order: 1 });
    await useCanvasStore.getState().loadCanvases();
    expect(useCanvasStore.getState().canvases.map((canvas) => canvas.id)).toEqual([
      "pinned",
      "first",
      "later",
    ]);
  });

  it("loads parsed JSON and resets stale editor state", async () => {
    const doc = { ...createDefaultCanvasDoc(), nodes: [textNode("fresh")] };
    await insertCanvas("canvas", JSON.stringify(doc));
    useCanvasStore.setState({
      selectedNodeId: "stale",
      selectedEdgeId: "stale-edge",
      past: [createDefaultCanvasDoc()],
      future: [createDefaultCanvasDoc()],
      liveBaseDoc: createDefaultCanvasDoc(),
    });
    await useCanvasStore.getState().loadCanvas("canvas");
    const state = useCanvasStore.getState();
    expect(state.doc).toEqual(doc);
    expect(state.loadState).toBe("ready");
    expect([state.selectedNodeId, state.selectedEdgeId, state.liveBaseDoc]).toEqual([
      null,
      null,
      null,
    ]);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
  });

  it.each([
    ["corrupt", "{"],
    ["future", JSON.stringify({ ...createDefaultCanvasDoc(), schemaVersion: 99 })],
  ])("write-blocks %s documents", async (id, raw) => {
    await insertCanvas(id, raw);
    await useCanvasStore.getState().loadCanvas(id);
    const state = useCanvasStore.getState();
    expect(state.loadState).toBe("error");
    expect(state.docLoadError).not.toBeNull();
    expect(state.docWriteBlocked).toBe(true);
    expect(state.editorReadOnly).toBe(true);
    expect(state.dirty).toBe(false);
  });

  it("refuses normal persistence while write-blocked", async () => {
    await insertCanvas("bad", "{");
    await useCanvasStore.getState().loadCanvas("bad");
    await useCanvasStore.getState().persistCurrent();
    const rows = await testDb.select<{ doc: string }[]>("SELECT doc FROM canvases WHERE id = 'bad'");
    expect(rows[0].doc).toBe("{");
  });

  it("replaces a corrupt document only through explicit recovery", async () => {
    await insertCanvas("bad", "{");
    await useCanvasStore.getState().loadCanvas("bad");
    await useCanvasStore.getState().replaceCorruptDocWithDefault();
    const state = useCanvasStore.getState();
    expect(state.docLoadError).toBeNull();
    expect(state.docWriteBlocked).toBe(false);
    expect(state.dirty).toBe(false);
    const rows = await testDb.select<{ doc: string }[]>("SELECT doc FROM canvases WHERE id = 'bad'");
    expect(rows[0].doc).toBe(JSON.stringify(createDefaultCanvasDoc()));
  });

  it("commits node edits with one history entry and a revision", () => {
    useCanvasStore.setState({ loadState: "ready" });
    useCanvasStore.getState().addNode(textNode("a"));
    const state = useCanvasStore.getState();
    expect(state.doc.nodes).toHaveLength(1);
    expect(state.past).toHaveLength(1);
    expect(state.revision).toBe(1);
    expect(state.dirty).toBe(true);
  });

  it("kind-specific update actions ignore the wrong node kind", () => {
    useCanvasStore.setState({ loadState: "ready" });
    useCanvasStore.getState().addNode({
      id: "ref",
      kind: "noteRef",
      noteId: "note",
      position: { x: 0, y: 0 },
    });
    const revision = useCanvasStore.getState().revision;
    useCanvasStore.getState().updateTextNode("ref", { html: "<p>wrong</p>" });
    expect(useCanvasStore.getState().revision).toBe(revision);
    expect(useCanvasStore.getState().doc.nodes[0]).not.toHaveProperty("html");
  });

  it("adds and removes strokes through history", () => {
    const store = useCanvasStore.getState();
    store.addStroke({
      id: "s1",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      color: "#000",
      width: 2,
    });
    expect(useCanvasStore.getState().doc.strokes.map((s) => s.id)).toEqual(["s1"]);
    store.removeStroke("s1");
    expect(useCanvasStore.getState().doc.strokes).toEqual([]);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.strokes.map((s) => s.id)).toEqual(["s1"]);
  });

  it("tool mode and pen settings are transient (no doc revision change)", () => {
    const before = useCanvasStore.getState().revision;
    useCanvasStore.getState().setToolMode("pen");
    useCanvasStore.getState().setPenWidth(8);
    useCanvasStore.getState().setPenColor("#ff0000");
    const s = useCanvasStore.getState();
    expect(s.toolMode).toBe("pen");
    expect(s.penWidth).toBe(8);
    expect(s.penColor).toBe("#ff0000");
    expect(s.revision).toBe(before);
  });

  it("updates a text node's html", () => {
    const store = useCanvasStore.getState();
    store.addNode({
      id: "t1",
      kind: "text",
      html: "<p>a</p>",
      position: { x: 0, y: 0 },
    });
    store.updateTextNode("t1", { html: "<p>b</p>" });
    const node = useCanvasStore.getState().doc.nodes.find((n) => n.id === "t1");
    expect(node?.kind === "text" && node.html).toBe("<p>b</p>");
  });

  it("validates edges, preserves handles, and prevents duplicate connections", () => {
    useCanvasStore.setState({ loadState: "ready" });
    useCanvasStore.getState().addNode(textNode("a"));
    useCanvasStore.getState().addNode(textNode("b"));
    useCanvasStore.getState().addEdge({
      id: "edge",
      source: "a",
      target: "b",
      sourceHandle: "out",
      targetHandle: "in",
    });
    useCanvasStore.getState().addEdge({
      id: "duplicate",
      source: "a",
      target: "b",
      sourceHandle: "out",
      targetHandle: "in",
      label: "ignored",
    });
    useCanvasStore.getState().addEdge({ id: "bad", source: "a", target: "missing" });
    expect(useCanvasStore.getState().doc.edges).toEqual([
      expect.objectContaining({ id: "edge", sourceHandle: "out", targetHandle: "in" }),
    ]);
  });

  it("deletes a node and connected edges in one undoable step", () => {
    useCanvasStore.setState({ loadState: "ready" });
    const store = useCanvasStore.getState();
    store.addNode(textNode("a"));
    store.addNode(textNode("b"));
    store.addEdge({ id: "edge", source: "a", target: "b" });
    const historyBefore = useCanvasStore.getState().past.length;
    useCanvasStore.getState().removeNode("a");
    expect(useCanvasStore.getState().doc.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(useCanvasStore.getState().doc.edges).toEqual([]);
    expect(useCanvasStore.getState().past).toHaveLength(historyBefore + 1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().doc.nodes.map((node) => node.id)).toContain("a");
    expect(useCanvasStore.getState().doc.edges).toHaveLength(1);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().doc.nodes.map((node) => node.id)).toEqual(["b"]);
  });

  it("caps history at 100 snapshots", () => {
    useCanvasStore.setState({ loadState: "ready" });
    for (let index = 0; index < 105; index++) {
      useCanvasStore.getState().addNode(textNode(String(index)));
    }
    expect(useCanvasStore.getState().past).toHaveLength(100);
  });

  it("creates exactly one undo step for a live drag", () => {
    useCanvasStore.setState({ loadState: "ready" });
    useCanvasStore.getState().addNode(textNode("a"));
    const before = useCanvasStore.getState().past.length;
    useCanvasStore.getState().beginLiveChange();
    useCanvasStore.getState().moveNodeLive("a", { x: 1, y: 0 });
    useCanvasStore.getState().moveNodeLive("a", { x: 2, y: 0 });
    useCanvasStore.getState().moveNodeLive("a", { x: 3, y: 0 });
    useCanvasStore.getState().endLiveChange();
    expect(useCanvasStore.getState().past).toHaveLength(before + 1);
  });

  it("does not create history for a live drag with no movement", () => {
    useCanvasStore.setState({ loadState: "ready" });
    useCanvasStore.getState().addNode(textNode("a"));
    const before = useCanvasStore.getState().past.length;
    useCanvasStore.getState().beginLiveChange();
    useCanvasStore.getState().endLiveChange();
    expect(useCanvasStore.getState().past).toHaveLength(before);
  });

  it("does not expose a non-drag position update action", () => {
    expect(useCanvasStore.getState()).not.toHaveProperty("updateNodePosition");
  });

  it("persists viewport without adding undo history", () => {
    const before = useCanvasStore.getState().past.length;
    useCanvasStore.getState().setViewport({ x: 5, y: 6, zoom: 2 });
    expect(useCanvasStore.getState().doc.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(useCanvasStore.getState().past).toHaveLength(before);
    expect(useCanvasStore.getState().revision).toBe(1);
  });

  it("keeps selection exclusive and deletes through deleteSelection", () => {
    useCanvasStore.getState().addNode(textNode("a"));
    useCanvasStore.getState().addNode(textNode("b"));
    useCanvasStore.getState().addEdge({ id: "edge", source: "a", target: "b" });
    useCanvasStore.getState().selectNode("a");
    expect(useCanvasStore.getState().selectedEdgeId).toBeNull();
    useCanvasStore.getState().selectEdge("edge");
    expect(useCanvasStore.getState().selectedNodeId).toBeNull();
    useCanvasStore.getState().deleteSelection();
    expect(useCanvasStore.getState().doc.edges).toEqual([]);
    expect(useCanvasStore.getState().doc.nodes).toHaveLength(2);
  });

  it("updates an edge label and directed flag", () => {
    useCanvasStore.getState().addNode(textNode("a"));
    useCanvasStore.getState().addNode(textNode("b"));
    useCanvasStore.getState().addEdge({ id: "edge", source: "a", target: "b" });
    useCanvasStore.getState().updateEdge("edge", { label: "Leads to", directed: true });
    expect(useCanvasStore.getState().doc.edges[0]).toMatchObject({
      label: "Leads to",
      directed: true,
    });
    useCanvasStore.getState().updateEdge("edge", { label: "   " });
    expect(useCanvasStore.getState().doc.edges[0].label).toBeUndefined();
  });

  it("writes JSON and marks only the matching revision saved", async () => {
    const canvas = await useCanvasStore.getState().createCanvas();
    await useCanvasStore.getState().loadCanvas(canvas.id);
    useCanvasStore.getState().addNode(textNode("a"));
    await useCanvasStore.getState().persistCurrent();
    const state = useCanvasStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.savedRevision).toBe(state.revision);
    const rows = await testDb.select<{ doc: string }[]>("SELECT doc FROM canvases WHERE id = ?", [
      canvas.id,
    ]);
    expect(JSON.parse(rows[0].doc).nodes).toHaveLength(1);
  });

  it("cannot save a delayed snapshot for canvas A into canvas B", async () => {
    const a = await useCanvasStore.getState().createCanvas({ title: "A" });
    const b = await useCanvasStore.getState().createCanvas({ title: "B" });
    await useCanvasStore.getState().loadCanvas(b.id);
    const snapshot = { ...createDefaultCanvasDoc(), nodes: [textNode("from-a")] };
    await useCanvasStore.getState().persistCanvas(a.id, snapshot, 1);
    const rows = await testDb.select<{ id: string; doc: string }[]>(
      "SELECT id, doc FROM canvases ORDER BY title",
    );
    expect(rows.map((row) => JSON.parse(row.doc).nodes)).toEqual([[], []]);
  });

  it("leaves dirty state and exposes an error after a write failure", async () => {
    const canvas = await useCanvasStore.getState().createCanvas();
    await useCanvasStore.getState().loadCanvas(canvas.id);
    useCanvasStore.getState().addNode(textNode("a"));
    vi.spyOn(testDb, "execute").mockRejectedValueOnce(new Error("disk full"));
    await useCanvasStore.getState().persistCurrent();
    expect(useCanvasStore.getState()).toMatchObject({ dirty: true, saveState: "error" });
  });

  it("resets all editor and recovery state on close", async () => {
    await insertCanvas("bad", "{");
    await useCanvasStore.getState().loadCanvas("bad");
    useCanvasStore.getState().closeCanvas();
    expect(useCanvasStore.getState()).toMatchObject({
      current: null,
      loadState: "idle",
      docLoadError: null,
      docWriteBlocked: false,
      editorReadOnly: false,
      selectedNodeId: null,
      selectedEdgeId: null,
      past: [],
      future: [],
      liveBaseDoc: null,
    });
  });
});
