// The Dictation Vocabulary (ADR 0014): words and names the author teaches
// Dictation — what the Dictation Model hears and what to write instead — per
// Dictation Language, on this device. Entries match whole words, folding case
// and accents, and their written form is inserted exactly as typed.
import { normalizePhrase } from "@/features/dictation/normalize";
import type { DictationLanguage } from "@/features/dictation/types";

export interface VocabularyEntry {
  /** The heard form, as the author typed it. Matched whole-word, folded. */
  heard: string;
  /** The written form, as the author typed it. Inserted exactly, never re-cased. */
  written: string;
}

export type VocabularySettings = Record<DictationLanguage, VocabularyEntry[]>;

const LANGUAGES: readonly DictationLanguage[] = ["en", "es"];

export function defaultVocabularySettings(): VocabularySettings {
  return { en: [], es: [] };
}

export type VocabularyRefusal = { kind: "empty" } | { kind: "duplicate"; entry: string };

/**
 * The index of the entry whose heard form folds to `heard`, or -1 when none
 * does. `exceptIndex` is the entry being edited, which may keep its own form.
 */
export function findVocabularyEntryIndex(
  entries: readonly VocabularyEntry[],
  heard: string,
  exceptIndex = -1
): number {
  const normalized = normalizePhrase(heard);
  if (normalized === "") return -1;
  return entries.findIndex(
    (entry, index) => index !== exceptIndex && normalizePhrase(entry.heard) === normalized
  );
}

/**
 * A new entry is refused when either form is empty after trimming, or when
 * its heard form already answers to another entry (compared the same way
 * matching does: whole words, folding case and accents). An entry being
 * edited may keep its own heard form.
 */
export function findVocabularyRefusal(options: {
  heard: string;
  written: string;
  entries: readonly VocabularyEntry[];
  editingIndex?: number;
}): VocabularyRefusal | null {
  const heard = options.heard.trim();
  const written = options.written.trim();
  if (heard === "" || written === "" || normalizePhrase(heard) === "") return { kind: "empty" };
  const duplicate = findVocabularyEntryIndex(options.entries, heard, options.editingIndex);
  if (duplicate !== -1) {
    return { kind: "duplicate", entry: options.entries[duplicate].heard };
  }
  return null;
}

/**
 * Whatever storage holds (an older shape, a hand-edited value) is made safe
 * before any line is matched: missing languages fall back to no entries, and
 * entries with an empty form or a repeated heard form are dropped, first wins.
 */
export function normalizeVocabularySettings(raw: unknown): VocabularySettings {
  const settings = defaultVocabularySettings();
  if (typeof raw !== "object" || raw === null) return settings;
  const source = raw as Record<string, unknown>;
  for (const language of LANGUAGES) {
    const value = source[language];
    if (!Array.isArray(value)) continue;
    const entries: VocabularyEntry[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const heard = typeof record.heard === "string" ? record.heard.trim() : "";
      const written = typeof record.written === "string" ? record.written.trim() : "";
      const normalized = normalizePhrase(heard);
      if (normalized === "" || written === "" || seen.has(normalized)) continue;
      seen.add(normalized);
      entries.push({ heard, written });
    }
    settings[language] = entries;
  }
  return settings;
}
