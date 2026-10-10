import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupAdapter, BackupEntry, DatabaseAdapter } from "@/lib/platform/types";
import { parseTriggerFromFilename } from "@/features/backup/utils";
import { createTestDatabase } from "@/test/support/db-test-context";

// Real sql.js database and the real SQL exporter: the only stand-ins are the
// database handle and the backup file store. Plugin data is Library data
// (ADR 0023): Backups and Database Files carry it, Restore replaces it, older
// Backups leave it alone, and loading a Database File merges it by Plugin id
// and storage key.

const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockExportDatabase = vi.hoisted(() => vi.fn());
const mockCreateDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
  exportDatabase: mockExportDatabase,
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  createDatabase: mockCreateDatabase,
}));

const { BackupService, resetBackupQueueForTests } = await import(
  "@/features/backup/backup-service"
);
const { importDatabase, resetDatabase, closeDatabase } = await import("@/lib/db");

function createMemoryBackupAdapter(): BackupAdapter & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  let counter = 0;
  const entries = new Map<string, BackupEntry>();
  const list = () =>
    [...entries.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    files,
    async saveBackup(filename, sql) {
      files.set(filename, sql);
      entries.set(filename, {
        filename,
        trigger: parseTriggerFromFilename(filename),
        createdAt: new Date(1_700_000_000_000 + counter++ * 1000),
        sizeBytes: sql.length,
        checksum: "test",
      });
    },
    async listBackups() {
      return list();
    },
    async listBackupsPage({ page, pageSize }) {
      const all = list();
      return {
        entries: all.slice((page - 1) * pageSize, page * pageSize),
        totalCount: all.length,
        totalSizeBytes: all.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        page,
        pageSize,
      };
    },
    async readBackup(filename) {
      const sql = files.get(filename);
      if (!sql) throw new Error("Not found");
      return new TextDecoder().decode(sql);
    },
    async deleteBackup(filename) {
      files.delete(filename);
      entries.delete(filename);
    },
  };
}

async function insertBook(db: DatabaseAdapter, id: string, title: string): Promise<void> {
  await db.execute(
    "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, title, "Author", 1000, 1000]
  );
}

async function bookTitles(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.select<{ title: string }[]>("SELECT title FROM books ORDER BY title");
  return rows.map((row) => row.title);
}

async function putPluginValue(
  db: DatabaseAdapter,
  pluginId: string,
  key: string,
  value: unknown,
  updatedAt = 1000
): Promise<void> {
  await db.execute(
    `INSERT INTO plugin_storage (plugin_id, "key", "value", updated_at) VALUES (?, ?, ?, ?)`,
    [pluginId, key, JSON.stringify(value), updatedAt]
  );
}

async function putPluginDataVersion(
  db: DatabaseAdapter,
  pluginId: string,
  dataVersion: number,
  updatedAt = 1000
): Promise<void> {
  await db.execute(
    `INSERT INTO plugin_data_versions (plugin_id, data_version, updated_at) VALUES (?, ?, ?)`,
    [pluginId, dataVersion, updatedAt]
  );
}

async function pluginValues(
  db: DatabaseAdapter
): Promise<{ pluginId: string; key: string; value: unknown }[]> {
  const rows = await db.select<{ plugin_id: string; key: string; value: string }[]>(
    `SELECT plugin_id, "key", "value" FROM plugin_storage ORDER BY plugin_id, "key"`
  );
  return rows.map((row) => ({
    pluginId: row.plugin_id,
    key: row.key,
    value: JSON.parse(row.value) as unknown,
  }));
}

async function pluginDataVersions(db: DatabaseAdapter): Promise<Record<string, number>> {
  const rows = await db.select<{ plugin_id: string; data_version: number }[]>(
    "SELECT plugin_id, data_version FROM plugin_data_versions ORDER BY plugin_id"
  );
  return Object.fromEntries(rows.map((row) => [row.plugin_id, row.data_version]));
}

