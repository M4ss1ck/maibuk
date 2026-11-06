import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "@tiptap/pm/model";
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
  // The real bubble portals its toolbar to the body; the test needs a focusable
  // control inside the element the node treats as the bubble.
  NodeFormatBubble: ({ bubbleRef }: { bubbleRef?: { current: HTMLElement | null } }) => (
    <div
      ref={(element) => {
        if (bubbleRef) bubbleRef.current = element;
      }}
    >
      <button type="button">Format selection</button>
    </div>
  ),
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

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
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
function fakeEditor(misspelling: { word: string; from: number; to: number } | null = null) {
  const dom = document.createElement("div");
  dom.tabIndex = -1;
  // The opening effect asks Selection for the end of a real document.
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*" },
      text: {},
    },
  });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Idea")])]);
  const transaction = { setSelection: vi.fn(), scrollIntoView: vi.fn() };
  transaction.setSelection.mockReturnValue(transaction);
  transaction.scrollIntoView.mockReturnValue(transaction);
  const run = vi.fn();
  const insertContentAt = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ insertContentAt, run }));
  const editor = {
    isFocused: false,
    // TipTap's focus command defers a frame (see its `focus` command). Off by
    // default so the mount's own focus lands before the test drives the menu.
    deferFocusCommand: false,
    isDestroyed: false,
    isEditable: true,
    getHTML: vi.fn(() => "<p>Idea</p>"),
    // The shared surface reads these while its Find bar is closed.
    getAttributes: () => ({}),
    on: vi.fn(),
    off: vi.fn(),
    view: {
      dom,
      dispatch: vi.fn(),
      posAtCoords: vi.fn(() => ({ pos: 2, inside: 0 })),
      posAtDOM: vi.fn(() => 1),
      coordsAtPos: vi.fn(() => ({ top: 10, bottom: 20, left: 10, right: 10 })),
      // ProseMirror's own focus lands at once.
      focus: vi.fn(() => dom.focus()),
    },
    state: {
      selection: { empty: false, from: 1, to: 3 },
      doc,
      tr: transaction,
    },
    storage: { spellCheck: misspelling ? { getMisspellingAt: () => misspelling } : {} },
    commands: {
      focus: vi.fn(() => {
        if (editor.deferFocusCommand) {
          requestAnimationFrame(() => dom.focus());
          return;
        }
        editor.isFocused = true;
      }),
      addToDictionary: vi.fn(),
      clearSearchHighlights: vi.fn(),
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
    // deprecated-api: stubs the Copy path EditorContextMenu calls; jsdom has none.
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

  it("keeps the node editing when Escape closes the editor menu", async () => {
    const user = userEvent.setup();
    const { editor, dom } = fakeEditor();
    mocks.useEditor.mockReturnValue(editor);
    renderEditingNode();

    act(() => dom.focus());
    // Let the mount's own focus settle, then make the focus command behave as
    // TipTap's does: it lands in the next frame, not this one.
    await nextFrame();
    editor.deferFocusCommand = true;

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    dom.dispatchEvent(event);

    const menu = await screen.findByRole("menu");
    const copy = screen.getByRole("menuitem", { name: "Copy" });
    act(() => copy.focus());
    expect(menu.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await nextFrame();

    // The Text Node decides in the frame the menu closes whether to keep
    // editing; focus must already be back by then.
    expect(editor.isFocused).toBe(true);
    expect(document.activeElement).toBe(dom);
    expect(mocks.updateTextNode).not.toHaveBeenCalled();
    expect(mocks.endNodeEdit).not.toHaveBeenCalled();
  });

  it("keeps editing after Add to Dictionary, whose action leaves focus on the menu's hidden trigger", async () => {
    const { editor, dom } = fakeEditor({ word: "Idea", from: 1, to: 5 });
    mocks.useEditor.mockReturnValue(editor);
    renderEditingNode();
    // The menu hides the page from the accessibility tree while it is open, so
    // the trigger is taken before it opens.
    const trigger = screen.getByRole("button", { name: "Editor options" });

    act(() => dom.focus());
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    dom.dispatchEvent(event);

    const item = await screen.findByRole("menuitem", { name: "Add to Dictionary" });
    act(() => item.focus());
    // Synchronous, so no frame runs between the close and the focus move below.
    fireEvent.keyDown(item, { key: "Enter" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // The action does not focus the text itself, so React Aria hands focus
    // back to the menu's hidden trigger: that is not leaving the node.
    act(() => trigger.focus());
    await nextFrame();

    expect(mocks.updateTextNode).not.toHaveBeenCalled();
    expect(mocks.endNodeEdit).not.toHaveBeenCalled();
  });

  it("commits the text when the menu closes and an outside control takes focus", async () => {
    const user = userEvent.setup();
    const { editor, dom } = fakeEditor();
    mocks.useEditor.mockReturnValue(editor);
    renderEditingNode();
    render(<button type="button">Elsewhere</button>);
    // Query before the menu opens: its modal popover hides the page from the
    // accessibility tree while it is up.
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    act(() => dom.focus());
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    });
    dom.dispatchEvent(event);

    const copy = await screen.findByRole("menuitem", { name: "Copy" });
    act(() => copy.focus());
    // An actual press outside the menu: it dismisses the popover, and the
    // author's control keeps the focus the press gave it.
    await user.pointer({ target: elsewhere, keys: "[MouseLeft]" });
    act(() => elsewhere.focus());
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await nextFrame();

    expect(mocks.updateTextNode).toHaveBeenCalledWith("node", { html: "<p>Idea</p>" });
  });

  it("keeps editing when focus moves into the node's selection bubble", () => {
    const { editor, dom } = fakeEditor();
    mocks.useEditor.mockReturnValue(editor);
    renderEditingNode();

    act(() => dom.focus());
    act(() => screen.getByRole("button", { name: "Format selection" }).focus());

    expect(mocks.updateTextNode).not.toHaveBeenCalled();
    expect(mocks.endNodeEdit).not.toHaveBeenCalled();
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
