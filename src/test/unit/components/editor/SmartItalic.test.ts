import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { SmartItalic } from "@/components/editor/extensions/SmartItalic";

function makeEditor(content: string) {
  return new Editor({
    extensions: [StarterKit.configure({ italic: false }), SmartItalic],
    content,
  });
}

/** Simulate typing `text` at the current cursor, firing input rules. */
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  editor.view.someProp("handleTextInput", (handler) =>
    handler(editor.view, from, to, text, () => editor.state.tr)
  );
}

function atEnd(editor: Editor) {
  editor.commands.setTextSelection(editor.state.doc.content.size);
}

describe("SmartItalic underscore rule (boundary-triggered + escape)", () => {
  it("keeps `_named_function` literal when a trailing space is typed", () => {
    const editor = makeEditor("<p>_named_function</p>");
    atEnd(editor);

    type(editor, " ");

    expect(editor.getHTML()).not.toContain("<em>");
    expect(editor.getText()).toContain("_named_function");
    editor.destroy();
  });

  it("italicizes `_word_` when followed by a boundary char", () => {
    const editor = makeEditor("<p>_word_</p>");
    atEnd(editor);

    type(editor, " ");

    expect(editor.getHTML()).toContain("<em>word</em>");
    editor.destroy();
  });

  it("treats a backslash before the opener as an escape", () => {
    const editor = makeEditor("<p>\\_word_</p>");
    atEnd(editor);

    type(editor, " ");

    expect(editor.getHTML()).not.toContain("<em>");
    expect(editor.getText()).toContain("_word_");
    expect(editor.getText()).not.toContain("\\");
    editor.destroy();
  });

  it("does not italicize intraword underscores", () => {
    const editor = makeEditor("<p>un_der_</p>");
    atEnd(editor);

    type(editor, " ");

    expect(editor.getHTML()).not.toContain("<em>");
    editor.destroy();
  });
});

describe("SmartItalic asterisk rule (immediate + escape)", () => {
  it("italicizes `*word*` on the closing asterisk", () => {
    const editor = makeEditor("<p>*word</p>");
    atEnd(editor);

    type(editor, "*");

    expect(editor.getHTML()).toContain("<em>word</em>");
    editor.destroy();
  });

  it("treats a backslash before the opener as an escape", () => {
    const editor = makeEditor("<p>\\*word</p>");
    atEnd(editor);

    type(editor, "*");

    expect(editor.getHTML()).not.toContain("<em>");
    expect(editor.getText()).toContain("*word*");
    expect(editor.getText()).not.toContain("\\");
    editor.destroy();
  });
});

describe("SmartItalic preserves explicit italics", () => {
  it("still italicizes part of a word via toggleItalic on a selection", () => {
    const editor = makeEditor("<p>functional</p>");
    editor.commands.setTextSelection({ from: 1, to: 5 }); // "func"

    editor.commands.toggleItalic();

    expect(editor.getHTML()).toContain("<em>func</em>tional");
    editor.destroy();
  });
});