// The exact section layout every Backup had before Plugin storage joined the
// export: no Plugin sections. `extraNote` lets a test put arbitrary text
// inside a quoted value; `trailing` appends raw rows no section header
// announces.
function prePluginDump(bookInsert: string, noteInsert = "", trailing = ""): Uint8Array {
  return new TextEncoder().encode(
    [
      "-- Maibuk Database Export (SQL Dump)",
      "-- Exported at: 2026-05-01T00:00:00.000Z",
      "-- Import this file into a SQLite database after creating the schema",
      "",
      "-- Books",
      bookInsert,
      "",
      "-- Chapters",
      "",
      "",
      "-- Book Versions",
      "",
      "",
      "-- Notes",
      noteInsert,
      "",
      "-- Canvases",
      "",
      "",
      "-- Sync Tombstones",
      "",
      "",
      "-- Cover Templates",
      "",
      "",
      "-- Settings",
      "",
      trailing,
    ].join("\n")
  );
}

function pluginStorageInsert(pluginId: string, key: string, value: unknown): string {
  const encoded = JSON.stringify(value).replace(/'/g, "''");
  return `INSERT OR REPLACE INTO "plugin_storage" ("plugin_id", "key", "value", "updated_at") VALUES ('${pluginId}', '${key}', '${encoded}', 1000);`;
}

const LEGACY_BOOK_INSERT = `INSERT OR REPLACE INTO "books" ("id", "title", "author_name", "created_at", "updated_at") VALUES ('book-old', 'Book from the Backup', 'Author', 1000, 1000);`;

describe("Backup restore and Plugin storage", () => {
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryBackupAdapter>;
  let service: InstanceType<typeof BackupService>;

  beforeEach(async () => {
    vi.stubGlobal("Worker", undefined);
    resetBackupQueueForTests();
    // The real importDatabase/resetDatabase share the module's cached handle;
    // close it so each test's fresh Library is the one they reach.
    await closeDatabase();
    db = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(db);
    mockExportDatabase.mockImplementation(() => db.exportData());
    mockCreateDatabase.mockResolvedValue(db);
    adapter = createMemoryBackupAdapter();
    service = new BackupService(adapter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("brings back a Plugin namespace deleted after the Backup was taken", async () => {
    await insertBook(db, "book-1", "Novel");
    await putPluginValue(db, "echoes", "ignored", ["chapter-1"]);
    await putPluginDataVersion(db, "echoes", 2);
    const filename = await service.createBackup("manual");

    await db.execute("DELETE FROM plugin_storage");
    await db.execute("DELETE FROM plugin_data_versions");

    await service.restoreBackup(filename);

    expect(await pluginValues(db)).toEqual([
      { pluginId: "echoes", key: "ignored", value: ["chapter-1"] },
    ]);
    expect(await pluginDataVersions(db)).toEqual({ echoes: 2 });
    expect(await bookTitles(db)).toEqual(["Novel"]);
  });

  it("carries a namespace whose Plugin is not installed", async () => {
    await insertBook(db, "book-1", "Novel");
    await putPluginValue(db, "echoes", "ignored", ["chapter-1"]);
    await putPluginValue(db, "gone-plugin", "draft", { text: "kept" });
    const filename = await service.createBackup("manual");

    // The absent Plugin's rows sit in the Backup like any other namespace.
    await db.execute("DELETE FROM plugin_storage WHERE plugin_id = 'gone-plugin'");
    await putPluginValue(db, "later-plugin", "fresh", true);

    await service.restoreBackup(filename);

    expect(await pluginValues(db)).toEqual([
      { pluginId: "echoes", key: "ignored", value: ["chapter-1"] },
      { pluginId: "gone-plugin", key: "draft", value: { text: "kept" } },
    ]);
  });

  it("keeps this device's Plugin data when restoring a Backup made before Plugin storage was backed up", async () => {
    await insertBook(db, "book-now", "Book on this device");
    await putPluginValue(db, "echoes", "ignored", ["chapter-now"]);
    await putPluginDataVersion(db, "echoes", 3);
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, prePluginDump(LEGACY_BOOK_INSERT));

    await service.restoreBackup(filename);

    expect(await bookTitles(db)).toEqual(["Book from the Backup"]);
    expect(await pluginValues(db)).toEqual([
      { pluginId: "echoes", key: "ignored", value: ["chapter-now"] },
    ]);
    expect(await pluginDataVersions(db)).toEqual({ echoes: 3 });
  });

  it("does not mistake a Plugin section name inside a stored value for the section", async () => {
    await insertBook(db, "book-now", "Book on this device");
    await putPluginValue(db, "echoes", "still-here", ["chapter-now"]);
    const trickyNote = `INSERT OR REPLACE INTO "notes" ("id", "title", "content", "order", "created_at", "updated_at") VALUES ('note-1', 'Outline', 'Part one\n-- Plugin Storage\nPart two', 0, 1000, 1000);`;
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, prePluginDump(LEGACY_BOOK_INSERT, trickyNote));

    await service.restoreBackup(filename);

    expect(await pluginValues(db)).toEqual([
      { pluginId: "echoes", key: "still-here", value: ["chapter-now"] },
    ]);
    const notes = await db.select<{ content: string }[]>("SELECT content FROM notes");
    expect(notes[0].content).toBe("Part one\n-- Plugin Storage\nPart two");
  });

  it("replaces Plugin data when the Backup has a Plugin section, even an empty one", async () => {
    await insertBook(db, "book-1", "Novel");
    const filename = await service.createBackup("manual");
    await putPluginValue(db, "echoes", "made-later", ["chapter-1"]);
    await putPluginDataVersion(db, "echoes", 2);

    await service.restoreBackup(filename);

    expect(await pluginValues(db)).toEqual([]);
    expect(await pluginDataVersions(db)).toEqual({});
  });

  it("replaces Plugin data when a Backup without the section still carries Plugin rows", async () => {
    await putPluginValue(db, "device-plugin", "device", true);
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(
      filename,
      prePluginDump(LEGACY_BOOK_INSERT, "", pluginStorageInsert("echoes", "from-backup", ["c1"]))
    );

    await service.restoreBackup(filename);

    expect(await pluginValues(db)).toEqual([
      { pluginId: "echoes", key: "from-backup", value: ["c1"] },
    ]);
  });

  it("merges a Database File into this Library by Plugin id and storage key", async () => {
    await putPluginValue(db, "echoes", "keep", { from: "device" });
    await putPluginValue(db, "echoes", "replace", { from: "device" });
    await putPluginValue(db, "other", "shared-key", "device-value");
    await putPluginDataVersion(db, "boards", 5);

    const source = await createTestDatabase();
    await putPluginValue(source, "echoes", "replace", { from: "file" });
    await putPluginValue(source, "echoes", "added", { from: "file" });
    await putPluginValue(source, "other", "shared-key", "file-value");
    await putPluginDataVersion(source, "echoes", 4);
    const sqlContent = new TextDecoder().decode(await source.exportData());

    await importDatabase(sqlContent);

    expect(await pluginValues(db)).toEqual([
      { pluginId: "echoes", key: "added", value: { from: "file" } },
      { pluginId: "echoes", key: "keep", value: { from: "device" } },
      { pluginId: "echoes", key: "replace", value: { from: "file" } },
      { pluginId: "other", key: "shared-key", value: "file-value" },
    ]);
    expect(await pluginDataVersions(db)).toEqual({ echoes: 4, boards: 5 });
  });

  it("clears Plugin data on Reset Library", async () => {
    await insertBook(db, "book-1", "Novel");
    await putPluginValue(db, "echoes", "ignored", ["chapter-1"]);
    await putPluginDataVersion(db, "echoes", 2);

    await resetDatabase();

    expect(await pluginValues(db)).toEqual([]);
    expect(await pluginDataVersions(db)).toEqual({});
    expect(await bookTitles(db)).toEqual([]);
  });
});
