/**
 * The Plugin sidebar as the last launch left it, so the first frame shows each
 * enabled Plugin's entries before the Plugin Directory scan reads a manifest.
 * The scan is async (Rust reads the folder), so without this the sidebar would
 * draw empty and fill in later.
 *
 * `main.tsx` seeds the registry from it before the first render, keeping only
 * Plugins whose approval is enabled now. The lifecycle drops what the scan did
 * not replace once it settles (an enabled Plugin it refused keeps its entry,
 * marked Stopped), and from then on saves the live entries on
 * every contribution change (enable, disable, language change). A snapshot is
 * device-local, like the approvals, and a bad one seeds nothing.
 *
 * Kept zod-free and small: it is in the entry chunk (#437).
 */

import { listPluginApprovals } from "@/features/plugins/approvals";
import {
  getPluginSidebarEntries,
  onPluginContributionsChange,
  pluginPageRoute,
  seedPluginSidebarEntries,
  type PluginSidebarEntryDef,
} from "@/features/plugins/contributions-registry";
import {
  LOCAL_ID_PATTERN,
  PLUGIN_ID_PATTERN,
  isPluginContributionId,
  pluginIdOfContribution,
} from "@/features/plugins/ids";
import { inlineIconProblem, type PluginIconSpec } from "@/features/plugins/inline-icon";
import type { PluginCommandId } from "@/lib/shortcut-registry";

export const PLUGIN_SIDEBAR_SNAPSHOT_KEY = "maibuk-plugin-sidebar";

interface StoredSnapshot {
  version: 1;
  entries: PluginSidebarEntryDef[];
}

function readIcon(value: unknown): PluginIconSpec | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  const elements = (value as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return null;
  const valid = elements.every(
    (element) =>
      Array.isArray(element) &&
      element.length === 2 &&
      typeof element[0] === "string" &&
      typeof element[1] === "object" &&
      element[1] !== null &&
      Object.values(element[1]).every((attribute) => typeof attribute === "string")
  );
  if (!valid) return null;
  const icon = { elements: elements as [string, Record<string, string>][] };
  return inlineIconProblem(icon) === null ? icon : null;
}

/**
 * One stored entry, or null when any field is off. The ids must be ones a
 * manifest could declare, and the route and page id are rebuilt from them, so
 * a hand-edited snapshot can never point an entry outside its Plugin's pages.
 */
function readEntry(value: unknown): PluginSidebarEntryDef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { pluginId, pageId, displayName, title, commandId } = record;
  if (typeof pluginId !== "string" || !PLUGIN_ID_PATTERN.test(pluginId)) return null;
  if (typeof pageId !== "string" || !LOCAL_ID_PATTERN.test(pageId)) return null;
  if (typeof displayName !== "string" || typeof title !== "string") return null;
  if (
    typeof commandId !== "string" ||
    !isPluginContributionId(commandId) ||
    pluginIdOfContribution(commandId) !== pluginId
  ) {
    return null;
  }
  const icon = readIcon(record.icon);
  if (icon === null) return null;
  return {
    pluginId,
    displayName,
    pageId,
    pageRoute: pluginPageRoute(pluginId, pageId),
    title,
    ...(icon !== undefined ? { icon } : {}),
    commandId: commandId as PluginCommandId,
  };
}

/** The saved entries; a missing, unreadable, or foreign snapshot is empty. */
export function readPluginSidebarSnapshot(): PluginSidebarEntryDef[] {
  try {
    const raw = localStorage.getItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot> | null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
    const entries: PluginSidebarEntryDef[] = [];
    for (const value of parsed.entries) {
      const entry = readEntry(value);
      if (entry !== null) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

/** Saves the entries' declared fields; the page fields a live entry carries stay out. */
export function writePluginSidebarSnapshot(entries: readonly PluginSidebarEntryDef[]): void {
  const stored: StoredSnapshot = {
    version: 1,
    entries: entries.map((entry) => ({
      pluginId: entry.pluginId,
      displayName: entry.displayName,
      pageId: entry.pageId,
      pageRoute: entry.pageRoute,
      title: entry.title,
      ...(entry.icon !== undefined ? { icon: entry.icon } : {}),
      commandId: entry.commandId,
    })),
  };
  try {
    localStorage.setItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY, JSON.stringify(stored));
  } catch {
    // A full or blocked storage costs the next launch its first-frame entries only.
  }
}

/** Seeds the registry with the saved entries of every Plugin enabled now. */
export function seedPluginSidebarFromSnapshot(): void {
  try {
    const enabled = new Set(
      listPluginApprovals()
        .filter((approval) => approval.enabled)
        .map((approval) => approval.pluginId)
    );
    if (enabled.size === 0) return;
    seedPluginSidebarEntries(
      readPluginSidebarSnapshot().filter((entry) => enabled.has(entry.pluginId))
    );
  } catch (error) {
    // Never block the first render; the scan registers the entries anyway.
    console.warn("Plugin sidebar snapshot could not be seeded", error);
  }
}

/**
 * Saves the live entries now and after every contribution change; returns the
 * stop. The lifecycle starts it once the scan settled, when the only seeded
 * entries left belong to enabled Plugins the scan refused: those are saved
 * back, so a refusal that recurs keeps its marked entry next launch (#618).
 * It stops before a dispose clears the registry.
 */
export function persistPluginSidebarSnapshot(): () => void {
  const save = (): void => {
    writePluginSidebarSnapshot(getPluginSidebarEntries());
  };
  save();
  return onPluginContributionsChange(save);
}
