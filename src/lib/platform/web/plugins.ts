/**
 * The web Plugin Directory (ADR 0020): a `plugins` folder in OPFS, one
 * directory per Plugin. The bytes read here are the bytes Web Crypto hashes,
 * so nothing can change between the pinned-hash check and the load. There is
 * no author-picked folder on the web; the app owns the OPFS directory. It also
 * writes a Built-in copy back (`replaceFolder`) when the author replaces a
 * modified Built-in (#442) and installs a Plugin from a `.zip`, or from a
 * folder where the browser exposes `window.showDirectoryPicker` (#443).
 *
 * The browser has no OPFS in jsdom or an engine without the File System
 * Access API: reading there reports an empty directory, never an error, so a
 * launch without Plugins stays a launch without Plugins.
 */

import { strFromU8, unzipSync } from "fflate";
import { PLUGIN_ID_PATTERN } from "@/features/plugins/ids";
import { webDialog } from "@/lib/platform/web/dialog";
import type { PluginDirectoryAdapter, PluginFolder, PluginFolderFile } from "@/lib/platform/types";

/**
 * The OPFS folder the web Plugin Directory lives in: one directory per Plugin
 * (ADR 0020). It lives here, not in `src/constants.ts`, so the E2E seed can
 * import it without the app's build-time defines.
 */
export const WEB_PLUGIN_DIRECTORY_NAME = "plugins";

/** The archive caps the web installer mirrors from Rust (`archive::Limits::default`). */
const MAX_ENTRIES = 4096;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** OS litter a file manager may add; it never reaches the hashed file set (#390). */
const OS_LITTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** `window` with the Chromium-only directory picker, absent from the DOM types. */
interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

/** One picked file, keyed by its POSIX path relative to the Plugin root. */
interface RawEntry {
  path: string;
  bytes: Uint8Array;
}

/**
 * The in-process change bus (development mode, #442). OPFS emits no change
 * events, so every write path here announces the folder it wrote. A watcher
 * subscribes with `watch`; a write calls {@link notifyWebPluginChanged} once
 * the write is complete, so the reader never sees a half-written folder.
 */
const watchers = new Set<(id: string) => void>();

/** Notifies every web Plugin Directory watcher that `id`'s files changed. */
export function notifyWebPluginChanged(id: string): void {
  for (const watcher of [...watchers]) watcher(id);
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await navigator.storage.getDirectory()) ?? null;
  } catch {
    return null;
  }
}

async function collectFiles(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  files: PluginFolderFile[]
): Promise<void> {
  for await (const entry of directory.values()) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else {
      await collectFiles(entry as FileSystemDirectoryHandle, path, files);
    }
  }
}

/** Reads every file under `directory` as a raw entry, keeping the picked paths. */
async function collectRawEntries(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  entries: RawEntry[]
): Promise<void> {
  for await (const entry of directory.values()) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      entries.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else {
      await collectRawEntries(entry as FileSystemDirectoryHandle, path, entries);
    }
  }
}

/**
 * Whether an archive entry name is a safe POSIX path inside the Plugin: no
 * absolute path, no backslash or colon (a Windows drive or stream), no `.` or
 * `..` segment, and no empty segment (a trailing slash marks a directory and
 * is allowed). Mirrors the Rust archive's unsafe-path rule.
 */
function isSafeEntryPath(name: string): boolean {
  if (name === "" || name.startsWith("/")) return false;
  if (name.includes("\\") || name.includes(":") || name.includes("\0")) return false;
  const segments = name.split("/");
  const last = segments.length - 1;
  return segments.every((segment, index) => {
    if (index === last && segment === "") return true;
    return segment !== "" && segment !== "." && segment !== "..";
  });
}

/**
 * The folder holding `manifest.json`: none (the Plugin root) or exactly one
 * top-level folder. Several manifests, or a manifest deeper than one folder,
 * mean the input is not one Plugin.
 */
function manifestPrefix(entries: readonly RawEntry[]): string | null {
  let root = false;
  const folders: string[] = [];
  for (const entry of entries) {
    if (entry.path.endsWith("/")) continue;
    const segments = entry.path.split("/");
    if (segments[segments.length - 1] !== "manifest.json") continue;
    if (segments.length === 1) root = true;
    else if (segments.length === 2) folders.push(segments[0]);
    else throw new Error("The Plugin has a manifest outside its root or one folder");
  }
  if (root && folders.length === 0) return null;
  if (!root && folders.length === 1) return folders[0];
  if (!root) throw new Error("The Plugin has no manifest.json");
  throw new Error("The Plugin has more than one manifest.json");
}

