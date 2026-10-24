import { describe, expect, it } from "vitest";
import sqlite3InitModule, {
  type Database as SqliteDatabase,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  AtomicStatementError,
  type AtomicDatabase,
  isTransactionControl,
  runAtomic,
} from "@/lib/db/atomic";
import { createTestDatabase } from "@/test/support/db-test-context";

let engine: Promise<Sqlite3Static> | null = null;

function sqlite3(): Promise<Sqlite3Static> {
  engine ??= sqlite3InitModule();
  return engine;
}

async function createRawDb(): Promise<SqliteDatabase> {
  const db = new (await sqlite3()).oo1.DB(":memory:", "c");
  db.exec("CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT)");
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)");
  db.exec("INSERT INTO authors (id, name) VALUES ('a1', 'Kept Author')");
  db.exec("INSERT INTO notes (id, title) VALUES ('n1', 'Kept Note')");
  return db;
}

/** The runner `runAtomic` takes, built the way the in-memory adapter builds it. */
function runner(db: SqliteDatabase): AtomicDatabase {
  return {
    run: (sql, params) => {
      if (params === undefined) {
        db.exec(sql);
      } else {
        db.exec({ sql, bind: params });
      }
    },
  };
}

/** The full contents of every table, keyed by table name. */
function snapshot(db: SqliteDatabase): Record<string, Record<string, unknown>[]> {
  const names = db.selectObjects(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  ) as { name: string }[];
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const { name } of names) {
    out[name] = db.selectObjects(`SELECT * FROM "${name}" ORDER BY rowid`);
  }
  return out;
}

describe("runAtomic()", () => {
  it("applies every statement on success", async () => {
    const db = await createRawDb();

    runAtomic(runner(db), [
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
      runAtomic(runner(db), [
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
      runAtomic(runner(db), ["INSERT INTO authors (id, name) VALUES ('a2', 'Doomed')", "COMMIT"]);
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
        runAtomic(runner(db), [
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

    runAtomic(runner(db), [
      "   ",
      "INSERT INTO authors (id, name) VALUES ('a2', 'New Author')",
      "\n\t ",
    ]);

    expect(snapshot(db).authors).toHaveLength(2);
    db.close();
  });
});

describe("runAtomic() with bound statements", () => {
  it("stores a bound value with quotes, semicolons and 1 MB exactly", async () => {
    const db = await createRawDb();
    const tricky = "O'Brien; DROP TABLE authors; --";
    const big = "a'b;".repeat(250_000); // 1,000,000 characters

    runAtomic(runner(db), [
      { sql: "INSERT INTO authors (id, name) VALUES (?, ?)", params: ["a2", tricky] },
      { sql: "INSERT INTO notes (id, title) VALUES (?, ?)", params: ["n2", big] },
    ]);

    const rows = snapshot(db);
    expect(rows.authors.find((row) => row.id === "a2")?.name).toBe(tricky);
    expect(rows.notes.find((row) => row.id === "n2")?.title).toBe(big);
    db.close();
  });

  it("commits plain and bound statements together", async () => {
    const db = await createRawDb();

    runAtomic(runner(db), [
      "INSERT INTO authors (id, name) VALUES ('a2', 'Plain')",
      { sql: "INSERT INTO notes (id, title) VALUES (?, ?)", params: ["n2", "Bound"] },
      "   ",
    ]);

    expect(snapshot(db).authors).toHaveLength(2);
    expect(snapshot(db).notes).toHaveLength(2);
    db.close();
  });

  it("a failing bound statement rolls back every statement and reports its index", async () => {
    const db = await createRawDb();
    const before = snapshot(db);

    let error: unknown = null;
    try {
      runAtomic(runner(db), [
        "INSERT INTO authors (id, name) VALUES ('a2', 'Doomed')",
        { sql: "INSERT INTO notes (id, title) VALUES (?, ?)", params: ["n1", "Duplicate id"] },
      ]);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(AtomicStatementError);
    expect((error as AtomicStatementError).index).toBe(1);
    expect((error as AtomicStatementError).message).toMatch(/^Statement 2\/2 failed: /);
    expect(snapshot(db)).toEqual(before);
    db.close();
  });

  it("refuses a bound statement whose sql is BEGIN before running anything", async () => {
    const db = await createRawDb();
    const before = snapshot(db);

    let error: unknown = null;
    try {
      runAtomic(runner(db), [
        "INSERT INTO authors (id, name) VALUES ('a2', 'Doomed')",
        { sql: "BEGIN", params: [] },
      ]);
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
