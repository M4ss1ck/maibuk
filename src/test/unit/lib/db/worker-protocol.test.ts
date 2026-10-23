import { describe, expect, it } from "vitest";
import { AtomicStatementError } from "@/lib/db/atomic";
import { createDbWorkerHandler } from "@/lib/db/db-worker-handler";
import { SQL_EXPORT_TABLES } from "@/lib/db/sql-export-format";
import { rebuildDbError, serializeDbError } from "@/lib/db/worker-protocol";

function openHandler() {
  return createDbWorkerHandler();
}

describe("Library Worker error serialization", () => {
  it("keeps AtomicStatementError's index, detail, total and message", () => {
    const original = new AtomicStatementError(1, "no such table: missing", 3);

    const rebuilt = rebuildDbError(serializeDbError(original));

    expect(rebuilt).toBeInstanceOf(AtomicStatementError);
    const atomic = rebuilt as AtomicStatementError;
    expect(atomic.index).toBe(1);
    expect(atomic.detail).toBe("no such table: missing");
    expect(atomic.total).toBe(3);
    expect(atomic.message).toBe("Statement 2/3 failed: no such table: missing");
    expect(atomic.name).toBe("AtomicStatementError");
  });

  it("keeps a plain Error's name and message", () => {
    const original = new DOMException("The quota has been exceeded.", "QuotaExceededError");

    const rebuilt = rebuildDbError(serializeDbError(original));

    expect(rebuilt).not.toBeInstanceOf(AtomicStatementError);
    expect(rebuilt.name).toBe("QuotaExceededError");
    expect(rebuilt.message).toBe("The quota has been exceeded.");
  });
});

describe("Library Worker handler over the boundary", () => {
  it("rolls back an atomic load whose statement fails", async () => {
    const handler = openHandler();
    await handler.handle({
      id: 1,
      op: "open",
      mode: "memory",
      name: "library.sqlite3",
    });
    await handler.handle({
      id: 2,
      op: "execute",
      sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)",
    });
    await handler.handle({
      id: 3,
      op: "execute",
      sql: "INSERT INTO notes (id, title) VALUES ('kept', 'Kept')",
    });

    const failed = await handler.handle({
      id: 4,
      op: "runAtomic",
      statements: [
        "INSERT INTO notes (id, title) VALUES ('doomed', 'Doomed')",
        "INSERT INTO missing_table (id) VALUES ('x')",
      ],
    });

    expect(failed.response.ok).toBe(false);
    if (failed.response.ok) throw new Error("expected the atomic load to fail");
    const error = rebuildDbError(failed.response.error);
    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(1);
    expect((error as AtomicStatementError).total).toBe(2);
    expect((error as AtomicStatementError).detail).toMatch(/missing_table/);

    const rows = await handler.handle({
      id: 5,
      op: "select",
      sql: "SELECT id FROM notes ORDER BY id",
    });
    expect(rows.response.ok).toBe(true);
    if (!rows.response.ok) throw new Error("expected rows");
    expect(rows.response.value).toEqual([{ id: "kept" }]);
  });

  it("serializes an SQL failure without SQLite's result-code prefix", async () => {
    const handler = openHandler();
    await handler.handle({ id: 1, op: "open", mode: "memory", name: "library.sqlite3" });
    await handler.handle({ id: 2, op: "execute", sql: "CREATE TABLE t (id TEXT UNIQUE)" });
    await handler.handle({ id: 3, op: "execute", sql: "INSERT INTO t (id) VALUES ('a')" });

    const failed = await handler.handle({
      id: 4,
      op: "execute",
      sql: "INSERT INTO t (id) VALUES ('a')",
    });

    expect(failed.response.ok).toBe(false);
    if (failed.response.ok) throw new Error("expected the write to fail");
    const error = rebuildDbError(failed.response.error);
    expect(error.message).toBe("UNIQUE constraint failed: t.id");
    expect(error.message).not.toMatch(/sqlite3 result code/);
    expect(failed.response.error.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
  });

  it("exports the SQL dump from inside the handler", async () => {
    const handler = openHandler();
    await handler.handle({ id: 1, op: "open", mode: "memory", name: "library.sqlite3" });
    let id = 2;
    for (const table of SQL_EXPORT_TABLES) {
      const columns = table.name === "books" ? "id TEXT, title TEXT" : "id TEXT";
      await handler.handle({
        id: id++,
        op: "execute",
        sql: `CREATE TABLE "${table.name}" (${columns})`,
      });
    }
    await handler.handle({
      id: id++,
      op: "execute",
      sql: "INSERT INTO books (id, title) VALUES ('b1', 'Saved')",
    });

    const exported = await handler.handle({
      id: id++,
      op: "exportSqlDump",
      exportedAt: "2026-10-23T00:00:00.000Z",
    });

    expect(exported.response.ok).toBe(true);
    if (!exported.response.ok) throw new Error("expected a dump");
    const dump = new TextDecoder().decode(new Uint8Array(exported.response.value as ArrayBuffer));
    expect(dump).toContain("-- Maibuk Database Export (SQL Dump)");
    expect(dump).toContain(
      `INSERT OR REPLACE INTO "books" ("id", "title") VALUES ('b1', 'Saved');`
    );
    expect(exported.transfer).toHaveLength(1);
  });

  it("exports the database bytes, not a dump", async () => {
    const handler = openHandler();
    await handler.handle({ id: 1, op: "open", mode: "memory", name: "library.sqlite3" });

    const exported = await handler.handle({ id: 2, op: "exportBytes" });

    expect(exported.response.ok).toBe(true);
    if (!exported.response.ok) throw new Error("expected bytes");
    const bytes = new Uint8Array(exported.response.value as ArrayBuffer);
    expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe("SQLite format 3");
  });
});
