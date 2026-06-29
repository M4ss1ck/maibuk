import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { shouldPromptMarkdownPaste } from "@/components/editor/extensions/paste-markdown-guard";

function makeEditor(content: string) {
  return new Editor({ extensions: [StarterKit], content });
}

function selectInside(editor: Editor, text: string) {
  let pos = 0;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.isTextblock && node.textContent === text) {
      pos = nodePos + 1;
    }
  });
  editor.commands.setTextSelection(pos);
}

describe("shouldPromptMarkdownPaste", () => {
  it("prompts for a normal paragraph paste", () => {
    const editor = makeEditor("<p>hello</p>");
    selectInside(editor, "hello");

    expect(shouldPromptMarkdownPaste(editor.state, { plainPaste: false })).toBe(true);
    editor.destroy();
  });

  it("does not prompt when the caret is inside a code block", () => {
    const editor = makeEditor("<pre><code>const x = 1</code></pre>");
    selectInside(editor, "const x = 1");

    expect(shouldPromptMarkdownPaste(editor.state, { plainPaste: false })).toBe(false);
    editor.destroy();
  });

  it("does not prompt on a paste-without-formatting (shift) paste", () => {
    const editor = makeEditor("<p>hello</p>");
    selectInside(editor, "hello");

    expect(shouldPromptMarkdownPaste(editor.state, { plainPaste: true })).toBe(false);
    editor.destroy();
  });
});
