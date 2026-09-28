import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { installedDictationLanguages, nextDictationLanguage } from "@/features/dictation/language";

describe("Dictation language choices", () => {
  it("deduplicates downloaded models in catalog order, not download order", () => {
    expect(installedDictationLanguages(MODEL_CATALOG.map((m) => m.id).reverse())).toEqual([
      "en",
      "es",
    ]);
  });

  it("cycles Auto, English, Spanish, Auto", () => {
    expect(nextDictationLanguage(null, ["en", "es"])).toBe("en");
    expect(nextDictationLanguage("en", ["en", "es"])).toBe("es");
    expect(nextDictationLanguage("es", ["en", "es"])).toBeNull();
  });

  it("skips missing languages and returns Auto for a removed override", () => {
    expect(nextDictationLanguage(null, ["en"])).toBe("en");
    expect(nextDictationLanguage("en", ["en"])).toBeNull();
    expect(nextDictationLanguage("es", ["en"])).toBeNull();
    expect(nextDictationLanguage(null, ["es"])).toBe("es");
  });

  it("has no next choice without a downloaded model", () => {
    expect(nextDictationLanguage(null, [])).toBeUndefined();
    expect(nextDictationLanguage("en", [])).toBeUndefined();
  });
});
