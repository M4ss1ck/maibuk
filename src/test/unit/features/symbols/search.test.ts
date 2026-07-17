import { describe, expect, it } from "vitest";
import { searchSymbols } from "@/features/symbols/search";
import type { SymbolEntry } from "@/features/symbols/types";

const entry = (
  partial: Partial<SymbolEntry> & Pick<SymbolEntry, "glyph" | "label">
): SymbolEntry => ({
  code: null,
  category: "General Punctuation",
  search: partial.label.toLowerCase(),
  ...partial,
});

const emDash = entry({ glyph: "—", label: "EM DASH", code: "U+2014" });
const enDash = entry({ glyph: "–", label: "EN DASH", code: "U+2013" });
const dagger = entry({ glyph: "†", label: "DAGGER", code: "U+2020" });
const smile = entry({
  glyph: "😀",
  label: "grinning face",
  category: "Smileys & Emotion",
  search: "grinning face|sonrisa|feliz",
});
const all = [dagger, enDash, emDash, smile];

describe("searchSymbols", () => {
  it("returns the category listing for an empty query", () => {
    expect(searchSymbols(all, "", "Smileys & Emotion")).toEqual([smile]);
  });

  it("returns everything for empty query and null category", () => {
    expect(searchSymbols(all, "", null)).toEqual(all);
  });

  it("ranks exact label match before prefix before substring", () => {
    const results = searchSymbols(all, "em dash", null);
    expect(results[0]).toBe(emDash);
  });

  it("matches by prefix", () => {
    expect(searchSymbols(all, "dag", null)).toEqual([dagger]);
  });

  it("matches localized keywords in the search haystack", () => {
    expect(searchSymbols(all, "sonrisa", null)).toEqual([smile]);
  });

  it("matches by hex code point, with and without U+ prefix", () => {
    expect(searchSymbols(all, "2014", null)[0]).toBe(emDash);
    expect(searchSymbols(all, "U+2014", null)[0]).toBe(emDash);
  });

  it("matches the literal glyph itself", () => {
    expect(searchSymbols(all, "—", null)[0]).toBe(emDash);
  });

  it("respects the category filter while searching", () => {
    expect(searchSymbols(all, "dash", "Smileys & Emotion")).toEqual([]);
  });

  it("caps broad result sets without changing ranking", () => {
    const manySubstringMatches = Array.from({ length: 20 }, (_, index) =>
      entry({ glyph: String(index), label: `SYMBOL ${index}`, search: `symbol ${index}|dash` })
    );
    const exactMatch = entry({ glyph: "x", label: "DASH", search: "dash" });

    expect(searchSymbols([...manySubstringMatches, exactMatch], "dash", null, 5)).toEqual([
      exactMatch,
      ...manySubstringMatches.slice(0, 4),
    ]);
  });

  it("caps empty-query browsing without copying an already-small pool", () => {
    expect(searchSymbols(all, "", null, 2)).toEqual(all.slice(0, 2));
    expect(searchSymbols(all, "", null, 10)).toBe(all);
  });
});
