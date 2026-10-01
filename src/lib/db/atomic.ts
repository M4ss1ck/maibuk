import type { Database as SqlJsDatabase } from "sql.js";

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

/**
 * Runs every statement inside one sql.js transaction, or none. Synchronous on
 * purpose: nothing else can interleave with sql.js mid-load.
 */
export function runAtomicSqlJs(db: SqlJsDatabase, statements: string[]): void {
  const total = statements.length;
  for (let index = 0; index < statements.length; index += 1) {
    if (isTransactionControl(statements[index])) {
      throw new AtomicStatementError(
        index,
        "transaction control statements are not allowed in an atomic load",
        total
      );
    }
    if (ATTACH_RE.test(statements[index].trimStart())) {
      throw new AtomicStatementError(index, "ATTACH is not allowed in an atomic load", total);
    }
  }

  db.run("BEGIN");
  for (let index = 0; index < statements.length; index += 1) {
    if (statements[index].trim().length === 0) continue;
    try {
      db.run(statements[index]);
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
