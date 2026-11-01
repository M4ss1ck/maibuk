import type { PluginIconSpec } from "@/features/plugins/inline-icon";
import {
  LOCAL_ID_PATTERN,
  PLUGIN_ID_PATTERN,
  PLUGIN_PREFIX,
  collapseContributionRenames,
  isPluginContributionId,
  localIdOfContribution,
  pluginIdOfContribution,
} from "@/features/plugins/ids";

export type ToolbarGroupId =
  | "history"
  | "font"
  | "basic-marks"
  | "headings"
  | "find"
  | "line-height"
  | "highlight"
  | "script"
  | "text-color"
  | "link-code"
  | "lists"
  | "blockquote"
  | "indent"
  | "align"
  | "clear-formatting"
  | "text-case"
  | "table"
  | "image"
  | "scene-break"
  | "footnote"
  | "horizontal-rule"
  | "spellcheck"
  | "dictionary"
  | "symbols"
  | "html-view"
  | "export";

export type ToolbarSection = "start" | "end";

/** A Plugin toolbar button id, derived by the host as `plugin.<pluginId>.<localId>`. */
export type PluginToolbarButtonId = `plugin.${string}.${string}`;
/** Any toolbar button: a core group or a Plugin button. */
export type ToolbarEntryId = ToolbarGroupId | PluginToolbarButtonId;

/** The shape of a Plugin toolbar button id, whether or not its Plugin is registered. */
export function isPluginToolbarButtonId(value: string): value is PluginToolbarButtonId {
  return isPluginContributionId(value);
}

export function pluginIdOfToolbarButton(value: string): string | null {
  return pluginIdOfContribution(value);
}

export function localIdOfToolbarButton(value: string): string | null {
  return localIdOfContribution(value);
}

export interface ToolbarGroupPreference {
  kind: "group";
  id: ToolbarEntryId;
  toolbarVisible: boolean;
}

export interface ToolbarDividerPreference {
  kind: "divider";
  id: string;
}

export type ToolbarEntry = ToolbarGroupPreference | ToolbarDividerPreference;

export interface ToolbarConfig {
  start: ToolbarEntry[];
  end: ToolbarEntry[];
  /** The Selection Toolbar's own order (ADR 0038); retained ids of absent Plugins keep their slots. */
  selectionToolbar: ToolbarEntryId[];
}

/** Canonical left-to-right order. Also the "append new groups" order for normalize. */
export const ALL_GROUP_IDS = [
  "history",
  "font",
  "basic-marks",
  "headings",
  "find",
  "line-height",
  "highlight",
  "script",
  "text-color",
  "link-code",
  "lists",
  "blockquote",
  "indent",
  "align",
  "clear-formatting",
  "text-case",
  "table",
  "image",
  "scene-break",
  "footnote",
  "horizontal-rule",
  "spellcheck",
  "dictionary",
  "symbols",
  "html-view",
  "export",
] as const satisfies readonly ToolbarGroupId[];

export const FLOATING_ELIGIBLE_IDS: ReadonlySet<string> = new Set([
  "basic-marks",
  "headings",
  "highlight",
  "link-code",
]);

const GROUP_ID_SET = new Set<string>(ALL_GROUP_IDS);

/** Whether a toolbar button may appear in the selection toolbar. Plugin buttons always may. */
export function isFloatingEligible(id: string): boolean {
  if (isPluginToolbarButtonId(id)) return true;
  return (FLOATING_ELIGIBLE_IDS as ReadonlySet<string>).has(id);
}

/** `D` marks a default divider boundary; strings are group ids in default (Start) order. */
const DEFAULT_START_LAYOUT: (ToolbarGroupId | "D")[] = [
  "history",
  "D",
  "font",
  "D",
  "basic-marks",
  "D",
  "headings",
  "D",
  "find",
  "D",
  "line-height",
  "D",
  "highlight",
  "script",
  "text-color",
  "link-code",
  "D",
  "lists",
  "blockquote",
  "D",
  "indent",
  "D",
  "align",
  "D",
  "clear-formatting",
  "D",
  "text-case",
  "D",
  "table",
  "image",
  "scene-break",
  "footnote",
  "D",
  "horizontal-rule",
  "spellcheck",
  "dictionary",
  "symbols",
  "html-view",
  "D",
  "export",
];