/**
 * Validates a picked folder or archive the same way Rust does — paths, entry
 * count, file and total sizes, one manifest, and a Plugin id — and returns the
 * installed folder name (the Plugin id) and the files to write under it. Throws
 * a short Error when the input is not one Plugin; shares its rules between the
 * `.zip` and folder install paths.
 */
function preparePlugin(entries: readonly RawEntry[]): { id: string; files: PluginFolderFile[] } {
  if (entries.length > MAX_ENTRIES) throw new Error("The Plugin has too many files");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isSafeEntryPath(entry.path)) throw new Error(`The Plugin has an unsafe path: ${entry.path}`);
    const folded = entry.path.toLowerCase();
    if (seen.has(folded)) throw new Error(`The Plugin has two files with the same path: ${entry.path}`);
    seen.add(folded);
  }

  const prefix = manifestPrefix(entries);
  const manifestPath = prefix === null ? "manifest.json" : `${prefix}/manifest.json`;
  const manifest = entries.find((entry) => entry.path === manifestPath);
  if (!manifest) throw new Error("The Plugin has no manifest.json");

  let id: unknown;
  try {
    id = (JSON.parse(strFromU8(manifest.bytes)) as { id?: unknown }).id;
  } catch {
    throw new Error("The Plugin manifest is not valid JSON");
  }
  if (typeof id !== "string" || !PLUGIN_ID_PATTERN.test(id)) {
    throw new Error("The Plugin manifest does not name a valid id");
  }

  const files: PluginFolderFile[] = [];
  let total = 0;
  for (const entry of entries) {
    if (entry.path.endsWith("/")) continue;
    const basename = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (OS_LITTER.has(basename)) continue;
    let relative = entry.path;
    if (prefix !== null) {
      if (entry.path === manifestPath) relative = "manifest.json";
      else if (entry.path.startsWith(`${prefix}/`)) relative = entry.path.slice(prefix.length + 1);
      else throw new Error(`The Plugin has a file outside its folder: ${entry.path}`);
    }
    if (relative === "") continue;
    if (entry.bytes.length > MAX_FILE_BYTES) {
      throw new Error(`A Plugin file is too large: ${relative}`);
    }
    total += entry.bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("The Plugin is too large");
    files.push({ path: relative, bytes: entry.bytes });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { id, files };
}

/**
 * Writes a Plugin folder into OPFS under its id, replacing any folder with that
 * id: the files are staged first, then the old folder is dropped and the staged
 * files copied in, so a half-written install never becomes the installed copy.
 */
async function installPluginFolder(
  base: FileSystemDirectoryHandle,
  id: string,
  files: readonly PluginFolderFile[]
): Promise<void> {
  const directory = await base.getDirectoryHandle(WEB_PLUGIN_DIRECTORY_NAME, { create: true });
  const stagingName = `.install-${id}-${Date.now()}`;
  const staging = await directory.getDirectoryHandle(stagingName, { create: true });
  try {
    for (const file of files) await writeFile(staging, file.path, file.bytes);
    const staged: PluginFolderFile[] = [];
    await collectFiles(staging, "", staged);
    try {
      // Drop the installed copy first, so a file the new copy dropped does not
      // survive the replace.
      await directory.removeEntry(id, { recursive: true });
    } catch {
      // Not there yet; the folder is created below.
    }
    const target = await directory.getDirectoryHandle(id, { create: true });
    for (const file of staged) await writeFile(target, file.path, file.bytes);
    notifyWebPluginChanged(id);
  } finally {
    try {
      await directory.removeEntry(stagingName, { recursive: true });
    } catch {
      // Already gone.
    }
  }
}

