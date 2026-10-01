import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupAdapter, BackupEntry, DatabaseAdapter } from "@/lib/platform/types";
import { parseTriggerFromFilename } from "@/features/backup/utils";
import { CURRENT_CANVAS_SCHEMA_VERSION } from "@/lib/canvas/defaultDoc";
import { createTestDatabase } from "@/test/support/db-test-context";

// Real sql.js database (foreign keys on, like desktop), the real SQL
// exporter, and the real atomic restore path: a Backup whose third restore
// INSERT fails at execution must leave every table exactly as it was (#344),
// because the deletes and inserts run in one transaction.

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

async function seedLibrary(db: DatabaseAdapter): Promise<void> {
  await db.execute(
    "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ["book-1", "Novel", "Author", 1000, 1000]
  );
  await db.execute(
    'INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ["chapter-1", "book-1", "Chapter One", "<p>Once upon a time</p>", 0, 1000, 1000]
  );
  await db.execute(
    "INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["version-1", "book-1", "First draft", "{}", 4, "abc123", "manual", 1000]
  );
  await db.execute(
    'INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ["note-1", "Outline", "The plan", 0, 1000, 1000]
  );
  await db.execute(
    'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ["canvas-1", "Plot map", canvasDoc("Plot map"), 0, 0, 1000, 1000, 1000]
  );
  await db.execute(
    "INSERT INTO sync_tombstones (id, entity_type, entity_id, title, deleted_at) VALUES (?, ?, ?, ?, ?)",
    ["tomb-1", "book", "book-gone", "Gone Book", 1000]
  );
  await db.execute(
    "INSERT INTO sync_state (entity_type, entity_id, local_checksum, remote_checksum, synced_at) VALUES (?, ?, ?, ?, ?)",
    ["book", "book-1", "local", "remote", 1000]
  );
}

const SNAPSHOT_TABLES = [
  "books",
  "chapters",
  "book_versions",
  "notes",
  "canvases",
  "sync_tombstones",
  "sync_state",
] as const;

async function snapshotLibrary(
  db: DatabaseAdapter
): Promise<Record<string, Record<string, unknown>[]>> {
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    snapshot[table] = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM ${table} ORDER BY rowid`
    );
  }
  return snapshot;
}

function bookInsert(id: string, title: string): string {
  return `INSERT INTO "books" ("id", "title", "author_name", "created_at", "updated_at") VALUES ('${id}', '${title}', 'Author', 1000, 1000);`;
}

describe("Backup restore is all-or-nothing", () => {
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

  it("leaves every table untouched when the third restore INSERT fails", async () => {
    await seedLibrary(db);
    const before = await snapshotLibrary(db);

    // The third restore statement re-uses the first Book id, so it fails at
    // execution with a UNIQUE constraint violation.
    const failing = new TextEncoder().encode(
      [
        "-- Maibuk Database Export (SQL Dump)",
        "",
        "-- Books",
        bookInsert("book-new-1", "First"),
        bookInsert("book-new-2", "Second"),
        bookInsert("book-new-1", "Duplicate"),
        "",
        "-- Canvases",
        "",
      ].join("\n")
    );
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    await adapter.saveBackup(filename, failing);

    await expect(service.restoreBackup(filename)).rejects.toThrow(
      /^RESTORE_FAILED: Restore failed on statement 3\/\d+:/
    );

    const after = await snapshotLibrary(db);
    expect(after).toEqual(before);

    const safety = (await service.listBackups()).find(
      (entry) => entry.trigger === "pre-restore"
    );
    expect(safety).toBeDefined();
  });

  it("restores a valid Backup made from the seeded Library", async () => {
    await seedLibrary(db);
    const before = await snapshotLibrary(db);
    const filename = await service.createBackup("manual");

    await db.execute("DELETE FROM chapters");
    await db.execute("DELETE FROM book_versions");
    await db.execute("DELETE FROM books");
    await db.execute("DELETE FROM notes");
    await db.execute("DELETE FROM canvases");

    await service.restoreBackup(filename);

    const after = await snapshotLibrary(db);
    expect(after.books).toEqual(before.books);
    expect(after.chapters).toEqual(before.chapters);
    expect(after.notes).toEqual(before.notes);
    expect(after.canvases).toEqual(before.canvases);
  });
});
