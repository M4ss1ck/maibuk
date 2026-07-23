import { describe, expect, it } from "vitest";
import {
  droppedTextToEditorHtml,
  textDropExtension,
  textDropStem,
} from "@/features/markdown/dropped-file";

describe("textDropExtension()", () => {
  it("matches supported extensions case-insensitively", () => {
    expect(textDropExtension("notes.md")).toBe(".md");
    expect(textDropExtension("Notes.MD")).toBe(".md");
    expect(textDropExtension("a.markdown")).toBe(".markdown");
    expect(textDropExtension("a.txt")).toBe(".txt");
  });

  it("returns null for unsupported files", () => {
    expect(textDropExtension("image.png")).toBeNull();
    expect(textDropExtension("archive.md.zip")).toBeNull();
    expect(textDropExtension("no-extension")).toBeNull();
  });
});

describe("textDropStem()", () => {
  it("strips the matched extension, preserving the rest", () => {
    expect(textDropStem("My Chapter.md")).toBe("My Chapter");
    expect(textDropStem("a.b.txt")).toBe("a.b");
  });

  it("returns the name unchanged when no supported extension matches", () => {
    expect(textDropStem("image.png")).toBe("image.png");
  });
});

describe("droppedTextToEditorHtml()", () => {
  it("converts markdown files through the markdown pipeline", () => {
    expect(droppedTextToEditorHtml("# Title\n\nBody", ".md")).toBe("<h1>Title</h1>\n<p>Body</p>");
  });

  it("converts markdown-looking .txt through the markdown pipeline", () => {
    expect(droppedTextToEditorHtml("# Title\n\n- a\n- b", ".txt")).toContain("<h1>Title</h1>");
  });

  it("converts plain .txt into escaped paragraphs with <br> line breaks", () => {
    const html = droppedTextToEditorHtml("one <b>raw</b>\ntwo\n\nthree & four", ".txt");
    expect(html).toBe("<p>one &lt;b&gt;raw&lt;/b&gt;<br>two</p><p>three &amp; four</p>");
  });

  it("returns empty string for blank content", () => {
    expect(droppedTextToEditorHtml("   \n  ", ".txt")).toBe("");
    expect(droppedTextToEditorHtml("", ".md")).toBe("");
  });
});
