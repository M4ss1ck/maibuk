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

export const PLUGIN_TOOLBAR_PREFIX = "plugin.";

const PLUGIN_ID_SOURCE = "[a-z0-9-]{3,64}";
const LOCAL_ID_SOURCE = "[a-z][a-zA-Z0-9]{0,47}";
const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SOURCE}$`);
const LOCAL_ID_PATTERN = new RegExp(`^${LOCAL_ID_SOURCE}$`);
const PLUGIN_BUTTON_ID_PATTERN = new RegExp(
  `^plugin\\.(${PLUGIN_ID_SOURCE})\\.(${LOCAL_ID_SOURCE})$`
);

/** The shape of a Plugin toolbar button id, whether or not its Plugin is registered. */
export function isPluginToolbarButtonId(value: string): value is PluginToolbarButtonId {
  return PLUGIN_BUTTON_ID_PATTERN.test(value);
}

export function pluginIdOfToolbarButton(value: string): string | null {
  return PLUGIN_BUTTON_ID_PATTERN.exec(value)?.[1] ?? null;
}

export function localIdOfToolbarButton(value: string): string | null {
  return PLUGIN_BUTTON_ID_PATTERN.exec(value)?.[2] ?? null;
}

export interface ToolbarGroupPreference {
  kind: "group";
  id: ToolbarEntryId;
  toolbarVisible: boolean;
  floatingVisible: boolean;
}

export interface ToolbarDividerPreference {
  kind: "divider";
  id: string;
}

export type ToolbarEntry = ToolbarGroupPreference | ToolbarDividerPreference;

export interface ToolbarConfig {
  start: ToolbarEntry[];
  end: ToolbarEntry[];
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
      : {
          kind: "group",
          id: token,
          toolbarVisible: true,
          floatingVisible: FLOATING_ELIGIBLE_IDS.has(token),
        }
  );
  return { start, end: [] };
}

function freezeToolbarConfig(config: ToolbarConfig): ToolbarConfig {
  config.start.forEach(Object.freeze);
  config.end.forEach(Object.freeze);
  Object.freeze(config.start);
  Object.freeze(config.end);
  return Object.freeze(config);
}

export const DEFAULT_TOOLBAR_CONFIG: ToolbarConfig = freezeToolbarConfig(makeDefaultConfig());

export function cloneToolbarConfig(config: ToolbarConfig): ToolbarConfig {
  return {
    start: config.start.map((entry) => ({ ...entry })),
    end: config.end.map((entry) => ({ ...entry })),
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
  /** A Lucide icon name or a relative `.svg` path; resolved by the wiring slice. */
  icon?: string;
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
  buttonIds: readonly PluginToolbarButtonId[];
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

function collapseToolbarRenames(
  renames: Readonly<Record<string, string>>,
  declared: ReadonlySet<string>
): Readonly<Record<string, string>> {
  for (const [from, to] of Object.entries(renames)) {
    if (!LOCAL_ID_PATTERN.test(from) || !LOCAL_ID_PATTERN.test(to)) {
      throw new Error(`Plugin button rename "${from}" targets "${to}", which is not a Plugin-local id`);
    }
    if (declared.has(from)) {
      throw new Error(`Plugin button rename source "${from}" is a declared button`);
    }
    if (!declared.has(to)) {
      throw new Error(`Plugin button rename "${from}" targets "${to}", which is not a declared button`);
    }
  }
  const collapsed: Record<string, string> = {};
  for (const from of Object.keys(renames)) {
    const seen = new Set<string>([from]);
    let target = renames[from];
    while (renames[target] !== undefined) {
      if (seen.has(target)) throw new Error(`Plugin button rename for "${from}" cycles`);
      seen.add(target);
      target = renames[target];
    }
    collapsed[from] = target;
  }
  return collapsed;
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
  const buttonIds: PluginToolbarButtonId[] = [];
  for (const declaration of registration.buttons) {
    if (!LOCAL_ID_PATTERN.test(declaration.id)) {
      throw new Error(`Plugin button id "${declaration.id}" is outside this Plugin's namespace`);
    }
    if (declared.has(declaration.id)) {
      throw new Error(`Duplicate Plugin button id "${declaration.id}"`);
    }
    declared.add(declaration.id);
    buttonIds.push(`${PLUGIN_TOOLBAR_PREFIX}${pluginId}.${declaration.id}` as PluginToolbarButtonId);
  }
  const renames = collapseToolbarRenames(registration.buttonRenames ?? {}, declared);
  const previous = toolbarPlugins.get(pluginId);
  const token = Symbol(pluginId);
  // Token guards a stale unregister after a re-register, like Commands.
  const record: RegisteredToolbarPlugin & { token: symbol } = {
    pluginId,
    order: previous?.order ?? toolbarRegistrationOrder++,
    renames,
    buttonIds,
    token,
  };
  toolbarPlugins.set(pluginId, record);
  notifyToolbarRegistryChange();
  return () => {
    const current = toolbarPlugins.get(pluginId) as (RegisteredToolbarPlugin & { token?: symbol }) | undefined;
    if (current?.token !== token) return;
    toolbarPlugins.delete(pluginId);
    notifyToolbarRegistryChange();
  };
}

