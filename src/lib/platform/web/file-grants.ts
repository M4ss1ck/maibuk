/**
 * The web File Grant store (ADR 0036): a picked file is a browser file handle
 * kept in IndexedDB under the Plugin's id, so a reload keeps the grant and the
 * Plugin still reads ranges of bytes, never a path. Where the browser has no
 * File System Access API (Firefox, Safari) the picked `File` lives in memory
 * for the session only, and a reload forgets it.
 *
 * The browser decides when a handle is readable again: `read` refuses with
 * `file-needs-permission` while the answer is "prompt", and `requestAccess`
 * asks from inside the author's click. IndexedDB that fails (private mode, a
 * blocked upgrade, no factory at all) degrades to session grants instead of
 * breaking a Plugin's pick.
 */

import { hasPluginFileExtension } from "@/lib/platform/plugin-file-extensions";
import type {
  PluginDroppedFile,
  PluginFileGrant,
  PluginFileGrantStore,
  PluginFileStat,
  PluginFolderPick,
} from "@/lib/platform/types";
import { PluginApiError } from "@/plugin-sdk/protocol";

const DB_NAME = "maibuk-plugin-file-grants";
const STORE_NAME = "grants";

// The browser owns this answer; `requestPermission` is the only way to change it.
type GrantPermission = "denied" | "granted" | "prompt";

// Only the slice this store uses: the project has no @types package for the File System Access API.
interface StoredFileGrant {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  isSameEntry(other: StoredFileGrant): Promise<boolean>;
  queryPermission?(descriptor: { mode: "read" }): Promise<GrantPermission>;
  requestPermission?(descriptor: { mode: "read" }): Promise<GrantPermission>;
}

interface OpenFilePickerOptions {
  multiple: boolean;
  excludeAcceptAllOption: boolean;
  types: {
    description: string;
    accept: Record<string, string[]>;
  }[];
}

// A folder entry is either a file to match or a subfolder to walk.
interface StoredDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<StoredFileGrant | StoredDirectoryHandle>;
}

// The DOM typings do not declare window.showOpenFilePicker or window.showDirectoryPicker.
type ShowOpenFilePicker = (options: OpenFilePickerOptions) => Promise<StoredFileGrant[]>;
type ShowDirectoryPicker = (options: { mode: "read" }) => Promise<StoredDirectoryHandle>;

/** The extra arguments tests substitute; the app passes none. */
export interface WebPluginFileGrantDeps {
  /** `window.showOpenFilePicker`; absent means the session-only input fallback. */
  showOpenFilePicker?: ShowOpenFilePicker;
  /** `window.showDirectoryPicker`; absent means the session-only folder input fallback. */
  showDirectoryPicker?: ShowDirectoryPicker;
  /** The factory grants persist through; absent means session-only grants. */
  indexedDB?: IDBFactory;
  /** The picker used where the File System Access API is missing. */
  pickWithInput?: (extensions: readonly string[]) => Promise<File | null>;
  /** The picker used for `pickMany` where the File System Access API is missing; null means cancelled. */
  pickManyWithInput?: (extensions: readonly string[]) => Promise<File[] | null>;
  /** The folder picker used where `showDirectoryPicker` is missing; null means cancelled. */
  pickFolderWithInput?: () => Promise<File[] | null>;
  /** Grant id source, so a test can name them. */
  randomId?: () => string;
}

interface PersistedGrant {
  pluginId: string;
  grant: string;
  name: string;
  handle: StoredFileGrant;
}

// A session grant holds the File itself, since there is no handle to persist.
interface SessionGrant {
  pluginId: string;
  grant: string;
  name: string;
  file: File;
}

function fileMissing(): PluginApiError {
  return new PluginApiError({
    code: "file-missing",
    message: "The file behind this File Grant is gone or unreadable",
  });
}

function internalError(): PluginApiError {
  return new PluginApiError({
    code: "internal-error",
    message: "The File Grant could not be removed from this device",
  });
}

// The browser shows its picker only inside a user activation.
function userActionRequired(): PluginApiError {
  return new PluginApiError({
    code: "user-action-required",
    message: "The browser opens its file picker only after a click or key press",
  });
}

function needsPermission(): PluginApiError {
  return new PluginApiError({
    code: "file-needs-permission",
    message: "The browser needs the author's permission before this File Grant can be read",
  });
}

