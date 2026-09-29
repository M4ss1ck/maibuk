import { describe, expect, it } from "vitest";
import {
  defaultVocabularySettings,
  findVocabularyRefusal,
  normalizeVocabularySettings,
  type VocabularyEntry,
} from "@/features/dictation/vocabulary";

const entries: VocabularyEntry[] = [
  { heard: "a reliano", written: "Aureliano" },
  { heard: "buendía", written: "Buendía" },
];

describe("defaultVocabularySettings()", () => {
  it("starts both Dictation Languages empty", () => {
    expect(defaultVocabularySettings()).toEqual({ en: [], es: [] });
  });

  it("returns fresh arrays each call", () => {
    const first = defaultVocabularySettings();
    const second = defaultVocabularySettings();
    expect(first).not.toBe(second);
    expect(first.en).not.toBe(second.en);
  });
});

describe("findVocabularyRefusal()", () => {
  it("refuses an entry with an empty form after trimming", () => {
    expect(findVocabularyRefusal({ heard: "  ", written: "x", entries: [] })).toEqual({
      kind: "empty",
    });
    expect(findVocabularyRefusal({ heard: "x", written: " ", entries: [] })).toEqual({
      kind: "empty",
    });
    expect(findVocabularyRefusal({ heard: " ,.! ", written: "x", entries: [] })).toEqual({
      kind: "empty",
    });
  });

  it("refuses a heard form that folds to an existing one and names it", () => {
    expect(findVocabularyRefusal({ heard: "A RELIANO", written: "x", entries })).toEqual({
      kind: "duplicate",
      entry: "a reliano",
    });
    expect(findVocabularyRefusal({ heard: "Buendia.", written: "x", entries })).toEqual({
      kind: "duplicate",
      entry: "buendía",
    });
  });

  it("accepts a heard form that only shares words with an entry", () => {
    expect(findVocabularyRefusal({ heard: "reliano", written: "x", entries })).toBeNull();
    expect(findVocabularyRefusal({ heard: "a reliano buendía", written: "x", entries })).toBeNull();
  });

  it("lets an edited entry keep its own heard form but not another's", () => {
    expect(
      findVocabularyRefusal({ heard: "a reliano", written: "x", entries, editingIndex: 0 })
    ).toBeNull();
    expect(
      findVocabularyRefusal({ heard: "a reliano", written: "x", entries, editingIndex: 1 })
    ).toEqual({ kind: "duplicate", entry: "a reliano" });
  });
});

describe("normalizeVocabularySettings()", () => {
  it("falls back to the defaults for a missing or malformed record", () => {
    for (const raw of [undefined, null, 7, "nope", {}]) {
      expect(normalizeVocabularySettings(raw)).toEqual(defaultVocabularySettings());
    }
  });

  it("keeps valid entries per language and ignores unknown or malformed ones", () => {
    const settings = normalizeVocabularySettings({
      es: [
        { heard: "  a reliano ", written: "  Aureliano " },
        { heard: "buendía", written: "Buendía" },
        { heard: "", written: "nada" },
        { heard: "sin escrita", written: "  " },
        "not an entry",
        null,
        { heard: 5, written: 6 },
      ],
      en: [{ heard: "a reliano", written: "Aureliano" }],
      fr: [{ heard: "bonjour", written: "Bonjour" }],
    });

    expect(settings.es).toEqual([
      { heard: "a reliano", written: "Aureliano" },
      { heard: "buendía", written: "Buendía" },
    ]);
    expect(settings.en).toEqual([{ heard: "a reliano", written: "Aureliano" }]);
  });

  it("drops a repeated heard form, first wins", () => {
    const settings = normalizeVocabularySettings({
      es: [
        { heard: "A Reliano", written: "Primero" },
        { heard: "a reliano", written: "Segundo" },
      ],
    });
    expect(settings.es).toEqual([{ heard: "A Reliano", written: "Primero" }]);
  });

  it("ignores a language whose value is not an array", () => {
    const settings = normalizeVocabularySettings({ es: { heard: "a", written: "b" } });
    expect(settings.es).toEqual([]);
  });
});
