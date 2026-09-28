import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionSnapshot } from "@/features/dictation/session";
import {
  defaultSpokenPunctuationSettings,
  normalizeSpokenPunctuationSettings,
  type SpokenPunctuationLanguageSettings,
  type SpokenPunctuationSettings,
} from "@/features/dictation/spoken-punctuation";
import type {
  DictationLanguage,
  ModelSpec,
  ModelTier,
  SupportReport,
} from "@/features/dictation/types";

export interface DictationStoreState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  snapshot: SessionSnapshot;
  support: SupportReport | null;
  installed: string[];
  downloads: Record<string, { done: number; total: number }>;
  preferredTier: Record<DictationLanguage, ModelTier>;
  /** The latest screen-reader announcement; the control renders it in a live region. */
  announcement: string;
  /** The control's language choice for the Session; `session.setLanguage` owns the engine. */
  languageOverride: DictationLanguage | null;
  setPreferredTier: (language: DictationLanguage, tier: ModelTier) => void;
  /** Spoken Punctuation per Dictation Language, this device only (ADR 0014). */
  spokenPunctuation: SpokenPunctuationSettings;
  setSpokenPunctuationEnabled: (language: DictationLanguage, enabled: boolean) => void;
  setSpokenPunctuationEntryEnabled: (
    language: DictationLanguage,
    entryId: string,
    enabled: boolean
  ) => void;
  /** The caller refuses a conflicting alias first; this only stores it. */
  addSpokenPunctuationAlias: (language: DictationLanguage, entryId: string, phrase: string) => void;
  removeSpokenPunctuationAlias: (
    language: DictationLanguage,
    entryId: string,
    phrase: string
  ) => void;
  /** One entry goes back to its default switch and its default phrases. */
  resetSpokenPunctuationEntry: (language: DictationLanguage, entryId: string) => void;
}

function withLanguage(
  settings: SpokenPunctuationSettings,
  language: DictationLanguage,
  next: SpokenPunctuationLanguageSettings
): SpokenPunctuationSettings {
  return { ...settings, [language]: next };
}

export const useDictationStore = create<DictationStoreState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      snapshot: {
        status: "idle",
        language: null,
        modelId: null,
        level: 0,
        hasTarget: false,
      },
      support: null,
      installed: [],
      downloads: {},
      preferredTier: { en: "fast", es: "fast" },
      announcement: "",
      languageOverride: null,
      setPreferredTier: (language, tier) =>
        set((state) => ({
          preferredTier: { ...state.preferredTier, [language]: tier },
        })),
      spokenPunctuation: defaultSpokenPunctuationSettings(),
      setSpokenPunctuationEnabled: (language, enabled) =>
        set((state) => {
          const current = state.spokenPunctuation[language];
          if (current.enabled === enabled) return state;
          return {
            spokenPunctuation: withLanguage(state.spokenPunctuation, language, {
              ...current,
              enabled,
            }),
          };
        }),
      setSpokenPunctuationEntryEnabled: (language, entryId, enabled) =>
        set((state) => {
          const current = state.spokenPunctuation[language];
          if (current.entries[entryId] === enabled) return state;
          return {
            spokenPunctuation: withLanguage(state.spokenPunctuation, language, {
              ...current,
              entries: { ...current.entries, [entryId]: enabled },
            }),
          };
        }),
      addSpokenPunctuationAlias: (language, entryId, phrase) =>
        set((state) => {
          const trimmed = phrase.trim();
          if (trimmed === "") return state;
          const current = state.spokenPunctuation[language];
          const existing = current.aliases[entryId] ?? [];
          if (existing.includes(trimmed)) return state;
          return {
            spokenPunctuation: withLanguage(state.spokenPunctuation, language, {
              ...current,
              aliases: { ...current.aliases, [entryId]: [...existing, trimmed] },
            }),
          };
        }),
      removeSpokenPunctuationAlias: (language, entryId, phrase) =>
        set((state) => {
          const current = state.spokenPunctuation[language];
          const existing = current.aliases[entryId];
          if (!existing?.includes(phrase)) return state;
          const remaining = existing.filter((alias) => alias !== phrase);
          const aliases = { ...current.aliases };
          if (remaining.length === 0) delete aliases[entryId];
          else aliases[entryId] = remaining;
          return {
            spokenPunctuation: withLanguage(state.spokenPunctuation, language, {
              ...current,
              aliases,
            }),
          };
        }),
      resetSpokenPunctuationEntry: (language, entryId) =>
        set((state) => {
          const current = state.spokenPunctuation[language];
          const { [entryId]: _switch, ...entries } = current.entries;
          const { [entryId]: _aliases, ...aliases } = current.aliases;
          return {
            spokenPunctuation: withLanguage(state.spokenPunctuation, language, {
              ...current,
              entries,
              aliases,
            }),
          };
        }),
    }),
    // Device-local, like the models themselves.
    {
      name: "maibuk-dictation",
      partialize: (state) => ({
        preferredTier: state.preferredTier,
        enabled: state.enabled,
        spokenPunctuation: state.spokenPunctuation,
      }),
      // Older records have no spokenPunctuation yet; a hand-edited one may be
      // partial or name entries this version no longer has.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<DictationStoreState> | undefined),
        spokenPunctuation: normalizeSpokenPunctuationSettings(
          (persisted as { spokenPunctuation?: unknown } | undefined)?.spokenPunctuation
        ),
      }),
    }
  )
);

export function pickModel(
  language: DictationLanguage,
  available: readonly ModelSpec[],
  installed: readonly string[],
  preferred: Record<DictationLanguage, ModelTier>
): ModelSpec | null {
  const candidates = available.filter(
    (spec) => spec.languages.includes(language) && installed.includes(spec.id)
  );
  return candidates.find((spec) => spec.tier === preferred[language]) ?? candidates[0] ?? null;
}
