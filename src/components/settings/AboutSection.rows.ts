import type { SettingsSectionDef } from "@/features/settings/rows";

export const ABOUT_SECTION = {
  id: "about",
  labelKey: "settings.about",
  rows: [
    {
      id: "appVersion",
      labelKey: "settings.about",
      descriptionKey: "app.description",
    },
  ],
} as const satisfies SettingsSectionDef;
