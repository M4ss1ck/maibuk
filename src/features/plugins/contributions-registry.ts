/**
 * The read side of a Plugin's contributions: the registry the UI subscribes to,
 * its getters, and the localization helper the surfaces share. Kept apart from
 * `contributions.ts` (which parses and registers) so UI code reads a
 * contribution without pulling the manifest validator and Zod into the entry
 * chunk (#437). `registerPluginContributions` is the only writer; the getters
 * and `onPluginContributionsChange` are what the sidebar, the Item Menus, the
 * toolbar, and the Plugin pages read.
 *
 * One Plugin's entries are ordered Maibuk first, then Plugin display name,
 * Plugin id for ties, then the declared order within the Plugin (the placement
 * decision, #395).
 */

import type { PluginIconSpec } from "@/features/plugins/inline-icon";

import i18n from "@/i18n";
import { PLUGIN_TARGETS } from "@/features/plugins/manifest-constants";
import type { PluginContributionId } from "@/features/plugins/types";
import type { Language } from "@/features/settings/types";
import type { PluginCommandId } from "@/lib/shortcut-registry";

/** The item kinds a contributed Command can act on (the v1 API entities). */
export type PluginTarget = (typeof PLUGIN_TARGETS)[number];

/** A Plugin page reachable at `/plugin/<pluginId>/<pageId>`. */
export interface PluginPageDef {
  pluginId: string;
  displayName: string;
  /** The Plugin-local page id, which is also its Shortcut Context. */
  localId: string;
  id: PluginContributionId;
  title: string;
  /**
   * A whole-page Frame's HTML path, relative to the Plugin folder (#454, D2):
   * the page renders the sandboxed Frame instead of its Remote UI tree. Absent
   * for a host-rendered page.
   */
  frame?: string;
  /** The navigating Command that opens the page. */
  commandId: PluginCommandId;
  icon?: PluginIconSpec;
}

/** An optional sidebar entry that navigates to a page. */
export interface PluginSidebarEntryDef {
  pluginId: string;
  displayName: string;
  pageId: string;
  pageRoute: string;
  title: string;
  icon?: PluginIconSpec;
  commandId: PluginCommandId;
  /**
   * Read from the previous launch's snapshot, so the first frame shows the
   * entry before the scan registers it. Its Command is not in the shared
   * registry yet, so nothing reads that Command's label or Shortcut.
   */
  seeded?: true;
}

/** A Command explicitly listed for the Item Menus of its target kinds. */
export interface PluginItemMenuEntryDef {
  pluginId: string;
  displayName: string;
  commandId: PluginCommandId;
  localId: string;
  label: string;
  targets: readonly PluginTarget[];
}

/**
 * One live Command of a registered Plugin: its derived id, the Contexts it is
 * live in, the item kinds it acts on, and the page it opens when it is a page's
 * navigating Command. The stored Contexts are the same derived names the
 * shared registry keeps (`plugin.<id>.<page>` for this Plugin's own pages), so
 * `getPluginCommands` and `getCommand` never disagree about one. Built from
 * the platform-filtered manifest, so it is the single source the runner reads.
 */
export interface PluginCommandDef {
  id: PluginCommandId;
  pluginId: string;
  localId: string;
  contexts: readonly string[];
  targets?: readonly PluginTarget[];
  pageId?: string;
}

/** One Plugin's registered contributions, replaced whole on re-register. */
export interface RegisteredContributions {
  pluginId: string;
  displayName: string;
  commands: readonly PluginCommandDef[];
  pages: readonly PluginPageDef[];
  sidebarEntries: readonly PluginSidebarEntryDef[];
  itemMenuEntries: readonly PluginItemMenuEntryDef[];
  token: symbol;
  /** A sidebar-only record seeded from the snapshot until the scan replaces it. */
  seeded?: true;
}

/** The route a Plugin page lives at. */
export function pluginPageRoute(pluginId: string, pageId: string): string {
  return `/plugin/${pluginId}/${pageId}`;
}

const contributions = new Map<string, RegisteredContributions>();
const listeners = new Set<() => void>();
// Referentially stable snapshots for useSyncExternalStore, refreshed on change.
let cachedPages: PluginPageDef[] | null = null;
let cachedSidebar: PluginSidebarEntryDef[] | null = null;
const cachedItemMenu = new Map<PluginTarget, PluginItemMenuEntryDef[]>();

/** Runs after every contribution register and unregister. */
export function notifyContributionsChange(): void {
  cachedPages = null;
  cachedSidebar = null;
  cachedItemMenu.clear();
  for (const listener of [...listeners]) listener();
}

/** Runs after every contribution register and unregister. Returns unregister. */
export function onPluginContributionsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The registration side's read of one Plugin's stored record. */
export function getRegisteredContributions(pluginId: string): RegisteredContributions | undefined {
  return contributions.get(pluginId);
}

