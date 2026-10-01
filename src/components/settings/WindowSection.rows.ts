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
  ],
} as const satisfies SettingsSectionDef;
