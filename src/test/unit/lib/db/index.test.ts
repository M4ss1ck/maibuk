import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
  close: vi.fn(),
  exportData: vi.fn(),
  executeAtomic: vi.fn(),
};

const mockEnsureMetricsSchema = vi.fn();

const { mockCreateDatabase } = vi.hoisted(() => ({
  mockCreateDatabase: vi.fn(),
}));

const { mockFlushPendingEdits } = vi.hoisted(() => ({
  mockFlushPendingEdits: vi.fn(),
}));

vi.mock("../../../../lib/platform", () => ({
  createDatabase: mockCreateDatabase,
  IS_TAURI: false,
}));

vi.mock("../../../../features/metrics/events-repo", () => ({
  ensureMetricsSchema: mockEnsureMetricsSchema,
}));

vi.mock("@/features/sync/pending-edits", () => ({
  flushPendingEdits: mockFlushPendingEdits,
}));

/** The DELETE statements a mocked execute call received. */
function deletesFrom(execute: ReturnType<typeof vi.fn>): string[] {
  return execute.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) => sql.trimStart().startsWith("DELETE"));
}

describe("src/lib/db/index.ts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    mockCreateDatabase.mockResolvedValue(mockDb);
    mockDb.execute.mockResolvedValue({ rowsAffected: 0 });
    mockDb.select.mockResolvedValue([]);
    mockDb.exportData.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockDb.executeAtomic.mockResolvedValue(undefined);
    mockFlushPendingEdits.mockResolvedValue(undefined);
  });

  describe("getDatabase()", () => {
    it("creates and returns a database on first call", async () => {
      const { getDatabase } = await import("@/lib/db");
      const db = await getDatabase();

      expect(mockCreateDatabase).toHaveBeenCalledWith("maibuk.db");
      expect(db).toBe(mockDb);
    });

    it("retries a failed open and returns the Library once it opens", async () => {
      vi.useFakeTimers();
      try {
        mockCreateDatabase
          .mockRejectedValueOnce(new Error("database is locked"))
          .mockResolvedValueOnce(mockDb);
        const { getDatabase } = await import("@/lib/db");

        const opened = getDatabase();
        await vi.advanceTimersByTimeAsync(250);

        await expect(opened).resolves.toBe(mockDb);
        expect(mockCreateDatabase).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("opens again on the next call after every attempt failed, instead of failing all session", async () => {
      vi.useFakeTimers();
      try {
        mockCreateDatabase.mockRejectedValue(new Error("database is locked"));
        const { getDatabase, DATABASE_OPEN_RETRY_DELAYS_MS } = await import("@/lib/db");

        const first = getDatabase();
        const firstResult = expect(first).rejects.toThrow("database is locked");
        for (const delay of DATABASE_OPEN_RETRY_DELAYS_MS) {
          await vi.advanceTimersByTimeAsync(delay);
        }
        await firstResult;
        expect(mockCreateDatabase).toHaveBeenCalledTimes(DATABASE_OPEN_RETRY_DELAYS_MS.length + 1);

        mockCreateDatabase.mockResolvedValue(mockDb);
        await expect(getDatabase()).resolves.toBe(mockDb);
      } finally {
        vi.useRealTimers();
      }
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
    it("clears every table in one transaction, in foreign-key order", async () => {
      const { resetDatabase } = await import("@/lib/db");

      await resetDatabase();

      expect(mockDb.executeAtomic).toHaveBeenCalledTimes(1);
      expect(mockDb.executeAtomic).toHaveBeenCalledWith([
        "DELETE FROM chapter_epub_meta",
        "DELETE FROM epub_structures",
        "DELETE FROM book_styles",
        "DELETE FROM book_metadata",
        "DELETE FROM project_assets",
        "DELETE FROM chapters",
        "DELETE FROM book_versions",
        "DELETE FROM books",
        "DELETE FROM cover_templates",
        "DELETE FROM notes",
        "DELETE FROM canvases",
        "DELETE FROM links",
        "DELETE FROM sync_tombstones",
        "DELETE FROM sync_state",
        "DELETE FROM settings",
        "DELETE FROM metrics_cache",
        "DELETE FROM metrics_event_tombstones",
        "DELETE FROM metrics_events",
      ]);
      // The per-statement path is gone: a failure must clear nothing.
      expect(deletesFrom(mockDb.execute)).toEqual([]);
    });

    it("announces the completed Reset once on the Change Feed", async () => {
      const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
      const { resetDatabase } = await import("@/lib/db");
      resetChangeFeedForTests();
      const signals: unknown[] = [];
      const off = onChange((signal) => {
        signals.push(signal);
      });

      try {
        await resetDatabase();
      } finally {
        off();
      }

      expect(signals).toEqual([{ scope: "all", reason: "resetLibrary" }]);
    });

    it("announces the completed Reset only after the transaction committed", async () => {
      const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
      const { resetDatabase } = await import("@/lib/db");
      resetChangeFeedForTests();
      const order: string[] = [];
      mockDb.executeAtomic.mockImplementation(async () => {
        order.push("clear");
      });
      const off = onChange(() => {
        order.push("signal");
      });

      try {
        await resetDatabase();
      } finally {
        off();
      }

      // A listener reading the Library on the signal sees it already empty;
      // the page reload that resets the views follows the signal (ADR 0026).
      expect(order).toEqual(["clear", "signal"]);
    });

    it("clears nothing and announces nothing when a Reset fails partway", async () => {
      const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
      const { resetDatabase } = await import("@/lib/db");
      resetChangeFeedForTests();
      const signals: unknown[] = [];
      const off = onChange((signal) => {
        signals.push(signal);
      });
      mockDb.executeAtomic.mockRejectedValueOnce(new Error("disk full"));

      try {
        await expect(resetDatabase()).rejects.toThrow("disk full");
      } finally {
        off();
      }

      // The failed transaction rolled back: no table was cleared.
      expect(deletesFrom(mockDb.execute)).toEqual([]);
      expect(signals).toEqual([]);
    });
  });

  describe("importDatabase()", () => {
    it("flushes pending edits, then loads each INSERT as an in-place upsert", async () => {
      const { importDatabase } = await import("@/lib/db");
      const sql = `INSERT INTO books (id) VALUES ('1');\nINSERT OR IGNORE INTO chapters (id) VALUES ('a;b');`;

      await importDatabase(sql);

      expect(mockFlushPendingEdits).toHaveBeenCalled();
      expect(mockDb.executeAtomic).toHaveBeenCalledWith([
        `INSERT INTO books (id) VALUES ('1') ON CONFLICT DO UPDATE SET id = excluded.id`,
        `INSERT INTO chapters (id) VALUES ('a;b') ON CONFLICT DO UPDATE SET id = excluded.id`,
      ]);
      expect(mockFlushPendingEdits.mock.invocationCallOrder[0]).toBeLessThan(
        mockDb.executeAtomic.mock.invocationCallOrder[0]
      );
    });

    it("drops the dump's own transaction control statements", async () => {
      const { importDatabase } = await import("@/lib/db");
      const sql = `BEGIN TRANSACTION;\nINSERT INTO books (id) VALUES ('1');\nCOMMIT;`;

      await importDatabase(sql);

      expect(mockDb.executeAtomic).toHaveBeenCalledWith([
        `INSERT INTO books (id) VALUES ('1') ON CONFLICT DO UPDATE SET id = excluded.id`,
      ]);
    });

    it("a failed pending-edits flush stops the load before anything changes", async () => {
      const { importDatabase } = await import("@/lib/db");
      mockFlushPendingEdits.mockRejectedValueOnce(new Error("disk full"));

      await expect(importDatabase(`INSERT INTO books (id) VALUES ('1');`)).rejects.toThrow(
        "disk full"
      );
      expect(mockDb.executeAtomic).not.toHaveBeenCalled();
    });

    it("announces the completed Database File load once on the Change Feed", async () => {
      const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
      const { importDatabase } = await import("@/lib/db");
      resetChangeFeedForTests();
      const signals: unknown[] = [];
      const off = onChange((signal) => {
        signals.push(signal);
      });

      try {
        await importDatabase(`INSERT INTO books (id) VALUES ('1');`);
      } finally {
        off();
      }

      expect(signals).toEqual([{ scope: "all", reason: "databaseLoad" }]);
    });

    it("announces the completed Database File load only after the rows persisted", async () => {
      const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
      const { importDatabase } = await import("@/lib/db");
      resetChangeFeedForTests();
      const order: string[] = [];
      mockDb.executeAtomic.mockImplementation(async () => {
        order.push("load");
      });
      const off = onChange(() => {
        order.push("signal");
      });

      try {
        await importDatabase(`INSERT INTO books (id) VALUES ('1');`);
      } finally {
        off();
      }

      // A listener reading the Library on the signal sees the loaded rows;
      // the page reload that resets the views follows the signal (ADR 0026).
      expect(order).toEqual(["load", "signal"]);
    });

    it("announces no completion when the load fails", async () => {
      const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
      const { importDatabase } = await import("@/lib/db");
      resetChangeFeedForTests();
      const signals: unknown[] = [];
      const off = onChange((signal) => {
        signals.push(signal);
      });
      mockDb.executeAtomic.mockRejectedValueOnce(new Error("disk full"));

      try {
        await expect(importDatabase(`INSERT INTO books (id) VALUES ('1');`)).rejects.toThrow(
          "disk full"
        );
      } finally {
        off();
      }

      expect(signals).toEqual([]);
    });
  });
});
