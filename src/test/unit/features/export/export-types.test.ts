import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_OPTIONS } from "../../../../features/export/types";

describe("DEFAULT_EXPORT_OPTIONS", () => {
  it("has includeTableOfContents set to true", () => {
    expect(DEFAULT_EXPORT_OPTIONS.includeTableOfContents).toBe(true);
  });

  it("has numberChapters set to true", () => {
    expect(DEFAULT_EXPORT_OPTIONS.numberChapters).toBe(true);
  });

  it("has prependChapterTitles set to true", () => {
    expect(DEFAULT_EXPORT_OPTIONS.prependChapterTitles).toBe(true);
  });
});
