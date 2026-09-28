// The Spoken Punctuation layer's data and settings (ADR 0014): the entries a
// Dictation Language offers, which of them act on this device, and the extra
// phrases the author teaches each one. The default phrases live in the
// phrases-*.ts data files; this module is the one owner of the rules over them.
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import { normalizePhrase } from "@/features/dictation/normalize";
import { EN_ENTRIES } from "@/features/dictation/phrases-en";
import { ES_ENTRIES } from "@/features/dictation/phrases-es";
import type { DictationLanguage, ModelSpec } from "@/features/dictation/types";

/** One emitted piece of a phrase: a mark, a layout split, a modifier, or scratch. */
export type PhraseAction =
  | { kind: "mark"; mark: string }
  | { kind: "paragraph" }
  | { kind: "line_break" }
  | { kind: "list_item" }
  | { kind: "cap" }
  | { kind: "literal" }
  | { kind: "scratch" };

/** One Spoken Punctuation entry: what the author switches on or off as a unit. */
export interface SpokenPunctuationEntry {
  /** Stable id; stored switches, aliases, and conflict messages key on it. */
  id: string;
  /** The phrases that trigger it by default; aliases add to these. */
  phrases: readonly string[];
  actions: readonly PhraseAction[];
  /** Marks are defaulted by the model's capabilities; layout phrases are not. */
  punctuation: boolean;
}

export interface SpokenPunctuationLanguageSettings {
  /** The master switch: off means no entry of this language acts. */
  enabled: boolean;
  /** Explicit per-entry switches by entry id; absent means the capability default. */
  entries: Record<string, boolean>;
  /** Extra phrases by entry id, matched with the entry's defaults. */
  aliases: Record<string, string[]>;
}

export type SpokenPunctuationSettings = Record<
  DictationLanguage,
  SpokenPunctuationLanguageSettings
>;

export const DICTATION_LANGUAGES: readonly DictationLanguage[] = ["en", "es"];

const NO_PUNCTUATION_CAPABILITIES: ModelSpec["capabilities"] = {
  casing: false,
  punctuation: false,
  streaming: true,
};

const ENTRIES: Record<DictationLanguage, readonly SpokenPunctuationEntry[]> = {
  en: EN_ENTRIES,
  es: ES_ENTRIES,
};

export function entriesFor(language: DictationLanguage): readonly SpokenPunctuationEntry[] {
  return ENTRIES[language];
}

export function defaultSpokenPunctuationLanguageSettings(): SpokenPunctuationLanguageSettings {
  return { enabled: true, entries: {}, aliases: {} };
}

export function defaultSpokenPunctuationSettings(): SpokenPunctuationSettings {
  return {
    en: defaultSpokenPunctuationLanguageSettings(),
    es: defaultSpokenPunctuationLanguageSettings(),
  };
}

/**
 * An entry with no explicit switch follows the model: marks stay off where the
 * model punctuates itself, and every layout phrase is on everywhere.
 */
export function defaultEntryEnabled(
  entry: SpokenPunctuationEntry,
  capabilities?: ModelSpec["capabilities"]
): boolean {
  return !entry.punctuation || !(capabilities ?? NO_PUNCTUATION_CAPABILITIES).punctuation;
}

/**
 * The defaults a language follows before the author has picked a model: the
 * models of one language agree today, and a picked model's own flags win.
 */
export function catalogCapabilities(language: DictationLanguage): ModelSpec["capabilities"] {
  return (
    MODEL_CATALOG.find((spec) => spec.languages.includes(language))?.capabilities ??
    NO_PUNCTUATION_CAPABILITIES
  );
}

/** What the author's switch resolves to: master, explicit choice, then the model default. */
export function isEntryEnabled(
  entry: SpokenPunctuationEntry,
  settings?: SpokenPunctuationLanguageSettings,
  capabilities?: ModelSpec["capabilities"]
): boolean {
  if (settings && !settings.enabled) return false;
  return settings?.entries[entry.id] ?? defaultEntryEnabled(entry, capabilities);
}

export type AliasRefusal =
  | { kind: "empty" }
  | { kind: "duplicate" }
  | { kind: "escape"; word: string };

