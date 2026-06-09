import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { clipboardTextSerializer } from "../../../../components/editor/extensions/CopyHandler";

function sliceText(html: string): string {
  const editor = new Editor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: html,
  });
  const { doc } = editor.state;
  const text = clipboardTextSerializer(doc.slice(0, doc.content.size));
  editor.destroy();
  return text;
}

describe("clipboardTextSerializer", () => {
  it("separates headings and paragraphs with a single newline (no blank lines)", () => {
    const text = sliceText("<h1>title</h1><h2>subtitle</h2><p>body</p>");
    expect(text).toBe("title\nsubtitle\nbody");
  });

  it("separates list items with a single newline", () => {
    const text = sliceText("<ul><li>list item 1</li><li>list item 2</li><li>list item 3</li></ul>");
    expect(text).toBe("list item 1\nlist item 2\nlist item 3");
  });

  it("does not insert blank lines between mixed headings and list items", () => {
    const text = sliceText(
      "<h1>title</h1><h2>subtitle</h2><h3>another heading</h3><ul><li>list item 1</li><li>list item 2</li><li>list item 3</li></ul>"
    );
    expect(text).toBe("title\nsubtitle\nanother heading\nlist item 1\nlist item 2\nlist item 3");
  });
});
