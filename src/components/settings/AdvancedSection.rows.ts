import type { SettingsSectionDef } from "@/features/settings/rows";

export const ADVANCED_SECTION = {
  id: "advanced",
  labelKey: "settings.advanced",
  rows: [
    {
      id: "exportDatabase",
      labelKey: "settings.exportDatabase",
      descriptionKey: "settings.exportDatabaseDescription",
      reveal: { kind: "advanced" },
    },
    {
      id: "importDatabase",
      labelKey: "settings.importDatabase",
      descriptionKey: "settings.importDatabaseDescription",
      reveal: { kind: "advanced" },
    },
    {
      id: "resetDatabase",
      labelKey: "settings.resetDatabase",
      descriptionKey: "settings.resetDatabaseDescription",
      keywordsKey: "settings.keywords.resetDatabase",
      reveal: { kind: "advanced" },
    },
  ],
} as const satisfies SettingsSectionDef;
