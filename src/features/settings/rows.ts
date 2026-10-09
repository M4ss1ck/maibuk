import { IS_ANDROID, IS_DESKTOP, IS_WEB } from "@/lib/platform";

export type SettingsPlatform = "web" | "desktop" | "android";

export type SettingsReveal =
  | { kind: "advanced" }
  | { kind: "pasteCleanupAdvanced" }
  | { kind: "dictationLanguage" }
  | { kind: "plugin"; pluginId: string };

export interface SettingsRowDef {
  /** camelCase, unique across all sections. */
  id: string;
  /** i18n key of the row's visible label. */
  labelKey: string;
  /** i18n key of its description, when it has one. */
  descriptionKey?: string;
  /** i18n key whose value is a string ARRAY of extra search terms. */
  keywordsKey?: string;
  /** Omitted = every platform. */
  platforms?: readonly SettingsPlatform[];
  /** What must open before the row's control exists. */
  reveal?: SettingsReveal;
}

export interface SettingsSectionDef {
  id: string;
  labelKey: string;
  rows: readonly SettingsRowDef[];
}

export function currentSettingsPlatform(): SettingsPlatform {
  if (IS_ANDROID) return "android";
  if (IS_DESKTOP) return "desktop";
  if (IS_WEB) return "web";
  // iOS and unknown Tauri targets behave like the web screen: no desktop-only
  // rows and no Android-only rows.
  return "web";
}

export function rowOnPlatform(
  row: SettingsRowDef | PluginSettingsRowDef,
  platform: SettingsPlatform
): boolean {
  return row.platforms === undefined || row.platforms.includes(platform);
}

/** A Plugin Settings row id, derived by the host as `plugin.<pluginId>.<localId>`. */
export type PluginSettingsRowId = `plugin.${string}.${string}`;

export const PLUGIN_SETTINGS_PREFIX = "plugin.";

const PLUGIN_ID_SOURCE = "[a-z0-9-]{3,64}";
const LOCAL_ID_SOURCE = "[a-z][a-zA-Z0-9]{0,47}";
const PLUGIN_ID_PATTERN = new RegExp(`^${PLUGIN_ID_SOURCE}$`);
const LOCAL_ID_PATTERN = new RegExp(`^${LOCAL_ID_SOURCE}$`);
const PLUGIN_ROW_ID_PATTERN = new RegExp(
  `^plugin\\.(${PLUGIN_ID_SOURCE})\\.(${LOCAL_ID_SOURCE})$`
);

/** The shape of a Plugin Settings row id, whether or not its Plugin is registered. */
export function isPluginSettingsRowId(value: string): value is PluginSettingsRowId {
  return PLUGIN_ROW_ID_PATTERN.test(value);
}

export function pluginIdOfSettingsRow(value: string): string | null {
  return PLUGIN_ROW_ID_PATTERN.exec(value)?.[1] ?? null;
}

export function localIdOfSettingsRow(value: string): string | null {
  return PLUGIN_ROW_ID_PATTERN.exec(value)?.[2] ?? null;
}

/** One Settings row a Plugin declares; metadata only, no Worker needed. */
export interface PluginSettingsRowDeclaration {
  /** The Plugin-local id: `[a-z][a-zA-Z0-9]{0,47}`, unique in the Plugin. */
  id: string;
  /** The label in the Plugin's default language. */
  label: string;
  description?: string;
  keywords?: readonly string[];
  platforms?: readonly SettingsPlatform[];
}

/** A declared Plugin Settings row with its derived full id and reveal. */
export interface PluginSettingsRowDef {
  /** The full id: `plugin.<pluginId>.<localId>`. */
  id: PluginSettingsRowId;
  pluginId: string;
  localId: string;
  label: string;
  description?: string;
  keywords?: readonly string[];
  platforms?: readonly SettingsPlatform[];
  reveal: { kind: "plugin"; pluginId: string };
}

export interface PluginSettingsRegistration {
  /** The displayed Plugin name, for accordion ordering. */
  displayName: string;
  rows: readonly PluginSettingsRowDeclaration[];
  /** Same-Plugin row renames: old local id → new local id. */
  rowRenames?: Readonly<Record<string, string>>;
}

