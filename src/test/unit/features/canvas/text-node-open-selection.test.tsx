// Regression test for #725: opening a Text Node (F2) reset the selection the
// author made a few frames later. TipTap's `autofocus` runs its
// `commands.focus("end")` from a timeout after mount, which dispatches
// `setSelection(end)` and overwrote that selection. This suite uses the real
// TipTap editor, so the deferred path exists as it does in the app.

import { act, render } from "@testing-library/react";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTextNode: vi.fn(),
  selectNode: vi.fn(),
  removeNode: vi.fn(),
  openConnectPicker: vi.fn(),
  beginNodeEdit: vi.fn(),
  endNodeEdit: vi.fn(),
  navigate: vi.fn(),
  openExternal: vi.fn(),
  getClipboard: vi.fn(),
  state: {} as Record<string, unknown>,
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

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: { text?: string }) =>
      options?.text ? `${key}:${options.text}` : key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../../lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return {
    ...actual,
    openExternal: mocks.openExternal,
    getClipboard: mocks.getClipboard,
  };
});

// The Selection toolbar and the menus are not what this suite opens the node
// for; the editor itself stays real.
vi.mock("../../../../features/canvas/nodes/NodeFormatBubble", () => ({
  NodeFormatBubble: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/EditorContextMenu", () => ({
  EditorContextMenu: () => null,
}));

const { LightweightNode } = await import("@/features/canvas/nodes/LightweightNode");
const { useSettingsStore } = await import("@/features/settings/store");

function connectedSides() {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

/** Renders a Text Node already open for editing, the way F2 opens it. */
function renderOpenTextNode(html = "<p>Idea</p>") {
  return render(
    <LightweightNode
      {...({
        selected: false,
        data: {
          node: { id: "node", kind: "text", html, position: { x: 0, y: 0 } },
          canvasId: "canvas",
          canvasTitle: "Map",
          connectedSides: connectedSides(),
        },
      } as Parameters<typeof LightweightNode>[0])}
    />
  );
}

/** The TipTap editor of the open Text Node, through the view's DOM element. */
function openTextNodeEditor(): Editor {
  const dom = document.querySelector<HTMLElement>(".ProseMirror");
  const editor = (dom as (HTMLElement & { editor?: Editor }) | null)?.editor;
  if (!editor) throw new Error("the Text Node's editor never mounted");
  return editor;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Spell check would fetch its dictionaries in jsdom.
  useSettingsStore.setState({ spellCheckEnabled: false });
  mocks.getClipboard.mockResolvedValue({ readText: vi.fn(), writeText: vi.fn() });
  mocks.state = {
    updateTextNode: mocks.updateTextNode,
    selectNode: mocks.selectNode,
    removeNode: mocks.removeNode,
    openConnectPicker: mocks.openConnectPicker,
    beginNodeEdit: mocks.beginNodeEdit,
    endNodeEdit: mocks.endNodeEdit,
    editingNodeId: "node",
    editorReadOnly: false,
    interactivityLocked: false,
    pristineTextNode: null,
  };
});

describe("opening a Text Node", () => {
  it("places the caret at the end of its text during the commit that opens it", () => {
    renderOpenTextNode();

    const editor = openTextNodeEditor();

    expect(editor.state.doc.textContent).toBe("Idea");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("keeps a selection the author makes right after the Text Node opens", async () => {
    renderOpenTextNode();

    const editor = openTextNodeEditor();
    // The author presses Shift+ArrowRight a few frames after F2, before TipTap's
    // deferred focus would have run.
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 3))
      );
    });

    // Past TipTap's opening timeout: autofocus used to run from it, and it is
    // the same callback that marks the editor initialized. Waiting for that
    // mark proves nothing the opening defers can still touch the selection.
    await vi.waitFor(() => expect(editor.isInitialized).toBe(true));

    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(3);
  });

  it("keeps the caret the browser moves to the start right after the Text Node opens (F2 then Home)", () => {
    renderOpenTextNode();

    const editor = openTextNodeEditor();
    // F2 then Home: the browser moves the caret to the start of the line. The
    // keystroke arrives in the frame the node opened, so nothing waits here
    // either. For 200ms after a focus ProseMirror reads a caret at the start of
    // the document as the browser resetting it, and puts the caret it placed
    // when opening back (at the end).
    const paragraph = editor.view.dom.firstChild as HTMLElement;
    const text = paragraph.firstChild as Text;
    act(() => {
      window.getSelection()?.collapse(text, 0);
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(1);
  });
});
