import type { SqlValue } from "@sqlite.org/sqlite-wasm";

// The SQLite build this app runs keeps every INTEGER as a BigInt and returns
// null-prototype row objects. The engine it replaced handed callers Numbers
// and plain objects, and every store and test still expects those shapes, so
// rows are converted once at the engine boundary.

/** What `selectObjects` hands back before parity conversion. */
export function toLibraryValue(value: SqlValue): unknown {
  // The old engine read every INTEGER as a double, even outside the safe
  // integer range, and so returned a Number. Convert the BigInt so both
  // paths hand callers the same JS types (the value is lossy exactly where
  // the old engine already was).
  return typeof value === "bigint" ? Number(value) : value;
}

/** A plain row object, with the same value types every caller already reads. */
export function toLibraryRow(row: Record<string, SqlValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    out[key] = toLibraryValue(row[key]);
  }
  return out;
}

// The official build prefixes an SQL failure with its result code and name
// (`SQLITE_CONSTRAINT_FOREIGNKEY: sqlite3 result code 787: FOREIGN KEY
// constraint failed`). The engine this replaced threw only SQLite's own
// message, which callers and tests match on, so strip the prefix back off and
// keep the result name for callers that branch on it.
const SQLITE_ERROR_PREFIX = /^([A-Z][A-Z0-9_]*): sqlite3 result code -?\d+: /;

/** Back to the message every existing caller already matched on. */
export function toLibraryError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const match = SQLITE_ERROR_PREFIX.exec(error.message);
  if (!match) return error;
  const stripped = new Error(error.message.slice(match[0].length));
  (stripped as Error & { code: string }).code = match[1];
  return stripped;
}
