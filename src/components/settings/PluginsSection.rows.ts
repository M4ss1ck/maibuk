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
    {
      id: "pluginsAdd",
      labelKey: "plugins.management.add",
      descriptionKey: "plugins.management.addHelp",
    },
    {
      id: "pluginsFilter",
      labelKey: "plugins.management.filters.label",
      descriptionKey: "plugins.management.filters.help",
    },
  ],
} as const satisfies SettingsSectionDef;
