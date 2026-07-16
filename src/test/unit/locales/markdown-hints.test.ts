import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

const EXPECTED_KEYS = [
  "bold",
  "italic",
  "strikethrough",
  "code",
  "codeBlock",
  "heading1",
  "heading2",
  "heading3",
  "bulletList",
  "numberedList",
  "taskList",
  "quote",
  "highlight",
  "horizontalRule",
] as const;

describe("editor.markdownHints i18n", () => {
  it("defines a non-empty spelling array for every markdown-parsed button in both locales", () => {
    for (const locale of [en, es]) {
      const hints = (locale.editor as Record<string, unknown>).markdownHints as Record<
        string,
        string[]
      >;
      expect(hints).toBeDefined();
      for (const key of EXPECTED_KEYS) {
        expect(Array.isArray(hints[key]), `missing hint: ${key}`).toBe(true);
        expect(hints[key].length).toBeGreaterThan(0);
        for (const spelling of hints[key]) {
          expect(spelling).toBeTruthy();
        }
      }
      expect(Object.keys(hints).sort()).toEqual([...EXPECTED_KEYS].sort());
    }
  });

  it("keeps the same number of spellings per hint in en and es", () => {
    const enHints = (en.editor as Record<string, unknown>).markdownHints as Record<
      string,
      string[]
    >;
    const esHints = (es.editor as Record<string, unknown>).markdownHints as Record<
      string,
      string[]
    >;
    for (const key of EXPECTED_KEYS) {
      expect(esHints[key].length, `spelling count mismatch: ${key}`).toBe(enHints[key].length);
    }
  });
});
