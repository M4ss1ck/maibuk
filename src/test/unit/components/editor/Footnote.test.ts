import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { collectFootnotes, Footnote } from "@/components/editor/extensions/Footnote";

// The React node view needs a mounted EditorContent; the commands do not.
const HeadlessFootnote = Footnote.extend({ addNodeView: () => null });

const fn = (id: string, content: string) =>
  `<sup data-footnote="" data-footnote-id="${id}" data-footnote-content="${content}">*</sup>`;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function makeEditor(content: string) {
  const editor = new Editor({ extensions: [StarterKit, HeadlessFootnote], content });
  editors.push(editor);
  return editor;
}

const texts = (editor: Editor) => collectFootnotes(editor.state.doc).map((f) => f.content);
const ids = (editor: Editor) => collectFootnotes(editor.state.doc).map((f) => f.id);

describe("collectFootnotes()", () => {
  it("lists Footnotes in document order with their index and position", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")} two${fn("b", "Second")}</p>`);

    const footnotes = collectFootnotes(editor.state.doc);

    expect(footnotes.map(({ id, content, index }) => ({ id, content, index }))).toEqual([
      { id: "a", content: "First", index: 0 },
      { id: "b", content: "Second", index: 1 },
    ]);
    expect(editor.state.doc.nodeAt(footnotes[1].pos)?.attrs.id).toBe("b");
  });
});

describe("updateFootnote", () => {
  it("changes only that Footnote's text and keeps its id and place", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")} two${fn("b", "Second")}</p>`);

    expect(editor.commands.updateFootnote({ id: "b" }, "Changed")).toBe(true);

    expect(texts(editor)).toEqual(["First", "Changed"]);
    expect(ids(editor)).toEqual(["a", "b"]);
    expect(editor.getText()).toBe("One two");
  });

  it("returns false and changes nothing for an unknown id", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")}</p>`);
    const before = editor.getHTML();

    expect(editor.commands.updateFootnote({ id: "missing" }, "Changed")).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("uses the index to pick one of two Footnotes that share an id (a pasted copy)", () => {
    const editor = makeEditor(`<p>One${fn("a", "Same")} two${fn("a", "Same")}</p>`);

    editor.commands.updateFootnote({ id: "a", index: 1 }, "Second copy");

    expect(texts(editor)).toEqual(["Same", "Second copy"]);
  });

  it("falls back to the first Footnote with the id when the index is stale", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")} two${fn("b", "Second")}</p>`);

    editor.commands.updateFootnote({ id: "b", index: 0 }, "Changed");

    expect(texts(editor)).toEqual(["First", "Changed"]);
  });

  it("is one undoable step", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")}</p>`);

    editor.commands.updateFootnote({ id: "a" }, "Changed");
    editor.commands.undo();

    expect(texts(editor)).toEqual(["First"]);
  });
});

describe("deleteFootnote", () => {
  it("removes the reference so the following Footnotes move up", () => {
    const editor = makeEditor(
      `<p>One${fn("a", "First")} two${fn("b", "Second")} three${fn("c", "Third")}</p>`
    );

    expect(editor.commands.deleteFootnote({ id: "b" })).toBe(true);

    expect(ids(editor)).toEqual(["a", "c"]);
    expect(collectFootnotes(editor.state.doc).map((f) => f.index)).toEqual([0, 1]);
    expect(editor.getText()).toBe("One two three");
  });

  it("returns false and changes nothing for an unknown id", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")}</p>`);

    expect(editor.commands.deleteFootnote({ id: "missing" })).toBe(false);
    expect(ids(editor)).toEqual(["a"]);
  });

  it("is restored with its text by one undo", () => {
    const editor = makeEditor(`<p>One${fn("a", "First")} two${fn("b", "Second")}</p>`);

    editor.commands.deleteFootnote({ id: "a" });
    editor.commands.undo();

    expect(texts(editor)).toEqual(["First", "Second"]);
    expect(ids(editor)).toEqual(["a", "b"]);
  });
});
