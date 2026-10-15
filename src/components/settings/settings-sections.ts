import type {
  PluginCardRowDef,
  PluginCardRowId,
  PluginSettingsRowDef,
  PluginSettingsRowId,
  SettingsRowDef,
  SettingsSectionDef,
} from "@/features/settings/rows";
import {
  findPluginSettingsRow,
  getPluginSettingsOwners,
  pluginCardRowId,
  pluginIdOfCardRow,
  resolvePluginSettingsRowRename,
} from "@/features/settings/rows";
import { usePluginManagementStore } from "@/features/plugins/management";
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
import { PLUGINS_SECTION } from "@/components/settings/PluginsSection.rows";

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
  PLUGINS_SECTION,
  ADVANCED_SECTION,
  ABOUT_SECTION,
] as const;

type CoreSettingsRowId = (typeof SETTINGS_SECTIONS)[number]["rows"][number]["id"];
/** Any Settings row: a core row, a runtime Plugin row, or a Plugin card. */
export type SettingsRowId = CoreSettingsRowId | PluginSettingsRowId | PluginCardRowId;

export type AnySettingsRow = SettingsRowDef | PluginSettingsRowDef | PluginCardRowDef;

/** Whether a Plugin id is one Settings knows: a card or a legacy Settings owner. */
function isKnownPluginCard(pluginId: string): boolean {
  if (usePluginManagementStore.getState().plugins[pluginId] !== undefined) return true;
  return getPluginSettingsOwners().some((owner) => owner.pluginId === pluginId);
}

export function findSettingsRow(
  id: string
): { section: SettingsSectionDef; row: AnySettingsRow } | undefined {
  const renamed = resolvePluginSettingsRowRename(id);
  const lookupId = renamed !== id ? renamed : id;
  for (const section of SETTINGS_SECTIONS) {
    const row = (section.rows as readonly SettingsRowDef[]).find(
      (candidate) => candidate.id === lookupId
    );
    if (row) return { section: section as SettingsSectionDef, row };
  }
  const runtime = findPluginSettingsRow(lookupId);
  if (runtime) {
    return { section: PLUGINS_SECTION as unknown as SettingsSectionDef, row: runtime.row };
  }
  // A Plugin card resolves to the Plugins section, opening its accordion. An
  // unknown Plugin has no card to reveal, so the id resolves to nothing.
  const pluginId = pluginIdOfCardRow(lookupId);
  if (pluginId !== null && isKnownPluginCard(pluginId)) {
    return {
      section: PLUGINS_SECTION as unknown as SettingsSectionDef,
      row: { id: pluginCardRowId(pluginId), reveal: { kind: "plugin", pluginId } },
    };
  }
  return undefined;
}