let dividerCounter = 0;

export function makeDividerId(): string {
  const uuid =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  return `divider-${uuid}-${dividerCounter++}`;
}

function makeDefaultConfig(): ToolbarConfig {
  const start: ToolbarEntry[] = DEFAULT_START_LAYOUT.map((token) =>
    token === "D"
      ? { kind: "divider", id: makeDividerId() }
      : { kind: "group", id: token, toolbarVisible: true }
  );
  const selectionToolbar = DEFAULT_START_LAYOUT.filter(
    (token): token is ToolbarGroupId => token !== "D" && FLOATING_ELIGIBLE_IDS.has(token)
  );
  return { start, end: [], selectionToolbar };
}

function freezeToolbarConfig(config: ToolbarConfig): ToolbarConfig {
  config.start.forEach(Object.freeze);
  config.end.forEach(Object.freeze);
  Object.freeze(config.start);
  Object.freeze(config.end);
  Object.freeze(config.selectionToolbar);
  return Object.freeze(config);
}

export const DEFAULT_TOOLBAR_CONFIG: ToolbarConfig = freezeToolbarConfig(makeDefaultConfig());

export function cloneToolbarConfig(config: ToolbarConfig): ToolbarConfig {
  return {
    start: config.start.map((entry) => ({ ...entry })),
    end: config.end.map((entry) => ({ ...entry })),
    selectionToolbar: [...config.selectionToolbar],
  };
}

export function resetToolbarConfig(): ToolbarConfig {
  return makeDefaultConfig();
}

/** One toolbar button a Plugin declares; the host derives its full id. */
export interface PluginToolbarButtonDeclaration {
  /** The Plugin-local id: `[a-z][a-zA-Z0-9]{0,47}`, unique in the Plugin. */
  id: string;
  /** The local Command id this button runs; resolved by the wiring slice. */
  command?: string;
  /** A Lucide icon name, a relative `.svg` path, or inline elements (#531); resolved by the wiring slice. */
  icon?: PluginIconSpec;
  /** A Toggle Button: shows on or off as the Plugin sets it with `toolbar.setPressed`. */
  toggle?: boolean;
}

export interface PluginToolbarRegistration {
  buttons: readonly PluginToolbarButtonDeclaration[];
  /** Same-Plugin button renames: old local id → new local id. */
  buttonRenames?: Readonly<Record<string, string>>;
}

interface RegisteredToolbarPlugin {
  pluginId: string;
  order: number;
  renames: Readonly<Record<string, string>>;
  buttons: readonly PluginToolbarButtonDef[];
}

/** One live Plugin toolbar button: its derived id plus what its declaration carried. */
export interface PluginToolbarButtonDef {
  id: PluginToolbarButtonId;
  pluginId: string;
  localId: string;
  /** The local Command id this button runs; labels resolve through the Command registry. */
  command?: string;
  /** A Lucide icon name, a relative `.svg` path, or inline elements (#531). */
  icon?: PluginIconSpec;
  /** A Toggle Button: its pressed state is the Plugin's, set with `toolbar.setPressed`. */
  toggle?: boolean;
}

const toolbarPlugins = new Map<string, RegisteredToolbarPlugin>();
let toolbarRegistrationOrder = 0;
let toolbarRevision = 0;
const toolbarListeners = new Set<() => void>();

function notifyToolbarRegistryChange(): void {
  toolbarRevision += 1;
  for (const listener of [...toolbarListeners]) listener();
}

export function toolbarRegistryRevision(): number {
  return toolbarRevision;
}

/** Runs after every toolbar register and unregister. Returns unregister. */
export function onToolbarRegistryChange(listener: () => void): () => void {
  toolbarListeners.add(listener);
  return () => {
    toolbarListeners.delete(listener);
  };
}

