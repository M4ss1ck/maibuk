// src/test/unit/components/editor/HeadingId.test.ts
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { HeadingId } from "../../../../components/editor/extensions/HeadingId";

function makeEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      HeadingId,
    ],
    content,
  });
}

describe("HeadingId extension", () => {
  it("parses an existing heading id and renders it back", () => {
    const editor = makeEditor('<h2 id="h-keep">Stable</h2>');
    expect(editor.getHTML()).toContain('id="h-keep"');
    editor.destroy();
  });

  it("does not add an id attribute when none is present", () => {
    const editor = makeEditor("<h2>No id</h2>");
    expect(editor.getHTML()).not.toContain("id=");
    editor.destroy();
  });
});