export function createWebPluginDirectory(root?: FileSystemDirectoryHandle): PluginDirectoryAdapter {
  async function pluginsDirectory(): Promise<FileSystemDirectoryHandle | null> {
    const base = root ?? (await opfsRoot());
    if (!base) return null;
    try {
      return await base.getDirectoryHandle(WEB_PLUGIN_DIRECTORY_NAME);
    } catch {
      return null;
    }
  }

  async function installBase(): Promise<FileSystemDirectoryHandle | null> {
    return root ?? (await opfsRoot());
  }

  const picker =
    typeof window !== "undefined"
      ? (window as WindowWithDirectoryPicker).showDirectoryPicker
      : undefined;
  const supportsFolderPicker = typeof picker === "function";

  const folderPicker: Pick<PluginDirectoryAdapter, "addFromFolder"> = supportsFolderPicker
    ? {
        /** Copies a folder the author picks into OPFS (Chromium only); see the interface. */
        async addFromFolder(): Promise<string | null> {
          const base = await installBase();
          if (!base) throw new Error("Plugin storage is not available");
          let picked: FileSystemDirectoryHandle;
          try {
            picked = await picker!();
          } catch {
            return null; // The author cancelled the picker.
          }
          const entries: RawEntry[] = [];
          await collectRawEntries(picked, "", entries);
          const { id, files } = preparePlugin(entries);
          await installPluginFolder(base, id, files);
          return id;
        },
      }
    : {};

  return {
    kind: "web",
    supportsFolderPicker,

    async listFolders(): Promise<string[]> {
      const directory = await pluginsDirectory();
      if (!directory) return [];
      const names: string[] = [];
      for await (const entry of directory.values()) {
        if (entry.kind === "directory") names.push(entry.name);
      }
      return names.sort();
    },

    async readFolder(name: string): Promise<PluginFolder | null> {
      const directory = await pluginsDirectory();
      if (!directory) return null;
      let folder: FileSystemDirectoryHandle;
      try {
        folder = await directory.getDirectoryHandle(name);
      } catch {
        return null;
      }
      const files: PluginFolderFile[] = [];
      await collectFiles(folder, "", files);
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { name, files };
    },

    async replaceFolder(name: string, files: readonly PluginFolderFile[]): Promise<boolean> {
      const base = root ?? (await opfsRoot());
      if (!base) return false;
      let directory: FileSystemDirectoryHandle;
      try {
        directory = await base.getDirectoryHandle(WEB_PLUGIN_DIRECTORY_NAME, { create: true });
      } catch {
        return false;
      }
      try {
        // Drop the installed copy first, so a file the shipped copy dropped
        // does not survive the replace.
        await directory.removeEntry(name, { recursive: true });
      } catch {
        // Not there yet; the folder is created below.
      }
      const folder = await directory.getDirectoryHandle(name, { create: true });
      for (const file of files) {
        await writeFile(folder, file.path, file.bytes);
      }
      notifyWebPluginChanged(name);
      return true;
    },

    /**
     * Installs the Plugin a `.zip` carries: the author picks the file with the
     * web file input, this unzips it with fflate, validates the manifest, id,
     * paths, and caps the same way the folder path does, then writes the folder
     * into OPFS. Resolves the installed folder name, or null when the picker is
     * cancelled; throws a short Error on an invalid `.zip`.
     */
    async addFromZip(): Promise<string | null> {
      const base = await installBase();
      if (!base) throw new Error("Plugin storage is not available");
      const picked = await webDialog.openWithData({
        filters: [{ name: "Plugin", extensions: ["zip"] }],
      });
      if (!picked) return null;
      if (picked.data.length > MAX_TOTAL_BYTES) throw new Error("The Plugin .zip is too large");
      let entries: RawEntry[];
      try {
        entries = Object.entries(unzipSync(picked.data)).map(([path, bytes]) => ({ path, bytes }));
      } catch {
        throw new Error("The Plugin .zip could not be read");
      }
      const { id, files } = preparePlugin(entries);
      await installPluginFolder(base, id, files);
      return id;
    },

    /**
     * Deletes a Plugin folder and every file in it. `true` when it was there
     * and is now gone, `false` when it was already absent.
     */
    async removeFolder(name: string): Promise<boolean> {
      const directory = await pluginsDirectory();
      if (!directory) return false;
      try {
        await directory.removeEntry(name, { recursive: true });
      } catch {
        return false;
      }
      notifyWebPluginChanged(name);
      return true;
    },

    /**
     * Subscribes to the in-process change bus. OPFS itself has no change
     * events, so this is how a completed write reaches development mode (#442).
     */
    watch(onChanged: (id: string) => void): () => void {
      watchers.add(onChanged);
      return () => {
        watchers.delete(onChanged);
      };
    },

    ...folderPicker,
  };
}

/** Writes one file into an OPFS folder, creating the folders its path names. */
async function writeFile(
  directory: FileSystemDirectoryHandle,
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const segments = path.split("/");
  const name = segments.pop();
  if (!name) return;
  let parent = directory;
  for (const segment of segments) {
    if (segment === "") continue;
    parent = await parent.getDirectoryHandle(segment, { create: true });
  }
  const handle = await parent.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Uint8Array(bytes).buffer);
  await writable.close();
}