/**
 * Admits a Plugin's toolbar buttons into the shared registry. The host derives
 * every full id as `plugin.<pluginId>.<localId>`, so a declaration can never
 * name another owner's button. Registering the same Plugin again updates it in
 * place, keeping its place in the append order. Returns unregister.
 */
export function registerToolbarButtons(
  pluginId: string,
  registration: PluginToolbarRegistration
): () => void {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(`Invalid Plugin id "${pluginId}"`);
  }
  const declared = new Set<string>();
  const buttons: PluginToolbarButtonDef[] = [];
  for (const declaration of registration.buttons) {
    if (!LOCAL_ID_PATTERN.test(declaration.id)) {
      throw new Error(`Plugin button id "${declaration.id}" is outside this Plugin's namespace`);
    }
    if (declared.has(declaration.id)) {
      throw new Error(`Duplicate Plugin button id "${declaration.id}"`);
    }
    declared.add(declaration.id);
    buttons.push({
      id: `${PLUGIN_PREFIX}${pluginId}.${declaration.id}` as PluginToolbarButtonId,
      pluginId,
      localId: declaration.id,
      ...(declaration.command !== undefined ? { command: declaration.command } : {}),
      ...(declaration.icon !== undefined ? { icon: declaration.icon } : {}),
      ...(declaration.toggle !== undefined ? { toggle: declaration.toggle } : {}),
    });
  }
  const renames = collapseContributionRenames(registration.buttonRenames ?? {}, declared, "button");
  const previous = toolbarPlugins.get(pluginId);
  const token = Symbol(pluginId);
  // Token guards a stale unregister after a re-register, like Commands.
  const record: RegisteredToolbarPlugin & { token: symbol } = {
    pluginId,
    order: previous?.order ?? toolbarRegistrationOrder++,
    renames,
    buttons,
    token,
  };
  toolbarPlugins.set(pluginId, record);
  notifyToolbarRegistryChange();
  return () => {
    const current = toolbarPlugins.get(pluginId) as
      | (RegisteredToolbarPlugin & { token?: symbol })
      | undefined;
    if (current?.token !== token) return;
    toolbarPlugins.delete(pluginId);
    notifyToolbarRegistryChange();
  };
}

function registeredToolbarPlugins(): RegisteredToolbarPlugin[] {
  return [...toolbarPlugins.values()].sort((a, b) => a.order - b.order);
}

/** Every live Plugin toolbar button, in registration then declaration order. */
export function registeredToolbarButtons(): PluginToolbarButtonDef[] {
  return registeredToolbarPlugins().flatMap((plugin) => [...plugin.buttons]);
}

/** Every live Plugin toolbar button id, in registration then declaration order. */
export function registeredToolbarButtonIds(): PluginToolbarButtonId[] {
  return registeredToolbarButtons().map((button) => button.id);
}

/**
 * Whether a toolbar entry renders: core groups always do; a `plugin.` button
 * only while its Plugin is registered. Absent Plugin ids stay in the config
 * as retained arrangement but render nothing until the Plugin returns.
 */
export function isLiveToolbarEntry(id: string): boolean {
  if (GROUP_ID_SET.has(id)) return true;
  if (!isPluginToolbarButtonId(id)) return false;
  return registeredToolbarButtonIds().includes(id);
}

/** The rename maps of every registered Plugin, for settings migration. */
export function pluginToolbarButtonRenames(): ReadonlyMap<
  string,
  Readonly<Record<string, string>>
> {
  return new Map(registeredToolbarPlugins().map((plugin) => [plugin.pluginId, plugin.renames]));
}

/**
 * Applies a registered Plugin's rename map to a stored button id. A Plugin
 * that is absent keeps its stored ids as they are: the arrangement is retained
 * for its return.
 */
export function resolveToolbarButtonRename(value: string): string {
  const pluginId = pluginIdOfToolbarButton(value);
  if (pluginId === null) return value;
  const localId = localIdOfToolbarButton(value);
  const renamed = localId === null ? undefined : toolbarPlugins.get(pluginId)?.renames[localId];
  return renamed === undefined ? value : `${PLUGIN_PREFIX}${pluginId}.${renamed}`;
}

