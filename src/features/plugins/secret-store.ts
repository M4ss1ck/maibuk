/**
 * The seam a Plugin credential store fills (ADR 0023 keeps secrets in the OS
 * keychain). Reset settings deletes every saved Plugin credential through it, so
 * the orchestrator never reaches into a platform keychain directly. The
 * keychain-backed store lands in #453 and registers itself here; until then no
 * store is registered and there is nothing to delete.
 */

export interface PluginSecretStore {
  /** Deletes every saved Plugin credential. */
  clearAll(): Promise<void>;
}

let installedStore: PluginSecretStore | null = null;

/** Registers the store Reset settings deletes credentials through; null clears it. */
export function registerPluginSecretStore(store: PluginSecretStore | null): void {
  installedStore = store;
}

/** The registered store, or null when none is (no Plugin credential store has landed). */
export function getPluginSecretStore(): PluginSecretStore | null {
  return installedStore;
}
