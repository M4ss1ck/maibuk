import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { quotesFor } from "@/components/editor/extensions/WritingQuotes";

function makeEditor(getLanguage: () => string, content = "<p></p>") {
  return new Editor({
    extensions: createRichTextExtensions({ writingLanguage: getLanguage }),
    content,
  });
}

function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  let handled = false;
  editor.view.someProp("handleTextInput", (handler) => {
    handled = handler(editor.view, from, to, text, () => editor.state.tr) === true;
    return handled;
  });
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
  return handled;
}

describe("quotesFor()", () => {
  it.each([
    ["en", "\u201C", "\u201D"],
    ["es-MX", "\u201C", "\u201D"],
    ["pt-BR", "\u201C", "\u201D"],
    ["fr", "\u00AB\u00A0", "\u00A0\u00BB"],
    ["fr-CA", "\u00AB\u00A0", "\u00A0\u00BB"],
    ["de", "\u201E", "\u201C"],
    ["not a tag!", "\u201C", "\u201D"],
  ])("returns the quotes for %s", (language, open, close) => {
    expect(quotesFor(language)).toEqual({ open, close });
  });
});

describe("WritingQuotes", () => {
  it.each([
    ["en", "\u201C"],
    ["fr", "\u00AB\u00A0"],
    ["de", "\u201E"],
  ])("types the %s opening quote at the start of a block", (language, open) => {
    const editor = makeEditor(() => language);

    expect(type(editor, '"')).toBe(true);

    expect(editor.getText()).toBe(open);
    expect(editor.state.selection.from).toBe(1 + open.length);
    editor.destroy();
  });

  it.each([
    ["en", "\u201D"],
    ["fr", "\u00A0\u00BB"],
    ["de", "\u201C"],
  ])("types the %s closing quote after text", (language, close) => {
    const editor = makeEditor(() => language, "<p>hola</p>");
    editor.commands.setTextSelection(5);

    expect(type(editor, '"')).toBe(true);

    expect(editor.getText()).toBe(`hola${close}`);
    editor.destroy();
  });

  it("keeps the English result of the Typography rules it replaces", () => {
    const open = makeEditor(() => "en");
    type(open, '"');
    expect(open.getText()).toBe("\u201C");
    open.destroy();

    const close = makeEditor(() => "en", "<p>hola</p>");
    close.commands.setTextSelection(5);
    type(close, '"');
    expect(close.getText()).toBe("hola\u201D");
    close.destroy();
  });

  it("reads the language again on each keystroke", () => {
    let language = "en";
    const editor = makeEditor(() => language);

    type(editor, '"');
    expect(editor.getText()).toBe("\u201C");

    editor.commands.clearContent();
    language = "fr";

    expect(type(editor, '"')).toBe(true);

    expect(editor.getText()).toBe("\u00AB\u00A0");
    editor.destroy();
  });
});
