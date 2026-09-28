import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { normalizePhrase } from "@/features/dictation/normalize";
import {
  DICTATION_LANGUAGES,
  catalogCapabilities,
  defaultEntryEnabled,
  defaultSpokenPunctuationSettings,
  entriesFor,
  findAliasRefusal,
  isEntryEnabled,
  normalizeSpokenPunctuationSettings,
} from "@/features/dictation/spoken-punctuation";
import type { ModelSpec } from "@/features/dictation/types";

const punctuating: ModelSpec["capabilities"] = {
  casing: true,
  punctuation: true,
  streaming: true,
};
const bare: ModelSpec["capabilities"] = { casing: false, punctuation: false, streaming: true };

describe("Spoken Punctuation entries", () => {
  it("has an entry list per Dictation Language with unique ids and phrases", () => {
    for (const language of DICTATION_LANGUAGES) {
      const entries = entriesFor(language);
      expect(entries.length).toBeGreaterThan(0);
      const ids = new Set(entries.map((entry) => entry.id));
      expect(ids.size).toBe(entries.length);
      for (const entry of entries) {
        expect(entry.phrases.length).toBeGreaterThan(0);
        expect(entry.actions.length).toBeGreaterThan(0);
      }
    }
  });

  it("never gives two entries the same normalized default phrase", () => {
    for (const language of DICTATION_LANGUAGES) {
      const seen = new Map<string, string>();
      for (const entry of entriesFor(language)) {
        for (const phrase of entry.phrases) {
          const normalized = normalizePhrase(phrase);
          expect(normalized, `${entry.id}: ${phrase}`).not.toBe("");
          expect(
            seen.get(normalized),
            `${entry.id} and ${seen.get(normalized)} share "${phrase}"`
          ).toBeUndefined();
          seen.set(normalized, entry.id);
        }
      }
    }
  });

  it("covers every language the catalog offers", () => {
    const catalogLanguages = new Set(MODEL_CATALOG.flatMap((spec) => spec.languages));
    expect(catalogLanguages.size).toBeGreaterThan(0);
    for (const language of catalogLanguages) {
      expect(DICTATION_LANGUAGES, `missing Spoken Punctuation for ${language}`).toContain(language);
      expect(entriesFor(language).length).toBeGreaterThan(0);
    }
  });
});

describe("defaultEntryEnabled()", () => {
  it("follows the model for marks and keeps layout phrases on everywhere", () => {
    const entries = entriesFor("es");
    const comma = entries.find((entry) => entry.id === "coma")!;
    const paragraph = entries.find((entry) => entry.id === "nuevoParrafo")!;

    expect(defaultEntryEnabled(comma, bare)).toBe(true);
    expect(defaultEntryEnabled(comma, punctuating)).toBe(false);
    expect(defaultEntryEnabled(paragraph, punctuating)).toBe(true);
  });
});

describe("isEntryEnabled()", () => {
  it("lets the author's explicit switch override the model default", () => {
    const comma = entriesFor("es").find((entry) => entry.id === "coma")!;
    const settings = defaultSpokenPunctuationSettings().es;

    expect(isEntryEnabled(comma, settings, punctuating)).toBe(false);
    expect(isEntryEnabled(comma, { ...settings, entries: { coma: true } }, punctuating)).toBe(true);
    expect(isEntryEnabled(comma, { ...settings, entries: { coma: false } }, bare)).toBe(false);
  });

  it("turns everything off with the master switch", () => {
    const entries = entriesFor("es");
    const settings = { ...defaultSpokenPunctuationSettings().es, enabled: false };
    for (const entry of entries) {
      expect(isEntryEnabled(entry, settings, bare)).toBe(false);
    }
  });
});

describe("catalogCapabilities()", () => {
  it("gives the catalog's model data, not the language name", () => {
    expect(catalogCapabilities("en").punctuation).toBe(true);
    expect(catalogCapabilities("es").punctuation).toBe(false);
  });
});

