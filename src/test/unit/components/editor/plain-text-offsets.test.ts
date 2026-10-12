import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import {
  buildPlainTextMap,
  plainOffsetToPm,
  plainRangeToPmRange,
  pmToPlainOffset,
} from "@/components/editor/plain-text-offsets";

const editors: Editor[] = [];

function editorFor(content: string): Editor {
  const editor = new Editor({ extensions: createRichTextExtensions(), content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

// Representative documents: marks, lists, footnotes, images, hard breaks,
// headings, blockquote, table, and a scene break. The mapping must survive
// every node kind the schema can hold, because a wrong offset breaks a
// highlight silently.
const DOCUMENTS: Record<string, string> = {
  paragraph: "<p>Hello world</p>",
  marks: "<p>Plain <strong>bold</strong> and <em>italic</em> and <code>code</code></p>",
  heading: "<h1>Title</h1><h2>Sub</h2><p>Body text</p>",
  list: "<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>",
  orderedList: "<ol><li><p>One</p></li><li><p>Two</p></li></ol>",
  taskList: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Todo</p></li></ul>',
  footnote: '<p>Before<sup data-footnote data-footnote-id="fn-1" data-footnote-content="note">*</sup>after</p>',
  image: '<p>Before</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="img"><p>After</p>',
  hardBreak: "<p>Line one<br>Line two</p>",
  blockquote: "<blockquote><p>Quoted words</p></blockquote><p>Outside</p>",
  table:
    "<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>",
  sceneBreak: '<p>Before</p><hr data-scene-break="symbol"><p>After</p>',
  nested: "<p>Intro</p><ul><li><p>Item <strong>bold</strong></p><ul><li><p>Nested</p></li></ul></li></ul><p>Outro</p>",
};

describe("buildPlainTextMap()", () => {
  it("derives the same text as editor.getText()", () => {
    for (const [name, content] of Object.entries(DOCUMENTS)) {
      const editor = editorFor(content);
      expect(buildPlainTextMap(editor.state.doc).text, name).toBe(editor.getText());
    }
  });
});

describe("plain-text offsets map back to editor positions", () => {
  // Property test: every substring of every text node round-trips through the
  // plain-text coordinate system, in both directions, for every document
  // shape. This is the guarantee reads, highlight ranges, and reveal share.
  it("round-trips every substring of every document", () => {
    for (const [name, content] of Object.entries(DOCUMENTS)) {
      const editor = editorFor(content);
      const doc = editor.state.doc;
      const map = buildPlainTextMap(doc);

      for (const segment of map.segments) {
        const length = segment.textEnd - segment.textStart;
        for (let i = 0; i <= length; i += 1) {
          for (let j = i; j <= length; j += 1) {
            const from = segment.textStart + i;
            const to = segment.textStart + j;
            const expected = map.text.slice(from, to);

            // offsets -> positions -> text
            const pm = plainRangeToPmRange(map, from, to);
            if (i === j) {
              expect(pm, `${name} empty range ${from}:${to}`).toBeNull();
              continue;
            }
            expect(pm, `${name} range ${from}:${to}`).not.toBeNull();
            if (pm === null) continue;
            expect(doc.textBetween(pm.from, pm.to), `${name} text ${from}:${to}`).toBe(expected);

            // positions -> offsets (the reverse direction)
            expect(pmToPlainOffset(map, pm.from), `${name} from ${from}`).toBe(from);
            expect(pmToPlainOffset(map, pm.to), `${name} to ${to}`).toBe(to);
          }
        }
      }
    }
  });

  it("maps a position inside a gap to the nearest text boundary", () => {
    const editor = editorFor("<p>First</p><p>Second</p>");
    const map = buildPlainTextMap(editor.state.doc);
    // "First" ends at offset 5; the paragraph break is two plain-text units.
    expect(map.text).toBe("First\n\nSecond");
    expect(plainOffsetToPm(map, 5, "end")).toBe(6);
    expect(plainOffsetToPm(map, 7, "start")).toBe(8);
    expect(pmToPlainOffset(map, 8)).toBe(7);
  });

  it("clamps offsets beyond the text to the last character", () => {
    const editor = editorFor("<p>abc</p>");
    const map = buildPlainTextMap(editor.state.doc);
    expect(plainOffsetToPm(map, 999, "start")).toBe(4);
    expect(plainOffsetToPm(map, 999, "end")).toBe(4);
  });

  it("returns an empty map for an empty document", () => {
    const editor = editorFor("");
    const map = buildPlainTextMap(editor.state.doc);
    expect(map.text).toBe("");
    expect(map.segments).toEqual([]);
    expect(plainOffsetToPm(map, 0, "start")).toBe(0);
  });
});
