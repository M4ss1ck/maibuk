import { describe, expect, it } from "vitest";
import { countWords } from "../../../../features/metrics/word-count";

describe("countWords()", () => {
  it("returns zero for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
  });

  it("counts whitespace-separated words without reading a whole document", () => {
    expect(countWords("Draft one\nwith  multiple\tspaces")).toBe(5);
  });

  it("treats hyphenated words as one word", () => {
    expect(countWords("twenty-one drafts")).toBe(2);
  });
});
