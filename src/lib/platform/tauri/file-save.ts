/**
 * The Tauri Plugin File Saver (ADR 0040), registered on desktop and Android:
 * Rust shows the save dialog and opens the file the bytes go to, so the
 * webview only holds a token. On desktop each chunk crosses IPC as raw bytes
 * with no path ever sent; Android cannot deliver raw IPC, so each chunk crosses
 * as base64 in a JSON body (at most `SAVE_JSON_CHUNK_BYTES`), with the token
 * beside it when the header is dropped too (ADR 0010 keeps the webview `fs`
 * scope as narrow as it was). On desktop Rust renames a sibling `.part` file
 * over the target on commit, so a save that fails partway leaves the old file
 * as it was; on Android it writes the document the picker just created in
 * place. A failed save is aborted before the error reaches the Plugin, which
 * the `files.save` handler reports as `internal-error`.
 */

import { invoke } from "@tauri-apps/api/core";
import { IS_ANDROID } from "@/lib/platform";
import type { PluginFileSaver } from "@/lib/platform/types";
import { bytesToBase64 } from "@/plugin-sdk/protocol";

/** The header that ties each raw write to the save Rust opened. */
export const SAVE_TOKEN_HEADER = "x-save-token";

/**
 * Largest chunk the Android JSON path sends, in decoded bytes. Tauri never
 * delivers raw IPC on Android, so each chunk crosses as base64; 512 KiB keeps
 * the encoded body well under the Plugin message cap and the bridge's string
 * limit.
 */
export const SAVE_JSON_CHUNK_BYTES = 512 * 1024;

function osMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Rust-backed saver the app registers on desktop and Android. */
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
            if (IS_ANDROID) {
              // Android never delivers raw IPC, so each chunk goes as base64 in
              // a JSON body, with the token beside it in case the bridge drops
              // the header too. A reader chunk can exceed the limit, so split.
              for (let offset = 0; offset < value.length; offset += SAVE_JSON_CHUNK_BYTES) {
                const chunk = value.subarray(offset, offset + SAVE_JSON_CHUNK_BYTES);
                await invoke("plugin_files_save_write", {
                  token,
                  data: bytesToBase64(chunk),
                });
              }
            } else {
              await invoke("plugin_files_save_write", value, {
                headers: { [SAVE_TOKEN_HEADER]: String(token) },
              });
            }
          }
        } finally {
          reader.releaseLock();
        }
        await invoke("plugin_files_save_commit", { token });
        return "saved";
      } catch (error) {
        // Rust removes the desktop `.part` or empties the Android document; the
        // abort only ends the token's entry, so a failure here must not hide
        // the reason the save stopped.
        await invoke("plugin_files_save_abort", { token }).catch(() => undefined);
        throw new Error(osMessage(error));
      }
    },
  };
}