/**
 * A stored id to the button it names today, or null when it names nothing.
 * Unknown ids under `plugin.` are kept as they are (retained preference);
 * everything else unknown is dropped.
 */
export function resolveStoredToolbarButtonId(rawId: string): ToolbarEntryId | null {
  const renamed = resolveToolbarButtonRename(rawId);
  if (GROUP_ID_SET.has(renamed)) return renamed as ToolbarGroupId;
  return isPluginToolbarButtonId(renamed) ? renamed : null;
}

/**
 * Moves retained preferences to a registered Plugin's renamed button ids.
 * A Plugin that is absent has no rename map, so its ids stay as they are.
 * Returns the same config object when nothing changes.
 */
export function applyToolbarButtonRenames(config: ToolbarConfig): ToolbarConfig {
  if (pluginToolbarButtonRenames().size === 0) return config;
  let changed = false;
  interface MappedGroup {
    entry: ToolbarEntry;
    next: string;
    owned: boolean;
  }
  const mapped: MappedGroup[][] = [config.start, config.end].map((lane) =>
    lane.map((entry) => {
      if (entry.kind !== "group") return { entry, next: "", owned: false };
      const next = resolveToolbarButtonRename(entry.id);
      if (next !== entry.id) changed = true;
      return { entry, next, owned: next === entry.id };
    })
  );
  // Ids with an entry of their own: a migrated old id pointing at one is
  // dropped, so the declared entry's own flags win wherever it sits.
  const ownedIds = new Set<string>();
  for (const lane of mapped) {
    for (const info of lane) {
      if (info.entry.kind === "group" && info.owned) ownedIds.add(info.next);
    }
  }
  const seen = new Set<string>();
  const rebuild = (lane: MappedGroup[]): ToolbarEntry[] => {
    const out: ToolbarEntry[] = [];
    for (const info of lane) {
      if (info.entry.kind !== "group") {
        out.push(info.entry);
        continue;
      }
      if ((!info.owned && ownedIds.has(info.next)) || seen.has(info.next)) {
        changed = true;
        continue;
      }
      seen.add(info.next);
      out.push(info.owned ? info.entry : { ...info.entry, id: info.next as ToolbarEntryId });
    }
    return out;
  };
  const nextStart = rebuild(mapped[0]);
  const nextEnd = rebuild(mapped[1]);
  const selectionSeen = new Set<string>();
  const nextSelection: ToolbarEntryId[] = [];
  for (const id of config.selectionToolbar) {
    const next = resolveToolbarButtonRename(id) as ToolbarEntryId;
    if (next !== id) changed = true;
    if (selectionSeen.has(next)) {
      changed = true;
      continue;
    }
    selectionSeen.add(next);
    nextSelection.push(next);
  }
  if (!changed) return config;
  return { start: nextStart, end: nextEnd, selectionToolbar: nextSelection };
}

/**
 * Appends every registered Plugin button missing from the config to the end
 * of Start, preserving the author's arrangement. An author's visibility and
 * Selection Toolbar slots for a retained button survive its absence because
 * `normalizeToolbarConfig` keeps unknown `plugin.` ids. A new button joins the
 * Selection Toolbar too, at its end.
 */
export function withRegisteredToolbarButtons(config: ToolbarConfig): ToolbarConfig {
  const known = new Set<string>();
  for (const entry of [...config.start, ...config.end]) {
    if (entry.kind === "group") known.add(entry.id);
  }
  const missing = registeredToolbarButtonIds().filter((id) => !known.has(id));
  if (missing.length === 0) return config;
  const start = [...config.start];
  for (const id of missing) {
    start.push({ kind: "group", id, toolbarVisible: true });
  }
  return { start, end: config.end, selectionToolbar: [...config.selectionToolbar, ...missing] };
}

