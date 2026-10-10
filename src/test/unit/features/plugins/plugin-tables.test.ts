import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_TABLES } from "@/features/plugins/tables";
import { SQL_EXPORT_TABLES } from "@/lib/db/sql-export-format";
import { RESTORE_DELETE_TABLES } from "@/features/backup/backup-service";
import { RESET_LIBRARY_TABLES } from "@/lib/db";

// Every Plugin table must travel with the Library (ADR 0023): in the Backup
// dump (and so a Database File), on the Restore delete list, and on the Reset
// Library delete list. A Plugin table that joins the schema and misses one of
// these paths is the Canvas-wipe class of bug this agreement test catches.

describe("Plugin table coverage agreement", () => {
  it("exports every Plugin table", () => {
    const exported = SQL_EXPORT_TABLES.map((table) => table.name);
    expect(PLUGIN_TABLES.filter((table) => !exported.includes(table))).toEqual([]);
  });

  it("deletes every Plugin table on Restore", () => {
    expect(PLUGIN_TABLES.filter((table) => !RESTORE_DELETE_TABLES.includes(table))).toEqual([]);
  });

  it("deletes every Plugin table on Reset Library", () => {
    expect(PLUGIN_TABLES.filter((table) => !RESET_LIBRARY_TABLES.includes(table))).toEqual([]);
  });

  it("agrees with the schema the Library is created with", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/db/index.ts"), "utf8");
    const created = [...source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)]
      .map((match) => match[1])
      .filter((name) => name.startsWith("plugin_"));
    expect(created.sort()).toEqual([...PLUGIN_TABLES].sort());
  });
});
