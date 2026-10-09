import { PLUGINS_SECTION } from "@/components/settings/PluginsSection.rows";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";
import type { PaletteItem, PaletteTranslate } from "@/features/command-palette/palette-index";
import {
  getAllPluginSettingsRows,
  rowOnPlatform,
  type SettingsPlatform,
  type SettingsRowDef,
} from "@/features/settings/rows";

export interface BuildSettingsItemsOptions {
  t: PaletteTranslate;
  /** Rows the platform this build runs on does not have are left out. */
  platform: SettingsPlatform;
}

function keywordsOf(t: PaletteTranslate, key: string): string[] {
  const raw = t(key, { returnObjects: true });
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

function labelOf(t: PaletteTranslate, key: string, fallback: string): string {
  const label = t(key);
  return typeof label === "string" && label !== "" ? label : fallback;
}

/**
 * One palette item per declared Settings row, read from the same ordered list
 * the Settings screen renders (ADR 0018), so the two can never drift. A row is
 * found by its label, its description, and its keywords; its section is the
 * detail that says where choosing it lands. Runtime Plugin rows join with
 * their metadata only, without running the Plugin.
 */
export function buildSettingsItems({ t, platform }: BuildSettingsItemsOptions): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const section of SETTINGS_SECTIONS) {
    // The Plugins section renders runtime rows from the registry, not its
    // static (empty) rows; they join below with their literal metadata.
    if (section.id === PLUGINS_SECTION.id) continue;
    const sectionLabel = labelOf(t, section.labelKey, section.id);
    for (const row of section.rows as readonly SettingsRowDef[]) {
      if (!rowOnPlatform(row, platform)) continue;
      const terms: string[] = [];
      if (row.descriptionKey) terms.push(labelOf(t, row.descriptionKey, ""));
      if (row.keywordsKey) terms.push(...keywordsOf(t, row.keywordsKey));
      items.push({
        key: `settingsRow:${row.id}`,
        kind: "settingsRow",
        id: row.id,
        label: labelOf(t, row.labelKey, row.id),
        terms: terms.filter((term) => term !== ""),
        state: "runnable",
        detail: sectionLabel,
      });
    }
  }
  const pluginsLabel = labelOf(t, PLUGINS_SECTION.labelKey, PLUGINS_SECTION.id);
  for (const row of getAllPluginSettingsRows()) {
    if (!rowOnPlatform(row, platform)) continue;
    const terms: string[] = [];
    if (row.description) terms.push(row.description);
    if (row.keywords) terms.push(...row.keywords);
    items.push({
      key: `settingsRow:${row.id}`,
      kind: "settingsRow",
      id: row.id,
      label: row.label,
      terms: terms.filter((term) => term !== ""),
      state: "runnable",
      detail: pluginsLabel,
    });
  }
  return items;
}
