import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actions = {
    loadCanvas: vi.fn().mockResolvedValue(undefined),
    closeCanvas: vi.fn(),
    persistCanvas: vi.fn().mockResolvedValue(undefined),
    saveDoc: vi.fn().mockResolvedValue(null),
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
    beginNodeEdit: vi.fn(),
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
    loadBooks: vi.fn().mockResolvedValue(undefined),
    loadNotes: vi.fn().mockResolvedValue(undefined),
    openConnectPicker: vi.fn(),
    closeConnectPicker: vi.fn(),
    connectNodes: vi.fn(),
  };
  const flowActions = {
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
  const state: Record<string, unknown> = {};
  return {
    actions,
    flowActions,
    state,
    flowProps: { current: null as Record<string, unknown> | null },
  };
});

vi.mock("../../../features/canvas/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/canvas/store")>();
  const useCanvasStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.state);
  useCanvasStore.getState = () => mocks.state;
  return { ...actual, useCanvasStore, canvasWriteQueue: actual.canvasWriteQueue };
});

vi.mock("../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ notes: [], loadNotes: mocks.actions.loadNotes }),
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ loadBooks: mocks.actions.loadBooks }),
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

// The header hosts the real sync button; isolate the flow here while still
// verifying its contextual scope wiring through the captured props.
const syncButtonProps = { current: null as null | { defaultScope?: string } };
vi.mock("@/components/sync/SyncStatusButton", () => ({
  SyncStatusButton: (props: { defaultScope?: string }) => {
    syncButtonProps.current = props;
    return <button type="button">sync</button>;
  },
}));

const { Canvas } = await import("@/pages/Canvas");

function readyState() {
  const doc = {
    schemaVersion: 2,
    nodes: [{ id: "node", kind: "text", html: "<p>Idea</p>", position: { x: 0, y: 0 } }],
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
    externalDocNonce: 0,
    past: [],
    future: [],
    liveBaseDoc: null,
    editingNodeId: null,
    selectedNodeId: null,
    selectedEdgeId: "edge",
    toolMode: "select",
    penWidth: 3,
    penColor: "#ef4444",
    interactivityLocked: false,
    connectSourceNodeId: null,
  });
}

function renderCanvas() {
  return render(
    <MemoryRouter initialEntries={["/canvas/canvas-1"]}>
      <Routes>
        <Route path="/canvas/:canvasId" element={<Canvas />} />
      </Routes>
    </MemoryRouter>
  );
}

function boundIds() {
  return Object.keys(useBoundShortcutStore.getState().counts);
}

