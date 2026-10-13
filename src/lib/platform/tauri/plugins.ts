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
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { IS_ANDROID } from "@/lib/platform";
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

/** An installed Plugin as Rust returns it: its folder name (the Plugin id) and hash. */
interface InstalledPluginPayload {
  id: string;
  hash: string;
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
  const adapter: PluginDirectoryAdapter = {
    // Android keeps the fixed app-private directory and installs from a `.zip`;
    // desktop can also pick a folder, open the directory, and change it.
    kind: IS_ANDROID ? "android" : "desktop",

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

    /**
     * Installs the Plugin a `.zip` carries. Rust opens the native file picker,
     * reads and validates the archive, and writes the folder, so no archive
     * byte crosses IPC (ADR 0020). Resolves the installed folder name (the
     * Plugin id), or null when the picker is cancelled; an invalid archive
     * rejects with Rust's message.
     */
    async addFromZip(): Promise<string | null> {
      const installed = await invoke<InstalledPluginPayload | null>("add_plugin_from_zip");
      return installed?.id ?? null;
    },

    /**
     * Deletes a Plugin folder and every file in it through Rust. `true` when it
     * was there and is now gone, `false` when it was already absent.
     */
    async removeFolder(name: string): Promise<boolean> {
      try {
        return await invoke<boolean>("remove_plugin_folder", { id: name });
      } catch (error) {
        console.warn(`The Plugin folder ${name} could not be removed`, error);
        return false;
      }
    },

    /**
     * Watches the Plugin Directory through Rust (development mode, #442).
     * Rust owns the folder and emits `plugins://changed` with the folder name
     * once a debounced burst of writes settles; this listens for it. The
     * returned unsubscribe stops both the listener and the Rust watcher.
     */
    watch(onChanged: (id: string) => void): () => void {
      void invoke("watch_plugin_directory").catch((error) => {
        console.warn("The Plugin Directory could not be watched", error);
      });
      let unlisten: UnlistenFn | null = null;
      let stopped = false;
      void listen<{ id: string }>("plugins://changed", (event) => {
        const id = event.payload?.id;
        if (typeof id === "string") onChanged(id);
      })
        .then((stop) => {
          if (stopped) stop();
          else unlisten = stop;
        })
        .catch((error) => {
          console.warn("The Plugin change listener could not be attached", error);
        });
      return () => {
        stopped = true;
        unlisten?.();
        unlisten = null;
        void invoke("unwatch_plugin_directory").catch(() => {
          // Nothing watched: a failed unwatch is not worth surfacing.
        });
      };
    },
  };

  if (!IS_ANDROID) {
    /**
     * Installs a Plugin from a folder the author picks. Desktop only: Android
     * has no author-picked folder that only Maibuk can read, so it installs
     * from a `.zip`. Resolves the installed folder name, or null when the
     * picker is cancelled.
     */
    adapter.addFromFolder = async (): Promise<string | null> => {
      const installed = await invoke<InstalledPluginPayload | null>("add_plugin_from_folder");
      return installed?.id ?? null;
    };

    /** Opens the Plugin Directory in the system file manager. Desktop only. */
    adapter.openDirectory = async (): Promise<void> => {
      await invoke("open_plugin_directory");
    };

    /**
     * Runs the native folder picker and switches the Plugin Directory to the
     * folder the author picks (ADR 0010: the picker is the native UI a script
     * cannot fake, and the Rust command records the approval itself). `true`
     * when the directory changed, `false` when the picker was cancelled.
     * Desktop only.
     */
    adapter.changeDirectory = async (): Promise<boolean> => {
      const picked = await invoke<string | null>("pick_plugin_directory", { defaultPath: null });
      return picked !== null;
    };
  }

  return adapter;
}
