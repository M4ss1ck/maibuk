import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/symbols/data/characters.json", () => ({
  default: {
    blocks: ["General Punctuation", "CJK Unified Ideographs"],
    chars: [[0x2014, "EM DASH", 0]],
    ranges: [[0x4e00, 0x4e02, 1, "CJK UNIFIED IDEOGRAPH"]],
  },
}));
vi.mock("@/features/symbols/data/emoji.json", () => ({
  default: {
    groups: [["Smileys & Emotion", "Sonrisas y emociones"]],
    emoji: [["😀", "grinning face", "cara sonriendo", "grin|smile", "sonrisa|feliz", 0]],
  },
}));

import { entriesForCategory, loadSymbolsCatalog, lookupByCodePoint } from "@/features/symbols/load";

describe("loadSymbolsCatalog", () => {
  it("lists emoji groups (localized) before blocks", async () => {
    const es = await loadSymbolsCatalog("es");
    expect(es.categories[0]).toBe("Sonrisas y emociones");
    expect(es.categories).toContain("General Punctuation");
  });

  it("builds entries for named chars and emoji with locale-aware labels", async () => {
    const es = await loadSymbolsCatalog("es");
    const emoji = es.entries.find((e) => e.glyph === "😀");
    expect(emoji?.label).toBe("cara sonriendo");
    expect(emoji?.search).toContain("feliz");
    expect(emoji?.search).toContain("grinning"); // en names remain searchable
    const dash = es.entries.find((e) => e.glyph === "—");
    expect(dash).toMatchObject({
      label: "EM DASH",
      code: "U+2014",
      category: "General Punctuation",
    });
  });

  it("uses English emoji labels under the en locale", async () => {
    const en = await loadSymbolsCatalog("en");
    expect(en.entries.find((e) => e.glyph === "😀")?.label).toBe("grinning face");
  });
});

describe("entriesForCategory", () => {
  it("returns the un-expanded pool for null", async () => {
    const catalog = await loadSymbolsCatalog("en");
    expect(entriesForCategory(catalog, null)).toBe(catalog.entries);
  });

  it("expands ranges with algorithmic names for a range-backed block", async () => {
    const catalog = await loadSymbolsCatalog("en");
    const cjk = entriesForCategory(catalog, "CJK Unified Ideographs");
    expect(cjk).toHaveLength(3);
    expect(cjk[0]).toMatchObject({
      glyph: "一",
      label: "CJK UNIFIED IDEOGRAPH-4E00",
      code: "U+4E00",
    });
  });
});

describe("lookupByCodePoint", () => {
  it("finds named chars and range chars, misses unassigned", async () => {
    const catalog = await loadSymbolsCatalog("en");
    expect(lookupByCodePoint(catalog, 0x2014)?.label).toBe("EM DASH");
    expect(lookupByCodePoint(catalog, 0x4e01)?.label).toBe("CJK UNIFIED IDEOGRAPH-4E01");
    expect(lookupByCodePoint(catalog, 0x10ffff)).toBeNull();
  });
});