describe("Canvas page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flowProps.current = null;
    readyState();
  });

  it("loads books with notes so linked note references can resolve book titles", () => {
    renderCanvas();
    expect(mocks.actions.loadNotes).toHaveBeenCalledTimes(1);
    expect(mocks.actions.loadBooks).toHaveBeenCalledTimes(1);
  });

  it("lists the canvas tool shortcuts as bound once the canvas is ready", () => {
    renderCanvas();

    expect(boundIds()).toEqual(
      expect.arrayContaining([
        "canvas.toolSelect",
        "canvas.toolPen",
        "canvas.toolEraser",
        "canvas.addTextNode",
        "canvas.addNoteRef",
        "canvas.editTextNode",
        "canvas.zoomIn",
        "canvas.zoomOut",
        "canvas.fitView",
        "canvas.lock",
      ])
    );
  });

  it("disables built-in deletion and synchronizes React Flow node selection to the store", () => {
    renderCanvas();
    expect(mocks.flowProps.current?.deleteKeyCode).toBeNull();
    expect(mocks.flowProps.current?.connectionMode).toBe("loose");
    act(() => {
      const onSelectionChange = mocks.flowProps.current?.onSelectionChange as (
        value: Record<string, unknown>
      ) => void;
      onSelectionChange({ nodes: [{ id: "node" }], edges: [] });
    });
    expect(mocks.actions.selectNode).toHaveBeenCalledWith("node");
    act(() => {
      const onSelectionChange = mocks.flowProps.current?.onSelectionChange as (
        value: Record<string, unknown>
      ) => void;
      onSelectionChange({ nodes: [], edges: [{ id: "edge" }] });
    });
    expect(mocks.actions.selectEdge).not.toHaveBeenCalled();
  });

  it("adds a roomy html text node and selects it from the floating tool panel", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "canvas.addTextNode" }));
    const addedNode = mocks.actions.addNode.mock.calls[0][0];
    expect(addedNode).toEqual(
      expect.objectContaining({
        kind: "text",
        html: "<p>canvas.newTextNode</p>",
        width: 288,
      })
    );
    expect(mocks.actions.selectNode).toHaveBeenCalledWith(addedNode.id);
    expect(mocks.actions.beginNodeEdit).toHaveBeenCalledWith(addedNode.id);
  });

  it("records a keyboard arrow key as one live move so the node persists", () => {
    renderCanvas();
    mocks.actions.beginLiveChange.mockClear();
    mocks.actions.endLiveChange.mockClear();

    act(() => {
      const onNodesChange = mocks.flowProps.current?.onNodesChange as (
        changes: Record<string, unknown>[]
      ) => void;
      onNodesChange([
        { type: "position", id: "node", position: { x: 5, y: 0 }, dragging: false },
      ]);
    });

    expect(mocks.actions.beginLiveChange).toHaveBeenCalledTimes(1);
    expect(mocks.actions.moveNodeLive).toHaveBeenCalledWith("node", { x: 5, y: 0 });
    expect(mocks.actions.endLiveChange).toHaveBeenCalledTimes(1);
  });

  it("leaves a pointer drag bracketed by its own begin and end", () => {
    renderCanvas();
    mocks.actions.beginLiveChange.mockClear();
    mocks.actions.endLiveChange.mockClear();
    mocks.state.liveBaseDoc = { nodes: [] };

    act(() => {
      const onNodesChange = mocks.flowProps.current?.onNodesChange as (
        changes: Record<string, unknown>[]
      ) => void;
      onNodesChange([
        { type: "position", id: "node", position: { x: 30, y: 0 }, dragging: true },
      ]);
    });

    expect(mocks.actions.beginLiveChange).not.toHaveBeenCalled();
    expect(mocks.actions.endLiveChange).not.toHaveBeenCalled();
    expect(mocks.actions.moveNodeLive).toHaveBeenCalledWith("node", { x: 30, y: 0 });
  });

  it("opens the focused Text Node for editing from the F2 shortcut", () => {
    renderCanvas();
    const node = document.createElement("div");
    node.className = "react-flow__node react-flow__node-text";
    node.dataset.id = "node";
    node.tabIndex = 0;
    document.body.append(node);
    node.focus();

    fireEvent.keyDown(window, { key: "F2" });

    expect(mocks.actions.beginNodeEdit).toHaveBeenCalledWith("node");
    node.remove();
  });

  describe("Connect to…", () => {
    function withTwoNodes(overrides: Record<string, unknown> = {}) {
      const doc = {
        ...(mocks.state.doc as Record<string, unknown>),
        nodes: [
          { id: "node", kind: "text", html: "<p>Idea</p>", position: { x: 0, y: 0 } },
          { id: "other", kind: "text", html: "<p>Second thought</p>", position: { x: 300, y: 0 } },
          { id: "third", kind: "text", html: "<p>Third</p>", position: { x: 0, y: 300 } },
        ],
        edges: [],
      };
      Object.assign(mocks.state, {
        doc,
        selectedNodeId: "node",
        selectedEdgeId: null,
        ...overrides,
      });
    }

    it("opens the picker for the selected node from the side panel by keyboard", async () => {
      const user = userEvent.setup();
      withTwoNodes();
      renderCanvas();

      const button = screen.getByRole("button", { name: "canvas.connectTo" });
      button.focus();
      await user.keyboard("{Enter}");

      expect(mocks.actions.openConnectPicker).toHaveBeenCalledWith("node");
    });

    it("hides the side-panel entry when nothing is selected or the canvas is locked", () => {
      withTwoNodes({ selectedNodeId: null });
      const { unmount } = renderCanvas();
      expect(screen.queryByRole("button", { name: "canvas.connectTo" })).toBeNull();
      unmount();

      withTwoNodes({ interactivityLocked: true });
      renderCanvas();
      expect(screen.queryByRole("button", { name: "canvas.connectTo" })).toBeNull();
    });

    it("connects to a searched node with the keyboard", async () => {
      const user = userEvent.setup();
      withTwoNodes({ connectSourceNodeId: "node" });
      renderCanvas();

      const dialog = await screen.findByRole("dialog", { name: "canvas.connectFrom" });
      expect(dialog).toHaveTextContent("Second thought");
      expect(dialog).toHaveTextContent("Third");
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: "canvas.searchNodesPlaceholder" })).toHaveFocus()
      );
      await user.keyboard("second");
      expect(dialog).not.toHaveTextContent("Third");
      await user.tab();
      expect(screen.getByRole("button", { name: "Second thought" })).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(mocks.actions.connectNodes).toHaveBeenCalledWith("node", "other");
      expect(mocks.actions.closeConnectPicker).toHaveBeenCalled();
    });

    it("leaves out nodes it is already connected to, and closes with Escape", async () => {
      const user = userEvent.setup();
      withTwoNodes({ connectSourceNodeId: "node" });
      (mocks.state.doc as { edges: unknown[] }).edges = [
        { id: "e", source: "other", target: "node" },
      ];
      renderCanvas();

      const dialog = await screen.findByRole("dialog", { name: "canvas.connectFrom" });
      expect(dialog).not.toHaveTextContent("Second thought");
      expect(dialog).toHaveTextContent("Third");
      await user.keyboard("{Escape}");

      expect(mocks.actions.closeConnectPicker).toHaveBeenCalled();
      expect(mocks.actions.connectNodes).not.toHaveBeenCalled();
    });
  });

  it("turns a React Flow keyboard node selection into a store selection", () => {
    renderCanvas();
    const onNodesChange = mocks.flowProps.current?.onNodesChange as (
      changes: Record<string, unknown>[]
    ) => void;

    act(() => {
      onNodesChange([{ type: "select", id: "node", selected: true }]);
    });
    expect(mocks.actions.selectNode).toHaveBeenCalledWith("node");

    mocks.state.selectedNodeId = "node";
    act(() => {
      onNodesChange([{ type: "select", id: "node", selected: false }]);
    });
    expect(mocks.actions.clearSelection).toHaveBeenCalled();
  });

  it("turns a React Flow keyboard edge selection into a store selection", () => {
    renderCanvas();
    const onEdgesChange = mocks.flowProps.current?.onEdgesChange as (
      changes: Record<string, unknown>[]
    ) => void;

    act(() => {
      onEdgesChange([{ type: "select", id: "edge", selected: true }]);
    });
    expect(mocks.actions.selectEdge).toHaveBeenCalledWith("edge");
  });

  it("selects a node on click", () => {
    renderCanvas();
    act(() => {
      const onNodeClick = mocks.flowProps.current?.onNodeClick as (
        event: Record<string, unknown>,
        node: { id: string }
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
        edge: { id: string }
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

  it("dismisses the edge inspector from its close button", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(mocks.actions.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("dismisses the edge inspector on Escape while focus is inside it", () => {
    renderCanvas();
    fireEvent.keyDown(screen.getByLabelText("canvas.edgeLabel"), { key: "Escape" });
    expect(mocks.actions.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("keeps the floating tool column scrollable above the edge inspector", () => {
    const { rerender } = renderCanvas();
    const toolbar = screen.getByRole("toolbar", { name: "canvas.tools" });
    const toolArea = toolbar.parentElement?.parentElement;
    const column = toolArea?.parentElement;
    expect(column?.className).toContain("inset-y-4");
    expect(column?.className).toContain("flex-col");
    expect(toolArea?.className).toContain("min-h-0");
    expect(toolArea?.className).toContain("flex-1");
    expect(toolArea?.className).toContain("overflow-y-auto");

    const closeButton = screen.getByRole("button", { name: "common.close" });
    const inspector = closeButton.parentElement?.parentElement;
    expect(inspector?.className).toContain("w-56");
    expect(inspector?.className).not.toContain("absolute");
    expect(inspector?.parentElement?.className).toContain("shrink-0");
    expect(inspector?.parentElement?.parentElement).toBe(column);

    Object.assign(mocks.state, { selectedEdgeId: null });
    rerender(
      <MemoryRouter initialEntries={["/canvas/canvas-1"]}>
        <Routes>
          <Route path="/canvas/:canvasId" element={<Canvas />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByRole("button", { name: "common.close" })).not.toBeInTheDocument();
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

  it("wires the header sync button to the Canvases scope before Delete Selection", () => {
    renderCanvas();
    const syncButton = screen.getByRole("button", { name: "sync" });
    const deleteButton = screen.getByRole("button", { name: "canvas.deleteSelection" });

    expect(syncButtonProps.current?.defaultScope).toBe("canvases");
    // Shared sync button sits immediately before Delete Selection in the header.
    expect(syncButton.nextElementSibling).toBe(deleteButton);
  });

  it("keeps the header sync button enabled with no elements selected", () => {
    Object.assign(mocks.state, { selectedNodeId: null, selectedEdgeId: null });
    renderCanvas();
    const syncButton = screen.getByRole("button", { name: "sync" });
    const deleteButton = screen.getByRole("button", { name: "canvas.deleteSelection" });

    expect(mocks.state.selectedNodeId).toBeNull();
    expect(mocks.state.selectedEdgeId).toBeNull();
    expect(deleteButton).toBeDisabled();
    expect(syncButton).toBeEnabled();
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