// DOMException is not an Error in every browser, so read `name` structurally.
function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

// The NUL separator keeps one Plugin's id from ever matching another's grant.
function grantKey(pluginId: string, grant: string): string {
  return `${pluginId}\u0000${grant}`;
}

function windowPicker(): ShowOpenFilePicker | null {
  const picker = (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  return typeof picker === "function" ? (picker as ShowOpenFilePicker).bind(globalThis) : null;
}

function windowDirectoryPicker(): ShowDirectoryPicker | null {
  const picker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof picker === "function" ? (picker as ShowDirectoryPicker).bind(globalThis) : null;
}

// Browsers without the File System Access API still fire `cancel` on dismissal.
// One that does not only reveals a cancel by focus coming back with no file chosen,
// which is why the focus listener settles the pick as well. `multiple` lets the
// author choose several files; a single pick reads only the first.
function pickFilesWithFileInput(
  extensions: readonly string[],
  multiple: boolean
): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((extension) => `.${extension}`).join(",");
    input.multiple = multiple;
    input.style.display = "none";
    document.body.append(input);

    let settled = false;
    const finish = (files: File[] | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    const chosen = (): File[] => Array.from(input.files ?? []);

    input.addEventListener("change", () => finish(chosen().length > 0 ? chosen() : null), {
      once: true,
    });
    input.addEventListener("cancel", () => finish(null), { once: true });
    // `change` trails the focus return on some browsers, so look on the next task.
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => finish(chosen().length > 0 ? chosen() : null), 0);
      },
      { once: true }
    );
    input.click();
  });
}

function pickWithFileInput(extensions: readonly string[]): Promise<File | null> {
  return pickFilesWithFileInput(extensions, false).then((files) => files?.[0] ?? null);
}

// The folder twin of `pickWithFileInput`: a `webkitdirectory` input hands over
// every file under the chosen folder, each with its path in `webkitRelativePath`.
// A change with no files is a picked empty folder; only a dismissal without a
// change reads as a cancel.
function pickFolderWithFileInput(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = "none";
    document.body.append(input);

    let settled = false;
    const finish = (files: File[] | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    // `change` trails the focus return on some browsers, so look on the next task.
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => {
          const files = Array.from(input.files ?? []);
          finish(files.length > 0 ? files : null);
        }, 0);
      },
      { once: true }
    );
    input.click();
  });
}

function isPersistedGrant(value: unknown): value is PersistedGrant {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pluginId === "string" &&
    typeof record.grant === "string" &&
    typeof record.name === "string" &&
    typeof record.handle === "object" &&
    record.handle !== null
  );
}

