import { Editor } from "@tiptap/core";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { AutoClose } from "@/components/editor/extensions/AutoClose";

function makeEditor(content = "<p></p>") {
  return new Editor({ extensions: [StarterKit, AutoClose], content });
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

describe("AutoClose", () => {
  it.each([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ['"', '"'],
    ["`", "`"],
  ])("inserts %s%s with the caret between", (open, close) => {
    const editor = makeEditor();

    expect(type(editor, open)).toBe(true);

    expect(editor.getText()).toBe(open + close);
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });

  it.each([")", "]", "}", '"', "`"])('skips over an existing "%s"', (close) => {
    const editor = makeEditor(`<p>${close}</p>`);
    editor.commands.setTextSelection(1);

    expect(type(editor, close)).toBe(true);

    expect(editor.getText()).toBe(close);
    expect(editor.state.selection.from).toBe(2);
    editor.destroy();
  });

  it("wraps a rich-text selection without removing marks", () => {
    const editor = makeEditor("<p><strong>bold</strong></p>");
    editor.commands.setTextSelection({ from: 1, to: 5 });

    expect(type(editor, "(")).toBe(true);

    expect(editor.getHTML()).toBe("<p>(<strong>bold</strong>)</p>");
    expect(editor.state.selection.from).toBe(7);
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });

  it("wraps inline nodes without flattening them to text", () => {
    const editor = makeEditor("<p>one<br>two</p>");
    editor.commands.setTextSelection({ from: 1, to: 8 });

    expect(type(editor, "[")).toBe(true);

    expect(editor.getHTML()).toBe("<p>[one<br>two]</p>");
    expect(editor.state.selection.from).toBe(10);
    editor.destroy();
  });

  it("keeps autoclosing quotes straight when typography is installed", () => {
    const editor = new Editor({
      extensions: [StarterKit, Typography, AutoClose],
      content: "<p></p>",
    });

    expect(type(editor, '"')).toBe(true);

    expect(editor.getText()).toBe('""');
    editor.destroy();
  });

  it("leaves an escaped opener literal", () => {
    const editor = makeEditor("<p>\\</p>");
    editor.commands.setTextSelection(2);

    expect(type(editor, "(")).toBe(false);

    expect(editor.getText()).toBe("\\(");
    editor.destroy();
  });

  it("leaves input literal inside a code block", () => {
    const editor = makeEditor("<pre><code></code></pre>");
    editor.commands.setTextSelection(1);

    expect(type(editor, "(")).toBe(false);

    expect(editor.getHTML()).toBe("<pre><code>(</code></pre><p></p>");
    editor.destroy();
  });

  it("remains active inside an inline code mark", () => {
    const editor = makeEditor("<p><code>foo</code></p>");
    // Position 2 is between 'f' and 'oo' inside the <code> mark.
    editor.commands.setTextSelection(2);

    expect(type(editor, "(")).toBe(true);

    expect(editor.getHTML()).toBe("<p><code>f()oo</code></p>");
    expect(editor.state.selection.from).toBe(3);
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });

  it("passes unrelated text through", () => {
    const editor = makeEditor();

    expect(type(editor, "a")).toBe(false);

    expect(editor.getText()).toBe("a");
    editor.destroy();
  });

  it("handles a dead-key double-quote via beforeinput fallback", () => {
    const editor = makeEditor();
    const el = editor.view.dom as HTMLElement;

    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: '"',
      cancelable: true,
      bubbles: true,
    });

    const prevented = !el.dispatchEvent(event);

    expect(prevented).toBe(true);
    expect(editor.getText()).toBe('""');
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });

  it("ignores an in-progress composing beforeinput event", () => {
    const editor = makeEditor();
    const el = editor.view.dom as HTMLElement;

    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: '"',
      cancelable: true,
      bubbles: true,
    });
    // jsdom may not expose a writable isComposing in the constructor options;
    // force it via Object.defineProperty so the handler sees composition.
    Object.defineProperty(event, "isComposing", { value: true });

    const prevented = !el.dispatchEvent(event);

    expect(prevented).toBe(false);
    // The editor document should be unchanged — autoclose must not engage.
    expect(editor.getText()).toBe("");
    editor.destroy();
  });

  it("inserts exactly three backticks when three are typed sequentially", () => {
    const editor = makeEditor();

    type(editor, "`");
    type(editor, "`");
    type(editor, "`");

    expect(editor.getText()).toBe("```");
    expect(editor.state.selection.from).toBe(4);
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });
});