function literalPhrases(
  language: DictationLanguage,
  settings?: SpokenPunctuationLanguageSettings
): string[] {
  const literals = new Set<string>();
  for (const entry of entriesFor(language)) {
    if (!entry.actions.some((action) => action.kind === "literal")) continue;
    for (const phrase of [...entry.phrases, ...(settings?.aliases[entry.id] ?? [])]) {
      const normalized = normalizePhrase(phrase);
      if (normalized !== "") literals.add(normalized);
    }
  }
  return [...literals];
}

/**
 * A new alias is refused when it normalizes to nothing, to a phrase the
 * language already knows (default or alias), or when it starts with the escape
 * word (a default one or the author's own alias for it), which would make the
 * rest literal text.
 */
export function findAliasRefusal(options: {
  language: DictationLanguage;
  entryId: string;
  alias: string;
  settings: SpokenPunctuationLanguageSettings;
}): AliasRefusal | null {
  const { language, alias, settings } = options;
  const normalized = normalizePhrase(alias);
  if (normalized === "") return { kind: "empty" };

  const escapeWord = literalPhrases(language, settings).find(
    (word) => normalized === word || normalized.startsWith(`${word} `)
  );
  if (escapeWord) return { kind: "escape", word: escapeWord };

  for (const entry of entriesFor(language)) {
    for (const phrase of entry.phrases) {
      if (normalizePhrase(phrase) === normalized) return { kind: "duplicate" };
    }
    for (const existing of settings.aliases[entry.id] ?? []) {
      if (normalizePhrase(existing) === normalized) return { kind: "duplicate" };
    }
  }
  return null;
}

function normalizeEntrySwitches(
  language: DictationLanguage,
  raw: unknown
): Record<string, boolean> {
  if (typeof raw !== "object" || raw === null) return {};
  const switches: Record<string, boolean> = {};
  for (const entry of entriesFor(language)) {
    const value = (raw as Record<string, unknown>)[entry.id];
    if (typeof value === "boolean") switches[entry.id] = value;
  }
  return switches;
}

function normalizeAliases(
  language: DictationLanguage,
  raw: unknown,
  settings: SpokenPunctuationLanguageSettings
): Record<string, string[]> {
  if (typeof raw !== "object" || raw === null) return {};
  const entries = entriesFor(language);
  const isLiteralEntry = (entry: SpokenPunctuationEntry) =>
    entry.actions.some((action) => action.kind === "literal");
  // The escape word's aliases come first, so an alias starting with one of
  // them is refused no matter how storage happened to order the entries.
  const ordered = [
    ...entries.filter(isLiteralEntry),
    ...entries.filter((entry) => !isLiteralEntry(entry)),
  ];
  const aliases: Record<string, string[]> = {};
  for (const entry of ordered) {
    const value = (raw as Record<string, unknown>)[entry.id];
    if (!Array.isArray(value)) continue;
    for (const phrase of value) {
      if (typeof phrase !== "string") continue;
      const trimmed = phrase.trim();
      if (trimmed === "") continue;
      const kept = aliases[entry.id] ?? [];
      if (kept.includes(trimmed)) continue;
      // Stored data is refused the same way the settings UI refuses a new
      // alias, so a stale or hand-edited record can never shadow a phrase.
      const refusal = findAliasRefusal({
        language,
        entryId: entry.id,
        alias: trimmed,
        settings: { ...settings, aliases },
      });
      if (refusal) continue;
      aliases[entry.id] = [...kept, trimmed];
    }
  }
  return aliases;
}

/**
 * Whatever storage holds (an older shape, a hand-edited value) is made safe
 * before any phrase is matched: unknown entries are dropped and missing
 * languages fall back to the defaults.
 */
export function normalizeSpokenPunctuationSettings(raw: unknown): SpokenPunctuationSettings {
  const settings = defaultSpokenPunctuationSettings();
  if (typeof raw !== "object" || raw === null) return settings;
  const source = raw as Record<string, unknown>;
  for (const language of DICTATION_LANGUAGES) {
    const value = source[language];
    if (typeof value !== "object" || value === null) continue;
    const languageValue = value as Record<string, unknown>;
    if (typeof languageValue.enabled === "boolean")
      settings[language].enabled = languageValue.enabled;
    settings[language].entries = normalizeEntrySwitches(language, languageValue.entries);
    settings[language].aliases = normalizeAliases(
      language,
      languageValue.aliases,
      settings[language]
    );
  }
  return settings;
}
