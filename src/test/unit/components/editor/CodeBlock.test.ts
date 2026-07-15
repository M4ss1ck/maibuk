import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

function makeEditor(content: string) {
  return new Editor({ extensions: createRichTextExtensions(), content });
}

function codeBlocks(editor: Editor): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock") blocks.push(node);
  });
  return blocks;
}

/** Select from just inside the first block to just inside the last. */
function selectAllText(editor: Editor) {
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
}

describe("CodeBlockWithCopy multi-line toggle", () => {
  it("collapses a selection spanning multiple paragraphs into one code block", () => {
    const editor = makeEditor("<p>line one</p><p>line two</p><p>line three</p>");
    selectAllText(editor);

    editor.commands.toggleCodeBlock();

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe("line one\nline two\nline three");
    editor.destroy();
  });

  it("keeps a single-paragraph selection as one code block", () => {
    const editor = makeEditor("<p>solo line</p>");
    selectAllText(editor);

    editor.commands.toggleCodeBlock();

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe("solo line");
    editor.destroy();
  });

  it("toggles an active code block back to paragraphs", () => {
    const editor = makeEditor("<pre><code>a\nb</code></pre>");
    editor.commands.setTextSelection(2);

    editor.commands.toggleCodeBlock();

    expect(codeBlocks(editor)).toHaveLength(0);
    editor.destroy();
  });
});
