// src/test/unit/components/editor/Wikilink.test.ts
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Wikilink } from "@/components/editor/extensions/Wikilink";

function makeEditor(content = "<p></p>") {
  return new Editor({ extensions: [StarterKit, Wikilink], content });
}

describe("Wikilink node", () => {
  it("renders a bound wikilink as a maibuk anchor", () => {
    const editor = makeEditor();
    editor.commands.insertContent({
      type: "wikilink",
      attrs: { href: "maibuk://note/n1", label: "My Note" },
    });
    const html = editor.getHTML();
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('href="maibuk://note/n1"');
    expect(html).toContain("My Note");
    editor.destroy();
  });

  it("renders an unresolved wikilink with broken class and data-label", () => {
    const editor = makeEditor();
    editor.commands.insertContent({
      type: "wikilink",
      attrs: { href: null, label: "New Idea" },
    });
    const html = editor.getHTML();
    expect(html).toContain("wikilink-broken");
    expect(html).toContain('data-label="New Idea"');
    editor.destroy();
  });

  it("parses a bound wikilink back from html", () => {
    const editor = makeEditor('<p><a class="wikilink" href="maibuk://book/b1">Book</a></p>');
    const json = editor.getJSON();
    const node = JSON.stringify(json);
    expect(node).toContain("wikilink");
    expect(node).toContain("maibuk://book/b1");
    editor.destroy();
  });
});
