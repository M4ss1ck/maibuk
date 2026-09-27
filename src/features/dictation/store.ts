import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionSnapshot } from "@/features/dictation/session";
import type {
  DictationLanguage,
  ModelSpec,
  ModelTier,
  SupportReport,
} from "@/features/dictation/types";

export interface DictationStoreState {
  snapshot: SessionSnapshot;
  support: SupportReport | null;
  installed: string[];
  downloads: Record<string, { done: number; total: number }>;
  preferredTier: Record<DictationLanguage, ModelTier>;
  setPreferredTier: (language: DictationLanguage, tier: ModelTier) => void;
}

export const useDictationStore = create<DictationStoreState>()(
  persist(
    (set) => ({
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
      setPreferredTier: (language, tier) =>
        set((state) => ({
          preferredTier: { ...state.preferredTier, [language]: tier },
        })),
    }),
    // Device-local, like the models themselves.
    {
      name: "maibuk-dictation",
      partialize: (state) => ({ preferredTier: state.preferredTier }),
    },
  ),
);

export function pickModel(
  language: DictationLanguage,
  available: readonly ModelSpec[],
  installed: readonly string[],
  preferred: Record<DictationLanguage, ModelTier>,
): ModelSpec | null {
  const candidates = available.filter(
    (spec) => spec.languages.includes(language) && installed.includes(spec.id),
  );
  return (
    candidates.find((spec) => spec.tier === preferred[language]) ??
    candidates[0] ??
    null
  );
}