/** The web store the app registers in a browser. */
export function createWebPluginFileGrantStore(
  deps: WebPluginFileGrantDeps = {}
): PluginFileGrantStore {
  const session = new Map<string, SessionGrant>();
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const pickWithInput = deps.pickWithInput ?? pickWithFileInput;
  const pickManyWithInput =
    deps.pickManyWithInput ?? ((extensions) => pickFilesWithFileInput(extensions, true));
  const pickFolderWithInput = deps.pickFolderWithInput ?? pickFolderWithFileInput;

  // Read per call, so a test can swap the factory for each store.
  function factory(): IDBFactory | undefined {
    return deps.indexedDB ?? globalThis.indexedDB;
  }

  function openDatabase(): Promise<IDBDatabase> {
    const idb = factory();
    if (!idb) return Promise.reject(new Error("IndexedDB is unavailable"));
    return new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function request<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await openDatabase();
    try {
      return await new Promise<T>((resolve, reject) => {
        const op = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        op.onsuccess = () => resolve(op.result);
        op.onerror = () => reject(op.error ?? new Error("IndexedDB request failed"));
      });
    } finally {
      db.close();
    }
  }

  async function write(run: (store: IDBObjectStore) => void): Promise<boolean> {
    try {
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(STORE_NAME, "readwrite");
          run(transaction.objectStore(STORE_NAME));
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
      return true;
    } catch {
      return false;
    }
  }

  // Unreadable storage reads as no records.
  async function recordsOf(pluginId: string): Promise<PersistedGrant[]> {
    try {
      const all = await request<unknown[]>("readonly", (store) => store.getAll());
      return all.filter(
        (record): record is PersistedGrant =>
          isPersistedGrant(record) && record.pluginId === pluginId
      );
    } catch {
      return [];
    }
  }

  async function findRecord(pluginId: string, grant: string): Promise<PersistedGrant | null> {
    const records = await recordsOf(pluginId);
    return records.find((record) => record.grant === grant) ?? null;
  }

  // A re-pick of the same file entry returns the grant already held.
  async function findSameEntry(
    pluginId: string,
    handle: StoredFileGrant
  ): Promise<PersistedGrant | null> {
    for (const record of await recordsOf(pluginId)) {
      try {
        if (await record.handle.isSameEntry(handle)) return record;
      } catch {
        // A handle the browser cannot compare is not the same entry.
      }
    }
    return null;
  }

  async function fileSize(handle: StoredFileGrant): Promise<number> {
    try {
      return (await handle.getFile()).size;
    } catch {
      return 0;
    }
  }

  // Listing never prompts, so a grant the browser has not granted reports size 0.
  async function permittedSize(handle: StoredFileGrant): Promise<number> {
    if (typeof handle.queryPermission === "function") {
      try {
        if ((await handle.queryPermission({ mode: "read" })) !== "granted") return 0;
      } catch {
        return 0;
      }
    }
    return fileSize(handle);
  }

  async function fileFromHandle(handle: StoredFileGrant): Promise<File> {
    if (typeof handle.queryPermission === "function") {
      let permission: GrantPermission = "granted";
      try {
        permission = await handle.queryPermission({ mode: "read" });
      } catch {
        // A browser that cannot answer is left to `getFile`, which fails as missing.
      }
      if (permission !== "granted") throw needsPermission();
    }
    try {
      return await handle.getFile();
    } catch {
      throw fileMissing();
    }
  }

  async function fileOf(pluginId: string, grant: string): Promise<File> {
    const sessionGrant = session.get(grantKey(pluginId, grant));
    if (sessionGrant) return sessionGrant.file;
    const record = await findRecord(pluginId, grant);
    if (!record) throw fileMissing();
    return fileFromHandle(record.handle);
  }

  // The picked handle could not be persisted, so the session keeps the File it gave.
  async function rememberSessionFile(
    pluginId: string,
    grant: string,
    handle: StoredFileGrant
  ): Promise<void> {
    try {
      const file = await handle.getFile();
      session.set(grantKey(pluginId, grant), { pluginId, grant, name: handle.name, file });
    } catch {
      // The grant is then unreadable, which `read` reports as missing.
    }
  }

  // A handle the browser handed over, whether through the picker or a drop:
  // the entry this Plugin already holds wins, otherwise the grant is persisted
  // and falls back to the session when IndexedDB refuses it.
  async function grantHandle(pluginId: string, handle: StoredFileGrant): Promise<PluginFileGrant> {
    const size = await fileSize(handle);
    const existing = await findSameEntry(pluginId, handle);
    if (existing) return { grant: existing.grant, name: existing.name, size };

    const grant = randomId();
    const record: PersistedGrant = { pluginId, grant, name: handle.name, handle };
    const persisted = await write((store) => store.put(record, grantKey(pluginId, grant)));
    if (!persisted) await rememberSessionFile(pluginId, grant, handle);
    return { grant, name: handle.name, size };
  }

  // A File with no handle to persist: the same File the Plugin already holds
  // returns that grant, otherwise the session keeps it.
  function sessionGrant(pluginId: string, file: File): PluginFileGrant {
    for (const entry of session.values()) {
      if (entry.pluginId !== pluginId) continue;
      if (
        entry.file.name === file.name &&
        entry.file.size === file.size &&
        entry.file.lastModified === file.lastModified
      ) {
        return { grant: entry.grant, name: entry.name, size: entry.file.size };
      }
    }
    const grant = randomId();
    session.set(grantKey(pluginId, grant), { pluginId, grant, name: file.name, file });
    return { grant, name: file.name, size: file.size };
  }

  // The handles the browser's picker returned, or null when the author cancelled.
  async function pickHandles(
    extensions: readonly string[],
    showOpenFilePicker: ShowOpenFilePicker,
    multiple: boolean
  ): Promise<StoredFileGrant[] | null> {
    try {
      return await showOpenFilePicker({
        multiple,
        excludeAcceptAllOption: false,
        types: [
          {
            description: "Documents",
            accept: {
              "application/octet-stream": extensions.map((extension) => `.${extension}`),
            },
          },
        ],
      });
    } catch (error) {
      if (errorName(error) === "AbortError") return null;
      if (errorName(error) === "NotAllowedError") throw userActionRequired();
      throw error;
    }
  }

  async function pickHandle(
    pluginId: string,
    extensions: readonly string[],
    showOpenFilePicker: ShowOpenFilePicker
  ): Promise<PluginFileGrant | null> {
    const handles = await pickHandles(extensions, showOpenFilePicker, false);
    const handle = handles?.[0];
    if (!handle) return null;

    return grantHandle(pluginId, handle);
  }

  // Every handle the browser returned, granted in dialog order, each grant once.
  async function pickHandleMany(
    pluginId: string,
    extensions: readonly string[],
    showOpenFilePicker: ShowOpenFilePicker
  ): Promise<PluginFileGrant[] | null> {
    const handles = await pickHandles(extensions, showOpenFilePicker, true);
    if (!handles || handles.length === 0) return null;

    const grants = new Map<string, PluginFileGrant>();
    for (const handle of handles) {
      const grant = await grantHandle(pluginId, handle);
      if (!grants.has(grant.grant)) grants.set(grant.grant, grant);
    }
    return [...grants.values()];
  }

  // A folder entry the store cannot hold persistently still grants its File for the session.
  async function grantFolderEntry(
    pluginId: string,
    entry: StoredFileGrant
  ): Promise<PluginFileGrant> {
    try {
      return await grantHandle(pluginId, entry);
    } catch {
      return sessionGrant(pluginId, await entry.getFile());
    }
  }

  // Walks the folder depth first in the order the browser lists it, granting every
  // matching file once; `grants` keeps the first occurrence of each grant id.
  async function grantFolderFiles(
    pluginId: string,
    extensions: readonly string[],
    directory: StoredDirectoryHandle,
    grants: Map<string, PluginFileGrant>
  ): Promise<void> {
    for await (const entry of directory.values()) {
      if (entry.kind === "directory") {
        await grantFolderFiles(pluginId, extensions, entry, grants);
        continue;
      }
      if (!hasPluginFileExtension(entry.name, extensions)) continue;
      const grant = await grantFolderEntry(pluginId, entry);
      if (!grants.has(grant.grant)) grants.set(grant.grant, grant);
    }
  }

  async function pickDirectory(
    pluginId: string,
    extensions: readonly string[],
    showDirectoryPicker: ShowDirectoryPicker
  ): Promise<PluginFolderPick | null> {
    let directory: StoredDirectoryHandle;
    try {
      directory = await showDirectoryPicker({ mode: "read" });
    } catch (error) {
      if (errorName(error) === "AbortError") return null;
      if (errorName(error) === "NotAllowedError") throw userActionRequired();
      throw error;
    }

    const grants = new Map<string, PluginFileGrant>();
    await grantFolderFiles(pluginId, extensions, directory, grants);
    return { folder: directory.name, grants: [...grants.values()] };
  }

  // The input fallback names the folder after the first file's first path segment;
  // a picked folder with no files, or files without a relative path, names it "".
  async function pickFolderSessionOnly(
    pluginId: string,
    extensions: readonly string[]
  ): Promise<PluginFolderPick | null> {
    const files = await pickFolderWithInput();
    if (!files) return null;

    const grants = new Map<string, PluginFileGrant>();
    for (const file of files) {
      if (!hasPluginFileExtension(file.name, extensions)) continue;
      const grant = sessionGrant(pluginId, file);
      if (!grants.has(grant.grant)) grants.set(grant.grant, grant);
    }
    const folder = files[0]?.webkitRelativePath.split("/")[0] ?? "";
    return { folder, grants: [...grants.values()] };
  }

  async function pickSessionOnly(
    pluginId: string,
    extensions: readonly string[]
  ): Promise<PluginFileGrant | null> {
    const file = await pickWithInput(extensions);
    if (!file) return null;
    return sessionGrant(pluginId, file);
  }

  async function pickSessionOnlyMany(
    pluginId: string,
    extensions: readonly string[]
  ): Promise<PluginFileGrant[] | null> {
    const files = await pickManyWithInput(extensions);
    if (!files || files.length === 0) return null;

    const grants = new Map<string, PluginFileGrant>();
    for (const file of files) {
      const grant = sessionGrant(pluginId, file);
      if (!grants.has(grant.grant)) grants.set(grant.grant, grant);
    }
    return [...grants.values()];
  }

  return {
    async pick(pluginId, extensions): Promise<PluginFileGrant | null> {
      const showOpenFilePicker = deps.showOpenFilePicker ?? windowPicker();
      if (showOpenFilePicker) return pickHandle(pluginId, extensions, showOpenFilePicker);
      return pickSessionOnly(pluginId, extensions);
    },

    async pickMany(pluginId, extensions): Promise<PluginFileGrant[] | null> {
      const showOpenFilePicker = deps.showOpenFilePicker ?? windowPicker();
      if (showOpenFilePicker) return pickHandleMany(pluginId, extensions, showOpenFilePicker);
      return pickSessionOnlyMany(pluginId, extensions);
    },

    async pickFolder(pluginId, extensions): Promise<PluginFolderPick | null> {
      const showDirectoryPicker = deps.showDirectoryPicker ?? windowDirectoryPicker();
      if (showDirectoryPicker) return pickDirectory(pluginId, extensions, showDirectoryPicker);
      return pickFolderSessionOnly(pluginId, extensions);
    },

    async drop(pluginId, files: readonly PluginDroppedFile[]): Promise<PluginFileGrant[]> {
      const grants: PluginFileGrant[] = [];
      for (const entry of files) {
        // A path is a desktop report; the browser has no way to open one.
        if ("path" in entry) continue;
        const handle = entry.handle === null ? null : await entry.handle.catch(() => null);
        if (handle?.kind === "file") {
          // The drop event's handle is the file entry itself, so the store can
          // hold it exactly as a picked one and survive a reload. A handle the
          // store cannot hold still leaves the File for this session.
          try {
            grants.push(await grantHandle(pluginId, handle as unknown as StoredFileGrant));
            continue;
          } catch {
            /* fall through to the session grant */
          }
        }
        grants.push(sessionGrant(pluginId, entry.file));
      }
      return grants;
    },

    async read(pluginId, grant, offset, length): Promise<ArrayBuffer> {
      const file = await fileOf(pluginId, grant);
      // A range past the end yields the bytes that exist, empty past the file.
      return file.slice(offset, offset + length).arrayBuffer();
    },

    async stat(pluginId, grant): Promise<PluginFileStat> {
      const file = await fileOf(pluginId, grant);
      return { name: file.name, size: file.size, modified: file.lastModified };
    },

    async requestAccess(pluginId, grant): Promise<boolean> {
      const sessionGrant = session.get(grantKey(pluginId, grant));
      if (sessionGrant) return true;
      const record = await findRecord(pluginId, grant);
      if (!record) throw fileMissing();
      if (typeof record.handle.requestPermission !== "function") return true;
      try {
        return (await record.handle.requestPermission({ mode: "read" })) === "granted";
      } catch {
        return false;
      }
    },

    async release(pluginId, grant): Promise<void> {
      const key = grantKey(pluginId, grant);
      if (!session.has(key) && !(await findRecord(pluginId, grant))) throw fileMissing();
      // The session copy goes even when the removal fails, so reads stop at once.
      session.delete(key);
      const removed = await write((store) => {
        store.delete(key);
      });
      if (!removed) throw internalError();
    },

    async list(pluginId): Promise<PluginFileGrant[]> {
      const grants: PluginFileGrant[] = [];
      for (const entry of session.values()) {
        if (entry.pluginId !== pluginId) continue;
        grants.push({ grant: entry.grant, name: entry.name, size: entry.file.size });
      }
      for (const record of await recordsOf(pluginId)) {
        if (session.has(grantKey(pluginId, record.grant))) continue;
        grants.push({
          grant: record.grant,
          name: record.name,
          size: await permittedSize(record.handle),
        });
      }
      return grants;
    },

    async clearPlugin(pluginId): Promise<void> {
      for (const [key, entry] of [...session]) {
        if (entry.pluginId === pluginId) session.delete(key);
      }
      const records = await recordsOf(pluginId);
      if (records.length === 0) return;
      await write((store) => {
        for (const record of records) store.delete(grantKey(record.pluginId, record.grant));
      });
    },

    async clearAll(): Promise<void> {
      session.clear();
      await write((store) => {
        store.clear();
      });
    },
  };
}