describe("findAliasRefusal()", () => {
  const settings = defaultSpokenPunctuationSettings().es;

  it("accepts a new phrase, folding case, accents, and punctuation", () => {
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "puntoYAparte",
        alias: "Punto y la parte.",
        settings,
      })
    ).toBeNull();
    expect(
      findAliasRefusal({ language: "es", entryId: "puntoYAparte", alias: "  ", settings })
    ).toEqual({ kind: "empty" });
    expect(
      findAliasRefusal({ language: "es", entryId: "puntoYAparte", alias: "…", settings })
    ).toEqual({ kind: "empty" });
  });

  it("refuses a phrase another entry already answers to", () => {
    expect(findAliasRefusal({ language: "es", entryId: "coma", alias: "punto", settings })).toEqual(
      { kind: "duplicate" }
    );
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "PUNTO, y coma.", settings })
    ).toEqual({ kind: "duplicate" });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "borra eso", settings })
    ).toEqual({ kind: "duplicate" });
  });

  it("refuses a phrase the entry itself already has, default or alias", () => {
    const withAlias = { ...settings, aliases: { coma: ["comita"] } };
    expect(findAliasRefusal({ language: "es", entryId: "coma", alias: "coma", settings })).toEqual({
      kind: "duplicate",
    });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "Comita", settings: withAlias })
    ).toEqual({ kind: "duplicate" });
  });

  it("refuses a phrase that starts with the escape word", () => {
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "literal", settings })
    ).toEqual({ kind: "escape", word: "literal" });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "literal coma", settings })
    ).toEqual({ kind: "escape", word: "literal" });
    expect(
      findAliasRefusal({ language: "en", entryId: "comma", alias: "Literal comma", settings })
    ).toEqual({ kind: "escape", word: "literal" });
    // "literales" is another word, not the escape word.
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "literales", settings })
    ).toBeNull();
  });

  it("treats the author's own alias of the escape word as the escape word", () => {
    const withAlias = { ...settings, aliases: { literal: ["textual"] } };
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "coma",
        alias: "Textual coma",
        settings: withAlias,
      })
    ).toEqual({ kind: "escape", word: "textual" });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "textuales", settings: withAlias })
    ).toBeNull();
  });

  it("checks the language's own phrases only", () => {
    const en = defaultSpokenPunctuationSettings().en;
    expect(
      findAliasRefusal({ language: "en", entryId: "comma", alias: "punto", settings: en })
    ).toBeNull();
  });
});

describe("normalizeSpokenPunctuationSettings()", () => {
  it("returns the full defaults for missing or garbage input", () => {
    expect(normalizeSpokenPunctuationSettings(undefined)).toEqual(
      defaultSpokenPunctuationSettings()
    );
    expect(normalizeSpokenPunctuationSettings("nope")).toEqual(defaultSpokenPunctuationSettings());
    expect(normalizeSpokenPunctuationSettings({ es: 3 })).toEqual(
      defaultSpokenPunctuationSettings()
    );
  });

  it("keeps known switches and aliases and drops everything else", () => {
    const normalized = normalizeSpokenPunctuationSettings({
      es: {
        enabled: false,
        entries: { coma: false, noSuchEntry: true, punto: "yes" },
        aliases: { coma: ["comita", 7, "  "], noSuchEntry: ["x"], punto: "nope" },
      },
    });

    expect(normalized.es.enabled).toBe(false);
    expect(normalized.es.entries).toEqual({ coma: false });
    expect(normalized.es.aliases).toEqual({ coma: ["comita"] });
    expect(normalized.en).toEqual(defaultSpokenPunctuationSettings().en);
  });

  it("drops stored aliases the settings UI would refuse", () => {
    const normalized = normalizeSpokenPunctuationSettings({
      es: {
        aliases: {
          // A default phrase, a phrase starting with the escape word, an
          // escape-alias prefix, a duplicate, and one good phrase.
          coma: ["punto", "literal coma", "textual coma", "comita", "comita"],
          literal: ["textual"],
        },
      },
    });

    expect(normalized.es.aliases).toEqual({ literal: ["textual"], coma: ["comita"] });
  });
});
