import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@/components/ui";
import { CanvasImageError } from "@/features/canvas/encodeCanvasImage";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";
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
    addNodes: vi.fn(),
    placeTextNode: vi.fn(),
    addEdge: vi.fn(),
    updateEdge: vi.fn(),
    previewEdgeColor: vi.fn(),
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
    openImageDialog: vi.fn((target: unknown) => {
      state.imageDialog = target;
    }),
    closeImageDialog: vi.fn(),
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
    notes: [] as Array<{ id: string; title: string }>,
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
    selector({ notes: mocks.notes, loadNotes: mocks.actions.loadNotes }),
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ loadBooks: mocks.actions.loadBooks }),
}));

vi.mock("../../../features/canvas/nodes", () => ({ nodeTypes: {} }));

const { mockEncode } = vi.hoisted(() => ({ mockEncode: vi.fn() }));

vi.mock("@/features/canvas/encodeCanvasImage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/canvas/encodeCanvasImage")>();
  return { ...actual, encodeCanvasImage: mockEncode };
});

const { mockReadCopiedImageFile } = vi.hoisted(() => ({ mockReadCopiedImageFile: vi.fn() }));

// The OS clipboard, read only for a file a file manager copied. The page runs
// as the web build here: drops arrive as DOM events, not Tauri webview events.
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_TAURI: false,
  getClipboard: async () => ({
    readText: vi.fn(),
    writeText: vi.fn(),
    readCopiedImageFile: mockReadCopiedImageFile,
  }),
}));

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

