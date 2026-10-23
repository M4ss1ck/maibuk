import type { AtomicStatement } from "@/lib/platform/types";
import { AtomicStatementError } from "@/lib/db/atomic";

/**
 * The typed message protocol between the page and the Library Worker. Every
 * request has an `id` the reply carries back, and every failure crosses the
 * boundary as data: a thrown Error does not survive `postMessage`.
 */

export type LibraryStorageMode = "opfs" | "memory";

export type DbRequestPayload =
  /** Installs the VFS (or starts an in-memory Library) and opens the Library. */
  | {
      op: "open";
      mode: LibraryStorageMode;
      name: string;
      /** Legacy bytes to open in memory; never used with `mode: "opfs"`. */
      bytes?: ArrayBuffer;
    }
  | { op: "execute"; sql: string; params?: unknown[] }
  | { op: "select"; sql: string; params?: unknown[] }
  | { op: "runAtomic"; statements: readonly AtomicStatement[] }
  /** The database file's bytes (`sqlite3_js_db_export`), not a SQL dump. */
  | { op: "exportBytes" }
  /** Replaces the pooled Library with `bytes` (the one-time move off IndexedDB). */
  | { op: "importBytes"; name: string; bytes: ArrayBuffer }
  /** Formats the SQL dump inside the Worker; resolves an ArrayBuffer. */
  | { op: "exportSqlDump"; exportedAt: string }
  | { op: "close" };

export type DbRequest = DbRequestPayload & { id: number };

/** A failed request, with everything a caller branches on preserved. */
export interface SerializedDbError {
  name: string;
  message: string;
  /** AtomicStatementError's zero-based failing statement; `null` when the load itself failed. */
  atomicIndex?: number | null;
  /** The failing statement's own message, without the "Statement X/Y failed:" wrapper. */
  atomicDetail?: string;
  /** The load's statement count, so the rebuilt message reads the same. */
  atomicTotal?: number;
  /** A SQLite result name such as `SQLITE_CONSTRAINT_UNIQUE`, when the engine gave one. */
  code?: string;
}

export type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: SerializedDbError };

/** What `open` resolves: whether the pool already held the Library. */
export interface DbOpenValue {
  mode: LibraryStorageMode;
  existing: boolean;
}

const SQLITE_RESULT_NAME = /^([A-Z][A-Z0-9_]*): sqlite3 result code -?\d+: /;

/** Every error the Worker throws, as plain data the page can rebuild. */
export function serializeDbError(error: unknown): SerializedDbError {
  if (error instanceof AtomicStatementError) {
    return {
      name: error.name,
      message: error.message,
      atomicIndex: error.index,
      atomicDetail: error.detail,
      atomicTotal: error.total,
    };
  }
  if (error instanceof Error) {
    const serialized: SerializedDbError = { name: error.name, message: error.message };
    const code = sqliteResultName(error.message);
    if (code) serialized.code = code;
    const errorCode = (error as { code?: unknown }).code;
    if (typeof errorCode === "string") serialized.code = errorCode;
    return serialized;
  }
  // jsdom's DOMException is not an Error subclass; a quota failure must still
  // keep its name so the page can give it its own code.
  if (typeof error === "object" && error !== null) {
    const named = error as { name?: unknown; message?: unknown; code?: unknown };
    const serialized: SerializedDbError = {
      name: typeof named.name === "string" ? named.name : "Error",
      message: typeof named.message === "string" ? named.message : String(error),
    };
    if (typeof named.code === "string") serialized.code = named.code;
    return serialized;
  }
  return { name: "Error", message: String(error) };
}

function sqliteResultName(message: string): string | undefined {
  return SQLITE_RESULT_NAME.exec(message)?.[1];
}

/** A real Error on the page side, with the details `serializeDbError` kept. */
export function rebuildDbError(serialized: SerializedDbError): Error {
  if (
    serialized.name === "AtomicStatementError" &&
    serialized.atomicIndex !== undefined &&
    serialized.atomicIndex !== null &&
    serialized.atomicDetail !== undefined
  ) {
    return new AtomicStatementError(
      serialized.atomicIndex,
      serialized.atomicDetail,
      serialized.atomicTotal ?? serialized.atomicIndex + 1
    );
  }
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.code !== undefined) {
    (error as Error & { code: string }).code = serialized.code;
  }
  return error;
}
