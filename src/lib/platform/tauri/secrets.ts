/**
 * The desktop Plugin secret store: the OS keychain (Linux Secret Service,
 * Windows Credential Manager) through the Rust commands (ADR 0023). Values are
 * scoped by Plugin id; `listNames` never returns one, and `read` is host-only,
 * for network header injection. A failing keychain rejects with the Rust
 * message, so Reset settings and Plugin removal can report it.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PluginSecretStore } from "@/features/plugins/secret-store";

/** The OS keychain-backed store the app registers on desktop. */
export function createKeychainPluginSecretStore(): PluginSecretStore {
  return {
    async set(pluginId: string, name: string, value: string): Promise<void> {
      await invoke("plugin_secret_set", { pluginId, name, value });
    },

    async delete(pluginId: string, name: string): Promise<void> {
      await invoke("plugin_secret_delete", { pluginId, name });
    },

    async listNames(pluginId: string): Promise<string[]> {
      return invoke<string[]>("plugin_secret_list_names", { pluginId });
    },

    async read(pluginId: string, name: string): Promise<string | null> {
      return invoke<string | null>("plugin_secret_read", { pluginId, name });
    },

    async clearPlugin(pluginId: string): Promise<void> {
      await invoke("plugin_secret_clear_plugin", { pluginId });
    },

    async clearAll(): Promise<void> {
      await invoke("plugin_secret_clear_all");
    },
  };
}
