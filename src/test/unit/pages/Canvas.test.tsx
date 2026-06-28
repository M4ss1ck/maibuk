import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actions = {
    loadCanvas: vi.fn().mockResolvedValue(undefined),
    closeCanvas: vi.fn(),
    persistCanvas: vi.fn().mockResolvedValue(undefined),
    replaceCorruptDocWithDefault: vi.fn().mockResolvedValue(undefined),
    addNode: vi.fn(),
    addEdge: vi.fn(),
    updateEdge: vi.fn(),
    updateTextNode: vi.fn(),
    moveNodeLive: vi.fn(),
    beginLiveChange: vi.fn(),
    endLiveChange: vi.fn(),
    selectNode: vi.fn(),
    selectEdge: vi.fn(),
    clearSelection: vi.fn(),
    deleteSelection: vi.fn(),
    setViewport: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    renameCanvas: vi.fn().mockResolvedValue(undefined),
    setToolMode: vi.fn(),
    setPenWidth: vi.fn(),
    setPenColor: vi.fn(),
    toggleInteractivityLocked: vi.fn(),
    addStroke: vi.fn(),
    removeStroke: vi.fn(),
  };
  const flowActions = {
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
  const state: Record<string, unknown> = {};
  return { actions, flowActions, state, flowProps: { current: null as Record<string, unknown> | null } };
});

vi.mock("../../../features/canvas/store", () => {
  const useCanvasStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.state);
  useCanvasStore.getState = () => mocks.state;
  return { useCanvasStore };
});

