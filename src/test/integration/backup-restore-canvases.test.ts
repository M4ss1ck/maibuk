import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupAdapter, BackupEntry, DatabaseAdapter } from "@/lib/platform/types";
import { parseTriggerFromFilename } from "@/features/backup/utils";
import { CURRENT_CANVAS_SCHEMA_VERSION } from "@/lib/canvas/defaultDoc";
import { createTestDatabase } from "@/test/support/db-test-context";

// Real sql.js database and the real SQL exporter: the only stand-ins are the
// database handle and the backup file store. A Canvas must survive a Backup
// round trip, and Backups taken before Canvases were exported must not
// delete the Canvases already on this device.

const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockExportDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
  exportDatabase: mockExportDatabase,
}));

const { BackupService, resetBackupQueueForTests } = await import(
  "@/features/backup/backup-service"
);

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

function canvasDoc(text: string): string {
  return JSON.stringify({
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    nodes: [{ id: "n1", kind: "text", position: { x: 0, y: 0 }, html: `<p>${text}</p>` }],
    edges: [],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

async function insertBook(db: DatabaseAdapter, id: string, title: string): Promise<void> {
  await db.execute(
    "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, title, "Author", 1000, 1000]
  );
}

async function insertCanvas(db: DatabaseAdapter, id: string, title: string): Promise<void> {
  await db.execute(
    'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, canvasDoc(title), 0, 0, 1000, 1000, 1000]
  );
}

async function canvasTitles(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.select<{ title: string }[]>("SELECT title FROM canvases ORDER BY title");
  return rows.map((row) => row.title);
}

async function bookTitles(db: DatabaseAdapter): Promise<string[]> {
  const rows = await db.select<{ title: string }[]>("SELECT title FROM books ORDER BY title");
  return rows.map((row) => row.title);
}

// The exact layout every Backup had from v0.4.14 through v0.7.1: no Canvases
// section. `extraNote` lets a test put arbitrary text inside a quoted value.
function legacyDump(bookInsert: string, noteInsert = ""): Uint8Array {
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
      "-- Sync Tombstones",
      "",
      "",
      "-- Cover Templates",
      "",
      "",
      "-- Settings",
      "",
    ].join("\n")
  );
}

const LEGACY_BOOK_INSERT = `INSERT OR REPLACE INTO "books" ("id", "title", "author_name", "created_at", "updated_at") VALUES ('book-old', 'Book from the Backup', 'Author', 1000, 1000);`;

describe("Backup restore and Canvases", () => {
  let db: DatabaseAdapter;
  let adapter: ReturnType<typeof createMemoryBackupAdapter>;
  let service: InstanceType<typeof BackupService>;

  beforeEach(async () => {
    vi.stubGlobal("Worker", undefined);
    resetBackupQueueForTests();
    db = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(db);
    mockExportDatabase.mockImplementation(() => db.exportData());
    adapter = createMemoryBackupAdapter();
    service = new BackupService(adapter);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("brings back a Canvas that was deleted after the Backup was taken", async () => {
    await insertBook(db, "book-1", "Novel");
    await insertCanvas(db, "canvas-1", "Plot map");
    const filename = await service.createBackup("manual");

    await db.execute("DELETE FROM canvases");
    await insertCanvas(db, "canvas-2", "Made after the Backup");

    await service.restoreBackup(filename);

    expect(await canvasTitles(db)).toEqual(["Plot map"]);
    expect(await bookTitles(db)).toEqual(["Novel"]);
  });

  it("keeps this device's Canvases when restoring a Backup made before Canvases were backed up", async () => {
    await insertBook(db, "book-now", "Book on this device");
    await insertCanvas(db, "canvas-1", "Plot map");
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, legacyDump(LEGACY_BOOK_INSERT));

    await service.restoreBackup(filename);

    expect(await bookTitles(db)).toEqual(["Book from the Backup"]);
    expect(await canvasTitles(db)).toEqual(["Plot map"]);
  });

  it("replaces Canvases when the Backup has a Canvases section, even an empty one", async () => {
    await insertBook(db, "book-1", "Novel");
    const filename = await service.createBackup("manual");
    await insertCanvas(db, "canvas-1", "Made after the Backup");

    await service.restoreBackup(filename);

    expect(await canvasTitles(db)).toEqual([]);
  });

  it("does not mistake a '-- Canvases' line inside note text for the Canvases section", async () => {
    await insertBook(db, "book-now", "Book on this device");
    await insertCanvas(db, "canvas-1", "Plot map");
    const trickyNote = `INSERT OR REPLACE INTO "notes" ("id", "title", "content", "order", "created_at", "updated_at") VALUES ('note-1', 'Outline', 'Part one\n-- Canvases\nPart two', 0, 1000, 1000);`;
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, legacyDump(LEGACY_BOOK_INSERT, trickyNote));

    await service.restoreBackup(filename);

    expect(await canvasTitles(db)).toEqual(["Plot map"]);
    const notes = await db.select<{ content: string }[]>("SELECT content FROM notes");
    expect(notes[0].content).toBe("Part one\n-- Canvases\nPart two");
  });

  it("saves a pre-restore Backup of a Library that only has Canvases, so the restore can be undone", async () => {
    await insertCanvas(db, "canvas-1", "Plot map");
    await insertBook(db, "book-1", "Novel");
    const filename = await service.createBackup("manual");
    await db.execute("DELETE FROM books");
    await db.execute("DELETE FROM canvases");
    await insertCanvas(db, "canvas-2", "Only thing on this device");

    await service.restoreBackup(filename);

    const safety = (await service.listBackups()).find((entry) => entry.trigger === "pre-restore");
    expect(safety).toBeDefined();
    // Backup filenames resolve to the second; undoing within the same second
    // would name the next safety Backup identically and overwrite this one.
    vi.setSystemTime(new Date(Date.now() + 2000));
    await service.restoreBackup(safety!.filename);
    expect(await canvasTitles(db)).toEqual(["Only thing on this device"]);
  });

  it("restores a Canvas written by a newer app unchanged instead of refusing the whole Backup", async () => {
    const newerDoc = JSON.stringify({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION + 1,
      nodes: [{ id: "n1", kind: "future-kind" }],
    });
    await insertBook(db, "book-1", "Novel");
    await db.execute(
      'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ["canvas-new", "From a newer app", newerDoc, 0, 0, 1000, 1000, 1000]
    );
    const filename = await service.createBackup("manual");
    await db.execute("DELETE FROM books");
    await db.execute("DELETE FROM canvases");

    await service.restoreBackup(filename);

    expect(await bookTitles(db)).toEqual(["Novel"]);
    const rows = await db.select<{ doc: string }[]>("SELECT doc FROM canvases");
    expect(rows.map((row) => row.doc)).toEqual([newerDoc]);
  });

  it("replaces Canvases when a Backup without a Canvases section still carries Canvas rows", async () => {
    await insertCanvas(db, "canvas-device", "On this device");
    const canvasRow = `INSERT OR REPLACE INTO "canvases" ("id", "title", "doc", "pinned", "order", "created_at", "updated_at", "content_updated_at") VALUES ('canvas-old', 'From the Backup', '${canvasDoc("From the Backup")}', 0, 0, 1000, 1000, 1000);`;
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, legacyDump(LEGACY_BOOK_INSERT, canvasRow));

    await service.restoreBackup(filename);

    expect(await canvasTitles(db)).toEqual(["From the Backup"]);
  });

  it("keeps this device's Canvases when the old Backup file uses Windows line endings", async () => {
    await insertCanvas(db, "canvas-1", "Plot map");
    const crlf = new TextDecoder().decode(legacyDump(LEGACY_BOOK_INSERT)).replace(/\n/g, "\r\n");
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, new TextEncoder().encode(crlf));

    await service.restoreBackup(filename);

    expect(await bookTitles(db)).toEqual(["Book from the Backup"]);
    expect(await canvasTitles(db)).toEqual(["Plot map"]);
  });
});
