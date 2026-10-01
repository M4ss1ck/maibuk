import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { normalizePhrase } from "@/features/dictation/normalize";
import {
  DICTATION_LANGUAGES,
  catalogCapabilities,
  defaultEntryEnabled,
  defaultSpokenPunctuationSettings,
  defaultTriggers,
  entriesFor,
  findAliasRefusal,
  isEntryEnabled,
  normalizeSpokenPunctuationSettings,
  type SpokenPunctuationSettings,
} from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";

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

describe("heard forms", () => {
  it("makes every heard value one of the entry's own phrases", () => {
    for (const language of DICTATION_LANGUAGES) {
      for (const entry of entriesFor(language)) {
        const phrases = new Set(entry.phrases.map(normalizePhrase));
        for (const [heard, meant] of Object.entries(entry.heard ?? {})) {
          expect(phrases.has(normalizePhrase(meant)), `${entry.id}: ${heard}`).toBe(true);
        }
      }
    }
  });

  it("keeps every heard key clear of any entry's phrases", () => {
    for (const language of DICTATION_LANGUAGES) {
      const phrases = new Set(
        entriesFor(language).flatMap((entry) => entry.phrases.map(normalizePhrase))
      );
      for (const entry of entriesFor(language)) {
        for (const heard of Object.keys(entry.heard ?? {})) {
          expect(phrases.has(normalizePhrase(heard)), `${entry.id}: ${heard}`).toBe(false);
        }
      }
    }
  });

  it("refuses a heard key added as an alias, as a duplicate of its own entry", () => {
    const settings = defaultSpokenPunctuationSettings().es;
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "cierre interrogación", settings })
    ).toEqual({ kind: "duplicate", entryId: "signoDeInterrogacion" });
  });

  it("lists only the default phrases in Settings while defaultTriggers adds the heard form", () => {
    const entry = entriesFor("es").find((candidate) => candidate.id === "signoDeInterrogacion")!;
    expect(defaultTriggers(entry)).toContain("cierre interrogación");
    expect(entry.phrases).not.toContain("cierre interrogación");
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

  it("refuses a phrase another entry already answers to, naming its owner", () => {
    expect(findAliasRefusal({ language: "es", entryId: "coma", alias: "punto", settings })).toEqual(
      { kind: "duplicate", entryId: "punto" }
    );
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "PUNTO, y coma.", settings })
    ).toEqual({ kind: "duplicate", entryId: "puntoYComa" });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "borra eso", settings })
    ).toEqual({ kind: "duplicate", entryId: "borraEso" });
  });

  it("refuses a phrase the entry itself already has, default or alias", () => {
    const withAlias = { ...settings, aliases: { coma: ["comita"] } };
    expect(findAliasRefusal({ language: "es", entryId: "coma", alias: "coma", settings })).toEqual({
      kind: "duplicate",
      entryId: "coma",
    });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "Comita", settings: withAlias })
    ).toEqual({ kind: "duplicate", entryId: "coma" });
  });

  it("refuses a phrase that starts with the escape word", () => {
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "literal", settings })
    ).toEqual({ kind: "escape", entryId: "literal", word: "literal" });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "literal coma", settings })
    ).toEqual({ kind: "escape", entryId: "literal", word: "literal" });
    expect(
      findAliasRefusal({ language: "en", entryId: "comma", alias: "Literal comma", settings })
    ).toEqual({ kind: "escape", entryId: "literal", word: "literal" });
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
    ).toEqual({ kind: "escape", entryId: "literal", word: "textual" });
    expect(
      findAliasRefusal({ language: "es", entryId: "coma", alias: "textuales", settings: withAlias })
    ).toBeNull();
  });

  it("refuses an escape alias that would shadow an existing alias, naming both", () => {
    const withAlias = { ...settings, aliases: { nuevoParrafo: ["nueva sección"] } };
    expect(
      findAliasRefusal({ language: "es", entryId: "literal", alias: "Nueva", settings: withAlias })
    ).toEqual({ kind: "shadow", entryId: "nuevoParrafo", conflict: "nueva sección" });
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "literal",
        alias: "nuevo",
        settings: withAlias,
      })
    ).toEqual({ kind: "shadow", entryId: "nuevoParrafo", conflict: "nuevo párrafo" });
    // Folded equality is a duplicate, not a shadow: no accents needed.
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "literal",
        alias: "nueva seccion",
        settings: withAlias,
      })
    ).toEqual({ kind: "duplicate", entryId: "nuevoParrafo" });
    // The whole phrase is a duplicate, not a shadow.
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "literal",
        alias: "nueva sección",
        settings: withAlias,
      })
    ).toEqual({ kind: "duplicate", entryId: "nuevoParrafo" });
    // A phrase the escape alias does not start stays available.
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "literal",
        alias: "sección",
        settings: withAlias,
      })
    ).toBeNull();
  });

  it("refuses an escape alias that starts a default phrase too", () => {
    // Defaults are never dropped on load, so this is not needed for storage to
    // survive; they count anyway so one rule holds for every phrase, and the
    // author is told before a longer alias would be refused as an escape.
    expect(
      findAliasRefusal({ language: "es", entryId: "literal", alias: "nueva", settings })
    ).toEqual({ kind: "shadow", entryId: "nuevaLinea", conflict: "nueva línea" });
    expect(
      findAliasRefusal({ language: "en", entryId: "literal", alias: "new", settings: settings })
    ).toEqual({ kind: "shadow", entryId: "newParagraph", conflict: "new paragraph" });
  });

  it("checks the language's own phrases only", () => {
    const en = defaultSpokenPunctuationSettings().en;
    expect(
      findAliasRefusal({ language: "en", entryId: "comma", alias: "punto", settings: en })
    ).toBeNull();
  });

  it("refuses the all-caps lock phrases as duplicates of their entries (#271)", () => {
    const en = defaultSpokenPunctuationSettings().en;
    expect(
      findAliasRefusal({ language: "en", entryId: "comma", alias: "all caps on", settings: en })
    ).toEqual({ kind: "duplicate", entryId: "allCapsOn" });
    expect(
      findAliasRefusal({ language: "en", entryId: "comma", alias: "all caps off", settings: en })
    ).toEqual({ kind: "duplicate", entryId: "allCapsOff" });
    const es = defaultSpokenPunctuationSettings().es;
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "coma",
        alias: "mayúsculas activadas",
        settings: es,
      })
    ).toEqual({ kind: "duplicate", entryId: "mayusculasActivadas" });
  });

  it("refuses numeral as a duplicate of its entry (#272)", () => {
    expect(
      findAliasRefusal({
        language: "en",
        entryId: "comma",
        alias: "numeral",
        settings: defaultSpokenPunctuationSettings().en,
      })
    ).toEqual({ kind: "duplicate", entryId: "numeral" });
    expect(
      findAliasRefusal({
        language: "es",
        entryId: "coma",
        alias: "numeral",
        settings: defaultSpokenPunctuationSettings().es,
      })
    ).toEqual({ kind: "duplicate", entryId: "numeral" });
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
          // escape-alias prefix, an escape alias shadowing a default, a
          // duplicate, and one good phrase.
          coma: ["punto", "literal coma", "textual coma", "comita", "comita"],
          literal: ["textual", "nueva"],
        },
      },
    });

    expect(normalized.es.aliases).toEqual({ literal: ["textual"], coma: ["comita"] });
  });

  it("keeps a switch for the all-caps off entry (#271)", () => {
    const normalized = normalizeSpokenPunctuationSettings({
      es: { entries: { mayusculasDesactivadas: false } },
      en: { entries: { allCapsOn: false } },
    });
    expect(normalized.es.entries).toEqual({ mayusculasDesactivadas: false });
    expect(normalized.en.entries).toEqual({ allCapsOn: false });
  });

  it("resolves a stored escape shadow toward the phrase that keeps working", () => {
    const normalized = normalizeSpokenPunctuationSettings({
      es: { aliases: { literal: ["nueva"], nuevoParrafo: ["nueva sección"] } },
    });

    expect(normalized.es.aliases).toEqual({ nuevoParrafo: ["nueva sección"] });
  });

  it("never drops an alias the settings UI accepted, in any add order", () => {
    const add = (
      settings: SpokenPunctuationSettings,
      language: DictationLanguage,
      entryId: string,
      alias: string
    ) => {
      if (findAliasRefusal({ language, entryId, alias, settings: settings[language] })) return;
      const current = settings[language];
      const existing = current.aliases[entryId] ?? [];
      if (existing.includes(alias)) return;
      settings[language] = {
        ...current,
        aliases: { ...current.aliases, [entryId]: [...existing, alias] },
      };
    };

    // Pairs that collide through the escape word in both directions, a
    // duplicate, and phrases that stay clear of each other. Each order's
    // accepted adds are spelled out, so the property cannot pass by refusing
    // everything.
    const orders: {
      adds: [DictationLanguage, string, string][];
      aliases: Partial<Record<DictationLanguage, Record<string, string[]>>>;
    }[] = [
      {
        adds: [
          ["es", "nuevoParrafo", "nueva sección"],
          ["es", "literal", "nueva"],
          ["es", "coma", "comita"],
          ["es", "punto", "comita"],
          ["es", "literal", "textual"],
          ["es", "coma", "textual coma"],
        ],
        aliases: {
          es: { nuevoParrafo: ["nueva sección"], coma: ["comita"], literal: ["textual"] },
        },
      },
      {
        adds: [
          ["es", "literal", "nueva"],
          ["es", "nuevoParrafo", "nueva sección"],
          ["es", "punto", "comita"],
          ["es", "coma", "comita"],
          ["es", "literal", "textual"],
          ["es", "coma", "textual coma"],
        ],
        aliases: {
          es: { nuevoParrafo: ["nueva sección"], punto: ["comita"], literal: ["textual"] },
        },
      },
      {
        adds: [
          ["en", "newParagraph", "next part"],
          ["en", "literal", "next"],
          ["en", "comma", "komma"],
          ["en", "period", "komma"],
          ["en", "literal", "quote"],
          ["en", "comma", "quote please"],
        ],
        aliases: { en: { newParagraph: ["next part"], comma: ["komma"], literal: ["quote"] } },
      },
      {
        adds: [
          ["en", "literal", "next"],
          ["en", "newParagraph", "next part"],
          ["en", "period", "komma"],
          ["en", "comma", "komma"],
          ["en", "literal", "quote"],
          ["en", "comma", "quote please"],
        ],
        aliases: { en: { literal: ["next", "quote"], period: ["komma"] } },
      },
    ];

    for (const { adds, aliases } of orders) {
      const settings = defaultSpokenPunctuationSettings();
      for (const [language, entryId, alias] of adds) add(settings, language, entryId, alias);
      expect(settings.es.aliases).toEqual(aliases.es ?? {});
      expect(settings.en.aliases).toEqual(aliases.en ?? {});
      expect(normalizeSpokenPunctuationSettings(settings)).toEqual(settings);
    }
  });
});