/** The registration side's only writer; callers notify after they finish. */
export function setRegisteredContributions(
  pluginId: string,
  record: RegisteredContributions
): void {
  contributions.set(pluginId, record);
}

/** Removes one Plugin's record; the registration side notifies when it does. */
export function deleteRegisteredContributions(pluginId: string): void {
  contributions.delete(pluginId);
}

/**
 * Shows saved sidebar entries before the launch scan, one sidebar-only record
 * per Plugin. A Plugin that already registered keeps its live record, and a
 * later registration replaces the seeded one whole.
 */
export function seedPluginSidebarEntries(entries: readonly PluginSidebarEntryDef[]): void {
  const byPlugin = new Map<string, PluginSidebarEntryDef[]>();
  for (const entry of entries) {
    if (contributions.has(entry.pluginId)) continue;
    const list = byPlugin.get(entry.pluginId) ?? [];
    list.push({ ...entry, seeded: true });
    byPlugin.set(entry.pluginId, list);
  }
  if (byPlugin.size === 0) return;
  for (const [pluginId, sidebarEntries] of byPlugin) {
    contributions.set(pluginId, {
      pluginId,
      displayName: sidebarEntries[0].displayName,
      commands: [],
      pages: [],
      sidebarEntries,
      itemMenuEntries: [],
      token: Symbol(pluginId),
      seeded: true,
    });
  }
  notifyContributionsChange();
}

/** Removes every seeded record the scan did not replace, except the ones `keep` names. */
export function dropSeededPluginContributions(
  keep: (pluginId: string) => boolean = () => false
): void {
  let dropped = false;
  for (const [pluginId, record] of contributions) {
    if (record.seeded !== true || keep(pluginId)) continue;
    contributions.delete(pluginId);
    dropped = true;
  }
  if (dropped) notifyContributionsChange();
}

function isMaibukOwner(pluginId: string): boolean {
  return pluginId === "maibuk" || pluginId.startsWith("maibuk-");
}

function compareOwners(
  a: { displayName: string; pluginId: string },
  b: { displayName: string; pluginId: string }
): number {
  const aMaibuk = isMaibukOwner(a.pluginId) ? 0 : 1;
  const bMaibuk = isMaibukOwner(b.pluginId) ? 0 : 1;
  if (aMaibuk !== bMaibuk) return aMaibuk - bMaibuk;
  const byName = a.displayName.localeCompare(b.displayName);
  if (byName !== 0) return byName;
  return a.pluginId.localeCompare(b.pluginId);
}

/** Every Plugin page, ordered by owner then declared order. */
export function getPluginPages(): PluginPageDef[] {
  if (cachedPages !== null) return cachedPages;
  const records = [...contributions.values()].sort(compareOwners);
  cachedPages = records.flatMap((record) => [...record.pages]);
  return cachedPages;
}

/** Every Plugin sidebar entry, ordered by owner then declared order. */
export function getPluginSidebarEntries(): PluginSidebarEntryDef[] {
  if (cachedSidebar !== null) return cachedSidebar;
  const records = [...contributions.values()].sort(compareOwners);
  cachedSidebar = records.flatMap((record) => [...record.sidebarEntries]);
  return cachedSidebar;
}

/** The Item Menu entries for one item kind, ordered by owner then declaration. */
export function getPluginItemMenuEntries(kind: PluginTarget): PluginItemMenuEntryDef[] {
  const cached = cachedItemMenu.get(kind);
  if (cached !== undefined) return cached;
  const records = [...contributions.values()].sort(compareOwners);
  const entries = records
    .flatMap((record) => [...record.itemMenuEntries])
    .filter((entry) => entry.targets.includes(kind));
  cachedItemMenu.set(kind, entries);
  return entries;
}

/** Every live Command of one Plugin, in declared order. */
export function getPluginCommands(pluginId: string): PluginCommandDef[] {
  return [...(contributions.get(pluginId)?.commands ?? [])];
}

/** One live Command of one Plugin, or undefined. */
export function getPluginCommand(pluginId: string, localId: string): PluginCommandDef | undefined {
  return contributions.get(pluginId)?.commands.find((command) => command.localId === localId);
}

export function getPluginPage(pluginId: string, pageId: string): PluginPageDef | undefined {
  return contributions.get(pluginId)?.pages.find((page) => page.localId === pageId);
}

/** The current UI language, narrowed to the languages a manifest may use. */
export function currentUILanguage(): Language {
  const raw = i18n.resolvedLanguage ?? i18n.language ?? "en";
  return raw.split("-")[0] === "es" ? "es" : "en";
}

/** Drops every registered contribution; tests use it between cases. */
export function resetPluginContributionsForTests(): void {
  contributions.clear();
  notifyContributionsChange();
}
