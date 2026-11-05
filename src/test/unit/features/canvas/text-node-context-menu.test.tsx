import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useEditor: vi.fn(),
  updateTextNode: vi.fn(),
  beginNodeEdit: vi.fn(),
  endNodeEdit: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: (props: {
    editor: { view?: { dom?: HTMLElement } };
    onBlur?: () => void;
    onFocus?: () => void;
    onKeyDown?: (event: unknown) => void;
  }) => {
    const attach = (node: HTMLDivElement | null) => {
      const dom = props.editor?.view?.dom;
      if (node && dom && !node.contains(dom)) node.append(dom);
    };
    return (
      <div
        data-testid="editor-content"
        ref={attach}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
      />
    );
  },
  useEditor: mocks.useEditor,
}));

vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: () => null,
  ResizeControlVariant: { Line: "line", Handle: "handle" },
}));

vi.mock("../../../../features/canvas/store", () => {
  const useCanvasStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.state);
  useCanvasStore.getState = () => mocks.state;
  return { useCanvasStore };
});

vi.mock("../../../../features/canvas/nodes/NodeFormatBubble", () => ({
  NodeFormatBubble: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/useClipboardProbe", () => ({
  fallbackPaste: vi.fn(),
  pasteWithoutFormatting: vi.fn(),
  probeClipboard: vi.fn().mockResolvedValue({ canPaste: false, hasFormatting: false }),
  useClipboardProbe: () => vi.fn().mockResolvedValue({ canPaste: false, hasFormatting: false }),
}));

vi.mock("../../../../lib/spellcheck", () => ({
  spellCheckService: { suggest: vi.fn().mockResolvedValue([]) },
}));

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");

function textNode() {
  return {
    id: "node",
    kind: "text",
    html: "<p>Idea</p>",
    position: { x: 0, y: 0 },
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

function renderEditingNode() {
  return render(
    <LightweightNode
      {...({
        selected: false,
        data: {
          node: textNode(),
          canvasId: "canvas",
          canvasTitle: "Map",
          connectedSides: connectedSides(),
        },
      } as Parameters<typeof LightweightNode>[0])}
    />
  );
}

/** The parts of a Tiptap Editor the context menu reads. */
function fakeEditor() {
  const dom = document.createElement("div");
  dom.tabIndex = -1;
  const run = vi.fn();
  const insertContentAt = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContentAt, run }));
  const editor = {
    isFocused: false,
    isDestroyed: false,
    isEditable: true,
    getHTML: vi.fn(() => "<p>Idea</p>"),
    on: vi.fn(),
    off: vi.fn(),
    view: {
      dom,
      posAtCoords: vi.fn(() => ({ pos: 2, inside: 0 })),
      posAtDOM: vi.fn(() => 1),
      coordsAtPos: vi.fn(() => ({ top: 10, bottom: 20, left: 10, right: 10 })),
      focus: vi.fn(),
    },
    state: {
      selection: { empty: false, from: 1, to: 3 },
      doc: {
        resolve: vi.fn(() => ({
          depth: 0,
          pos: 0,
          parent: { isTextblock: false },
          before: () => 0,
          after: () => 5,
        })),
        descendants: vi.fn(),
        textBetween: vi.fn(() => ""),
        content: { size: 5 },
      },
    },
    storage: { spellCheck: {} },
    commands: {
      focus: vi.fn(() => {
        editor.isFocused = true;
      }),
      addToDictionary: vi.fn(),
    },
    chain: vi.fn(() => ({
      focus,
      insertContentAt,
      run,
      setTextSelection: vi.fn(() => ({ extendMarkRange: vi.fn(() => ({ run })) })),
    })),
  };

  // ProseMirror marks the editor focused on the DOM event, as the real one does.
  dom.addEventListener("focus", () => {
    editor.isFocused = true;
  });
  dom.addEventListener("blur", () => {
    editor.isFocused = false;
  });

  return { editor, dom };
}

async function nextFrame() {
  await act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

describe("Text Node context menu while editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The Copy action uses the deprecated path, which jsdom does not implement.
    document.execCommand = vi.fn(() => true);
    mocks.state = {
      updateTextNode: mocks.updateTextNode,
      editorReadOnly: false,
      interactivityLocked: false,
      editingNodeId: "node",
      beginNodeEdit: mocks.beginNodeEdit,
      endNodeEdit: mocks.endNodeEdit,
    };
  });

  it("opens the editor menu on a right click and keeps the node while an action runs", async () => {
    const user = userEvent.setup();
    const { editor, dom } = fakeEditor();
    mocks.useEditor.mockReturnValue(editor);
    renderEditingNode();

    act(() => dom.focus());
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    dom.dispatchEvent(event);

    // The browser menu never appears, and the editor's own menu does.
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    // The menu took focus from the text: that blur must not commit the node.
    expect(mocks.updateTextNode).not.toHaveBeenCalled();

    const copy = screen.getByRole("menuitem", { name: "Copy" });
    act(() => copy.focus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await nextFrame();

    // The action closed the menu and the text holds focus again: still editing.
    expect(mocks.updateTextNode).not.toHaveBeenCalled();
    expect(mocks.endNodeEdit).not.toHaveBeenCalled();

    // With the menu gone, leaving the text commits as it always did.
    editor.isFocused = false;
    fireEvent.focusOut(screen.getByTestId("editor-content"));
    expect(mocks.updateTextNode).toHaveBeenCalledWith("node", { html: "<p>Idea</p>" });
  });

  it("prevents the browser menu on a right click on the Text Node padding", () => {
    const { editor } = fakeEditor();
    mocks.useEditor.mockReturnValue(editor);
    renderEditingNode();

    const padding = screen.getByTestId("editor-content").closest(".group");
    expect(padding).not.toBeNull();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    padding?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(mocks.updateTextNode).not.toHaveBeenCalled();
  });
});
