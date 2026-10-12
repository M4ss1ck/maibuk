import type { SettingsSectionDef } from "@/features/settings/rows";

export const PLUGINS_SECTION = {
  id: "plugins",
  labelKey: "settings.plugins",
  rows: [
    {
      id: "pluginDevelopmentMode",
      labelKey: "plugins.developmentMode",
      descriptionKey: "plugins.developmentModeHelp",
    },
  ],
} as const satisfies SettingsSectionDef;
