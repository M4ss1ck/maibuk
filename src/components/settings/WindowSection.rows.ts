import type { SettingsSectionDef } from "@/features/settings/rows";

export const WINDOW_SECTION = {
  id: "window",
  labelKey: "settings.window",
  rows: [
    {
      id: "launchOnStartup",
      labelKey: "settings.launchOnStartup",
      descriptionKey: "settings.launchOnStartupDescription",
      platforms: ["desktop"],
    },
    {
      id: "closeToTray",
      labelKey: "settings.closeToTray",
      descriptionKey: "settings.closeToTrayDescription",
      platforms: ["desktop"],
    },
    {
      id: "trayResourceUsage",
      labelKey: "settings.trayResourceUsage",
      descriptionKey: "settings.trayResourceUsageDescription",
      keywordsKey: "settings.keywords.trayResourceUsage",
      platforms: ["desktop"],
    },
  ],
} as const satisfies SettingsSectionDef;
