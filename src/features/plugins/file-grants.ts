/**
 * The seam a Plugin File Grant store fills (ADR 0036). A File Grant is a
 * device-local handle to a file the author picked, scoped by Plugin id: a grant
 * id from one Plugin never names another Plugin's file, and the host reads the
 * bytes in ranges, never handing a path to a Plugin. Grants live outside the
 * Library, so Backups, Database Files, and Sync never carry them.
 *
 * The app registers `createMemoryPluginFileGrantStore()` at startup, so a store
 * is always present. The desktop Rust-backed store and the web File System
 * Access store register themselves here later; each keeps its own device-local
 * record and reads through it.
 *
 * Removal, revoking `files:pick`, and Reset settings end grants through this
 * seam, so the orchestrator never reaches into a platform store directly.
 */

import { PluginApiError } from "@/plugin-sdk/protocol";

/** What `files.pick` returns and `files.list` lists: a live grant, named and sized. */
export interface PluginFileGrant {
  grant: string;
  name: string;
  size: number;
}

/** What `files.stat` reads without opening the file's bytes. */
export interface PluginFileStat {
  name: string;
  size: number;
  /** Milliseconds since the Unix epoch. */
  modified: number;
}

export interface PluginFileGrantStore {
  /**
   * Shows the host's file dialog filtered to `extensions`, returning the picked
   * file's grant, or null when the author cancelled. Picking a file this Plugin
   * already holds a grant for returns the same grant id.
   */
  pick(pluginId: string, extensions: readonly string[]): Promise<PluginFileGrant | null>;
  /**
   * Reads `length` bytes from `offset`. A range past the end returns the bytes
   * that exist: shorter than asked, empty at or past the end of the file.
   */
  read(pluginId: string, grant: string, offset: number, length: number): Promise<ArrayBuffer>;
  /** The grant's name, size, and last-modified time; cheap enough for a Shelf. */
  stat(pluginId: string, grant: string): Promise<PluginFileStat>;
  /**
   * Asks the browser for read access again, inside a user action. Desktop
   * always answers true; the web store asks the author's browser.
   */
  requestAccess(pluginId: string, grant: string): Promise<boolean>;
  /** Ends the grant. */
  release(pluginId: string, grant: string): Promise<void>;
  /** Every live grant the Plugin holds on this device. */
  list(pluginId: string): Promise<PluginFileGrant[]>;
  /** Ends every grant the Plugin holds, and no other Plugin's. */
  clearPlugin(pluginId: string): Promise<void>;
  /** Ends every File Grant on this device. */
  clearAll(): Promise<void>;
}

let installedStore: PluginFileGrantStore | null = null;

/** Registers the store the handlers and Reset settings read; null clears it. */
export function registerPluginFileGrantStore(store: PluginFileGrantStore | null): void {
  installedStore = store;
}

/** The registered store, or null when none is. */
export function getPluginFileGrantStore(): PluginFileGrantStore | null {
  return installedStore;
}

/** One file a test hands the memory store's next `pick`, or seeds it with. */
export interface MemoryPluginFileGrantFile {
  name: string;
  bytes: Uint8Array;
  /** Milliseconds since the Unix epoch; defaults to when the grant is created. */
  modified?: number;
}

/** A seeded grant: the file, already granted to one Plugin. */
export interface MemoryPluginFileGrantSeed extends MemoryPluginFileGrantFile {
  pluginId: string;
}

/** The memory store, with the test-only hooks a Plugin test drives it with. */
export interface MemoryPluginFileGrantStore extends PluginFileGrantStore {
  /** Queues the file the Plugin's next `pick` returns; null means the author cancelled. */
  queuePick(pluginId: string, file: MemoryPluginFileGrantFile | null): void;
  /** Makes the file behind `grant` unreadable: `read` and `stat` throw `file-missing`. */
  setMissing(grant: string): void;
}

interface GrantRecord {
  id: string;
  pluginId: string;
  name: string;
  bytes: Uint8Array;
  modified: number;
}