export interface PluginSettingsOwner {
  pluginId: string;
  displayName: string;
}

interface RegisteredSettingsPlugin {
  pluginId: string;
  displayName: string;
  order: number;
  renames: Readonly<Record<string, string>>;
  rows: readonly PluginSettingsRowDef[];
}

const settingsPlugins = new Map<string, RegisteredSettingsPlugin>();
let settingsRegistrationOrder = 0;
let settingsRevision = 0;
const settingsRowsListeners = new Set<() => void>();

function notifySettingsRowsChange(): void {
  settingsRevision += 1;
  for (const listener of [...settingsRowsListeners]) listener();
}

export function settingsRowsRevision(): number {
  return settingsRevision;
}

/** Runs after every settings register and unregister. Returns unregister. */
export function onSettingsRowsChange(listener: () => void): () => void {
  settingsRowsListeners.add(listener);
  return () => {
    settingsRowsListeners.delete(listener);
  };
}

function collapseSettingsRenames(
  renames: Readonly<Record<string, string>>,
  declared: ReadonlySet<string>
): Readonly<Record<string, string>> {
  for (const [from, to] of Object.entries(renames)) {
    if (!LOCAL_ID_PATTERN.test(from) || !LOCAL_ID_PATTERN.test(to)) {
      throw new Error(`Plugin row rename "${from}" targets "${to}", which is not a Plugin-local id`);
    }
    if (declared.has(from)) {
      throw new Error(`Plugin row rename source "${from}" is a declared row`);
    }
    if (!declared.has(to)) {
      throw new Error(`Plugin row rename "${from}" targets "${to}", which is not a declared row`);
    }
  }
  const collapsed: Record<string, string> = {};
  for (const from of Object.keys(renames)) {
    const seen = new Set<string>([from]);
    let target = renames[from];
    while (renames[target] !== undefined) {
      if (seen.has(target)) throw new Error(`Plugin row rename for "${from}" cycles`);
      seen.add(target);
      target = renames[target];
    }
    collapsed[from] = target;
  }
  return collapsed;
}

/**
 * Admits a Plugin's Settings rows into the shared registry. The host derives
 * every full id as `plugin.<pluginId>.<localId>`, so a declaration can never
 * name another owner's row. Metadata only: search finds these rows without
 * running the Plugin. Registering the same Plugin again updates it in place.
 * Returns unregister.
 */
export function registerPluginSettingsRows(
  pluginId: string,
  registration: PluginSettingsRegistration
): () => void {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(`Invalid Plugin id "${pluginId}"`);
  }
  if (typeof registration.displayName !== "string" || registration.displayName.trim() === "") {
    throw new Error(`Plugin "${pluginId}" needs a display name`);
  }
  const declared = new Set<string>();
  const rows: PluginSettingsRowDef[] = [];
  for (const declaration of registration.rows) {
    if (!LOCAL_ID_PATTERN.test(declaration.id)) {
      throw new Error(`Plugin row id "${declaration.id}" is outside this Plugin's namespace`);
    }
    if (declared.has(declaration.id)) {
      throw new Error(`Duplicate Plugin row id "${declaration.id}"`);
    }
    declared.add(declaration.id);
    if (typeof declaration.label !== "string" || declaration.label.trim() === "") {
      throw new Error(`Plugin row "${declaration.id}" needs a label`);
    }
    rows.push({
      id: `${PLUGIN_SETTINGS_PREFIX}${pluginId}.${declaration.id}` as PluginSettingsRowId,
      pluginId,
      localId: declaration.id,
      label: declaration.label,
      ...(declaration.description !== undefined ? { description: declaration.description } : {}),
      ...(declaration.keywords !== undefined ? { keywords: declaration.keywords } : {}),
      ...(declaration.platforms !== undefined ? { platforms: declaration.platforms } : {}),
      reveal: { kind: "plugin", pluginId },
    });
  }
  const renames = collapseSettingsRenames(registration.rowRenames ?? {}, declared);
  const previous = settingsPlugins.get(pluginId);
  const token = Symbol(pluginId);
  const record: RegisteredSettingsPlugin & { token: symbol } = {
    pluginId,
    displayName: registration.displayName,
    order: previous?.order ?? settingsRegistrationOrder++,
    renames,
    rows,
    token,
  };
  settingsPlugins.set(pluginId, record);
  notifySettingsRowsChange();
  return () => {
    const current = settingsPlugins.get(pluginId) as
      | (RegisteredSettingsPlugin & { token?: symbol })
      | undefined;
    if (current?.token !== token) return;
    settingsPlugins.delete(pluginId);
    notifySettingsRowsChange();
  };
}

