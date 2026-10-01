import { describe, expect, it } from "vitest";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { AtomicStatementError, isTransactionControl, runAtomicSqlJs } from "@/lib/db/atomic";
import { createTestDatabase } from "@/test/support/db-test-context";

async function createRawDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT)");
  db.run("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)");
  db.run("INSERT INTO authors (id, name) VALUES ('a1', 'Kept Author')");
  db.run("INSERT INTO notes (id, title) VALUES ('n1', 'Kept Note')");
  return db;
}

/** The full contents of every table, keyed by table name. */
function snapshot(db: SqlJsDatabase): Record<string, Record<string, unknown>[]> {
  const names: string[] = [];
  const list = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  try {
    while (list.step()) {
      names.push((list.getAsObject() as { name: string }).name);
    }
  } finally {
    list.free();
  }
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of names) {
    const select = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`);
    try {
      const rows: Record<string, unknown>[] = [];
      while (select.step()) {
        rows.push(select.getAsObject());
      }
      out[name] = rows;
    } finally {
      select.free();
    }
  }
  return out;
}

describe("runAtomicSqlJs()", () => {
  it("applies every statement on success", async () => {
    const db = await createRawDb();

    runAtomicSqlJs(db, [
      "INSERT INTO authors (id, name) VALUES ('a2', 'New Author')",
      "INSERT INTO notes (id, title) VALUES ('n2', 'New Note')",
    ]);

    expect(snapshot(db).authors).toHaveLength(2);
    expect(snapshot(db).notes).toHaveLength(2);
    db.close();
  });

  it("a failing 3rd statement leaves every table's full contents unchanged", async () => {
    const db = await createRawDb();
    const before = snapshot(db);

    let error: unknown = null;
    try {
      runAtomicSqlJs(db, [
        "INSERT INTO authors (id, name) VALUES ('a2', 'Doomed')",
        "INSERT INTO notes (id, title) VALUES ('n2', 'Doomed')",
        "INSERT INTO missing_table (id) VALUES ('x')",
      ]);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(2);
    expect((error as AtomicStatementError).name).toBe("AtomicStatementError");
    expect((error as AtomicStatementError).message).toMatch(/^Statement 3\/3 failed: /);
    expect(snapshot(db)).toEqual(before);
    db.close();
  });

  it("refuses transaction control statements before running anything", async () => {
    const db = await createRawDb();
    const before = snapshot(db);

    let error: unknown = null;
    try {
      runAtomicSqlJs(db, ["INSERT INTO authors (id, name) VALUES ('a2', 'Doomed')", "COMMIT"]);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(1);
    expect((error as AtomicStatementError).detail).toBe(
      "transaction control statements are not allowed in an atomic load"
    );
    expect(snapshot(db)).toEqual(before);
    db.close();
  });

  it("rolls back a load that contains ATTACH or VACUUM INTO", async () => {
    for (const statement of ["ATTACH 'other.db' AS x", "VACUUM INTO 'copy.db'"]) {
      const db = await createRawDb();
      const before = snapshot(db);

      let error: unknown = null;
      try {
        runAtomicSqlJs(db, [
          "INSERT INTO authors (id, name) VALUES ('a2', 'Doomed')",
          statement,
          "INSERT INTO notes (id, title) VALUES ('n2', 'Doomed')",
        ]);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(AtomicStatementError);
      expect((error as AtomicStatementError).index).toBe(1);
      expect(snapshot(db)).toEqual(before);
      db.close();
    }
  });

  it("skips whitespace-only statements", async () => {
    const db = await createRawDb();

    runAtomicSqlJs(db, [
      "   ",
      "INSERT INTO authors (id, name) VALUES ('a2', 'New Author')",
      "\n\t ",
    ]);

    expect(snapshot(db).authors).toHaveLength(2);
    db.close();
  });
});

describe("isTransactionControl()", () => {
  it.each([
    ["BEGIN", true],
    ["begin transaction", true],
    ["  COMMIT;", true],
    ["commit", true],
    ["END", true],
    ["ROLLBACK", true],
    ["  rollback to savepoint sp1", true],
    ["SAVEPOINT sp1", true],
    ["RELEASE sp1", true],
    ["RELEASE SAVEPOINT sp1", true],
    ["INSERT INTO beginnings (id) VALUES ('1')", false],
    ["SELECT * FROM commits", false],
    ["UPDATE notes SET title = 'rollback diary'", false],
    ["", false],
    ["   ", false],
  ])("%j -> %s", (statement, expected) => {
    expect(isTransactionControl(statement)).toBe(expected);
  });
});

describe("MemoryDatabaseAdapter.executeAtomic()", () => {
  it("a failing statement leaves the Library unchanged", async () => {
    const db = await createTestDatabase();
    await db.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1', 'Kept', 'A', 1, 1)`
    );
    const before = await db.select("SELECT * FROM books ORDER BY rowid");

    const error = await db
      .executeAtomic([
        `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b2', 'Doomed', 'A', 1, 1)`,
        `INSERT INTO missing_table (id) VALUES ('x')`,
      ])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(1);
    expect(await db.select("SELECT * FROM books ORDER BY rowid")).toEqual(before);
  });
});
