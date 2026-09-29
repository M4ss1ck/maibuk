import { beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { pickModel, useDictationStore } from "@/features/dictation/store";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import {
  defaultSpokenPunctuationSettings,
  normalizeSpokenPunctuationSettings,
} from "@/features/dictation/spoken-punctuation";
import { defaultVocabularySettings } from "@/features/dictation/vocabulary";

const ids = (tier: string, lang: string) =>
  MODEL_CATALOG.find((m) => m.tier === tier && m.languages.includes(lang as "en"))!.id;

describe("pickModel()", () => {
  it("prefers the author's tier when installed", () => {
    const installed = [ids("fast", "es"), ids("accurate", "es")];
    expect(pickModel("es", MODEL_CATALOG, installed, { en: "fast", es: "accurate" })?.id).toBe(
      ids("accurate", "es")
    );
  });

  it("falls back to any installed tier for the language", () => {
    expect(
      pickModel("es", MODEL_CATALOG, [ids("fast", "es")], {
        en: "fast",
        es: "accurate",
      })?.id
    ).toBe(ids("fast", "es"));
  });

  it("returns null when nothing for the language is installed", () => {
    expect(
      pickModel("es", MODEL_CATALOG, [ids("fast", "en")], {
        en: "fast",
        es: "fast",
      })
    ).toBeNull();
  });
});

describe("Spoken Punctuation settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useDictationStore.setState({ spokenPunctuation: defaultSpokenPunctuationSettings() });
  });

  it("switches the master and one entry per language", () => {
    const { setSpokenPunctuationEnabled, setSpokenPunctuationEntryEnabled } =
      useDictationStore.getState();
    setSpokenPunctuationEnabled("es", false);
    setSpokenPunctuationEntryEnabled("en", "comma", false);

    const state = useDictationStore.getState().spokenPunctuation;
    expect(state.es.enabled).toBe(false);
    expect(state.en.enabled).toBe(true);
    expect(state.en.entries).toEqual({ comma: false });
  });

  it("adds, trims, and removes aliases", () => {
    const { addSpokenPunctuationAlias, removeSpokenPunctuationAlias } =
      useDictationStore.getState();
    addSpokenPunctuationAlias("es", "puntoYAparte", "  punto y la parte  ");
    addSpokenPunctuationAlias("es", "puntoYAparte", "punto y la parte");
    addSpokenPunctuationAlias("es", "puntoYAparte", "   ");

    expect(useDictationStore.getState().spokenPunctuation.es.aliases).toEqual({
      puntoYAparte: ["punto y la parte"],
    });

    removeSpokenPunctuationAlias("es", "puntoYAparte", "punto y la parte");
    removeSpokenPunctuationAlias("es", "puntoYAparte", "not stored");
    expect(useDictationStore.getState().spokenPunctuation.es.aliases).toEqual({});
  });

  it("resets one entry's switch and aliases", () => {
    const {
      setSpokenPunctuationEntryEnabled,
      addSpokenPunctuationAlias,
      resetSpokenPunctuationEntry,
    } = useDictationStore.getState();
    setSpokenPunctuationEntryEnabled("es", "coma", false);
    addSpokenPunctuationAlias("es", "coma", "comita");
    addSpokenPunctuationAlias("es", "punto", "punto y la parte");

    resetSpokenPunctuationEntry("es", "coma");

    const state = useDictationStore.getState().spokenPunctuation.es;
    expect(state.entries).toEqual({});
    expect(state.aliases).toEqual({ punto: ["punto y la parte"] });
    // The master switch is not the entry's to reset.
    expect(state.enabled).toBe(true);
  });

  it("persists the settings and normalizes them on rehydrate", async () => {
    const user = useDictationStore.getState();
    user.setSpokenPunctuationEnabled("es", false);
    user.addSpokenPunctuationAlias("es", "coma", "comita");

    const saved = localStorage.getItem("maibuk-dictation");
    expect(saved).not.toBeNull();

    useDictationStore.setState({ spokenPunctuation: defaultSpokenPunctuationSettings() });
    localStorage.setItem(
      "maibuk-dictation",
      JSON.stringify({
        state: {
          enabled: true,
          preferredTier: { en: "fast", es: "fast" },
          spokenPunctuation: {
            es: { enabled: false, entries: { coma: true }, aliases: { coma: ["comita"] } },
            en: 7,
          },
        },
        version: 0,
      })
    );
    await act(async () => {
      await useDictationStore.persist.rehydrate();
    });

    expect(useDictationStore.getState().spokenPunctuation).toEqual(
      normalizeSpokenPunctuationSettings({
        es: { enabled: false, entries: { coma: true }, aliases: { coma: ["comita"] } },
      })
    );
  });

  it("defaults a legacy record with no Spoken Punctuation settings", async () => {
    localStorage.setItem(
      "maibuk-dictation",
      JSON.stringify({ state: { preferredTier: { en: "accurate", es: "fast" } }, version: 0 })
    );
    await act(async () => {
      await useDictationStore.persist.rehydrate();
    });

    expect(useDictationStore.getState().spokenPunctuation).toEqual(
      defaultSpokenPunctuationSettings()
    );
  });
});

