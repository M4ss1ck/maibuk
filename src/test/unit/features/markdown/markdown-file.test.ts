import { describe, expect, it } from "vitest";
import {
  markdownFilename,
  titleFromMarkdown,
} from "../../../../features/markdown/markdown-file";

describe("markdownFilename()", () => {
  it("slugifies a title", () => {
    expect(markdownFilename("My Great Chapter")).toBe("my-great-chapter.md");
  });

  it("strips punctuation and collapses separators", () => {
    expect(markdownFilename("Chapter 1: The End!")).toBe("chapter-1-the-end.md");
  });

  it("falls back to untitled for empty/symbol-only titles", () => {
    expect(markdownFilename("")).toBe("untitled.md");
    expect(markdownFilename("!!!")).toBe("untitled.md");
  });
});

describe("titleFromMarkdown()", () => {
  it("uses the first heading when present", () => {
    expect(titleFromMarkdown("# Real Title\n\nbody", "file")).toBe("Real Title");
  });

  it("falls back to the provided name when no heading", () => {
    expect(titleFromMarkdown("just body text", "my-file")).toBe("my-file");
  });

  it("uses Untitled when both are empty", () => {
    expect(titleFromMarkdown("", "")).toBe("Untitled");
  });
});