export function normalizeToolbarConfig(value: unknown): ToolbarConfig {
  if (!value || typeof value !== "object") return makeDefaultConfig();
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.start) || !Array.isArray(raw.end)) {
    return makeDefaultConfig();
  }
  const seenGroups = new Set<string>();
  const seenDividers = new Set<string>();
  // Before ADR 0038 each entry carried a `floatingVisible` flag; an upgrade
  // reads them once to build the Selection Toolbar's own list.
  const legacyFloating = new Set<string>();

  const normalizeLane = (lane: unknown): ToolbarEntry[] => {
    if (!Array.isArray(lane)) return [];
    const result: ToolbarEntry[] = [];
    for (const item of lane) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (entry.kind === "divider") {
        if (
          typeof entry.id !== "string" ||
          entry.id.trim().length === 0 ||
          seenDividers.has(entry.id)
        ) {
          continue;
        }
        seenDividers.add(entry.id);
        result.push({ kind: "divider", id: entry.id });
      } else if (entry.kind === "group") {
        const rawId = entry.id;
        if (typeof rawId !== "string") continue;
        const resolved = resolveStoredToolbarButtonId(rawId);
        if (resolved === null || seenGroups.has(resolved)) {
          continue;
        }
        seenGroups.add(resolved);
        if (isFloatingEligible(resolved) && entry.floatingVisible !== false) {
          legacyFloating.add(resolved);
        }
        result.push({
          kind: "group",
          id: resolved,
          toolbarVisible: typeof entry.toolbarVisible === "boolean" ? entry.toolbarVisible : true,
        });
      }
    }
    return result;
  };

  const start = normalizeLane(raw.start);
  const end = normalizeLane(raw.end);

  for (const entry of DEFAULT_TOOLBAR_CONFIG.start) {
    if (entry.kind === "group" && !seenGroups.has(entry.id)) {
      start.push({ ...entry });
      seenGroups.add(entry.id);
      if (isFloatingEligible(entry.id)) legacyFloating.add(entry.id);
    }
  }

  let selectionToolbar: ToolbarEntryId[];
  if (Array.isArray(raw.selectionToolbar)) {
    const seen = new Set<string>();
    selectionToolbar = [];
    for (const rawId of raw.selectionToolbar) {
      if (typeof rawId !== "string") continue;
      const resolved = resolveStoredToolbarButtonId(rawId);
      if (resolved === null || seen.has(resolved)) continue;
      if (!seenGroups.has(resolved) || !isFloatingEligible(resolved)) continue;
      seen.add(resolved);
      selectionToolbar.push(resolved);
    }
  } else {
    selectionToolbar = [...start, ...end]
      .filter(
        (entry): entry is ToolbarGroupPreference =>
          entry.kind === "group" && legacyFloating.has(entry.id)
      )
      .map((entry) => entry.id);
  }
  return { start, end, selectionToolbar };
}

function laneOf(config: ToolbarConfig, section: ToolbarSection): ToolbarEntry[] {
  return section === "start" ? config.start : config.end;
}

function withLane(
  config: ToolbarConfig,
  section: ToolbarSection,
  lane: ToolbarEntry[]
): ToolbarConfig {
  return section === "start" ? { ...config, start: lane } : { ...config, end: lane };
}

export function moveEntry(
  config: ToolbarConfig,
  section: ToolbarSection,
  index: number,
  direction: "up" | "down"
): ToolbarConfig {
  const lane = laneOf(config, section);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= lane.length || target < 0 || target >= lane.length) {
    return config;
  }
  const next = lane.map((entry) => ({ ...entry }));
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return withLane(config, section, next);
}

export function moveEntryTo(
  config: ToolbarConfig,
  from: ToolbarSection,
  index: number,
  to: ToolbarSection,
  toIndex: number
): ToolbarConfig {
  const fromLane = laneOf(config, from);
  if (index < 0 || index >= fromLane.length) return config;
  const moved = { ...fromLane[index] };
  const nextFrom = fromLane.filter((_, itemIndex) => itemIndex !== index);
  if (from === to) {
    const clamped = Math.max(0, Math.min(toIndex, nextFrom.length));
    nextFrom.splice(clamped, 0, moved);
    return withLane(config, from, nextFrom);
  }
  const toLane = laneOf(config, to).map((entry) => ({ ...entry }));
  const clamped = Math.max(0, Math.min(toIndex, toLane.length));
  toLane.splice(clamped, 0, moved);
  return withLane(withLane(config, from, nextFrom), to, toLane);
}

