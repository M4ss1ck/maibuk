import type { SettingsSectionDef } from "@/features/settings/rows";

export const APPEARANCE_SECTION = {
  id: "appearance",
  labelKey: "settings.appearance",
  rows: [
    {
      id: "theme",
      labelKey: "settings.theme",
      descriptionKey: "settings.themeDescription",
      keywordsKey: "settings.keywords.theme",
    },
    {
      id: "appFontSize",
      labelKey: "settings.fontSize",
      descriptionKey: "settings.fontSizeDescription",
      keywordsKey: "settings.keywords.appFontSize",
    },
    {
      id: "appFont",
      labelKey: "settings.font",
      descriptionKey: "settings.fontDescription",
    },
    {
      id: "primaryColor",
      labelKey: "settings.primaryColor",
      descriptionKey: "settings.primaryColorDescription",
      keywordsKey: "settings.keywords.primaryColor",
    },
  ],
} as const satisfies SettingsSectionDef;
