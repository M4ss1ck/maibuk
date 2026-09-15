import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createDefaultCanvasDoc } from "@/features/canvas/types";
import { createTestDatabase } from "@/test/support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
const flowProps = vi.hoisted(() => ({
  current: null as null | { nodes: unknown[]; defaultViewport: unknown },
}));
const mocks = vi.hoisted(() => ({
  loadBooks: vi.fn(),
  loadNotes: vi.fn(),
}));

vi.mock("../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ReactFlow: (props: { nodes: unknown[]; defaultViewport: unknown }) => {
      flowProps.current = { nodes: props.nodes, defaultViewport: props.defaultViewport };
      return <div data-testid="flow" />;
    },
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fitView: vi.fn(),
    }),
    useStore: (selector: (state: { transform: number[] }) => unknown) =>
      selector({ transform: [0, 0, 1] }),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../lib/shortcuts", () => ({ useShortcuts: () => {} }));

vi.mock("../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ books: [], loadBooks: mocks.loadBooks }),
}));

vi.mock("../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: [], loadNotes: mocks.loadNotes }),
}));

vi.mock("../../../features/theme", () => ({
  useThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ theme: "light" }),
}));

vi.mock("../../../features/canvas/CanvasToolPanel", () => ({
  CanvasToolPanel: () => null,
}));
vi.mock("../../../features/canvas/EdgeInspectorCard", () => ({
  EdgeInspectorCard: () => null,
}));
vi.mock("../../../features/canvas/NodeColorPanel", () => ({
  NodeColorPanel: () => null,
}));
vi.mock("../../../features/canvas/PenSettingsPanel", () => ({
  PenSettingsPanel: () => null,
}));
vi.mock("../../../features/canvas/drawing/CanvasDrawingLayer", () => ({
  CanvasDrawingLayer: () => null,
}));
vi.mock("../../../features/canvas/drawing/DrawingCaptureOverlay", () => ({
  DrawingCaptureOverlay: () => null,
}));

// The header now hosts the real sync button; keep edit-session tests isolated
// from the sync flow while still accepting its contextual scope wiring.
vi.mock("@/components/sync/SyncStatusButton", () => ({
  SyncStatusButton: (_props: { defaultScope?: string }) => <button type="button">sync</button>,
}));

const { Canvas } = await import("@/pages/Canvas");
const { useCanvasStore } = await import("@/features/canvas/store");
const { useReadingPositionStore } = await import("@/features/reading-position/store");
const { resetChangeFeedForTests } = await import("@/features/sync/change-feed");
const { resetViewRefreshForTests } = await import("@/features/sync/view-refresh");

const CANVAS_ID = "session-canvas";

async function insertCanvas(id: string, doc: string, title = id): Promise<void> {
  await testDb.execute(
    'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, 0, 0, 1000, 1000, 1000)',
    [id, title, doc]
  );
}

async function storedDoc(id: string): Promise<Record<string, unknown>> {
  const rows = await testDb.select<{ doc: string }[]>("SELECT doc FROM canvases WHERE id = ?", [
    id,
  ]);
  return JSON.parse(rows[0].doc) as Record<string, unknown>;
}

function renderCanvas(id: string = CANVAS_ID) {
  return render(
    <MemoryRouter initialEntries={[`/canvas/${id}`]}>
      <Routes>
        <Route path="/canvas/:canvasId" element={<Canvas />} />
      </Routes>
    </MemoryRouter>
  );
}

async function settle(): Promise<void> {
  await act(async () => {});
}

/** Flush microtask chains until the editor settles (flow or error screen). */
async function settleRender(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await act(async () => {});
    if (
      screen.queryByTestId("flow") ??
      screen.queryByText("canvas.newerCanvasTitle") ??
      screen.queryByText("canvas.corruptDocTitle") ??
      screen.queryByText("canvas.missingCanvas")
    ) {
      return;
    }
  }
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(testDb);
  resetChangeFeedForTests();
  resetViewRefreshForTests();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useCanvasStore.getState().closeCanvas();
  useCanvasStore.setState({
    canvases: [],
    galleryLoaded: false,
    galleryLoading: false,
    galleryError: null,
  });
  useReadingPositionStore.setState({ canvasViewports: {} });
  flowProps.current = null;
});

afterEach(async () => {
  await settle();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetViewRefreshForTests();
  useCanvasStore.getState().closeCanvas();
});

