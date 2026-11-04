import { describe, expect, it } from "vitest";
import { countWords } from "@/features/metrics/word-count";
import { normalizeChapterContent } from "@/features/chapters/write";

const CJK_CASES: Array<[string, number]> = [
  ["我喜欢写小说和读书", 9],
  ["これは日本語です。", 8],
  ["コーヒー", 4],
  ["佐々木", 3],
  ["hello 世界", 3],
  ["世界。", 2],
  ["「世界」", 2],
  ["한국어 단어", 2],
  ["hello world", 2],
  ["señor, ¿qué tal?", 3],
  ["one — two", 3],
  ["", 0],
  ["“世界”", 2],
  ["世界——你好", 4],
  ["第1章", 3],
  ["hello世界", 3],
  ["。", 0],
  ["か\u3099", 1],
  ["二〇二四", 4],
  ["世界！", 2],
];

// Ten lines of English and Spanish prose: em dashes, curly quotes, inverted
// punctuation, hyphens, and ellipses. None of it is Han or kana, so it must
// keep counting exactly as it did before.
const PROSE = [
  "The first draft sat on the desk — a stack of pages, dog-eared and heavy.",
  "“Where does this chapter go?” she asked, and the room went quiet…",
  "¿Y ahora qué? The plot had run out of road, or so it seemed.",
  "He wrote about the long-forgotten harbour, the tide, and the well-known lighthouse.",
  "Each line was a small promise: start here, end there, keep the reader moving.",
  "—¿Lo intentamos otra vez? —preguntó ella, sin levantar la vista del papel.",
  "The answer, as always, was another revision, another careful pass.",
  "“No room for doubt,” he said, “only room for the next sentence.”",
  "So they began again, with coffee, with patience, and with a half-finished map.",
  "And the words came, one after another, until the page was full.",
].join("\n");

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

  it.each(CJK_CASES)("counts %j as %i words", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });

  it("leaves English and Spanish prose at the whitespace-token count", () => {
    expect(countWords(PROSE)).toBe(PROSE.trim().split(/\s+/).length);
    expect(countWords(PROSE)).toBe(126);
  });

  it("agrees with the word count a Chapter stores on save", () => {
    const text = "hello 世界 and мир";
    expect(normalizeChapterContent(`<p>${text}</p>`).wordCount).toBe(countWords(text));
  });
});