export function transferEntry(
  config: ToolbarConfig,
  from: ToolbarSection,
  index: number
): ToolbarConfig {
  const to: ToolbarSection = from === "start" ? "end" : "start";
  return moveEntryTo(config, from, index, to, laneOf(config, to).length);
}

function mapGroups(
  config: ToolbarConfig,
  id: ToolbarEntryId,
  patch: Partial<ToolbarGroupPreference>
): ToolbarConfig {
  const apply = (lane: ToolbarEntry[]) =>
    lane.map((entry) =>
      entry.kind === "group" && entry.id === id ? { ...entry, ...patch } : entry
    );
  return { ...config, start: apply(config.start), end: apply(config.end) };
}

export function setGroupToolbarVisible(
  config: ToolbarConfig,
  id: ToolbarEntryId,
  visible: boolean
): ToolbarConfig {
  return mapGroups(config, id, { toolbarVisible: visible });
}

/**
 * The List switch (ADR 0038): removes a button from the Selection Toolbar, or
 * inserts it after the Selection Toolbar's last button that comes before it in
 * the Editor Toolbar, or first when none does.
 */
export function setSelectionToolbarMember(
  config: ToolbarConfig,
  id: ToolbarEntryId,
  member: boolean
): ToolbarConfig {
  const has = config.selectionToolbar.includes(id);
  if (!member) {
    if (!has) return config;
    return { ...config, selectionToolbar: config.selectionToolbar.filter((other) => other !== id) };
  }
  if (has || !isFloatingEligible(id)) return config;
  const editorOrder = [...config.start, ...config.end].map((entry) => entry.id);
  const before = new Set(editorOrder.slice(0, Math.max(0, editorOrder.indexOf(id))));
  let insertAt = 0;
  config.selectionToolbar.forEach((other, index) => {
    if (before.has(other)) insertAt = index + 1;
  });
  const selectionToolbar = [...config.selectionToolbar];
  selectionToolbar.splice(insertAt, 0, id);
  return { ...config, selectionToolbar };
}

export function addDivider(
  config: ToolbarConfig,
  section: ToolbarSection,
  index?: number
): ToolbarConfig {
  const lane = laneOf(config, section).map((entry) => ({ ...entry }));
  const at = index === undefined ? lane.length : Math.max(0, Math.min(index, lane.length));
  lane.splice(at, 0, { kind: "divider", id: makeDividerId() });
  return withLane(config, section, lane);
}

export function removeDivider(
  config: ToolbarConfig,
  section: ToolbarSection,
  dividerId: string
): ToolbarConfig {
  const lane = laneOf(config, section);
  const next = lane.filter((entry) => !(entry.kind === "divider" && entry.id === dividerId));
  if (next.length === lane.length) return config;
  return withLane(config, section, next);
}

/** The Selection Toolbar's buttons that render now, in its own order. */
export function liveSelectionToolbarIds(config: ToolbarConfig): ToolbarEntryId[] {
  return config.selectionToolbar.filter((id) => isFloatingEligible(id) && isLiveToolbarEntry(id));
}

export function suppressOrphanDividers(entries: ToolbarEntry[]): ToolbarEntry[] {
  const result: ToolbarEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "divider") {
      const previous = result[result.length - 1];
      if (!previous || previous.kind === "divider") continue;
      result.push(entry);
    } else {
      result.push(entry);
    }
  }
  while (result.length && result[result.length - 1].kind === "divider") {
    result.pop();
  }
  return result;
}

