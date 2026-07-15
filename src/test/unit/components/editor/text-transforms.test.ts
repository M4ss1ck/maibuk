import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { transformSelectedText, type TextTransform } from "@/components/editor/text-transforms";

let editor: Editor | null = null;

function makeEditor(content: string) {
  editor = new Editor({ extensions: [StarterKit], content });
  return editor;
}

function transformAll(content: string, transform: TextTransform) {
  const instance = makeEditor(content);
  instance.commands.selectAll();
  transformSelectedText(instance, transform);
  return instance;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("transformSelectedText", () => {
  it("moves formatting with graphemes when text is reversed", () => {
    const instance = transformAll("<p><strong>ab</strong><em>cd</em></p>", "reverseText");

    expect(instance.getHTML()).toBe("<p><em>dc</em><strong>ba</strong></p>");
  });

  it("preserves block structure and transforms each block independently", () => {
    const instance = transformAll("<p><strong>ab</strong></p><p><em>cd</em></p>", "reverseText");

    expect(instance.getHTML()).toBe("<p><strong>ba</strong></p><p><em>dc</em></p>");
  });

  it("does not split emoji grapheme clusters while reversing", () => {
    const instance = transformAll("<p>A👩‍💻B</p>", "reverseText");

    expect(instance.getText()).toBe("B👩‍💻A");
  });

  it("mirrors supported characters and leaves unsupported ones intact", () => {
    const instance = transformAll("<p>abc!</p>", "horizontalMirror");

    expect(instance.getText()).toBe("!ɔdɒ");
  });

  it("turns text upside down with Unicode approximations", () => {
    const instance = transformAll("<p>Hello!</p>", "upsideDown");

    expect(instance.getText()).toBe("¡ollǝH");
  });

  it("converts the selected characters to leetspeak in place", () => {
    const instance = transformAll("<p>A test is so cool</p>", "leetspeak");

    expect(instance.getText()).toBe("4 7357 15 50 c00l");
  });

  it("changes only the selected text and preserves its marks", () => {
    const instance = makeEditor("<p>start <strong>test</strong> end</p>");
    instance.commands.setTextSelection({ from: 7, to: 11 });

    transformSelectedText(instance, "leetspeak");

    expect(instance.getHTML()).toBe("<p>start <strong>7357</strong> end</p>");
  });

  it("keeps transformations undoable", () => {
    const instance = transformAll("<p>Hello!</p>", "upsideDown");

    instance.commands.undo();

    expect(instance.getText()).toBe("Hello!");
  });
});
