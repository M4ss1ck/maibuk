import type { DatabaseAdapter } from "@/lib/platform/types";
import type { DbOpenValue, LibraryStorageMode } from "@/lib/db/worker-protocol";

/**
 * The web Library's open sequence (ADR 0035): one tab at a time, the
 * `opfs-sahpool` VFS when it can be installed, an in-memory Library when it
 * cannot, and a one-time move of the old IndexedDB copy that never leaves the
 * author on an empty Library. The whole sequence takes its environment as
 * `LibraryOpenDeps`, so it is testable without a browser.
 */

/** The file the pooled VFS owns under `LIBRARY_POOL_DIRECTORY`. */
export const WEB_LIBRARY_FILE_NAME = "library.sqlite3";

/** The Web Lock every tab holds for as long as it has the Library open. */
export const WEB_LIBRARY_LOCK_NAME = "maibuk-library";

/** What the open sequence needs from the Worker that owns the Library. */
export interface LibraryClient extends DatabaseAdapter {
  /** Installs the VFS (or starts in memory) and opens the Library. */
  open(options: {
    mode: LibraryStorageMode;
    name: string;
    bytes?: Uint8Array;
  }): Promise<DbOpenValue>;
  /** Replaces the pooled Library with the old bytes and reopens it. */
  importBytes(bytes: Uint8Array, name: string): Promise<void>;
  /** Stops the Worker; a replacement client is made when the move fails. */
  terminate(): void;
}

/** A Web Lock held for the session, or the answer that another tab has it. */
export interface LibraryLock {
  held: boolean;
  release(): void;
}

export interface LibraryOpenDeps {
  acquireLock(): Promise<LibraryLock>;
  createClient(): LibraryClient;
  /** The old IndexedDB (or localStorage) copy, or null when none exists. */
  loadLegacyBytes(): Promise<Uint8Array | null>;
  deleteLegacyBytes(): Promise<void>;
}

export interface LibraryMigrationError {
  /** A full storage quota gets its own code so the UI can say what happened. */
  code: "quota-exceeded" | "migration-failed";
  message: string;
}

export type WebLibraryOpenResult =
  /** The pooled Library is open and kept. */
  | { kind: "opfs" }
  /** No usable OPFS: the Library runs for this session only. */
  | { kind: "memory" }
  /** Another tab holds the Library; nothing was opened. */
  | { kind: "locked" }
  /** The move failed; the old data is open in memory and the copy is kept. */
  | { kind: "migration-failed"; error: LibraryMigrationError };

export interface OpenWebLibraryOutcome {
  /** The open Library, or null when another tab holds it. */
  adapter: LibraryClient | null;
  result: WebLibraryOpenResult;
}

const QUOTA_EXCEEDED = "QuotaExceededError";

/** Turns whatever the move threw into the code the UI needs to branch on. */
export function describeMigrationError(error: unknown): LibraryMigrationError {
  const named = error as { name?: unknown; message?: unknown; code?: unknown } | null;
  const name = typeof named?.name === "string" ? named.name : "";
  const code = named?.code;
  const message =
    typeof named?.message === "string"
      ? named.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    code:
      name === QUOTA_EXCEEDED || code === "quota-exceeded" ? "quota-exceeded" : "migration-failed",
    message,
  };
}

/** The cheap checks a moved Library must pass before its old copy is dropped. */
async function verifyLibrary(client: LibraryClient): Promise<void> {
  await client.select("PRAGMA schema_version");
  await client.select("SELECT count(*) AS count FROM books");
}

async function openWithLock(deps: LibraryOpenDeps): Promise<OpenWebLibraryOutcome> {
  const client = deps.createClient();
  let opened: DbOpenValue;
  try {
    opened = await client.open({ mode: "opfs", name: WEB_LIBRARY_FILE_NAME });
  } catch {
    // Private windows, or an engine without usable OPFS. Attempting the
    // install is the only reliable test; capability checks lie.
    client.terminate();
    const legacy = await deps.loadLegacyBytes();
    const memory = deps.createClient();
    await memory.open({
      mode: "memory",
      name: WEB_LIBRARY_FILE_NAME,
      bytes: legacy ?? undefined,
    });
    return { adapter: memory, result: { kind: "memory" } };
  }

  // The pool already holds the Library: the move finished on an earlier launch.
  if (opened.existing) {
    return { adapter: client, result: { kind: "opfs" } };
  }

  const legacy = await deps.loadLegacyBytes();
  if (!legacy) {
    return { adapter: client, result: { kind: "opfs" } };
  }

  try {
    await client.importBytes(legacy, WEB_LIBRARY_FILE_NAME);
    await verifyLibrary(client);
  } catch (error) {
    // Never an empty Library: the old bytes open in memory, and the IndexedDB
    // copy stays exactly where it was for the next launch to try again.
    client.terminate();
    const memory = deps.createClient();
    await memory.open({
      mode: "memory",
      name: WEB_LIBRARY_FILE_NAME,
      bytes: legacy,
    });
    return {
      adapter: memory,
      result: { kind: "migration-failed", error: describeMigrationError(error) },
    };
  }

  // The pooled Library opened and passed its checks; only now may the old
  // copy go. A failed delete leaves an unused copy behind, never lost data.
  try {
    await deps.deleteLegacyBytes();
  } catch (error) {
    console.warn(
      "The moved Library is open, but its old IndexedDB copy could not be removed",
      error
    );
  }
  return { adapter: client, result: { kind: "opfs" } };
}

/**
 * Opens the web Library. `locked` means another tab holds it and nothing was
 * opened; every other result comes with an adapter.
 */
export async function openWebLibrary(deps: LibraryOpenDeps): Promise<OpenWebLibraryOutcome> {
  const lock = await deps.acquireLock();
  if (!lock.held) {
    return { adapter: null, result: { kind: "locked" } };
  }

  try {
    return await openWithLock(deps);
  } catch (error) {
    // A failed open must not leave the session lock held, or every retry
    // would look like "open in another tab".
    lock.release();
    throw error;
  }
}
