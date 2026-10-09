import type { SettingsSectionDef } from "@/features/settings/rows";

export const PLUGINS_SECTION = {
  id: "plugins",
  labelKey: "settings.plugins",
  rows: [],
} as const satisfies SettingsSectionDef;
