/**
 * The web Plugin Directory (ADR 0020): a `plugins` folder in OPFS, one
 * directory per Plugin. The bytes read here are the bytes Web Crypto hashes,
 * so nothing can change between the pinned-hash check and the load. There is
 * no author-picked folder on the web; the app owns the OPFS directory. It also
 * writes a Built-in copy back (`replaceFolder`) when the author replaces a
 * modified Built-in (#442).
 *
 * The browser has no OPFS in jsdom or an engine without the File System
 * Access API: reading there reports an empty directory, never an error, so a
 * launch without Plugins stays a launch without Plugins.
 */

import type { PluginDirectoryAdapter, PluginFolder, PluginFolderFile } from "@/lib/platform/types";

/**
 * The OPFS folder the web Plugin Directory lives in: one directory per Plugin
 * (ADR 0020). It lives here, not in `src/constants.ts`, so the E2E seed can
 * import it without the app's build-time defines.
 */
export const WEB_PLUGIN_DIRECTORY_NAME = "plugins";

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

  return {
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
      return true;
    },
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
