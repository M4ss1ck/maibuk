import type { SettingsSectionDef } from "@/features/settings/rows";

export const DICTATION_SECTION = {
  id: "dictation",
  labelKey: "dictation.section.title",
  rows: [
    {
      id: "dictationEnabled",
      labelKey: "dictation.section.title",
      descriptionKey: "dictation.section.description",
    },
    {
      id: "dictationModels",
      labelKey: "dictation.section.models",
      reveal: { kind: "dictationLanguage" },
    },
    {
      id: "dictationSpokenPunctuation",
      labelKey: "dictation.spokenPunctuation.title",
      descriptionKey: "dictation.spokenPunctuation.description",
      reveal: { kind: "dictationLanguage" },
    },
    {
      id: "dictationVocabulary",
      labelKey: "dictation.vocabulary.title",
      descriptionKey: "dictation.vocabulary.description",
      reveal: { kind: "dictationLanguage" },
    },
  ],
} as const satisfies SettingsSectionDef;
