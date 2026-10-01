import type { SettingsSectionDef } from "@/features/settings/rows";

export const GENERAL_SECTION = {
  id: "general",
  labelKey: "settings.general",
  rows: [
    {
      id: "autoSave",
      labelKey: "settings.autoSave",
      descriptionKey: "settings.autoSaveDescription",
      keywordsKey: "settings.keywords.autoSave",
    },
    {
      id: "alwaysOnTop",
      labelKey: "settings.alwaysOnTop",
      descriptionKey: "settings.alwaysOnTopDescription",
      keywordsKey: "settings.keywords.alwaysOnTop",
      platforms: ["desktop"],
    },
    {
      id: "language",
      labelKey: "settings.language",
      descriptionKey: "settings.languageDescription",
      keywordsKey: "settings.keywords.language",
    },
  ],
} as const satisfies SettingsSectionDef;