// The real keys, so a test can assert the options a key is asked for.
const { mockT } = vi.hoisted(() => ({ mockT: vi.fn((key: string) => key) }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: mockT }),
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
    imageDialog: null,
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
    mocks.notes = [];
    readyState();
  });

  it("loads the books the canvas page shares with the Library", () => {
    renderCanvas();
    expect(mocks.actions.loadBooks).toHaveBeenCalledTimes(1);
  });

  it("lists the canvas tool shortcuts as bound once the canvas is ready", () => {
    Object.assign(mocks.state, { toolMode: "textNode" });
    renderCanvas();

    expect(boundIds()).toEqual(
      expect.arrayContaining([
        "canvas.toolSelect",
        "canvas.toolPen",
        "canvas.toolEraser",
        "canvas.addTextNode",
        "canvas.addReference",
        "canvas.placeArmedTool",
        "canvas.editTextNode",
        "common.zoomIn",
        "common.zoomOut",
        "canvas.fitView",
        "canvas.lock",
      ])
    );
  });

  it("binds the Enter placement only while a placement tool is armed", () => {
    const { unmount } = renderCanvas();
    expect(boundIds()).not.toContain("canvas.placeArmedTool");
    unmount();

    Object.assign(mocks.state, { toolMode: "reference" });
    renderCanvas();
    expect(boundIds()).toContain("canvas.placeArmedTool");
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

  it("arms the Text Node tool from the floating panel without placing anything", () => {
    renderCanvas();
    fireEvent.click(screen.getByRole("button", { name: "canvas.addTextNode" }));

    expect(mocks.actions.setToolMode).toHaveBeenCalledWith("textNode");
    expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    expect(mocks.actions.addNode).not.toHaveBeenCalled();
  });

  it("records a keyboard arrow key as one live move so the node persists", () => {
    renderCanvas();
    mocks.actions.beginLiveChange.mockClear();
    mocks.actions.endLiveChange.mockClear();

    act(() => {
      const onNodesChange = mocks.flowProps.current?.onNodesChange as (
        changes: Record<string, unknown>[]
      ) => void;
      onNodesChange([{ type: "position", id: "node", position: { x: 5, y: 0 }, dragging: false }]);
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
      onNodesChange([{ type: "position", id: "node", position: { x: 30, y: 0 }, dragging: true }]);
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

  describe("placement tools", () => {
    // The mocked store has no reducer, so the tool a key sets is read back from the mocked state.
    function armTool(toolMode: "textNode" | "reference" | "image") {
      Object.assign(mocks.state, { toolMode });
    }

    beforeEach(() => {
      // readyState selects an edge, and its inspector then takes focus on mount. The keys
      // under test are pressed with focus on the page, so they start with nothing selected.
      Object.assign(mocks.state, { selectedEdgeId: null });
    });

    function paneElement() {
      const pane = document.createElement("div");
      pane.className = "react-flow__pane";
      return pane;
    }

    function doubleClickSurface(target: Element, clientX = 40, clientY = 60) {
      const onDoubleClick = mocks.flowProps.current?.onDoubleClick as (event: {
        target: Element;
        clientX: number;
        clientY: number;
      }) => void;
      act(() => onDoubleClick({ target, clientX, clientY }));
    }

    it("arms Text Node with T and Note Reference with N from the keyboard", async () => {
      const user = userEvent.setup();
      renderCanvas();

      await user.keyboard("t");
      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("textNode");

      await user.keyboard("n");
      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("reference");
    });

    it("arms the image tool with I from the keyboard", async () => {
      const user = userEvent.setup();
      renderCanvas();

      await user.keyboard("i");

      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("image");
    });

    it("opens the image dialog for the view center with the second Enter", async () => {
      const user = userEvent.setup();
      armTool("image");
      renderCanvas();

      await user.keyboard("{Enter}");

      expect(mocks.actions.openImageDialog).toHaveBeenCalledWith({
        kind: "place",
        position: { x: 24, y: 24 },
      });
      expect(mocks.state.imageDialog).toEqual({ kind: "place", position: { x: 24, y: 24 } });
      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("select");
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("places nothing when the image dialog is dismissed with Escape", async () => {
      const user = userEvent.setup();
      Object.assign(mocks.state, {
        imageDialog: { kind: "place", position: { x: 24, y: 24 } },
      });
      renderCanvas();

      await screen.findByRole("dialog", { name: "canvas.addImage" });
      await user.keyboard("{Escape}");

      expect(mocks.actions.closeImageDialog).toHaveBeenCalled();
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
    });

    it("places an armed Text Node at the view center with the second Enter", async () => {
      const user = userEvent.setup();
      armTool("textNode");
      renderCanvas();

      await user.keyboard("{Enter}");

      expect(mocks.actions.placeTextNode).toHaveBeenCalledTimes(1);
      const placed = mocks.actions.placeTextNode.mock.calls[0][0];
      expect(placed).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          kind: "text",
          html: "<p></p>",
          // The view center (0, 0) is held by the node at (0, 0), so the spot steps out by 24.
          position: { x: 24, y: 24 },
        })
      );
      expect(placed).not.toHaveProperty("width");
    });

    it("leaves Enter to a focused toolbar button while a tool is armed", async () => {
      const user = userEvent.setup();
      armTool("textNode");
      renderCanvas();

      screen.getByRole("button", { name: "canvas.zoomIn" }).focus();
      await user.keyboard("{Enter}");

      expect(mocks.flowActions.zoomIn).toHaveBeenCalledTimes(1);
      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("leaves Enter to a focused control the Canvas does not know about", async () => {
      const user = userEvent.setup();
      armTool("textNode");
      renderCanvas();
      const tab = document.createElement("div");
      tab.setAttribute("role", "tab");
      tab.tabIndex = 0;
      document.body.append(tab);

      tab.focus();
      await user.keyboard("{Enter}");
      tab.remove();

      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("does nothing on Enter while Select is active", async () => {
      const user = userEvent.setup();
      renderCanvas();

      await user.keyboard("{Enter}");

      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("cancels an armed tool with Escape and keeps the selection", async () => {
      const user = userEvent.setup();
      armTool("textNode");
      renderCanvas();

      await user.keyboard("{Escape}");

      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("select");
      expect(mocks.actions.clearSelection).not.toHaveBeenCalled();
    });

    it("clears the selection with Escape when no tool is armed", async () => {
      const user = userEvent.setup();
      renderCanvas();

      await user.keyboard("{Escape}");

      expect(mocks.actions.clearSelection).toHaveBeenCalledTimes(1);
    });

    it("places a Text Node where the pane is double clicked in Select", () => {
      renderCanvas();

      doubleClickSurface(paneElement(), 40, 60);

      expect(mocks.actions.placeTextNode).toHaveBeenCalledTimes(1);
      const placed = mocks.actions.placeTextNode.mock.calls[0][0];
      expect(placed).toEqual(
        expect.objectContaining({ kind: "text", html: "<p></p>", position: { x: 40, y: 60 } })
      );
      expect(placed).not.toHaveProperty("width");
    });

    it("ignores a double click on something other than the pane", () => {
      renderCanvas();

      doubleClickSurface(document.createElement("div"));

      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it.each([
      "pen",
      "eraser",
    ] as const)("ignores a pane double click while %s is active", (mode) => {
      Object.assign(mocks.state, { toolMode: mode });
      renderCanvas();

      doubleClickSurface(paneElement());

      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("ignores a pane double click while the canvas is locked", () => {
      Object.assign(mocks.state, { interactivityLocked: true });
      renderCanvas();

      doubleClickSurface(paneElement());

      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("ignores a pane double click while the canvas is read-only", () => {
      Object.assign(mocks.state, { editorReadOnly: true });
      renderCanvas();

      doubleClickSurface(paneElement());

      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
    });

    it("drops back to Select when the canvas turns read-only with a tool armed", () => {
      Object.assign(mocks.state, { toolMode: "textNode", editorReadOnly: true });
      renderCanvas();

      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("select");
    });

    it("opens the reference picker on Enter and places the chosen note there", async () => {
      const user = userEvent.setup();
      vi.spyOn(noteReferenceSource, "list").mockResolvedValue([
        { id: "note-1", title: "Chapter notes" },
      ]);
      vi.spyOn(noteReferenceSource, "resolve").mockResolvedValue({});
      vi.spyOn(noteReferenceSource, "subscribe").mockReturnValue(() => {});
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      armTool("reference");
      renderCanvas();

      await user.keyboard("{Enter}");

      const dialog = await screen.findByRole("dialog", { name: "canvas.addReference" });
      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("select");

      const option = await within(dialog).findByRole("option", { name: "Chapter notes" });
      act(() => option.focus());
      await user.keyboard("{Enter}");

      expect(mocks.actions.addNode).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          kind: "reference",
          source: "note",
          targetId: "note-1",
          label: "Chapter notes",
          position: { x: 24, y: 24 },
        })
      );
      const added = mocks.actions.addNode.mock.calls[0][0];
      expect(mocks.actions.selectNode).toHaveBeenCalledWith(added.id);
      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith("[canvas] reference placed", {
        source: "note",
        result: "placed",
      });
      vi.restoreAllMocks();
    });

    it("places nothing when the reference picker is cancelled with Escape", async () => {
      const user = userEvent.setup();
      vi.spyOn(noteReferenceSource, "list").mockResolvedValue([
        { id: "note-1", title: "Chapter notes" },
      ]);
      vi.spyOn(noteReferenceSource, "resolve").mockResolvedValue({});
      vi.spyOn(noteReferenceSource, "subscribe").mockReturnValue(() => {});
      armTool("reference");
      renderCanvas();

      await user.keyboard("{Enter}");
      await screen.findByRole("dialog", { name: "canvas.addReference" });
      await user.keyboard("{Escape}");

      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "canvas.addReference" })
        ).not.toBeInTheDocument()
      );
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
      expect(mocks.actions.placeTextNode).not.toHaveBeenCalled();
      expect(mocks.actions.setToolMode).toHaveBeenCalledWith("select");
      vi.restoreAllMocks();
    });
  });

  describe("pasting an image", () => {
    const imageFile = () => new File(["png"], "cat.png", { type: "image/png" });

    // jsdom has no DataTransfer: this keeps the shapes the router reads.
    function imageClipboard(file: File): DataTransfer {
      return {
        files: [file] as unknown as FileList,
        items: [
          { kind: "file", type: file.type, getAsFile: () => file } as DataTransferItem,
        ] as unknown as DataTransferItemList,
        types: ["Files"],
        getData: () => "",
      } as unknown as DataTransfer;
    }

    beforeEach(() => {
      mockEncode.mockReset();
      mockReadCopiedImageFile.mockReset();
      mockReadCopiedImageFile.mockResolvedValue(null);
    });

    it("places the pasted image at the viewport center and selects it", async () => {
      const user = userEvent.setup();
      mockEncode.mockResolvedValue({ src: "data:image/jpeg;base64,NEW", width: 640, height: 320 });
      renderCanvas();

      await user.paste(imageClipboard(imageFile()));

      await waitFor(() => expect(mocks.actions.addNode).toHaveBeenCalledTimes(1));
      expect(mockEncode).toHaveBeenCalledWith(expect.any(File));
      const added = mocks.actions.addNode.mock.calls[0][0];
      expect(added).toEqual({
        id: expect.any(String),
        kind: "image",
        src: "data:image/jpeg;base64,NEW",
        width: 320,
        height: 160,
        // The pointer left the surface, so the image lands at the view center.
        position: { x: 0, y: 0 },
        fileName: "cat.png",
      });
      expect(mocks.actions.selectNode).toHaveBeenCalledWith(added.id);
    });

    // WebKitGTK gives a file-manager copy only an empty text/uri-list.
    function copiedFileClipboard(): DataTransfer {
      return {
        files: [] as unknown as FileList,
        items: [
          { kind: "string", type: "text/uri-list", getAsFile: () => null } as DataTransferItem,
        ] as unknown as DataTransferItemList,
        types: ["text/uri-list"],
        getData: () => "",
      } as unknown as DataTransfer;
    }

    it("places the image file a file manager copied", async () => {
      const user = userEvent.setup();
      mockEncode.mockResolvedValue({ src: "data:image/png;base64,OS", width: 640, height: 320 });
      mockReadCopiedImageFile.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
      renderCanvas();

      await user.paste(copiedFileClipboard());

      await waitFor(() => expect(mocks.actions.addNode).toHaveBeenCalledTimes(1));
      expect(mockReadCopiedImageFile).toHaveBeenCalledTimes(1);
      expect(mockEncode).toHaveBeenCalledWith(expect.any(Blob));
      const added = mocks.actions.addNode.mock.calls[0][0];
      expect(added).toEqual({
        id: expect.any(String),
        kind: "image",
        src: "data:image/png;base64,OS",
        width: 320,
        height: 160,
        position: { x: 0, y: 0 },
      });
      expect(mocks.actions.selectNode).toHaveBeenCalledWith(added.id);
    });

    it("places the picture WebKitGTK pastes natively when the event carries no data", async () => {
      const picture = new Blob(["png"], { type: "image/png" });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ blob: async () => picture }))
      );
      mockEncode.mockResolvedValue({ src: "data:image/png;base64,PIC", width: 640, height: 320 });
      renderCanvas();
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { files: [], items: [], types: [], getData: () => "" },
      });

      act(() => {
        document.body.dispatchEvent(event);
        // The native paste lands in the field focused during the event.
        const img = document.createElement("img");
        img.setAttribute("src", "blob:http://localhost/1");
        (document.activeElement as HTMLElement).append(img);
      });

      await waitFor(() => expect(mocks.actions.addNode).toHaveBeenCalledTimes(1));
      expect(mockEncode).toHaveBeenCalledWith(picture);
      expect(mocks.actions.addNode.mock.calls[0][0]).toMatchObject({
        kind: "image",
        src: "data:image/png;base64,PIC",
      });
      vi.unstubAllGlobals();
    });

    it("places nothing and reports nothing when no clipboard holds an image", async () => {
      const user = userEvent.setup();
      const toastError = vi.spyOn(toast, "error");
      renderCanvas();

      await user.paste(copiedFileClipboard());

      await waitFor(() => expect(mockReadCopiedImageFile).toHaveBeenCalledTimes(1));
      expect(mockEncode).not.toHaveBeenCalled();
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
      toastError.mockRestore();
    });

    it("reports an unsupported image and places nothing", async () => {
      const user = userEvent.setup();
      const toastError = vi.spyOn(toast, "error");
      mockEncode.mockRejectedValue(new CanvasImageError("unsupported"));
      renderCanvas();

      await user.paste(imageClipboard(imageFile()));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith("canvas.imageUnsupported"));
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
      expect(mocks.actions.selectNode).not.toHaveBeenCalled();
      toastError.mockRestore();
    });

    it("reports an image that fails to read, rather than rejecting unhandled", async () => {
      const user = userEvent.setup();
      const toastError = vi.spyOn(toast, "error");
      mockEncode.mockRejectedValue(new DOMException("read failed", "NotReadableError"));
      renderCanvas();

      await user.paste(imageClipboard(imageFile()));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith("canvas.imageUnsupported"));
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
      toastError.mockRestore();
    });

    it("leaves a paste that began in a Text Node even after the editor ends editing mid-event", async () => {
      // WebKitGTK: the event carries only text/uri-list, so ProseMirror's
      // capturePaste moves focus out of the editor while the paste is still
      // being dispatched; the Text Node blurs, commits, and stops editing
      // before the event bubbles up to the document.
      mockReadCopiedImageFile.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
      Object.assign(mocks.state, { editingNodeId: "node" });
      renderCanvas();
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      const trailingBreak = document.createElement("br");
      editor.append(trailingBreak);
      document.body.append(editor);
      editor.focus();
      // The Text Node commits on that blur and its editor view is destroyed,
      // which strips contenteditable and detaches the DOM the event targets.
      editor.addEventListener("paste", () => {
        Object.assign(mocks.state, { editingNodeId: null });
        editor.removeAttribute("contenteditable");
        editor.remove();
      });

      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { files: [], items: [], types: ["text/uri-list"], getData: () => "" },
      });
      act(() => {
        trailingBreak.dispatchEvent(event);
      });
      await act(async () => {});

      expect(mockReadCopiedImageFile).not.toHaveBeenCalled();
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
    });

    it("places nothing while a Text Node is being edited", async () => {
      const user = userEvent.setup();
      Object.assign(mocks.state, { editingNodeId: "node" });
      renderCanvas();

      await user.paste(imageClipboard(imageFile()));

      expect(mockEncode).not.toHaveBeenCalled();
      expect(mocks.actions.addNode).not.toHaveBeenCalled();
    });
  });

  describe("dropping image files", () => {
    const imageFile = (name: string) => new File(["png"], name, { type: "image/png" });

    // jsdom has no DataTransfer: this keeps the shapes the drop handler reads.
    function fileTransfer(files: File[]): DataTransfer {
      return {
        files: files as unknown as FileList,
        items: files.map(
          (file) => ({ kind: "file", type: file.type, getAsFile: () => file }) as DataTransferItem
        ) as unknown as DataTransferItemList,
        types: ["Files"],
        getData: () => "",
        dropEffect: "none",
      } as unknown as DataTransfer;
    }

    // jsdom's events carry none of the drag payload, so it is attached directly.
    function dragEvent(type: string, files: File[], at = { x: 100, y: 200 }): Event {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: fileTransfer(files) });
      Object.defineProperty(event, "clientX", { value: at.x });
      Object.defineProperty(event, "clientY", { value: at.y });
      return event;
    }

    function dropOnSurface(event: Event) {
      act(() => {
        screen.getByTestId("react-flow").dispatchEvent(event);
      });
    }

    beforeEach(() => {
      mockEncode.mockReset();
    });

    it("places every dropped image cascaded from the drop point, in one history step", async () => {
      const toastError = vi.spyOn(toast, "error");
      mockEncode.mockImplementation(async (source: Blob) => {
        if (source.type !== "image/png") throw new CanvasImageError("unsupported");
        return { src: "data:image/png;base64,DROP", width: 640, height: 320 };
      });
      // Undo is only enabled with history behind it.
      Object.assign(mocks.state, { past: [{ nodes: [], edges: [] }] });
      renderCanvas();

      dropOnSurface(
        dragEvent("drop", [
          imageFile("one.png"),
          new File(["notes"], "notes.txt", { type: "text/plain" }),
          imageFile("two.png"),
        ])
      );

      await waitFor(() => expect(mocks.actions.addNodes).toHaveBeenCalledTimes(1));
      const added = mocks.actions.addNodes.mock.calls[0][0] as Array<{
        id: string;
        position: { x: number; y: number };
        fileName?: string;
      }>;
      expect(added).toHaveLength(2);
      expect(added[0]).toMatchObject({
        kind: "image",
        src: "data:image/png;base64,DROP",
        position: { x: 100, y: 200 },
        fileName: "one.png",
      });
      // The second image cascades; the skipped text file does not advance it.
      expect(added[1].position).toEqual({ x: 124, y: 224 });
      expect(added[1].fileName).toBe("two.png");
      expect(mocks.actions.selectNode).toHaveBeenCalledWith(added[1].id);
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("canvas.dropSkipped"));
      expect(mockT).toHaveBeenCalledWith("canvas.dropSkipped", { count: 1 });

      // Both images went in through one addNodes, so one Undo takes them back.
      fireEvent.click(screen.getByRole("button", { name: "canvas.undo" }));
      expect(mocks.actions.undo).toHaveBeenCalledTimes(1);
      expect(mocks.actions.addNodes).toHaveBeenCalledTimes(1);
      toastError.mockRestore();
    });

    it("places nothing while the Canvas is read-only", async () => {
      mockEncode.mockResolvedValue({ src: "data:image/png;base64,DROP", width: 640, height: 320 });
      Object.assign(mocks.state, { editorReadOnly: true });
      renderCanvas();

      dropOnSurface(dragEvent("drop", [imageFile("one.png")]));
      await act(async () => {});

      expect(mockEncode).not.toHaveBeenCalled();
      expect(mocks.actions.addNodes).not.toHaveBeenCalled();
      expect(mocks.actions.selectNode).not.toHaveBeenCalled();
    });

    it("claims a drop onto a Text Node's editor, so the editor never inlines it", async () => {
      mockEncode.mockResolvedValue({ src: "data:image/png;base64,DROP", width: 640, height: 320 });
      renderCanvas();
      // Stands in for ProseMirror's own drop handler on a Text Node.
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      const editorDrop = vi.fn();
      editor.addEventListener("drop", editorDrop);
      screen.getByTestId("react-flow").appendChild(editor);

      act(() => {
        editor.dispatchEvent(dragEvent("drop", [imageFile("one.png")]));
      });

      await waitFor(() => expect(mocks.actions.addNodes).toHaveBeenCalledTimes(1));
      expect(editorDrop).not.toHaveBeenCalled();
    });

    it("accepts a file drag over the surface", () => {
      renderCanvas();
      const event = dragEvent("dragover", [imageFile("one.png")]);

      dropOnSurface(event);

      expect(event.defaultPrevented).toBe(true);
    });
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

  it("sends the selected edge's thickness and line style picks to the store by keyboard", async () => {
    const user = userEvent.setup();
    renderCanvas();
    act(() =>
      screen.getByRole("radio", { name: "canvas.connectionThicknessOptions.thin" }).focus()
    );
    await user.keyboard("{ArrowRight}");
    act(() => screen.getByRole("radio", { name: "canvas.lineStyles.solid" }).focus());
    await user.keyboard("{ArrowRight}");
    expect(mocks.actions.updateEdge).toHaveBeenCalledWith("edge", { width: 2 });
    expect(mocks.actions.updateEdge).toHaveBeenCalledWith("edge", { lineStyle: "dashed" });
  });

  it("gives an uncolored arrowhead the theme's line color", () => {
    renderCanvas();
    expect(mocks.flowProps.current?.defaultMarkerColor).toBe("var(--xy-edge-stroke-default)");
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
  });

  it("keeps React Flow's own double-click zoom off so a double click can add a Text Node", () => {
    renderCanvas();
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
