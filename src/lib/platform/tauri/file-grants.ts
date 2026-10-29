/**
 * The desktop File Grant store: Rust keeps the grant record and reads the bytes
 * (ADR 0036), so a Plugin never learns where a picked file lives and the
 * webview `fs` scope stays as narrow as ADR 0010 left it. A refused command
 * arrives as a bare string whose `file-missing:` or `invalid-params:` prefix
 * becomes the Plugin API error code; anything else is rethrown unchanged.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  PluginFileGrant,
  PluginFileGrantStore,
  PluginFileStat,
} from "@/features/plugins/file-grants";
import { PluginApiError, type PluginApiErrorCode } from "@/plugin-sdk/protocol";

/** The stable prefixes the Rust commands open their messages with. */
const REFUSALS: readonly (readonly [string, PluginApiErrorCode])[] = [
  ["file-missing:", "file-missing"],
  ["invalid-params:", "invalid-params"],
];

/**
 * The error a caller sees: a refused File Grant call becomes a `PluginApiError`
 * carrying its code and the rest of the message, which never names a path.
 */
function refusal(error: unknown): unknown {
  const text = error instanceof Error ? error.message : String(error);
  for (const [prefix, code] of REFUSALS) {
    if (text.startsWith(prefix)) {
      return new PluginApiError({ code, message: text.slice(prefix.length).trim() });
    }
  }
  return error instanceof Error ? error : new Error(text);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return args === undefined ? await invoke<T>(command) : await invoke<T>(command, args);
  } catch (error) {
    throw refusal(error);
  }
}

/** The Rust-backed store the app registers on desktop. */
export function createTauriPluginFileGrantStore(): PluginFileGrantStore {
  return {
    async pick(pluginId: string, extensions: readonly string[]): Promise<PluginFileGrant | null> {
      return call<PluginFileGrant | null>("plugin_files_pick", {
        pluginId,
        extensions: [...extensions],
      });
    },

    async read(
      pluginId: string,
      grant: string,
      offset: number,
      length: number
    ): Promise<ArrayBuffer> {
      return call<ArrayBuffer>("plugin_files_read", { pluginId, grant, offset, length });
    },

    async stat(pluginId: string, grant: string): Promise<PluginFileStat> {
      return call<PluginFileStat>("plugin_files_stat", { pluginId, grant });
    },

    async requestAccess(): Promise<boolean> {
      // Desktop reads through Rust after checking the grant; there is no browser
      // permission to ask for again, so a live grant is readable.
      return true;
    },

    async release(pluginId: string, grant: string): Promise<void> {
      await call<void>("plugin_files_release", { pluginId, grant });
    },

    async list(pluginId: string): Promise<PluginFileGrant[]> {
      return call<PluginFileGrant[]>("plugin_files_list", { pluginId });
    },

    async clearPlugin(pluginId: string): Promise<void> {
      await call<void>("plugin_files_clear_plugin", { pluginId });
    },

    async clearAll(): Promise<void> {
      await call<void>("plugin_files_clear_all");
    },
  };
}
