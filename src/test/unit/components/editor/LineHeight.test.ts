import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LINE_HEIGHT,
  normalizeLineHeight,
} from "@/components/editor/extensions/LineHeight";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
});

function makeEditor(content = "<p>Hello</p>", withTaskList = false): Editor {
  const editor = new Editor({
    extensions: withTaskList
      ? [...createRichTextExtensions(), TaskList, TaskItem.configure({ nested: true })]
      : createRichTextExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

/** Cursor at the first occurrence of `text`. */
function cursorInText(editor: Editor, text: string, offset = 0) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text === text) {
      from = pos;
    }
  });
  expect(from).toBeGreaterThan(-1);
  editor.commands.setTextSelection(from + offset);
}

// Browsers and jsdom always serialize a style attribute with a trailing
// semicolon; strip it so assertions read the style content the editor set.
function html(editor: Editor): string {
  return editor.getHTML().replace(/;"/g, '"');
}

describe("normalizeLineHeight", () => {
  it.each([
    ["1", "1"],
    ["1.50", "1.5"],
    [" 2 ", "2"],
    ["150%", "1.5"],
    ["normal", null],
    ["24px", null],
    ["0", null],
    ["-1", null],
    ["", null],
    [undefined, null],
    [null, null],
    ["abc", null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeLineHeight(input)).toBe(expected);
  });

  it("exposes the index.css default", () => {
    expect(DEFAULT_LINE_HEIGHT).toBe("1.75");
  });
});

describe("LineHeight block attribute", () => {
  it("sets the block attribute on the paragraph at the cursor", () => {
    const editor = makeEditor("<p>Hello</p>");
    editor.commands.setTextSelection(1);

    expect(editor.chain().setLineHeight("1").run()).toBe(true);

    expect(html(editor)).toContain('<p style="line-height: 1; --line-height: 1">Hello</p>');
  });

  it("sets the attribute on the bullet list item and leaves its paragraph unstyled", () => {
    const editor = makeEditor("<ul><li><p>One</p></li></ul>");
    cursorInText(editor, "One", 1);

    editor.chain().setLineHeight("1").run();

    expect(html(editor)).toContain('<li style="line-height: 1; --line-height: 1"><p>One</p></li>');
  });

  it("updates only the nested list item", () => {
    const editor = makeEditor("<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>");
    cursorInText(editor, "Inner", 1);

    editor.chain().setLineHeight("1").run();

    const out = html(editor);
    expect(out).toContain('<li><p>Outer</p><ul><li style="line-height: 1; --line-height: 1">');
    expect(out).not.toContain('<li style="line-height: 1; --line-height: 1"><p>Outer');
  });

  it("sets the attribute on both paragraphs of a range selection", () => {
    const editor = makeEditor("<p>Hello</p><p>World</p>");
    editor.chain().setTextSelection({ from: 1, to: 11 }).run();

    editor.chain().setLineHeight("1.15").run();

    const out = html(editor);
    expect(out).toContain('<p style="line-height: 1.15; --line-height: 1.15">Hello</p>');
    expect(out).toContain('<p style="line-height: 1.15; --line-height: 1.15">World</p>');
  });

  it("sets the attribute on both list items of a range selection", () => {
    const editor = makeEditor("<ul><li><p>One</p></li><li><p>Two</p></li></ul>");
    editor.chain().setTextSelection({ from: 4, to: 13 }).run();

    editor.chain().setLineHeight("1.15").run();

    const out = html(editor);
    expect(out).toContain('<li style="line-height: 1.15; --line-height: 1.15"><p>One</p></li>');
    expect(out).toContain('<li style="line-height: 1.15; --line-height: 1.15"><p>Two</p></li>');
  });

  it("sets the attribute on a heading", () => {
    const editor = makeEditor("<h2>Title</h2>");
    editor.commands.setTextSelection(1);

    editor.chain().setLineHeight("2").run();

    // Editing a heading also stores its id (HeadingId).
    expect(html(editor)).toMatch(
      /<h2 id="h-[0-9a-f]{8}" style="line-height: 2; --line-height: 2">Title<\/h2>/
    );
  });

  it("sets the attribute on a task item", () => {
    const editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p></li></ul>',
      true
    );
    cursorInText(editor, "Task", 1);

    editor.chain().setLineHeight("1.5").run();

    expect(html(editor)).toContain('<li style="line-height: 1.5; --line-height: 1.5"');
    expect(html(editor)).toContain('data-type="taskItem"');
  });

  it("removes the attribute on unset", () => {
    const editor = makeEditor("<p>Hello</p>");
    editor.commands.setTextSelection(1);
    editor.chain().setLineHeight("1").run();

    editor.chain().unsetLineHeight().run();

    expect(html(editor)).toBe("<p>Hello</p>");
  });

  it("carries the value to the new paragraph after Enter", () => {
    const editor = makeEditor("<p>Hello</p>");
    editor.commands.setTextSelection(1);
    editor.chain().setLineHeight("1").run();

    editor.chain().splitBlock().run();

    const out = html(editor);
    expect(out).toContain('<p style="line-height: 1; --line-height: 1"></p>');
    expect(out).toContain('<p style="line-height: 1; --line-height: 1">Hello</p>');
  });

  it("carries the value to the new list item after Enter", () => {
    const editor = makeEditor("<ul><li><p>One</p></li></ul>");
    cursorInText(editor, "One", 1);
    editor.chain().setLineHeight("1").run();

    editor.chain().splitListItem("listItem").run();

    const out = html(editor);
    expect(out).toContain('<li style="line-height: 1; --line-height: 1"><p>O</p></li>');
    expect(out).toContain('<li style="line-height: 1; --line-height: 1"><p>ne</p></li>');
  });
});

