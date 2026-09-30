import { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import {
  isSelectionKept,
  selectionKeptPluginKey,
  setSelectionKept,
} from "@/components/editor/extensions/SelectionKept";

vi.mock("@/components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

const editors: Editor[] = [];

function createEditor() {
  const editor = new Editor({
    extensions: createRichTextExtensions({
      onMarkdownPaste: () => {},
      footnoteStartIndex: 1,
      autoClose: false,
      dropcursor: false,
    }),
    content: "<p>Hello world</p>",
  });
  editors.push(editor);
  document.body.appendChild(editor.view.dom);
  return editor;
}

function keptElements(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.querySelectorAll(".selection-kept"));
}

function selectRange(editor: Editor, from: number, to: number) {
  editor.commands.setTextSelection({ from, to });
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  }
});

describe("SelectionKept", () => {
  it("paints the selected range while kept and removes it when cleared", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);

    setSelectionKept(editor, true);
    expect(isSelectionKept(editor.state)).toBe(true);

    const kept = keptElements(editor);
    expect(kept).toHaveLength(1);
    expect(kept[0].textContent).toBe("Hello");

    setSelectionKept(editor, false);
    expect(isSelectionKept(editor.state)).toBe(false);
    expect(keptElements(editor)).toHaveLength(0);
  });

  it("paints nothing for an empty selection", () => {
    const editor = createEditor();
    editor.commands.setTextSelection(1);

    setSelectionKept(editor, true);
    expect(isSelectionKept(editor.state)).toBe(true);
    expect(keptElements(editor)).toHaveLength(0);
  });

  it("never reaches saved content, history, or undo availability", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);

    const htmlBefore = editor.getHTML();
    const jsonBefore = JSON.stringify(editor.getJSON());
    const depthBefore = undoDepth(editor.state);

    setSelectionKept(editor, true);

    expect(editor.getHTML()).toBe(htmlBefore);
    expect(JSON.stringify(editor.getJSON())).toBe(jsonBefore);
    expect(undoDepth(editor.state)).toBe(depthBefore);
    expect(editor.can().undo()).toBe(false);

    setSelectionKept(editor, false);
    expect(editor.getHTML()).toBe(htmlBefore);
    expect(undoDepth(editor.state)).toBe(depthBefore);
    expect(editor.can().undo()).toBe(false);
  });

  it("does not fire the update event when kept changes", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);
    const spy = vi.fn();
    editor.on("update", spy);

    setSelectionKept(editor, true);
    setSelectionKept(editor, false);

    expect(spy).not.toHaveBeenCalled();
  });

  it("moves the decoration when the selection changes while kept", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);
    setSelectionKept(editor, true);
    expect(keptElements(editor)[0]?.textContent).toBe("Hello");

    selectRange(editor, 7, 12);

    const kept = keptElements(editor);
    expect(kept).toHaveLength(1);
    expect(kept[0].textContent).toBe("world");
  });

  it("clears kept when the editor DOM regains focus", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);
    setSelectionKept(editor, true);
    expect(keptElements(editor)).toHaveLength(1);

    editor.view.dom.focus();

    expect(isSelectionKept(editor.state)).toBe(false);
    expect(keptElements(editor)).toHaveLength(0);
  });

  it("ignores unknown plugin state and repeated sets", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);

    // Same value twice: the second call is a no-op.
    setSelectionKept(editor, true);
    setSelectionKept(editor, true);
    expect(keptElements(editor)).toHaveLength(1);

    expect(selectionKeptPluginKey.getState(editor.state)).toBe(true);
  });

  it("does not throw on a destroyed editor", () => {
    const editor = createEditor();
    selectRange(editor, 1, 6);
    setSelectionKept(editor, true);
    const dom = editor.view.dom;
    editor.destroy();
    dom.remove();

    expect(() => setSelectionKept(editor, false)).not.toThrow();
  });
});
