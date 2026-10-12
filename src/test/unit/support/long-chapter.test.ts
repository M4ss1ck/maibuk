// The #401 long Chapter is one shared document: the unit bench, the Plugin
// editor tests, and the frame-rate seed all build it from
// `src/test/support/long-chapter.ts`, and this gate pins its shape and its
// word count so the copy can never drift from the number the frame budget
// (#401) was measured against.

import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "@/components/editor/html-to-text";
import { countWords } from "@/features/metrics/word-count";
import { LONG_CHAPTER_PARAGRAPHS, longChapterHtml } from "@/test/support/long-chapter";

describe("the long Chapter", () => {
  it("is deterministic across calls", () => {
    expect(longChapterHtml()).toBe(longChapterHtml());
  });

  it("emits LONG_CHAPTER_PARAGRAPHS top-level paragraphs outside lists", () => {
    const body = new DOMParser().parseFromString(longChapterHtml(), "text/html").body;
    const paragraphs = Array.from(body.children).filter((el) => el.tagName === "P");
    expect(paragraphs).toHaveLength(LONG_CHAPTER_PARAGRAPHS);
  });

  it("is 19771 words by countWords", () => {
    expect(countWords(htmlToPlainText(longChapterHtml()))).toBe(19771);
  });
});
