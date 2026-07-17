import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "@/features/settings/store";

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
  updateTextNode: vi.fn(),
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor-content" />,
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
    selector({ updateTextNode: mocks.updateTextNode, editorReadOnly: false }),
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

describe("LightweightNode editor lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not create a Tiptap editor while the node is idle", () => {
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: "<p>Idea</p>",
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: false, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    expect(screen.getByText("Idea")).toBeInTheDocument();
    expect(mocks.useEditor).not.toHaveBeenCalled();
  });

  it("scopes node color to a content container around the editor while editing", async () => {
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: "<p>Idea</p>",
              color: "#ef4444",
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: false, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    fireEvent.doubleClick(screen.getByText("Idea"));

    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());
    // The TipTap root must not carry the content scope class (avoids nested scopes).
    expect(mocks.useEditor.mock.calls[0][0].editorProps.attributes.class).not.toContain(
      "canvas-node-content"
    );
    // The active editor is wrapped in a color-scoped content container.
    const content = screen.getByTestId("editor-content").closest(".canvas-node-content");
    expect(content).not.toBeNull();
    expect(content).toHaveStyle({ color: "#ef4444" });
    // The outer node group carries no inline color.
    expect(screen.getByTestId("editor-content").closest(".group")).not.toHaveStyle({
      color: "#ef4444",
    });
  });

  it("builds the editor from the shared rich-text factory with a markdown callback", async () => {
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: "<p>Idea</p>",
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: false, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    fireEvent.doubleClick(screen.getByText("Idea"));
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
    mocks.useEditor.mockReturnValue({
      commands: { focus: vi.fn() },
      getHTML: vi.fn(() => "<p>Idea</p>"),
    });
    render(
      <LightweightNode
        {...({
          selected: false,
          data: {
            node: {
              id: "node",
              kind: "text",
              html: "<p>Idea</p>",
              position: { x: 0, y: 0 },
            },
            canvasId: "canvas",
            canvasTitle: "Map",
            connectedSides: {
              top: { connected: false, incoming: false, outgoing: false },
              right: { connected: false, incoming: false, outgoing: false },
              bottom: { connected: false, incoming: false, outgoing: false },
              left: { connected: false, incoming: false, outgoing: false },
            },
          },
        } as Parameters<typeof LightweightNode>[0])}
      />
    );

    fireEvent.doubleClick(screen.getByText("Idea"));
    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());
    const extensions = mocks.useEditor.mock.calls[0][0].extensions as Array<{ name: string }>;
    const names = extensions.map((extension) => extension.name);
    expect(names).toContain("autoClose");
  });
});
