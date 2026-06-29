import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "@/features/markdown/detect-markdown";

describe("looksLikeMarkdown()", () => {
  it("returns false for empty or whitespace input", () => {
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("   \n  ")).toBe(false);
  });

  it("returns false for plain prose", () => {
    expect(
      looksLikeMarkdown("The quick brown fox jumps over the lazy dog. It was a fine day.")
    ).toBe(false);
  });

  it("does not fire on prose with a stray dash or number", () => {
    expect(looksLikeMarkdown("She paused - then continued walking down 5th street.")).toBe(false);
    expect(looksLikeMarkdown("1. is the number she wrote")).toBe(false);
  });

  it("detects a fenced code block on its own (strong signal)", () => {
    expect(looksLikeMarkdown("```js\nconst x = 1;\n```")).toBe(true);
  });

  it("detects a GFM table on its own (strong signal)", () => {
    expect(looksLikeMarkdown("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(true);
  });

  it("detects a document with heading + list (two weak signals)", () => {
    expect(looksLikeMarkdown("# Title\n\n- first\n- second")).toBe(true);
  });

  it("detects heading + bold", () => {
    expect(looksLikeMarkdown("## Chapter\n\nThis is **important** text.")).toBe(true);
  });

  it("requires two distinct signal types, not one repeated", () => {
    // Three list items = one signal type → not enough on its own.
    expect(looksLikeMarkdown("- one\n- two\n- three")).toBe(false);
  });

  it("detects a typical pasted markdown article", () => {
    const md = [
      "# My Article",
      "",
      "Some intro paragraph with a [link](https://example.com).",
      "",
      "## Section",
      "",
      "- point one",
      "- point two",
    ].join("\n");
    expect(looksLikeMarkdown(md)).toBe(true);
  });
});
