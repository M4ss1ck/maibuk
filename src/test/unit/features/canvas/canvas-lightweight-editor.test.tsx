import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("../../../../features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ updateTextNode: mocks.updateTextNode, editorReadOnly: false }),
}));

vi.mock("../../../../features/canvas/nodes/NodeFormatBubble", () => ({
  NodeFormatBubble: () => null,
}));

const { LightweightNode } = await import(
  "../../../../features/canvas/nodes/LightweightNode"
);

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
      />,
    );

    expect(screen.getByText("Idea")).toBeInTheDocument();
    expect(mocks.useEditor).not.toHaveBeenCalled();
  });

  it("uses the shared content renderer while editing", async () => {
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
      />,
    );

    fireEvent.doubleClick(screen.getByText("Idea"));

    await waitFor(() => expect(mocks.useEditor).toHaveBeenCalled());
    expect(mocks.useEditor.mock.calls[0][0]).toMatchObject({
      editorProps: {
        attributes: { class: expect.stringContaining("canvas-node-content") },
      },
    });
  });
});