vi.mock("../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: [], loadNotes: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("../../../features/canvas/nodes", () => ({ nodeTypes: {} }));

vi.mock("@xyflow/react", () => ({
  ConnectionMode: { Loose: "loose" },
  MarkerType: { ArrowClosed: "arrowclosed" },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  ReactFlow: (props: Record<string, unknown>) => {
    mocks.flowProps.current = props;
    return <div data-testid="react-flow" />;
  },
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({
    ...mocks.flowActions,
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    flowToScreenPosition: (point: { x: number; y: number }) => point,
    getZoom: () => 1,
  }),
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { Canvas } = await import("../../../pages/Canvas");

function readyState() {
  const doc = {
    schemaVersion: 2,
    nodes: [
      { id: "node", kind: "text", html: "<p>Idea</p>", position: { x: 0, y: 0 } },
    ],
    edges: [{ id: "edge", source: "node", target: "node", label: "Old" }],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  Object.assign(mocks.state, mocks.actions, {
    current: { id: "canvas-1", title: "Map", doc },
    doc,
    loadState: "ready",
    saveState: "idle",
    docLoadError: null,
    docWriteBlocked: false,
    editorReadOnly: false,
    corruptDocReplacementAllowed: false,
    dirty: false,
    revision: 0,
    savedRevision: 0,
    past: [],
    future: [],
    selectedNodeId: null,
    selectedEdgeId: "edge",
    toolMode: "select",
    penWidth: 3,
    penColor: "#ef4444",
    interactivityLocked: false,
  });
}

function renderCanvas() {
  return render(
    <MemoryRouter initialEntries={["/canvas/canvas-1"]}>
      <Routes>
        <Route path="/canvas/:canvasId" element={<Canvas />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Canvas page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flowProps.current = null;
    readyState();
  });

  it("disables built-in deletion and synchronizes React Flow node selection to the store", () => {
    renderCanvas();
    expect(mocks.flowProps.current?.deleteKeyCode).toBeNull();
    expect(mocks.flowProps.current?.connectionMode).toBe("loose");
    act(() => {
      const onSelectionChange = mocks.flowProps.current?.onSelectionChange as (
        value: Record<string, unknown>,
      ) => void;
      onSelectionChange({ nodes: [{ id: "node" }], edges: [] });
    });
    expect(mocks.actions.selectNode).toHaveBeenCalledWith("node");
    act(() => {
      const onSelectionChange = mocks.flowProps.current?.onSelectionChange as (
        value: Record<string, unknown>,
      ) => void;
      onSelectionChange({ nodes: [], edges: [{ id: "edge" }] });
    });
    expect(mocks.actions.selectEdge).not.toHaveBeenCalled();
  });

  it("adds an html text node from the floating tool panel", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "canvas.addTextNode" }));
    expect(mocks.actions.addNode).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text", html: "<p>canvas.newTextNode</p>" }),
    );
  });

  it("resets the selected node's color with the automatic swatch", () => {
    Object.assign(mocks.state, { selectedNodeId: "node" });
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "canvas.nodeColor" }));
    fireEvent.click(screen.getByRole("button", { name: "canvas.defaultNodeColor" }));
    expect(mocks.actions.updateTextNode).toHaveBeenCalledWith("node", { color: "" });
  });

  it("selects a node on click", () => {
    renderCanvas();
    act(() => {
      const onNodeClick = mocks.flowProps.current?.onNodeClick as (
        event: Record<string, unknown>,
        node: { id: string },
      ) => void;
      onNodeClick({}, { id: "node" });
    });
    expect(mocks.actions.selectNode).toHaveBeenCalledWith("node");
  });

  it("selects an edge on click and clears selection on pane click", () => {
    renderCanvas();
    const stopPropagation = vi.fn();
    act(() => {
      const onEdgeClick = mocks.flowProps.current?.onEdgeClick as (
        event: { stopPropagation: () => void },
        edge: { id: string },
      ) => void;
      onEdgeClick({ stopPropagation }, { id: "edge" });
    });
    expect(stopPropagation).toHaveBeenCalled();
    expect(mocks.actions.selectEdge).toHaveBeenCalledWith("edge");
    act(() => {
      const onPaneClick = mocks.flowProps.current?.onPaneClick as () => void;
      onPaneClick();
    });
    expect(mocks.actions.clearSelection).toHaveBeenCalled();
  });

  it("uses editor-safe delete and undo shortcuts", () => {
    renderCanvas();
    fireEvent.keyDown(window, { key: "Backspace" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(mocks.actions.deleteSelection).toHaveBeenCalledTimes(1);
    expect(mocks.actions.undo).toHaveBeenCalledTimes(1);

    const title = screen.getByLabelText("canvas.renameCanvas");
    fireEvent.keyDown(title, { key: "Backspace" });
    expect(mocks.actions.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it("updates the selected edge label and directed flag", () => {
    renderCanvas();
    const label = screen.getByLabelText("canvas.edgeLabel");
    fireEvent.change(label, { target: { value: "New label" } });
    fireEvent.blur(label);
    fireEvent.click(screen.getByRole("switch"));
    expect(mocks.actions.updateEdge).toHaveBeenCalledWith("edge", { label: "New label" });
    expect(mocks.actions.updateEdge).toHaveBeenCalledWith("edge", { directed: true });
  });

  it("zooms and fits the view from the floating toolbar", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "canvas.zoomIn" }));
    fireEvent.click(screen.getByRole("button", { name: "canvas.zoomOut" }));
    fireEvent.click(screen.getByRole("button", { name: "canvas.fitView" }));
    expect(mocks.flowActions.zoomIn).toHaveBeenCalledTimes(1);
    expect(mocks.flowActions.zoomOut).toHaveBeenCalledTimes(1);
    expect(mocks.flowActions.fitView).toHaveBeenCalledTimes(1);
  });

  it("disables React Flow interactions when the canvas is locked", () => {
    Object.assign(mocks.state, { interactivityLocked: true });
    renderCanvas();
    expect(mocks.flowProps.current?.panOnDrag).toBe(false);
    expect(mocks.flowProps.current?.nodesDraggable).toBe(false);
    expect(mocks.flowProps.current?.elementsSelectable).toBe(false);
    expect(mocks.flowProps.current?.zoomOnScroll).toBe(false);
    expect(mocks.flowProps.current?.zoomOnPinch).toBe(false);
    expect(mocks.flowProps.current?.zoomOnDoubleClick).toBe(false);
  });

  it("toggles canvas interactivity lock from the toolbar", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "canvas.lockInteractivity" }));
    expect(mocks.actions.toggleInteractivityLocked).toHaveBeenCalledTimes(1);
  });

  it("renders recovery UI instead of React Flow for a corrupt document", () => {
    Object.assign(mocks.state, {
      loadState: "error",
      docLoadError: { code: "corrupt-json", message: "bad" },
      docWriteBlocked: true,
      editorReadOnly: true,
    });
    renderCanvas();
    expect(screen.getByText("canvas.corruptDocTitle")).toBeInTheDocument();
    expect(screen.queryByTestId("react-flow")).not.toBeInTheDocument();
  });
});