function registeredToolbarPlugins(): RegisteredToolbarPlugin[] {
  return [...toolbarPlugins.values()].sort((a, b) => a.order - b.order);
}

/** Every live Plugin toolbar button id, in registration then declaration order. */
export function registeredToolbarButtonIds(): PluginToolbarButtonId[] {
  return registeredToolbarPlugins().flatMap((plugin) => [...plugin.buttonIds]);
}

/** The rename maps of every registered Plugin, for settings migration. */
export function pluginToolbarButtonRenames(): ReadonlyMap<string, Readonly<Record<string, string>>> {
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
  return renamed === undefined ? value : `${PLUGIN_TOOLBAR_PREFIX}${pluginId}.${renamed}`;
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
  const remap = (lane: ToolbarEntry[]): ToolbarEntry[] =>
    lane.map((entry) => {
      if (entry.kind !== "group") return entry;
      const next = resolveToolbarButtonRename(entry.id);
      if (next === entry.id) return entry;
      changed = true;
      return { ...entry, id: next as ToolbarEntryId };
    });
  // The declared id's own entry wins over a migrated old one: drop duplicates
  // keeping the first occurrence across both lanes.
  const start = remap(config.start);
  const end = remap(config.end);
  const seen = new Set<string>();
  const dedupe = (lane: ToolbarEntry[]): ToolbarEntry[] =>
    lane.filter((entry) => {
      if (entry.kind !== "group") return true;
      if (seen.has(entry.id)) {
        changed = true;
        return false;
      }
      seen.add(entry.id);
      return true;
    });
  const nextStart = dedupe(start);
  const nextEnd = dedupe(end);
  if (!changed) return config;
  return { start: nextStart, end: nextEnd };
}

/**
 * Appends every registered Plugin button missing from the config to the end
 * of Start, preserving the author's arrangement. An author's visibility and
 * selection-toolbar choices for a retained button survive its absence because
 * `normalizeToolbarConfig` keeps unknown `plugin.` ids.
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
    start.push({ kind: "group", id, toolbarVisible: true, floatingVisible: true });
  }
  return { start, end: config.end };
}

export function normalizeToolbarConfig(value: unknown): ToolbarConfig {
  if (!value || typeof value !== "object") return makeDefaultConfig();
  const raw = value as Partial<ToolbarConfig>;
  if (!Array.isArray(raw.start) || !Array.isArray(raw.end)) {
    return makeDefaultConfig();
  }
  const seenGroups = new Set<string>();
  const seenDividers = new Set<string>();

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
        result.push({
          kind: "group",
          id: resolved,
          toolbarVisible: typeof entry.toolbarVisible === "boolean" ? entry.toolbarVisible : true,
          floatingVisible:
            isFloatingEligible(resolved) &&
            (typeof entry.floatingVisible === "boolean" ? entry.floatingVisible : true),
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
    }
  }
  return { start, end };
}

function laneOf(config: ToolbarConfig, section: ToolbarSection): ToolbarEntry[] {
  return section === "start" ? config.start : config.end;
}

function withLane(
  config: ToolbarConfig,
  section: ToolbarSection,
  lane: ToolbarEntry[]
): ToolbarConfig {
  return section === "start"
    ? { start: lane, end: config.end }
    : { start: config.start, end: lane };
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
  return { start: apply(config.start), end: apply(config.end) };
}

export function setGroupToolbarVisible(
  config: ToolbarConfig,
  id: ToolbarEntryId,
  visible: boolean
): ToolbarConfig {
  return mapGroups(config, id, { toolbarVisible: visible });
}

export function setGroupFloatingVisible(
  config: ToolbarConfig,
  id: ToolbarEntryId,
  visible: boolean
): ToolbarConfig {
  if (!isFloatingEligible(id)) return config;
  return mapGroups(config, id, { floatingVisible: visible });
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

export function deriveFloatingGroupIds(config: ToolbarConfig): ToolbarEntryId[] {
  return [...config.start, ...config.end]
    .filter(
      (entry): entry is ToolbarGroupPreference =>
        entry.kind === "group" && entry.floatingVisible && isFloatingEligible(entry.id)
    )
    .map((entry) => entry.id);
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
