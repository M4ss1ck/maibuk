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

  it("runs SQLite new enough for diacritic-insensitive trigrams", async () => {
    const db = await createMemoryDatabase();
    const rows = await db.select<{ version: string }[]>(
      "SELECT sqlite_version() AS version"
    );
    const [major, minor] = rows[0].version.split(".").map(Number);
    expect(major > 3 || (major === 3 && minor >= 45)).toBe(true);

    await db.execute("CREATE VIRTUAL TABLE folded USING fts5(x, tokenize='trigram remove_diacritics 1')");
    await db.execute("INSERT INTO folded (x) VALUES ('canción del faro')");
    await expect(
      db.select("SELECT x FROM folded WHERE folded MATCH 'cancion'")
    ).resolves.toEqual([{ x: "canción del faro" }]);
  });
});
