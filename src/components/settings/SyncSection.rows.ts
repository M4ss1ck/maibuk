import type { SettingsSectionDef } from "@/features/settings/rows";

export const SYNC_SECTION = {
  id: "sync",
  labelKey: "sync.title",
  rows: [
    {
      id: "syncServerUrl",
      labelKey: "sync.serverUrl",
      descriptionKey: "sync.serverUrlDescription",
    },
    {
      id: "syncAccount",
      labelKey: "sync.accountStatus",
      descriptionKey: "sync.accountStatusDescription",
    },
    {
      id: "syncAutoSync",
      labelKey: "sync.autoSync",
      descriptionKey: "sync.autoSyncDescription",
    },
    {
      id: "syncNow",
      labelKey: "sync.syncAll",
      keywordsKey: "settings.keywords.syncNow",
    },
  ],
} as const satisfies SettingsSectionDef;