/** What the Editor Toolbar renders of a lane: shown, live buttons, and no orphan dividers. */
export function displayedToolbarEntries(entries: ToolbarEntry[]): ToolbarEntry[] {
  // Retained buttons of absent Plugins stay in the config but render nothing:
  // dropping them before orphan suppression leaves no empty boundary and no
  // doubled dividers.
  return suppressOrphanDividers(
    entries.filter(
      (entry) => entry.kind === "divider" || (entry.toolbarVisible && isLiveToolbarEntry(entry.id))
    )
  );
}

/** A place between shown entries: `index` counts the entries the author sees in that lane. */
export interface ToolbarSlot {
  section: ToolbarSection;
  index: number;
}

/** The lane index a shown slot stands for: just before the shown entry at that slot. */
function laneIndexOfSlot<T>(lane: T[], shown: T[], index: number): number {
  if (index < shown.length) return lane.indexOf(shown[index]);
  return shown.length === 0 ? lane.length : lane.indexOf(shown[shown.length - 1]) + 1;
}

/** Whether a Toolbar Divider may sit at a shown slot: never at a lane's end, never beside another. */
export function toolbarSlotAcceptsDivider(shown: ToolbarEntry[], index: number): boolean {
  if (index <= 0 || index >= shown.length) return false;
  return shown[index - 1].kind !== "divider" && shown[index].kind !== "divider";
}

/**
 * Moves an entry to a shown slot of the Editor Toolbar, showing it if it was
 * hidden. A divider not in the config yet (pulled from the Divider source) is
 * added there.
 */
export function placeToolbarEntry(
  config: ToolbarConfig,
  entry: ToolbarEntry,
  slot: ToolbarSlot
): ToolbarConfig {
  const existing = [...config.start, ...config.end].find((other) => other.id === entry.id);
  const placed: ToolbarEntry =
    existing?.kind === "group" ? { ...existing, toolbarVisible: true } : { ...(existing ?? entry) };
  const without = {
    ...config,
    start: config.start.filter((other) => other.id !== entry.id),
    end: config.end.filter((other) => other.id !== entry.id),
  };
  const lane = [...laneOf(without, slot.section)];
  const at = laneIndexOfSlot(lane, displayedToolbarEntries(lane), slot.index);
  lane.splice(at, 0, placed);
  return withLane(without, slot.section, lane);
}

/** Dropped outside the toolbar: a button hides in place, a divider is deleted. */
export function hideToolbarEntry(config: ToolbarConfig, id: string): ToolbarConfig {
  const apply = (lane: ToolbarEntry[]): ToolbarEntry[] =>
    lane.flatMap((entry) => {
      if (entry.id !== id) return [entry];
      return entry.kind === "divider" ? [] : [{ ...entry, toolbarVisible: false }];
    });
  return { ...config, start: apply(config.start), end: apply(config.end) };
}

/**
 * Deletes the dividers the Editor Toolbar would not render: a lane's leading
 * and trailing ones, and the second of two that a move left side by side.
 */
export function mergeToolbarDividers(config: ToolbarConfig): ToolbarConfig {
  const merge = (lane: ToolbarEntry[]): ToolbarEntry[] => {
    const shown = new Set(displayedToolbarEntries(lane));
    const result = lane.filter((entry) => entry.kind !== "divider" || shown.has(entry));
    return result.length === lane.length ? lane : result;
  };
  const start = merge(config.start);
  const end = merge(config.end);
  if (start === config.start && end === config.end) return config;
  return { ...config, start, end };
}

/** Moves a button to a shown slot of the Selection Toolbar, adding it if it was out. */
export function placeSelectionToolbarEntry(
  config: ToolbarConfig,
  id: ToolbarEntryId,
  index: number
): ToolbarConfig {
  if (!isFloatingEligible(id)) return config;
  const list = config.selectionToolbar.filter((other) => other !== id);
  const at = laneIndexOfSlot(
    list,
    liveSelectionToolbarIds({ ...config, selectionToolbar: list }),
    index
  );
  list.splice(at, 0, id);
  return { ...config, selectionToolbar: list };
}

export function removeSelectionToolbarEntry(
  config: ToolbarConfig,
  id: ToolbarEntryId
): ToolbarConfig {
  return setSelectionToolbarMember(config, id, false);
}
