import type { AtomicStatement, DatabaseAdapter } from "@/lib/platform/types";
import type { DbOpenValue, DbRequestPayload } from "@/lib/db/worker-protocol";
import { createDbWorkerTransport, type DbWorkerTransport } from "@/lib/platform/web/db-client";
import {
  WEB_LIBRARY_LOCK_NAME,
  type LibraryClient,
  type LibraryLock,
  type LibraryOpenDeps,
  openWebLibrary,
  type WebLibraryOpenResult,
} from "@/lib/platform/web/library-open";
import {
  deleteLegacyLibraryBytes,
  loadLegacyLibraryBytes,
} from "@/lib/platform/web/legacy-storage";

/**
 * The web Library is a thin client of the Worker that owns it (ADR 0035):
 * every call is one protocol message. Durability comes from the `opfs-sahpool`
 * VFS writing changed pages, so a save never exports the whole database.
 */
export class WebDatabaseAdapter implements LibraryClient {
  constructor(private readonly transport: DbWorkerTransport) {}

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    return this.request({ op: "execute", sql, params });
  }

  async select<T = unknown[]>(sql: string, params?: unknown[]): Promise<T> {
    return this.request<T>({ op: "select", sql, params });
  }

  async close(): Promise<void> {
    try {
      await this.request({ op: "close" });
    } finally {
      this.terminate();
    }
  }

  async exportData(): Promise<Uint8Array> {
    const buffer = await this.request<ArrayBuffer>({
      op: "exportSqlDump",
      exportedAt: new Date().toISOString(),
    });
    return new Uint8Array(buffer);
  }

  async executeAtomic(statements: readonly AtomicStatement[]): Promise<void> {
    await this.request({ op: "runAtomic", statements });
  }

  async open(options: Parameters<LibraryClient["open"]>[0]): Promise<DbOpenValue> {
    return this.request({
      op: "open",
      mode: options.mode,
      name: options.name,
      bytes: options.bytes ? toArrayBuffer(options.bytes) : undefined,
    });
  }

  async importBytes(bytes: Uint8Array, name: string): Promise<void> {
    await this.request({ op: "importBytes", name, bytes: toArrayBuffer(bytes) });
  }

  terminate(): void {
    this.transport.terminate();
  }

  private request<T>(payload: DbRequestPayload): Promise<T> {
    return this.transport.request<T>(payload);
  }
}

/** A copy that owns exactly the bytes the view holds, not the whole buffer. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Why `getAuthorDatabase()` was not allowed to open: another tab holds the
 * Library. The result getter carries the same answer for the UI (unit 3).
 */
export class LibraryLockedError extends Error {
  constructor() {
    super("Maibuk is open in another tab.");
    this.name = "LibraryLockedError";
  }
}

/** Holds the `maibuk-library` Web Lock for as long as this page lives. */
async function acquireSessionLock(): Promise<LibraryLock> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) {
    // No Web Locks on this engine: the pool's own install rejection is the
    // only guard left.
    return { held: true, release() {} };
  }

  let release: (() => void) | null = null;
  const held = await new Promise<boolean>((resolve) => {
    locks
      .request<void>(WEB_LIBRARY_LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        const heldForSession = new Promise<void>((releaseLock) => {
          release = releaseLock;
        });
        resolve(true);
        return heldForSession;
      })
      // A failed lock request is no proof of exclusivity; the pool install
      // still gets its chance.
      .catch(() => resolve(false));
  });

  return held ? { held, release: () => release?.() } : { held: false, release() {} };
}

function defaultDeps(): LibraryOpenDeps {
  return {
    acquireLock: acquireSessionLock,
    createClient: () => new WebDatabaseAdapter(createDbWorkerTransport()),
    loadLegacyBytes: loadLegacyLibraryBytes,
    deleteLegacyBytes: deleteLegacyLibraryBytes,
  };
}

let webLibraryOpenResult: WebLibraryOpenResult | null = null;

/** How the Library was opened, for the screen that tells the author. */
export function getWebLibraryOpenResult(): WebLibraryOpenResult | null {
  return webLibraryOpenResult;
}

export async function createWebDatabase(
  _path: string,
  deps: LibraryOpenDeps = defaultDeps()
): Promise<DatabaseAdapter> {
  const outcome = await openWebLibrary(deps);
  webLibraryOpenResult = outcome.result;
  if (!outcome.adapter) throw new LibraryLockedError();
  return outcome.adapter;
}
