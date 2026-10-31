/**
 * The Plugin ids the app has ever seen in the Plugin Directory (#443). The
 * management store upserts one record per Plugin it reads, and never deletes a
 * record on a refresh, so a Settings row stays after the Plugin's files are
 * deleted. A record keeps the last-seen manifest (so an absent row still shows
 * its name and state) and whether the author explicitly removed the Plugin.
 *
 * Device-local, like approvals: never synced, never in a Backup. Reset settings
 * clears it, so a fresh device state starts with no known Plugins.
 */

import type { PluginManifest } from "@/features/plugins/types";

export const PLUGIN_KNOWN_STORAGE_KEY = "maibuk-plugins-known";

/** One Plugin id the app has seen, with the last manifest files showed. */
export interface KnownPlugin {
  /** The Plugin's id, which is also its folder name in the Plugin Directory. */
  pluginId: string;
  /** The manifest as last read from the Plugin Directory (or the shipped copy). */
  manifest: PluginManifest;
  /** True when the Plugin is a Built-in the app ships. */
  builtIn: boolean;
  /** True once the author explicitly removed the Plugin; false when it is back. */
  removed: boolean;
  /**
   * True once the 50 MB data-size warning was shown for this Plugin, so it
   * shows once ever (#401, #443). Absent on a record written before the warning
   * existed, which reads as "not shown yet".
   */
  dataSizeWarned?: boolean;
}

interface StoredKnown {
  version: 1;
  plugins: readonly KnownPlugin[];
}

function isManifest(value: unknown): value is PluginManifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string";
}

function isKnown(value: unknown): value is KnownPlugin {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pluginId === "string" &&
    typeof record.builtIn === "boolean" &&
    typeof record.removed === "boolean" &&
    isManifest(record.manifest)
  );
}

function read(): KnownPlugin[] {
  try {
    const raw = localStorage.getItem(PLUGIN_KNOWN_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const plugins = (parsed as { plugins?: unknown }).plugins;
    if (!Array.isArray(plugins)) return [];
    return plugins.filter(isKnown);
  } catch {
    return [];
  }
}

function write(plugins: KnownPlugin[]): void {
  localStorage.setItem(PLUGIN_KNOWN_STORAGE_KEY, serializeKnownPlugins(plugins));
}

/** Serializes the stored payload this module reads back. */
function serializeKnownPlugins(plugins: readonly KnownPlugin[]): string {
  return JSON.stringify({ version: 1, plugins } satisfies StoredKnown);
}

export function listKnownPlugins(): KnownPlugin[] {
  return read();
}

export function getKnownPlugin(pluginId: string): KnownPlugin | null {
  return read().find((known) => known.pluginId === pluginId) ?? null;
}

/** Upserts one record, keeping the last-seen manifest and removal state. */
export function saveKnownPlugin(known: KnownPlugin): void {
  write([...read().filter((current) => current.pluginId !== known.pluginId), known]);
}

/**
 * Marks a known Plugin as explicitly removed, keeping its row and last-seen
 * manifest for the retained-data state (#443, U3). An id that was never seen is
 * left alone: there is no manifest to record.
 */
export function markPluginRemoved(pluginId: string): void {
  const known = getKnownPlugin(pluginId);
  if (known === null || known.removed) return;
  write([
    ...read().filter((current) => current.pluginId !== pluginId),
    { ...known, removed: true },
  ]);
}

/**
 * Marks that the 50 MB data-size warning was shown for a Plugin, keeping its
 * row, so it shows once ever (#401, #443). An id that was never seen is left
 * alone: there is no record to persist on.
 */
export function markPluginDataSizeWarned(pluginId: string): void {
  const known = getKnownPlugin(pluginId);
  if (known === null || known.dataSizeWarned === true) return;
  write([
    ...read().filter((current) => current.pluginId !== pluginId),
    { ...known, dataSizeWarned: true },
  ]);
}

/** Removes every known record: Reset settings (#443). */
export function clearKnownPlugins(): void {
  localStorage.removeItem(PLUGIN_KNOWN_STORAGE_KEY);
}
