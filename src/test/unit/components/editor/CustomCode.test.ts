import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { CustomCode } from "@/components/editor/extensions/CustomCode";

/** Editor with the non-inclusive inline-code mark used by the app. */
function makeEditor(content: string) {
  return new Editor({
    extensions: [StarterKit.configure({ code: false }), CustomCode],
    content,
  });
}

/** Editor with StarterKit's default (inclusive) inline-code mark, for contrast. */
function makeInclusiveEditor(content: string) {
  return new Editor({ extensions: [StarterKit], content });
}

/** Position of the caret immediately after `foo` in `<p><code>foo</code></p>`. */
const AFTER_CODE = 4;

function codeMarkAt(editor: Editor, pos: number): boolean {
  editor.commands.setTextSelection(pos);
  return editor.state.selection.$head.marks().some((mark) => mark.type.name === "code");
}

describe("CustomCode non-inclusive boundary", () => {
  it("declares the code mark as non-inclusive in the schema", () => {
    const editor = makeEditor("<p>x</p>");
    expect(editor.schema.marks.code.spec.inclusive).toBe(false);
    editor.destroy();
  });

  it("treats the caret at the trailing edge of a code span as outside the mark", () => {
    const editor = makeEditor("<p><code>foo</code></p>");
    expect(codeMarkAt(editor, AFTER_CODE)).toBe(false);
    editor.destroy();
  });

  it("types plain (unmarked) text when the caret is at the end of a code span", () => {
    const editor = makeEditor("<p><code>foo</code></p>");
    // tr.insertText applies the boundary-aware marks at the position, exactly
    // as real typing does.
    editor.view.dispatch(editor.state.tr.insertText("x", AFTER_CODE));

    expect(editor.getHTML()).toContain("<code>foo</code>x");
    expect(editor.getHTML()).not.toContain("<code>foox</code>");
    editor.destroy();
  });

  it("still keeps the caret inside the span between code characters", () => {
    const editor = makeEditor("<p><code>foo</code></p>");
    expect(codeMarkAt(editor, AFTER_CODE - 1)).toBe(true); // between "fo|o"
    editor.destroy();
  });

  it("contrasts with StarterKit's default inclusive code, which traps the caret", () => {
    const editor = makeInclusiveEditor("<p><code>foo</code></p>");
    expect(codeMarkAt(editor, AFTER_CODE)).toBe(true);
    editor.destroy();
  });
});