function registeredSettingsPlugins(): RegisteredSettingsPlugin[] {
  return [...settingsPlugins.values()].sort((a, b) => a.order - b.order);
}

function isMaibukOwner(pluginId: string): boolean {
  return pluginId === "maibuk" || pluginId.startsWith("maibuk-");
}

/**
 * Every known Plugin Settings owner, ordered Maibuk first, then owner display
 * name, owner id for ties. Declared order within an owner is kept in its rows.
 */
export function getPluginSettingsOwners(): PluginSettingsOwner[] {
  const owners = registeredSettingsPlugins().map((plugin) => ({
    pluginId: plugin.pluginId,
    displayName: plugin.displayName,
  }));
  return owners.sort((a, b) => {
    const aMaibuk = isMaibukOwner(a.pluginId) ? 0 : 1;
    const bMaibuk = isMaibukOwner(b.pluginId) ? 0 : 1;
    if (aMaibuk !== bMaibuk) return aMaibuk - bMaibuk;
    const byName = a.displayName.localeCompare(b.displayName);
    if (byName !== 0) return byName;
    return a.pluginId.localeCompare(b.pluginId);
  });
}

/** A Plugin's declared rows, in declared order, or [] when unknown. */
export function getPluginSettingsRows(pluginId: string): PluginSettingsRowDef[] {
  return [...(settingsPlugins.get(pluginId)?.rows ?? [])];
}

/** Every runtime row, grouped by owner order then declared order. */
export function getAllPluginSettingsRows(): PluginSettingsRowDef[] {
  return getPluginSettingsOwners().flatMap((owner) => getPluginSettingsRows(owner.pluginId));
}

/** A runtime row by its full id, with its owner, or undefined. */
export function findPluginSettingsRow(
  id: string
): { pluginId: string; displayName: string; row: PluginSettingsRowDef } | undefined {
  const pluginId = pluginIdOfSettingsRow(id);
  if (pluginId === null) return undefined;
  const plugin = settingsPlugins.get(pluginId);
  if (!plugin) return undefined;
  const row = plugin.rows.find((candidate) => candidate.id === id);
  if (!row) return undefined;
  return { pluginId, displayName: plugin.displayName, row };
}

/** The rename maps of every registered Plugin, for stored-id migration. */
export function pluginSettingsRowRenames(): ReadonlyMap<string, Readonly<Record<string, string>>> {
  return new Map(registeredSettingsPlugins().map((plugin) => [plugin.pluginId, plugin.renames]));
}

/**
 * Applies a registered Plugin's rename map to a stored row id. A Plugin that
 * is absent keeps its stored ids as they are.
 */
export function resolvePluginSettingsRowRename(value: string): string {
  const pluginId = pluginIdOfSettingsRow(value);
  if (pluginId === null) return value;
  const localId = localIdOfSettingsRow(value);
  const renamed = localId === null ? undefined : settingsPlugins.get(pluginId)?.renames[localId];
  return renamed === undefined ? value : `${PLUGIN_SETTINGS_PREFIX}${pluginId}.${renamed}`;
}

/**
 * A stored id to the row it names today, or null when it names nothing.
 * Unknown ids under `plugin.` are kept as they are (retained for return);
 * everything else unknown is left to the core lookup.
 */
export function resolveStoredSettingsRowId(rawId: string): string | null {
  const renamed = resolvePluginSettingsRowRename(rawId);
  return isPluginSettingsRowId(renamed) ? renamed : null;
}
