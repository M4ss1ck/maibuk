import { describe, expect, it } from "vitest";
import { createMemoryDatabase } from "@/lib/db/memory-database";

describe("createMemoryDatabase()", () => {
  it("opens an empty Library that holds rows only in memory", async () => {
    const db = await createMemoryDatabase();
    await db.execute("CREATE TABLE t (id TEXT)");
    await db.execute("INSERT INTO t (id) VALUES (?)", ["a"]);
    await expect(db.select<{ id: string }[]>("SELECT id FROM t")).resolves.toEqual([{ id: "a" }]);

    const other = await createMemoryDatabase();
    await expect(other.select("SELECT name FROM sqlite_master")).resolves.toEqual([]);
  });

  it("has FTS5 with the trigram tokenizer, so Library Search can use it", async () => {
    const db = await createMemoryDatabase();
    await db.execute("CREATE VIRTUAL TABLE search USING fts5(x, tokenize='trigram')");
    await db.execute("INSERT INTO search (x) VALUES ('Elena Madrigal'), ('canción del faro')");

    const rows = await db.select<{ x: string }[]>(
      "SELECT x FROM search WHERE search MATCH 'elena' ORDER BY rowid"
    );
    expect(rows).toEqual([{ x: "Elena Madrigal" }]);
  });
});
