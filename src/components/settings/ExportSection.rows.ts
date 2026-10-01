import type { SettingsSectionDef } from "@/features/settings/rows";

export const EXPORT_SECTION = {
  id: "export",
  labelKey: "settings.export",
  rows: [
    {
      id: "defaultExportFormat",
      labelKey: "settings.defaultFormat",
      descriptionKey: "settings.defaultFormatDescription",
    },
  ],
} as const satisfies SettingsSectionDef;
