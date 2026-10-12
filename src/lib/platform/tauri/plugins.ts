/**
 * The desktop and Android Plugin Directory adapter. Only Rust lists, reads,
 * hashes, copies, replaces, and watches the folder there, and hands the webview
 * the bytes it hashed (ADR 0020): every command returns the files Rust read, so
 * nothing can change between the hash check and the load. A folder Rust
 * refuses (a symlink, a path that leaves the directory, a newline filename)
 * reads as `null`, like a folder that is not there, and the Plugin stays off;
 * the install flow (#442) owns surfacing the reason.
 *
 * The webview has no fs access to the Plugin Directory, so these commands are
 * the only way in. A failed invoke reports an empty directory, never an error:
 * a launch without Plugins stays a launch without Plugins.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PluginDirectoryAdapter, PluginFolder } from "@/lib/platform/types";

interface PluginFolderFilePayload {
  path: string;
  /** The file's exact bytes, standard base64. */
  bytes: string;
}

interface PluginFolderPayload {
  name: string;
  /** The `h1:` hash over exactly these bytes; null when the Go scheme refuses the paths. */
  hash: string | null;
  files: PluginFolderFilePayload[];
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function createTauriPluginDirectory(): PluginDirectoryAdapter {
  return {
    async listFolders(): Promise<string[]> {
      try {
        return await invoke<string[]>("list_plugin_folders");
      } catch (error) {
        console.warn("The Plugin Directory could not be listed", error);
        return [];
      }
    },

    async readFolder(name: string): Promise<PluginFolder | null> {
      try {
        const payload = await invoke<PluginFolderPayload | null>("read_plugin_folder", { name });
        if (!payload) return null;
        const folder: PluginFolder = {
          name: payload.name,
          files: payload.files.map((file) => ({
            path: file.path,
            bytes: decodeBase64(file.bytes),
          })),
        };
        if (payload.hash !== null) folder.hash = payload.hash;
        return folder;
      } catch (error) {
        console.warn(`The Plugin folder ${name} could not be read`, error);
        return null;
      }
    },

    /**
     * Replaces the installed Built-in copy with the one Maibuk ships. Rust
     * resolves the shipped copy from the app's bundled resources itself
     * (`plugins/<id>/`), so `files` is ignored here: no bytes cross IPC and the
     * webview cannot choose what a Built-in runs (ADR 0020). An id with no
     * bundled copy is refused.
     */
    async replaceFolder(name: string): Promise<boolean> {
      try {
        await invoke("replace_builtin_plugin_folder", { name });
        return true;
      } catch (error) {
        console.warn(`The Built-in Plugin folder ${name} could not be replaced`, error);
        return false;
      }
    },
  };
}