describe("LineHeight legacy compatibility", () => {
  it("round-trips existing inline span line heights unchanged", () => {
    const editor = makeEditor('<p><span style="line-height: 2">a</span></p>');
    expect(html(editor)).toBe('<p><span style="line-height: 2">a</span></p>');
  });

  it("round-trips a span that carries color and line height", () => {
    const editor = makeEditor(
      '<p><span style="line-height: 1.5; color: rgb(255, 0, 0)">b</span></p>'
    );
    expect(html(editor)).toBe(
      '<p><span style="line-height: 1.5; color: rgb(255, 0, 0)">b</span></p>'
    );
  });

  it("does not write a line height when a color is applied", () => {
    const editor = makeEditor("<p>Hello</p>");
    editor.chain().setTextSelection({ from: 1, to: 6 }).run();

    editor.chain().setColor("#ff0000").run();

    expect(html(editor)).toContain('<span style="color: rgb(255, 0, 0)">Hello</span>');
    expect(html(editor)).not.toContain("line-height");
  });

  it("clears legacy spans when a block line height is set, keeping other attributes", () => {
    const editor = makeEditor(
      '<p><span style="line-height: 2">a</span><span style="line-height: 1.5; color: rgb(255, 0, 0)">b</span></p>'
    );
    editor.commands.setTextSelection(1);

    editor.chain().setLineHeight("1").run();

    expect(html(editor)).toBe(
      '<p style="line-height: 1; --line-height: 1">a<span style="color: rgb(255, 0, 0)">b</span></p>'
    );
  });
});

describe("LineHeight parsing", () => {
  it("reads a block line height from a style attribute", () => {
    const editor = makeEditor('<p style="line-height: 1.3">x</p>');
    expect(html(editor)).toBe('<p style="line-height: 1.3; --line-height: 1.3">x</p>');
  });

  it("ignores the normal keyword", () => {
    const editor = makeEditor('<p style="line-height: normal">x</p>');
    expect(html(editor)).toBe("<p>x</p>");
  });

  it("ignores a bare custom property", () => {
    const editor = makeEditor('<p style="--line-height: 2">x</p>');
    expect(html(editor)).toBe("<p>x</p>");
  });
});

describe("LineHeight invalid input", () => {
  it("returns false and changes nothing for a value that does not normalize", () => {
    const editor = makeEditor("<p>Hello</p>");
    editor.commands.setTextSelection(1);

    const result = editor.chain().setLineHeight("abc").run();

    expect(result).toBe(false);
    expect(html(editor)).toBe("<p>Hello</p>");
  });
});
