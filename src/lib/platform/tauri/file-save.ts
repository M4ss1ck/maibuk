/**
 * The desktop Plugin File Saver (ADR 0040): Rust shows the save dialog, opens a
 * sibling `.part` file, and renames it over the target once every byte arrived
 * (ADR 0010 keeps the webview `fs` scope as narrow as it was). The webview only
 * holds a token, so each chunk crosses IPC as raw bytes and no path is ever
 * sent. A save that fails partway is aborted before the error reaches the
 * Plugin, which the `files.save` handler reports as `internal-error`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PluginFileSaver } from "@/lib/platform/types";

/** The header that ties each raw write to the save Rust opened. */
export const SAVE_TOKEN_HEADER = "x-save-token";

function osMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Rust-backed saver the app registers on desktop. */
export function createTauriPluginFileSaver(): PluginFileSaver {
  return {
    async save(name, _mimeType, blob): Promise<"saved" | "cancelled"> {
      const token = await invoke<number | null>("plugin_files_save_begin", { name });
      if (token === null) return "cancelled";
      try {
        const reader = blob.stream().getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await invoke("plugin_files_save_write", value, {
              headers: { [SAVE_TOKEN_HEADER]: String(token) },
            });
          }
        } finally {
          reader.releaseLock();
        }
        await invoke("plugin_files_save_commit", { token });
        return "saved";
      } catch (error) {
        // Rust removes the `.part`; the abort only ends the token's entry, so a
        // failure here must not hide the reason the save stopped.
        await invoke("plugin_files_save_abort", { token }).catch(() => undefined);
        throw new Error(osMessage(error));
      }
    },
  };
}