describe("Canvas Edit Session", () => {
  it("saves edits after a pause through the write path", async () => {
    await insertCanvas(CANVAS_ID, JSON.stringify(createDefaultCanvasDoc()), "Map");
    renderCanvas();
    await settleRender();
    expect(screen.getByTestId("flow")).toBeInTheDocument();

    act(() => {
      useCanvasStore.getState().addNode({
        id: "n1",
        kind: "text",
        html: "<p>Hello</p>",
        position: { x: 0, y: 0 },
      });
    });
    const saveDocSpy = vi.spyOn(useCanvasStore.getState(), "saveDoc");
    expect(screen.getByRole("status")).toHaveTextContent("canvas.unsaved");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await settle();
    // The debounced save resolves through the shared write queue; wait for it.
    const lastSave = saveDocSpy.mock.results[saveDocSpy.mock.results.length - 1];
    if (lastSave) await act(async () => void (await lastSave.value));
    await settle();

    const doc = await storedDoc(CANVAS_ID);
    expect(doc.nodes).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("canvas.saved");
  });

  it("viewport moves are not content and never save", async () => {
    await insertCanvas(CANVAS_ID, JSON.stringify(createDefaultCanvasDoc()), "Map");
    renderCanvas();
    await settleRender();
    expect(screen.getByTestId("flow")).toBeInTheDocument();

    act(() => {
      useCanvasStore.getState().setViewport({ x: 40, y: 50, zoom: 2 });
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await settle();

    const rows = await testDb.select<{ updated_at: number }[]>(
      "SELECT updated_at FROM canvases WHERE id = ?",
      [CANVAS_ID]
    );
    expect(rows[0].updated_at).toBe(1000);
    expect(screen.getByRole("status")).toHaveTextContent("canvas.saved");
  });

  it("flushes unsaved edits on unmount", async () => {
    await insertCanvas(CANVAS_ID, JSON.stringify(createDefaultCanvasDoc()), "Map");
    const rendered = renderCanvas();
    await settleRender();
    expect(screen.getByTestId("flow")).toBeInTheDocument();

    act(() => {
      useCanvasStore.getState().addNode({
        id: "n1",
        kind: "text",
        html: "<p>Bye</p>",
        position: { x: 0, y: 0 },
      });
    });
    await act(async () => {
      rendered.unmount();
    });
    await settle();

    const doc = await storedDoc(CANVAS_ID);
    expect(doc.nodes).toHaveLength(1);
  });

  it("a remote Change replaces the open content and is never saved back", async () => {
    const { installViewRefresh } = await import("@/features/sync/view-refresh");
    const { emitChange } = await import("@/features/sync/change-feed");
    const { applyCanvasSnapshotData } = await import("@/features/canvas/write");
    await insertCanvas(CANVAS_ID, JSON.stringify(createDefaultCanvasDoc()), "Map");
    renderCanvas();
    await settleRender();
    expect(screen.getByTestId("flow")).toBeInTheDocument();
    const stop = installViewRefresh();

    await act(async () => {
      await applyCanvasSnapshotData(
        {
          canvas: {
            id: CANVAS_ID,
            title: "Map",
            pinned: false,
            order: 0,
            doc: {
              schemaVersion: 3,
              nodes: [
                { id: "remote-1", kind: "text", html: "<p>Remote</p>", position: { x: 1, y: 1 } },
              ],
              edges: [],
              strokes: [],
            },
            createdAt: 1000,
            updatedAt: 2000,
            contentUpdatedAt: 2000,
          },
        },
        "remote"
      );
      await emitChange({ entity: "canvas", id: CANVAS_ID, origin: "remote", kind: "content" });
    });
    await settle();

    expect(
      useCanvasStore.getState().doc.nodes.map((node) => node.id)
    ).toEqual(["remote-1"]);
    // Let the session run past its save delay: nothing local to save, so the
    // pulled doc stands and no clock moves.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await settle();
    const doc = await storedDoc(CANVAS_ID);
    expect((doc.nodes as unknown[])).toHaveLength(1);
    const rows = await testDb.select<{ updated_at: number }[]>(
      "SELECT updated_at FROM canvases WHERE id = ?",
      [CANVAS_ID]
    );
    expect(rows[0].updated_at).toBe(2000);
    stop();
  });

  it("a newer-schema canvas loads read-only with no replacement offered", async () => {
    const { CURRENT_CANVAS_SCHEMA_VERSION } = await import("@/features/canvas/types");
    await insertCanvas(
      CANVAS_ID,
      JSON.stringify({
        schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION + 1,
        nodes: [{ id: "future" }],
        edges: [],
        strokes: [],
      }),
      "Future"
    );
    renderCanvas();
    await settleRender();
    expect(screen.getByText("canvas.newerCanvasTitle")).toBeInTheDocument();
    expect(screen.queryByText("canvas.replaceWithEmptyCanvas")).not.toBeInTheDocument();

    // Let any session timer run: the read-only doc is never written back.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await settle();
    const doc = await storedDoc(CANVAS_ID);
    expect(doc).toEqual({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION + 1,
      nodes: [{ id: "future" }],
      edges: [],
      strokes: [],
    });
  });

  it("a corrupt canvas still offers replacement", async () => {
    await insertCanvas(CANVAS_ID, "{", "Broken");
    renderCanvas();
    await settleRender();
    expect(screen.getByText("canvas.corruptDocTitle")).toBeInTheDocument();
    expect(screen.getByText("canvas.replaceWithEmptyCanvas")).toBeInTheDocument();
  });
});
