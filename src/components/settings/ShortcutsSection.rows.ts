import type { SettingsSectionDef } from "@/features/settings/rows";

export const SHORTCUTS_SECTION = {
  id: "shortcuts",
  labelKey: "shortcuts.title",
  rows: [
    {
      id: "customizeShortcuts",
      labelKey: "shortcutEditor.open",
      descriptionKey: "shortcutEditor.settingsDescription",
      keywordsKey: "settings.keywords.customizeShortcuts",
    },
  ],
} as const satisfies SettingsSectionDef;
