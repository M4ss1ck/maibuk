import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { DomSelectionSync } from "@/components/editor/extensions/DomSelectionSync";

// A key that moves the caret (End, Home, a click) moves the DOM selection at
// once, but ProseMirror learns about it from `selectionchange`, which fires a
// moment later. A Backspace pressed inside that moment reached the keymaps with
// the old caret at the start of the document, where TipTap's Backspace handling
// took the key and the browser deleted nothing: the E2E run pressed End then
// Backspace and the text stayed (Chromium, 8 of 12 runs under load). jsdom has
// no native editing, so these tests record the caret a keymap sees.

const seen: number[] = [];
const KeymapProbe = Extension.create({
  name: "keymapProbe",
  addKeyboardShortcuts() {
    const record = () => {
      seen.push(this.editor.state.selection.from);
      return false;
    };
    return { Backspace: record, Enter: record, "Mod-b": record };
  },
});

const editors: Editor[] = [];
afterEach(() => {
  seen.length = 0;
  for (const editor of editors.splice(0)) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
});

function mount(withSync: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions: withSync ? [StarterKit, KeymapProbe, DomSelectionSync] : [StarterKit, KeymapProbe],
    content: "<p>The storm came without warning.</p>",
  });
  editors.push(editor);
  editor.view.focus();
  editor.commands.setTextSelection(1);
  return editor;
}

/** Moves only the DOM caret, the way a native End does, before selectionchange. */
function moveDomCaretToEnd(editor: Editor) {
  const text = editor.view.dom.querySelector("p")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, text.textContent!.length);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function press(editor: Editor, key: string, init: KeyboardEventInit = {}) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  );
}

const END = "The storm came without warning.".length + 1;

describe("DomSelectionSync", () => {
  it("hands Backspace, Enter, and shortcuts the caret the DOM already shows", () => {
    const editor = mount(true);

    moveDomCaretToEnd(editor);
    press(editor, "Backspace");
    expect(seen).toEqual([END]);
    expect(editor.state.selection.from).toBe(END);

    editor.commands.setTextSelection(1);
    moveDomCaretToEnd(editor);
    press(editor, "Enter");
    editor.commands.setTextSelection(1);
    moveDomCaretToEnd(editor);
    press(editor, "b", { ctrlKey: true });
    expect(seen).toEqual([END, END, END]);
  });

  it("is what makes the difference: without it the keymap sees the stale caret", () => {
    const editor = mount(false);
    moveDomCaretToEnd(editor);

    press(editor, "Backspace");

    expect(seen).toEqual([1]);
  });

  it("leaves navigation keys to the browser", () => {
    const editor = mount(true);
    moveDomCaretToEnd(editor);
    const before = editor.state;

    for (const key of ["ArrowLeft", "End", "Home", "Shift", "PageDown"]) press(editor, key);

    expect(editor.state).toBe(before);
  });
});
