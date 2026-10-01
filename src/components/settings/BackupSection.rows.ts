import type { SettingsSectionDef } from "@/features/settings/rows";

export const BACKUP_SECTION = {
  id: "backups",
  labelKey: "backup.title",
  rows: [
    {
      id: "backupRetention",
      labelKey: "backup.retentionLimit",
    },
    {
      id: "backupDirectory",
      labelKey: "backup.directoryLabel",
      platforms: ["desktop"],
    },
    {
      id: "backupCreate",
      labelKey: "backup.createBackup",
    },
    {
      id: "backupsList",
      labelKey: "backup.title",
      descriptionKey: "backup.description",
      keywordsKey: "settings.keywords.backupsList",
    },
  ],
} as const satisfies SettingsSectionDef;
