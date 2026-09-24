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
});
