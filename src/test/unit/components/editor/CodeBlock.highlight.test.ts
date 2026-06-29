import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { lowlight } from "@/components/editor/extensions/CodeBlock";

function makeEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content,
  });
}

describe("code block syntax highlighting", () => {
  it("registers the shell language and its `sh` alias", () => {
    expect(lowlight.registered("bash")).toBe(true);
    // `sh` is the alias used by the ```sh fenced-code shortcut.
    const tree = lowlight.highlight("sh", "echo hello");
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain("hljs-");
  });

  it("highlights a fenced code block's language as token spans", () => {
    const editor = makeEditor('<pre><code class="language-sh">echo hello</code></pre>');

    const html = editor.view.dom.innerHTML;
    expect(html).toContain("hljs-");
    editor.destroy();
  });

  it("does not highlight a code block without a language", () => {
    const editor = makeEditor("<pre><code>for item in items</code></pre>");

    const html = editor.view.dom.innerHTML;
    expect(html).not.toContain("hljs-");
    editor.destroy();
  });

  it("registers common languages (js, ts, python)", () => {
    expect(lowlight.registered("javascript")).toBe(true);
    expect(lowlight.registered("typescript")).toBe(true);
    expect(lowlight.registered("python")).toBe(true);
  });
});