describe("Dictation Vocabulary settings", () => {
  beforeEach(() => {
    localStorage.clear();
    useDictationStore.setState({ vocabulary: defaultVocabularySettings() });
  });

  it("adds, trims, and removes entries per language", () => {
    const { addVocabularyEntry, removeVocabularyEntry } = useDictationStore.getState();
    addVocabularyEntry("es", "  a reliano ", "  Aureliano ");
    addVocabularyEntry("en", "a reliano", "Aureliano");
    addVocabularyEntry("es", "   ", "vacío");
    addVocabularyEntry("es", "sin escrita", "  ");

    expect(useDictationStore.getState().vocabulary).toEqual({
      es: [{ heard: "a reliano", written: "Aureliano" }],
      en: [{ heard: "a reliano", written: "Aureliano" }],
    });

    removeVocabularyEntry("es", 0);
    removeVocabularyEntry("es", 4);
    expect(useDictationStore.getState().vocabulary.es).toEqual([]);
    expect(useDictationStore.getState().vocabulary.en).toHaveLength(1);
  });

  it("keeps a repeated heard form out, folded", () => {
    const { addVocabularyEntry } = useDictationStore.getState();
    addVocabularyEntry("es", "a reliano", "Aureliano");
    addVocabularyEntry("es", "A RELIANO", "Otro");
    addVocabularyEntry("es", "Buendía", "Buendía");
    addVocabularyEntry("es", "buendia", "Otro");

    expect(useDictationStore.getState().vocabulary.es).toEqual([
      { heard: "a reliano", written: "Aureliano" },
      { heard: "Buendía", written: "Buendía" },
    ]);
  });

  it("edits an entry in place, keeping its own heard form", () => {
    const { addVocabularyEntry, updateVocabularyEntry } = useDictationStore.getState();
    addVocabularyEntry("es", "a reliano", "Aureliano");
    addVocabularyEntry("es", "buendía", "Buendía");

    updateVocabularyEntry("es", 0, " a reliano ", " Aureliano Buendía ");
    expect(useDictationStore.getState().vocabulary.es[0]).toEqual({
      heard: "a reliano",
      written: "Aureliano Buendía",
    });

    // Another entry's heard form is refused; empty forms are refused.
    updateVocabularyEntry("es", 0, "BUENDIA", "X");
    updateVocabularyEntry("es", 0, "", "X");
    updateVocabularyEntry("es", 9, "otro", "X");
    expect(useDictationStore.getState().vocabulary.es).toEqual([
      { heard: "a reliano", written: "Aureliano Buendía" },
      { heard: "buendía", written: "Buendía" },
    ]);
  });

  it("persists the vocabulary and normalizes it on rehydrate", async () => {
    const { addVocabularyEntry } = useDictationStore.getState();
    addVocabularyEntry("es", "a reliano", "Aureliano");

    const saved = localStorage.getItem("maibuk-dictation");
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved as string).state.vocabulary.es).toEqual([
      { heard: "a reliano", written: "Aureliano" },
    ]);

    useDictationStore.setState({ vocabulary: defaultVocabularySettings() });
    localStorage.setItem(
      "maibuk-dictation",
      JSON.stringify({
        state: {
          vocabulary: {
            es: [
              { heard: " a reliano ", written: " Aureliano " },
              { heard: "A RELIANO", written: "Otro" },
              { heard: "", written: "vacío" },
            ],
            en: 7,
          },
        },
        version: 0,
      })
    );
    await act(async () => {
      await useDictationStore.persist.rehydrate();
    });

    const vocabulary = useDictationStore.getState().vocabulary;
    expect(vocabulary.es).toEqual([{ heard: "a reliano", written: "Aureliano" }]);
    expect(vocabulary.en).toEqual([]);
  });

  it("defaults a legacy record with no vocabulary", async () => {
    localStorage.setItem(
      "maibuk-dictation",
      JSON.stringify({ state: { preferredTier: { en: "accurate", es: "fast" } }, version: 0 })
    );
    await act(async () => {
      await useDictationStore.persist.rehydrate();
    });

    expect(useDictationStore.getState().vocabulary).toEqual(defaultVocabularySettings());
  });
});
