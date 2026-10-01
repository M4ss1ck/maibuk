import type { SettingsSectionDef } from "@/features/settings/rows";
import { APPEARANCE_SECTION } from "@/components/settings/AppearanceSection.rows";
import { WINDOW_SECTION } from "@/components/settings/WindowSection.rows";
import { GENERAL_SECTION } from "@/components/settings/GeneralSection.rows";
import { SHORTCUTS_SECTION } from "@/components/settings/ShortcutsSection.rows";
import { SYNC_SECTION } from "@/components/settings/SyncSection.rows";
import { BACKUP_SECTION } from "@/components/settings/BackupSection.rows";
import { METRICS_SECTION } from "@/components/settings/MetricsSection.rows";
import { EDITOR_SECTION } from "@/components/settings/EditorSection.rows";
import { DICTATION_SECTION } from "@/components/settings/DictationSection.rows";
import { EXPORT_SECTION } from "@/components/settings/ExportSection.rows";
import { TUTORIAL_SECTION_DEF } from "@/components/settings/TutorialSection.rows";
import { ADVANCED_SECTION } from "@/components/settings/AdvancedSection.rows";
import { ABOUT_SECTION } from "@/components/settings/AboutSection.rows";

/** Every Settings section in screen order. The palette reads this too. */
export const SETTINGS_SECTIONS = [
  APPEARANCE_SECTION,
  WINDOW_SECTION,
  GENERAL_SECTION,
  SHORTCUTS_SECTION,
  SYNC_SECTION,
  BACKUP_SECTION,
  METRICS_SECTION,
  EDITOR_SECTION,
  DICTATION_SECTION,
  EXPORT_SECTION,
  TUTORIAL_SECTION_DEF,
  ADVANCED_SECTION,
  ABOUT_SECTION,
] as const;

export type SettingsRowId = (typeof SETTINGS_SECTIONS)[number]["rows"][number]["id"];

export function findSettingsRow(
  id: string
): { section: SettingsSectionDef; row: SettingsSectionDef["rows"][number] } | undefined {
  for (const section of SETTINGS_SECTIONS) {
    const row = section.rows.find((candidate) => candidate.id === id);
    if (row) return { section: section as SettingsSectionDef, row };
  }
  return undefined;
}
