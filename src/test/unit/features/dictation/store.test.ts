import { beforeEach, describe, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { pickModel, useDictationStore } from "@/features/dictation/store";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import {
  defaultSpokenPunctuationSettings,
  normalizeSpokenPunctuationSettings,
} from "@/features/dictation/spoken-punctuation";

const ids = (tier: string, lang: string) =>
  MODEL_CATALOG.find(
    (m) => m.tier === tier && m.languages.includes(lang as "en"),
  )!.id;

describe("pickModel()", () => {
  it("prefers the author's tier when installed", () => {
    const installed = [ids("fast", "es"), ids("accurate", "es")];
    expect(
      pickModel("es", MODEL_CATALOG, installed, { en: "fast", es: "accurate" })
        ?.id,
    ).toBe(ids("accurate", "es"));
  });

  it("falls back to any installed tier for the language", () => {
    expect(
      pickModel("es", MODEL_CATALOG, [ids("fast", "es")], {
        en: "fast",
        es: "accurate",
      })?.id,
    ).toBe(ids("fast", "es"));
  });

  it("returns null when nothing for the language is installed", () => {
    expect(
      pickModel("es", MODEL_CATALOG, [ids("fast", "en")], {
        en: "fast",
        es: "fast",
      }),
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
