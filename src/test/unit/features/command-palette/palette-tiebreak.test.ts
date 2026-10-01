import { describe, expect, it } from "vitest";
import { preparePaletteIndex, searchPalette } from "@/features/command-palette/palette-index";
import type { PaletteItem } from "@/features/command-palette/palette-index";

describe("palette-index tie-breaking", () => {
  it("breaks score ties by collator label order then key", () => {
    const items: PaletteItem[] = [
      { key: "command:b", kind: "command", id: "b", label: "abd", terms: [], state: "runnable" },
      { key: "command:a", kind: "command", id: "a", label: "abc", terms: [], state: "runnable" },
      { key: "command:c", kind: "command", id: "c", label: "abc", terms: [], state: "runnable" },
    ];
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    expect(collator.compare("abc", "abd")).toBeLessThan(0);
    const index = preparePaletteIndex(items);
    const sections = searchPalette(index, { query: "ab", page: "root", recent: [] });
    expect(sections).toHaveLength(1);
    const results = sections[0].results;
    expect(results).toHaveLength(3);
    // All three tie on score, so "abc" labels come before "abd" (collator
    // order) and the two "abc" entries fall back to key order.
    expect(results.map((r) => r.score)).toEqual([results[0].score, results[0].score, results[0].score]);
    expect(results.map((r) => r.item.key)).toEqual(["command:a", "command:c", "command:b"]);
  });
});
