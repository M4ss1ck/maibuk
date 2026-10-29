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

import type {
  PluginFileGrant,
  PluginFileGrantStore,
  PluginFileStat,
} from "@/features/plugins/file-grants";
import { PluginApiError } from "@/plugin-sdk/protocol";

/** The IndexedDB database and object store holding the persisted handles. */
const DB_NAME = "maibuk-plugin-file-grants";
const STORE_NAME = "grants";

/** What the browser answers about read access; asking again is a `requestPermission`. */
type GrantPermission = "denied" | "granted" | "prompt";

/** The slice of `FileSystemFileHandle` this store uses (no `@types` package). */
interface GrantFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  isSameEntry(other: GrantFileHandle): Promise<boolean>;
  queryPermission?(descriptor: { mode: "read" }): Promise<GrantPermission>;
  requestPermission?(descriptor: { mode: "read" }): Promise<GrantPermission>;
}

/** The options the store passes to the browser's picker. */
interface OpenFilePickerOptions {
  multiple: boolean;
  excludeAcceptAllOption: boolean;
  types: {
    description: string;
    accept: Record<string, string[]>;
  }[];
}

/** `window.showOpenFilePicker`, which the DOM types do not declare. */
type ShowOpenFilePicker = (options: OpenFilePickerOptions) => Promise<GrantFileHandle[]>;

/** The extra arguments tests substitute; the app passes none. */
export interface WebPluginFileGrantDeps {
  /** `window.showOpenFilePicker`; absent means the session-only input fallback. */
  showOpenFilePicker?: ShowOpenFilePicker;
  /** The factory grants persist through; absent means session-only grants. */
  indexedDB?: IDBFactory;
  /** The picker used where the File System Access API is missing. */
  pickWithInput?: (extensions: readonly string[]) => Promise<File | null>;
  /** Grant id source, so a test can name them. */
  randomId?: () => string;
}

/** A grant as IndexedDB keeps it: the handle is the grant. */
interface PersistedGrant {
  pluginId: string;
  grant: string;
  name: string;
  handle: GrantFileHandle;
}

/** A grant for this session only: the picked bytes, with no handle to keep. */
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

function needsPermission(): PluginApiError {
  return new PluginApiError({
    code: "file-needs-permission",
    message: "The browser needs the author's permission before this File Grant can be read",
  });
}

/** `name` on an error or DOMException, without assuming which one was thrown. */
function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

/** One grant's IndexedDB key: the Plugin id can never collide with another's. */
function grantKey(pluginId: string, grant: string): string {
  return `${pluginId}\u0000${grant}`;
}

/** The picker `window` carries, or null wherever the API is missing. */
function windowPicker(): ShowOpenFilePicker | null {
  const picker = (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  return typeof picker === "function" ? (picker as ShowOpenFilePicker).bind(globalThis) : null;
}

/**
 * The fallback picker: a hidden file input filtered to `extensions`, removed as
 * soon as it settles. Browsers without the File System Access API still fire
 * `cancel` on dismissal; one that does not only reveals a cancel by focus
 * coming back with no file chosen.
 */
function pickWithFileInput(extensions: readonly string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = extensions.map((extension) => `.${extension}`).join(",");
    input.style.display = "none";
    document.body.append(input);

    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    // `change` trails the focus return on some browsers, so look on the next task.
    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => finish(input.files?.[0] ?? null), 0);
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

  /** The IndexedDB factory right now, so a test can swap it per store. */
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

  /** One request's result; the caller closes the connection it opened. */
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

  /** Runs a write, answering whether it landed; a failure leaves the session copy. */
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

  /** Every record the Plugin holds; unreadable storage reads as none. */
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

  /** The Plugin's grant for the same file entry, so a re-pick keeps one grant. */
  async function findSameEntry(
    pluginId: string,
    handle: GrantFileHandle
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

  /** The file's size, or 0 when the browser will not hand the file over. */
  async function fileSize(handle: GrantFileHandle): Promise<number> {
    try {
      return (await handle.getFile()).size;
    } catch {
      return 0;
    }
  }

  /** A grant's size without prompting the author: 0 while access is not granted. */
  async function permittedSize(handle: GrantFileHandle): Promise<number> {
    if (typeof handle.queryPermission === "function") {
      try {
        if ((await handle.queryPermission({ mode: "read" })) !== "granted") return 0;
      } catch {
        return 0;
      }
    }
    return fileSize(handle);
  }

  /** The handle's file, refusing the two ways a browser withholds it. */
  async function fileFromHandle(handle: GrantFileHandle): Promise<File> {
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

  /** The file behind a grant: the session copy first, else the persisted handle. */
  async function fileOf(pluginId: string, grant: string): Promise<File> {
    const sessionGrant = session.get(grantKey(pluginId, grant));
    if (sessionGrant) return sessionGrant.file;
    const record = await findRecord(pluginId, grant);
    if (!record) throw fileMissing();
    return fileFromHandle(record.handle);
  }

  /** Keeps a grant the session can serve after a handle could not be persisted. */
  async function rememberSessionFile(
    pluginId: string,
    grant: string,
    handle: GrantFileHandle
  ): Promise<void> {
    try {
      const file = await handle.getFile();
      session.set(grantKey(pluginId, grant), { pluginId, grant, name: handle.name, file });
    } catch {
      // The grant is then unreadable, which `read` reports as missing.
    }
  }

  async function pickHandle(
    pluginId: string,
    extensions: readonly string[],
    showOpenFilePicker: ShowOpenFilePicker
  ): Promise<PluginFileGrant | null> {
    let handles: GrantFileHandle[];
    try {
      handles = await showOpenFilePicker({
        multiple: false,
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
      // The browser shows the picker only inside a user activation.
      if (errorName(error) === "NotAllowedError") {
        throw new PluginApiError({
          code: "user-action-required",
          message: "The browser opens its file picker only after a click or key press",
        });
      }
      throw error;
    }

    const handle = handles[0];
    if (!handle) return null;

    const size = await fileSize(handle);
    const existing = await findSameEntry(pluginId, handle);
    if (existing) return { grant: existing.grant, name: existing.name, size };

    const grant = randomId();
    const record: PersistedGrant = { pluginId, grant, name: handle.name, handle };
    const persisted = await write((store) => store.put(record, grantKey(pluginId, grant)));
    if (!persisted) await rememberSessionFile(pluginId, grant, handle);
    return { grant, name: handle.name, size };
  }

  async function pickSessionOnly(
    pluginId: string,
    extensions: readonly string[]
  ): Promise<PluginFileGrant | null> {
    const file = await pickWithInput(extensions);
    if (!file) return null;
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

  return {
    async pick(pluginId, extensions): Promise<PluginFileGrant | null> {
      const showOpenFilePicker = deps.showOpenFilePicker ?? windowPicker();
      if (showOpenFilePicker) return pickHandle(pluginId, extensions, showOpenFilePicker);
      return pickSessionOnly(pluginId, extensions);
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
      session.delete(grantKey(pluginId, grant));
      await write((store) => {
        store.delete(grantKey(pluginId, grant));
      });
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
