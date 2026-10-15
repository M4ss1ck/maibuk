/**
 * The seam a Plugin credential store fills (ADR 0023 keeps secrets in the OS
 * keychain). Secrets are scoped by Plugin id: names are not secret, values are.
 * Reset settings and Plugin removal delete through it, so the orchestrator never
 * reaches into a platform keychain directly.
 *
 * The app registers `createMemoryPluginSecretStore()` at startup, so a store is
 * always present. The desktop keychain store and the web "remember on this
 * device" store land in later #453 units and register themselves here.
 */

export interface PluginSecretStore {
  /** Saves a value under (pluginId, name), replacing any previous one. */
  set(pluginId: string, name: string, value: string): Promise<void>;
  /** Deletes one (pluginId, name); a name that was never set is a no-op. */
  delete(pluginId: string, name: string): Promise<void>;
  /** The Plugin's secret names, sorted, names only — never a value. */
  listNames(pluginId: string): Promise<string[]>;
  /**
   * The value for (pluginId, name), or null. Host-only: used ONLY by network
   * header injection, never exposed to a Plugin (ADR 0023).
   */
  read(pluginId: string, name: string): Promise<string | null>;
  /** Deletes every secret the Plugin saved, and no other Plugin's. */
  clearPlugin(pluginId: string): Promise<void>;
  /** Deletes every saved Plugin credential. */
  clearAll(): Promise<void>;
}

let installedStore: PluginSecretStore | null = null;

/** Registers the store Reset settings and removal delete through; null clears it. */
export function registerPluginSecretStore(store: PluginSecretStore | null): void {
  installedStore = store;
}

/** The registered store, or null when none is. */
export function getPluginSecretStore(): PluginSecretStore | null {
  return installedStore;
}

/** The default session-only store: secrets live in memory, scoped per Plugin. */
export function createMemoryPluginSecretStore(): PluginSecretStore {
  const byPlugin = new Map<string, Map<string, string>>();
  return {
    async set(pluginId, name, value): Promise<void> {
      let secrets = byPlugin.get(pluginId);
      if (!secrets) {
        secrets = new Map<string, string>();
        byPlugin.set(pluginId, secrets);
      }
      secrets.set(name, value);
    },
    async delete(pluginId, name): Promise<void> {
      byPlugin.get(pluginId)?.delete(name);
    },
    async listNames(pluginId): Promise<string[]> {
      return [...(byPlugin.get(pluginId)?.keys() ?? [])].sort();
    },
    async read(pluginId, name): Promise<string | null> {
      return byPlugin.get(pluginId)?.get(name) ?? null;
    },
    async clearPlugin(pluginId): Promise<void> {
      byPlugin.delete(pluginId);
    },
    async clearAll(): Promise<void> {
      byPlugin.clear();
    },
  };
}
