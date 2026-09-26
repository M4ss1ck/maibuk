import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/features/settings/store";

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
  updateTextNode: vi.fn(),
  beginNodeEdit: vi.fn(),
  endNodeEdit: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: (props: { onKeyDown?: (event: unknown) => void }) => (
    <div data-testid="editor-content" onKeyDown={props.onKeyDown} />
  ),
  useEditor: mocks.useEditor,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: () => null,
  ResizeControlVariant: { Line: "line", Handle: "handle" },
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.state),
}));

vi.mock("../../../../features/canvas/nodes/NodeFormatBubble", () => ({
  NodeFormatBubble: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => <div data-testid="footnote-list" />,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");

function textNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "node",
    kind: "text",
    html: "<p>Idea</p>",
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function connectedSides() {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

function nodeElement(node: Record<string, unknown> = textNode()) {
  return (
    <LightweightNode
      {...({
        selected: false,
        data: { node, canvasId: "canvas", canvasTitle: "Map", connectedSides: connectedSides() },
      } as Parameters<typeof LightweightNode>[0])}
    />
  );
}

function renderNode(node: Record<string, unknown> = textNode()) {
  return render(nodeElement(node));
}

describe("LightweightNode editor lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state = {
      updateTextNode: mocks.updateTextNode,
      editorReadOnly: false,
      interactivityLocked: false,
      editingNodeId: null,
      beginNodeEdit: mocks.beginNodeEdit,
      endNodeEdit: mocks.endNodeEdit,
    };
  });

  it("does not create a Tiptap editor while the node is idle", () => {
    renderNode();

    expect(screen.getByText("Idea")).toBeInTheDocument();
    expect(mocks.useEditor).not.toHaveBeenCalled();
  });

  it("asks the store to begin editing on double click (the pointer path)", () => {
    renderNode();

    fireEvent.doubleClick(screen.getByText("Idea"));

    expect(mocks.beginNodeEdit).toHaveBeenCalledWith("node");
  });

  it("autofocuses the editor when it opens, so F2 typing lands in the node", () => {
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    renderNode();

    expect(mocks.useEditor).toHaveBeenCalledWith(expect.objectContaining({ autofocus: "end" }));
  });

  it("focuses the editor view during the commit that opens it, before the next key", () => {
    const viewFocus = vi.fn();
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      view: { focus: viewFocus },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    // flushSync commits synchronously; a passive effect (or TipTap's
    // requestAnimationFrame) would not have run yet. The keystroke after T or
    // F2 arrives this early in WebKit, so the view must already hold focus.
    flushSync(() => {
      root.render(nodeElement());
    });

    expect(viewFocus).toHaveBeenCalled();

    flushSync(() => root.unmount());
    container.remove();
  });

  it("scopes node colors to the node and content while editing", async () => {
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    renderNode(textNode({ textColor: "#ef4444", backgroundColor: "#f59e0b" }));

    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());
    // The TipTap root must not carry the content scope class (avoids nested scopes).
    expect(mocks.useEditor.mock.calls[0][0].editorProps.attributes.class).not.toContain(
      "canvas-node-content"
    );
    // The active editor is wrapped in a color-scoped content container.
    const content = screen.getByTestId("editor-content").closest(".canvas-node-content");
    expect(content).not.toBeNull();
    expect(content).toHaveStyle({ color: "#ef4444" });
    expect(screen.getByTestId("editor-content").closest(".group")).toHaveStyle({
      backgroundColor: "#f59e0b",
    });
    // The outer node group carries no inline color.
    expect(screen.getByTestId("editor-content").closest(".group")).not.toHaveStyle({
      color: "#ef4444",
    });
  });

  it("builds the editor from the shared rich-text factory with a markdown callback", async () => {
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    renderNode();

    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());
    const extensions = mocks.useEditor.mock.calls[0][0].extensions as Array<{
      name: string;
      options: Record<string, unknown>;
    }>;
    const names = extensions.map((extension) => extension.name);
    expect(names).toEqual(expect.arrayContaining(["table", "image", "footnote", "pasteHandler"]));
    const pasteHandler = extensions.find((extension) => extension.name === "pasteHandler");
    expect(typeof pasteHandler?.options.onMarkdownPaste).toBe("function");
  });

  it("passes the enabled autoclose setting to the active editor", async () => {
    useSettingsStore.setState({ editorAutoClose: true });
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    renderNode();

    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());
    const extensions = mocks.useEditor.mock.calls[0][0].extensions as Array<{ name: string }>;
    const names = extensions.map((extension) => extension.name);
    expect(names).toContain("autoClose");
  });

  it("Escape leaves text editing through the store", async () => {
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    renderNode();
    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByTestId("editor-content"), { key: "Escape" });

    expect(mocks.endNodeEdit).toHaveBeenCalled();
  });

  it("Escape commits the typed HTML before leaving editing", async () => {
    mocks.state.editingNodeId = "node";
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea edited</p>"),
    });
    renderNode();
    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByTestId("editor-content"), { key: "Escape" });

    // Tab indents inside the editor and a keyboard-only author cannot blur, so
    // Escape is the commit path: without it the typed text would be lost.
    expect(mocks.updateTextNode).toHaveBeenCalledWith("node", { html: "<p>Idea edited</p>" });
    expect(mocks.endNodeEdit).toHaveBeenCalled();
  });
});
