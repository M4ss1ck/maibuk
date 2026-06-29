import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
  exportData: vi.fn(),
  importData: vi.fn(),
};

const mockEnsureMetricsSchema = vi.fn();

const { mockCreateDatabase } = vi.hoisted(() => ({
  mockCreateDatabase: vi.fn(),
}));

vi.mock("../../../../lib/platform", () => ({
  createDatabase: mockCreateDatabase,
  IS_TAURI: false,
}));

vi.mock("../../../../features/metrics/events-repo", () => ({
  ensureMetricsSchema: mockEnsureMetricsSchema,
}));

describe("src/lib/db/index.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCreateDatabase.mockResolvedValue(mockDb);
    mockDb.execute.mockResolvedValue({ rowsAffected: 0 });
    mockDb.select.mockResolvedValue([]);
    mockDb.exportData.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockDb.importData.mockResolvedValue(undefined);
  });

  describe("getDatabase()", () => {
    it("creates and returns a database on first call", async () => {
      const { getDatabase } = await import("@/lib/db");
      const db = await getDatabase();

      expect(mockCreateDatabase).toHaveBeenCalledWith("maibuk.db");
      expect(db).toBe(mockDb);
    });

    it("returns cached database on subsequent calls without recreating", async () => {
      const { getDatabase } = await import("@/lib/db");
      await getDatabase();
      mockCreateDatabase.mockClear();

      const db = await getDatabase();

      expect(mockCreateDatabase).not.toHaveBeenCalled();
      expect(db).toBe(mockDb);
    });

    it("ignores migration errors when added columns already exist", async () => {
      // ALTER TABLE ... ADD COLUMN fails on databases that already have the
      // column; initialization must swallow that and still resolve.
      mockDb.execute.mockImplementation((sql: string) => {
        if (/ALTER TABLE/i.test(sql)) {
          return Promise.reject(new Error("duplicate column name"));
        }
        return Promise.resolve({ rowsAffected: 0 });
      });
      const { getDatabase } = await import("@/lib/db");

      await expect(getDatabase()).resolves.toBe(mockDb);
    });

    it("creates EPUB project tables and indexes during initialization", async () => {
      const { getDatabase } = await import("@/lib/db");

      await getDatabase();

      const executedSql = mockDb.execute.mock.calls.map(([sql]) => sql);
      expect(executedSql).toEqual(
        expect.arrayContaining([
          expect.stringContaining("CREATE TABLE IF NOT EXISTS project_assets"),
          expect.stringContaining("CREATE TABLE IF NOT EXISTS book_metadata"),
          expect.stringContaining("CREATE TABLE IF NOT EXISTS book_styles"),
          expect.stringContaining("CREATE TABLE IF NOT EXISTS epub_structures"),
          expect.stringContaining("CREATE TABLE IF NOT EXISTS chapter_epub_meta"),
          expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_project_assets_book_id"),
          expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_project_assets_book_href"),
          expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_book_metadata_book_id"),
          expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_book_styles_book_id"),
          expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_epub_structures_book_id"),
          expect.stringContaining("CREATE INDEX IF NOT EXISTS idx_chapter_epub_meta_book_id"),
        ])
      );
    });

    it("backfills note spellcheck language from linked books during initialization", async () => {
      const { getDatabase } = await import("@/lib/db");

      await getDatabase();

      const executedSql = mockDb.execute.mock.calls.map(([sql]) => sql);
      expect(executedSql).toEqual(
        expect.arrayContaining([
          expect.stringContaining("ALTER TABLE notes ADD COLUMN language TEXT"),
          expect.stringContaining(
            "SELECT books.language FROM books WHERE books.id = notes.book_id"
          ),
          expect.stringContaining("WHERE language IS NULL"),
        ])
      );
    });
  });

  describe("waitForDatabaseReady()", () => {
    it("resolves when database is ready", async () => {
      const { waitForDatabaseReady } = await import("@/lib/db");

      await expect(waitForDatabaseReady()).resolves.toBeUndefined();
      expect(mockCreateDatabase).toHaveBeenCalled();
    });
  });

  describe("closeDatabase()", () => {
    it("closes the database and resets the singleton", async () => {
      const { getDatabase, closeDatabase } = await import("@/lib/db");
      await getDatabase();

      await closeDatabase();

      expect(mockDb.close).toHaveBeenCalled();
      // After close, a new getDatabase should create a new instance
      mockCreateDatabase.mockClear();
      await getDatabase();
      expect(mockCreateDatabase).toHaveBeenCalled();
    });

    it("does not throw when database is not initialized", async () => {
      const { closeDatabase } = await import("@/lib/db");

      await expect(closeDatabase()).resolves.toBeUndefined();
      expect(mockDb.close).not.toHaveBeenCalled();
    });
  });

  describe("exportDatabase()", () => {
    it("returns exported data from the database", async () => {
      const { exportDatabase } = await import("@/lib/db");
      mockDb.exportData.mockResolvedValue(new Uint8Array([1, 2, 3]));

      const data = await exportDatabase();

      expect(data).toEqual(new Uint8Array([1, 2, 3]));
      expect(mockDb.exportData).toHaveBeenCalled();
    });
  });

  describe("resetDatabase()", () => {
    it("deletes all data from tables in the correct order", async () => {
      const { resetDatabase } = await import("@/lib/db");

      await resetDatabase();

      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM chapters");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM book_versions");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM books");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM cover_templates");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM settings");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM metrics_cache");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM metrics_event_tombstones");
      expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM metrics_events");
    });

    it("does not throw when metrics tables do not exist", async () => {
      const { resetDatabase } = await import("@/lib/db");
      mockDb.execute.mockImplementation((sql: string) => {
        if (sql.includes("metrics_")) {
          return Promise.reject(new Error("no such table"));
        }
        return Promise.resolve({ rowsAffected: 0 });
      });

      await expect(resetDatabase()).resolves.toBeUndefined();
    });

    it("does not throw when optional tables are missing", async () => {
      const { resetDatabase } = await import("@/lib/db");
      // Every DELETE guarded by .catch() is for a table that may not exist yet.
      const optional = [
        "chapter_epub_meta",
        "epub_structures",
        "book_styles",
        "book_metadata",
        "project_assets",
        "notes",
        "links",
        "sync_tombstones",
        "metrics_cache",
        "metrics_event_tombstones",
        "metrics_events",
      ];
      mockDb.execute.mockImplementation((sql: string) => {
        if (optional.some((table) => sql === `DELETE FROM ${table}`)) {
          return Promise.reject(new Error("no such table"));
        }
        return Promise.resolve({ rowsAffected: 0 });
      });

      await expect(resetDatabase()).resolves.toBeUndefined();
    });
  });

  describe("importDatabase()", () => {
    it("imports sql content after converting INSERT to INSERT OR REPLACE", async () => {
      const { importDatabase } = await import("@/lib/db");
      const sql = `INSERT INTO books (id) VALUES ('1');\nINSERT OR IGNORE INTO chapters (id) VALUES ('2');`;

      await importDatabase(sql);

      expect(mockDb.importData).toHaveBeenCalledWith(
        `INSERT OR REPLACE INTO books (id) VALUES ('1');\nINSERT OR REPLACE INTO chapters (id) VALUES ('2');`
      );
    });
  });
});
