import type { Database as SqlJsDatabase } from "sql.js";
import type { AtomicStatement } from "@/lib/platform/types";

/** One statement of an atomic load failed, or the load itself could not run. */
export class AtomicStatementError extends Error {
  readonly index: number | null;
  readonly detail: string;

  constructor(index: number | null, detail: string, total: number) {
    super(
      index !== null
        ? `Statement ${index + 1}/${total} failed: ${detail}`
        : `Load failed: ${detail}`
    );
    this.name = "AtomicStatementError";
    this.index = index;
    this.detail = detail;
  }
}

// sql.js has no authorizer, and SQLite allows ATTACH inside a transaction, so
// the web load refuses it up front the way desktop's authorizer does (#196).
const ATTACH_RE = /^ATTACH\b/i;

const TRANSACTION_CONTROL_RE = /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/**
 * Whether the statement is transaction control (BEGIN/COMMIT/END/ROLLBACK/
 * SAVEPOINT/RELEASE as a whole word). Such statements would split the single
 * transaction an atomic load runs in, so they are refused or dropped.
 */
export function isTransactionControl(statement: string): boolean {
  return TRANSACTION_CONTROL_RE.test(statement.trimStart());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The one surface an atomic load needs from a database engine. */
export interface AtomicDatabase {
  run(sql: string, params?: readonly (string | number | null)[]): void;
}

/**
 * Runs every statement inside one transaction, or none. Synchronous on
 * purpose: the engine is single-threaded and in-process, so nothing else can
 * interleave with it mid-load.
 */
export function runAtomic(db: AtomicDatabase, statements: readonly AtomicStatement[]): void {
  const total = statements.length;
  const normalised = statements.map((statement) =>
    typeof statement === "string"
      ? { sql: statement, params: undefined }
      : { sql: statement.sql, params: statement.params }
  );
  for (let index = 0; index < normalised.length; index += 1) {
    if (isTransactionControl(normalised[index].sql)) {
      throw new AtomicStatementError(
        index,
        "transaction control statements are not allowed in an atomic load",
        total
      );
    }
    if (ATTACH_RE.test(normalised[index].sql.trimStart())) {
      throw new AtomicStatementError(index, "ATTACH is not allowed in an atomic load", total);
    }
  }

  db.run("BEGIN");
  for (let index = 0; index < normalised.length; index += 1) {
    const { sql, params } = normalised[index];
    if (sql.trim().length === 0) continue;
    try {
      db.run(sql, params);
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch {
        // SQLite already rolled back on some errors; the statement's error is what matters.
      }
      throw new AtomicStatementError(index, errorMessage(error), total);
    }
  }

  try {
    db.run("COMMIT");
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {
      // Ignore: the commit failure is what the caller must see.
    }
    throw new AtomicStatementError(null, errorMessage(error), total);
  }
}

/**
 * `runAtomic` over a sql.js handle. The web adapter still runs sql.js until
 * the OPFS move lands, so it keeps this entry point.
 */
export function runAtomicSqlJs(db: SqlJsDatabase, statements: readonly AtomicStatement[]): void {
  runAtomic(
    {
      run: (sql, params) => {
        db.run(sql, params as (string | number | null)[] | undefined);
      },
    },
    statements
  );
}
