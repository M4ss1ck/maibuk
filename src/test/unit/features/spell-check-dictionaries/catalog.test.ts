import { describe, expect, it } from "vitest";
import {
  DICTIONARY_CATALOG,
  DICTIONARY_COMMIT,
  dictionaryFor,
  dictionaryScript,
  validateCatalog,
} from "@/features/spell-check-dictionaries/catalog";
import type { SpellCheckDictionary } from "@/features/spell-check-dictionaries/types";

const entry = DICTIONARY_CATALOG[0];

describe("DICTIONARY_CATALOG", () => {
  it("is valid", () => {
    expect(validateCatalog(DICTIONARY_CATALOG)).toEqual([]);
  });

  it("lists only the languages the budget allows", () => {
    expect(DICTIONARY_CATALOG.map((dictionary) => dictionary.language).sort()).toEqual([
      "de",
      "el",
      "fr",
      "it",
      "nl",
      "pl",
      "pt",
      "ru",
      "tr",
      "uk",
    ]);
  });

  it("pins every file and source to the commit", () => {
    for (const dictionary of DICTIONARY_CATALOG) {
      expect(dictionary.aff.url).toContain(DICTIONARY_COMMIT);
      expect(dictionary.dic.url).toContain(DICTIONARY_COMMIT);
      expect(dictionary.source).toContain(DICTIONARY_COMMIT);
    }
  });

  it("assigns the script each language is written in", () => {
    expect(dictionaryScript("ru")).toBe("Cyrillic");
    expect(dictionaryScript("uk")).toBe("Cyrillic");
    expect(dictionaryScript("el")).toBe("Greek");
    expect(dictionaryScript("fr")).toBe("Latin");
    expect(dictionaryScript("en")).toBe("Latin");
    expect(dictionaryScript("es")).toBe("Latin");
    expect(dictionaryScript("ja")).toBeNull();
  });
});

describe("validateCatalog()", () => {
  it("reports a url that is not https", () => {
    const broken: SpellCheckDictionary = {
      ...entry,
      aff: { ...entry.aff, url: entry.aff.url.replace("https://", "http://") },
    };
    expect(validateCatalog([broken])).not.toEqual([]);
  });

  it("reports a sha256 that is not 64 lowercase hex", () => {
    const broken: SpellCheckDictionary = {
      ...entry,
      dic: { ...entry.dic, sha256: "abc" },
    };
    expect(validateCatalog([broken])).not.toEqual([]);
  });

  it("reports an empty license", () => {
    const broken: SpellCheckDictionary = { ...entry, license: " " };
    expect(validateCatalog([broken])).not.toEqual([]);
  });

  it("reports a duplicate language", () => {
    expect(validateCatalog([entry, entry])).not.toEqual([]);
  });
});

describe("dictionaryFor()", () => {
  it("finds a catalog entry by language", () => {
    expect(dictionaryFor("fr")?.language).toBe("fr");
    expect(dictionaryFor("ja")).toBeUndefined();
  });
});
