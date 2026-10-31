/**
 * The web Plugin secret store: session-only in memory, with a per-Plugin opt-in
 * "remember on this device" that persists that Plugin's credentials in
 * localStorage. Secrets are scoped by Plugin id; `listNames` returns names only,
 * and `read` is host-only, for network header injection.
 *
 * The persisted copy is unencrypted browser storage, so it is off by default
 * and the row labels say so. A storage that throws (private mode, quota) or
 * holds corrupt JSON degrades to session-only: no read or `listNames` ever
 * rejects, so a broken browser cannot take down Settings or a Plugin.
 */

import type { PluginSecretStore } from "@/features/plugins/secret-store";

/** The localStorage key holding every remembered Plugin's credentials. */
const VALUES_KEY = "maibuk.pluginSecrets.v1";
/** The localStorage key holding the Plugin ids opted into remembering. */
const REMEMBER_KEY = "maibuk.pluginSecrets.remember.v1";

/**
 * The web store's full type: every {@link PluginSecretStore} operation plus the
 * required remember capability, so the UI and tests can rely on it being there.
 */
export interface WebPluginSecretStore extends PluginSecretStore {
  isRemembered(pluginId: string): boolean;
  setRemembered(pluginId: string, on: boolean): Promise<void>;
}

/** The persisted shape: `{pluginId: {name: value}}`. */
type PersistedValues = Record<string, Record<string, string>>;

/** Reads `key` as JSON, or `fallback` when absent, corrupt, or unreadable. */
function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Writes `value` as JSON; a failing storage keeps the change in memory only. */
function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // The store stays session-only for this run.
  }
}

/** Removes `key`; a failing storage leaves nothing to clean up in memory. */
function removeKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing persisted to remove.
  }
}

/** The persisted values, dropping any entry shaped unlike `{name: value}`. */
function readValues(storage: Storage): PersistedValues {
  const parsed = readJson<unknown>(storage, VALUES_KEY, {});
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const values: PersistedValues = {};
  for (const [pluginId, names] of Object.entries(parsed as Record<string, unknown>)) {
    if (names === null || typeof names !== "object" || Array.isArray(names)) continue;
    const record: Record<string, string> = {};
    for (const [name, value] of Object.entries(names as Record<string, unknown>)) {
      if (typeof value === "string") record[name] = value;
    }
    values[pluginId] = record;
  }
  return values;
}

/** The remembered Plugin ids, ignoring a corrupt or mistyped list. */
function readRemembered(storage: Storage): string[] {
  const parsed = readJson<unknown>(storage, REMEMBER_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string");
}

/** Writes the persisted values, removing the key entirely when empty. */
function writeValues(storage: Storage, values: PersistedValues): void {
  if (Object.keys(values).length === 0) removeKey(storage, VALUES_KEY);
  else writeJson(storage, VALUES_KEY, values);
}

/** Writes the remember list, removing the key entirely when empty. */
function writeRemembered(storage: Storage, ids: string[]): void {
  if (ids.length === 0) removeKey(storage, REMEMBER_KEY);
  else writeJson(storage, REMEMBER_KEY, ids);
}

/**
 * The web store: memory always holds the session's values; a remembered
 * Plugin's values also persist in `storage` and load back into memory when a
 * new store is created over the same storage.
 */
export function createWebPluginSecretStore(storage: Storage = localStorage): WebPluginSecretStore {
  const memory = new Map<string, Map<string, string>>();
  const remembered = new Set<string>(readRemembered(storage));

  // Load the persisted credentials of remembered Plugins into memory, so a page
  // reload keeps them available for header injection without a second read.
  const restored = readValues(storage);
  for (const pluginId of remembered) {
    const names = restored[pluginId];
    if (names === undefined) continue;
    memory.set(pluginId, new Map(Object.entries(names)));
  }

  /** Writes the Plugin's memory values into the persisted copy. */
  function persist(pluginId: string): void {
    const values = readValues(storage);
    const names = memory.get(pluginId);
    if (names === undefined || names.size === 0) delete values[pluginId];
    else values[pluginId] = Object.fromEntries(names);
    writeValues(storage, values);
  }

  return {
    async set(pluginId, name, value): Promise<void> {
      let names = memory.get(pluginId);
      if (!names) {
        names = new Map<string, string>();
        memory.set(pluginId, names);
      }
      names.set(name, value);
      if (remembered.has(pluginId)) persist(pluginId);
    },

    async delete(pluginId, name): Promise<void> {
      memory.get(pluginId)?.delete(name);
      if (remembered.has(pluginId)) persist(pluginId);
    },

    async listNames(pluginId): Promise<string[]> {
      return [...(memory.get(pluginId)?.keys() ?? [])].sort();
    },

    async read(pluginId, name): Promise<string | null> {
      return memory.get(pluginId)?.get(name) ?? null;
    },

    async clearPlugin(pluginId): Promise<void> {
      memory.delete(pluginId);
      remembered.delete(pluginId);
      const values = readValues(storage);
      delete values[pluginId];
      writeValues(storage, values);
      writeRemembered(storage, [...remembered]);
    },

    async clearAll(): Promise<void> {
      memory.clear();
      remembered.clear();
      removeKey(storage, VALUES_KEY);
      removeKey(storage, REMEMBER_KEY);
    },

    isRemembered(pluginId): boolean {
      return remembered.has(pluginId);
    },

    async setRemembered(pluginId, on): Promise<void> {
      if (on) {
        remembered.add(pluginId);
        persist(pluginId);
        writeRemembered(storage, [...remembered]);
        return;
      }
      remembered.delete(pluginId);
      const values = readValues(storage);
      delete values[pluginId];
      writeValues(storage, values);
      writeRemembered(storage, [...remembered]);
    },
  };
}