function fileMissing(): PluginApiError {
  return new PluginApiError({
    code: "file-missing",
    message: "The file behind this File Grant is gone or unreadable",
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/**
 * The default session-only store: grants and their bytes live in memory, scoped
 * per Plugin. A test seeds files or queues picks, so it never needs a real
 * dialog or a platform store.
 */
export function createMemoryPluginFileGrantStore(
  seed: readonly MemoryPluginFileGrantSeed[] = []
): MemoryPluginFileGrantStore {
  const byPlugin = new Map<string, Map<string, GrantRecord>>();
  const queues = new Map<string, (MemoryPluginFileGrantFile | null)[]>();
  const missing = new Set<string>();
  let nextGrant = 1;

  function grantsOf(pluginId: string): Map<string, GrantRecord> {
    let grants = byPlugin.get(pluginId);
    if (!grants) {
      grants = new Map<string, GrantRecord>();
      byPlugin.set(pluginId, grants);
    }
    return grants;
  }

  function requireGrant(pluginId: string, grant: string): GrantRecord {
    const record = byPlugin.get(pluginId)?.get(grant);
    if (!record || missing.has(grant)) throw fileMissing();
    return record;
  }

  function addGrant(pluginId: string, file: MemoryPluginFileGrantFile): PluginFileGrant {
    const existing = [...grantsOf(pluginId).values()].find(
      (record) => record.name === file.name && sameBytes(record.bytes, file.bytes)
    );
    if (existing) {
      missing.delete(existing.id);
      return { grant: existing.id, name: existing.name, size: existing.bytes.length };
    }
    const id = `grant-${nextGrant}`;
    nextGrant += 1;
    grantsOf(pluginId).set(id, {
      id,
      pluginId,
      name: file.name,
      bytes: file.bytes,
      modified: file.modified ?? Date.now(),
    });
    return { grant: id, name: file.name, size: file.bytes.length };
  }

  for (const entry of seed) addGrant(entry.pluginId, entry);

  return {
    queuePick(pluginId, file): void {
      const queue = queues.get(pluginId) ?? [];
      queue.push(file);
      queues.set(pluginId, queue);
    },
    setMissing(grant): void {
      missing.add(grant);
    },
    async pick(pluginId, _extensions): Promise<PluginFileGrant | null> {
      const file = queues.get(pluginId)?.shift() ?? null;
      if (file === null) return null;
      return addGrant(pluginId, file);
    },
    async read(pluginId, grant, offset, length): Promise<ArrayBuffer> {
      const record = requireGrant(pluginId, grant);
      const start = Math.min(offset, record.bytes.length);
      const end = Math.min(start + length, record.bytes.length);
      const bytes = new ArrayBuffer(end - start);
      new Uint8Array(bytes).set(record.bytes.subarray(start, end));
      return bytes;
    },
    async stat(pluginId, grant): Promise<PluginFileStat> {
      const record = requireGrant(pluginId, grant);
      return { name: record.name, size: record.bytes.length, modified: record.modified };
    },
    async requestAccess(pluginId, grant): Promise<boolean> {
      const record = byPlugin.get(pluginId)?.get(grant);
      if (!record) throw fileMissing();
      // The memory store has no browser to ask, so a live grant is readable.
      return !missing.has(grant);
    },
    async release(pluginId, grant): Promise<void> {
      // A grant whose file is gone still ends here: the author removed a
      // Missing Document from the Shelf.
      const record = byPlugin.get(pluginId)?.get(grant);
      if (!record) throw fileMissing();
      byPlugin.get(pluginId)?.delete(grant);
      missing.delete(grant);
    },
    async list(pluginId): Promise<PluginFileGrant[]> {
      return [...(byPlugin.get(pluginId)?.values() ?? [])].map((record) => ({
        grant: record.id,
        name: record.name,
        size: record.bytes.length,
      }));
    },
    async clearPlugin(pluginId): Promise<void> {
      for (const grant of byPlugin.get(pluginId)?.keys() ?? []) {
        missing.delete(grant);
      }
      byPlugin.delete(pluginId);
      queues.delete(pluginId);
    },
    async clearAll(): Promise<void> {
      byPlugin.clear();
      queues.clear();
      missing.clear();
    },
  };
}
