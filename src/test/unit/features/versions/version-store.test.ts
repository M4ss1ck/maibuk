import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import { VERSION_AUTO_PRUNE_KEEP } from "../../../../constants";

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

const { mockSerializeBook, mockApplyBookSnapshot } = vi.hoisted(() => ({
  mockSerializeBook: vi.fn(),
  mockApplyBookSnapshot: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/sync/serializer", () => ({
  serializeBook: mockSerializeBook,
  applyBookSnapshot: mockApplyBookSnapshot,
}));

const { useVersionStore } = await import("../../../../features/versions/store");

async function seedBook(db: DatabaseAdapter, bookId = "book-1") {
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [bookId, "Test Book", "Author", now, now]
  );
}

function makeSnapshot(wordCount: number, updatedAt: number): string {
  return JSON.stringify({
    book: {
      id: "book-1",
      title: "Test Book",
      subtitle: null,
      authorName: "Author",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount,
      targetWordCount: null,
      status: "draft",
      createdAt: updatedAt,
      updatedAt,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [],
  });
}

describe("useVersionStore", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await seedBook(testDb);
    mockSerializeBook.mockReset();
    mockApplyBookSnapshot.mockReset();

    useVersionStore.setState({
      versions: [],
      totalCount: 0,
      currentBookId: null,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      error: null,
    });
  });

  describe("createVersion", () => {
    it("inserts a row and returns a BookVersion", async () => {
      const snapshot = makeSnapshot(1000, 1000);
      mockSerializeBook.mockResolvedValue(snapshot);

      const version = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "Draft 1",
        triggerType: "manual",
      });

      expect(version).not.toBeNull();
      expect(version?.name).toBe("Draft 1");
      expect(version?.triggerType).toBe("manual");
      expect(version?.bookId).toBe("book-1");
      expect(version?.wordCount).toBe(1000);

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE id = ?",
        [version!.id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshot).toBe(snapshot);
      expect(rows[0].trigger_type).toBe("manual");
    });

    it("dedups when checksum matches the last version", async () => {
      const snapshot = makeSnapshot(1000, 1000);
      mockSerializeBook.mockResolvedValue(snapshot);

      const v1 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      expect(v1).not.toBeNull();

      const v2 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      expect(v2).toBeNull();

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE book_id = ?",
        ["book-1"]
      );
      expect(rows).toHaveLength(1);
    });

    it("dedups when only updatedAt changed but text content is identical", async () => {
      // First snapshot at updatedAt=1000
      mockSerializeBook.mockResolvedValueOnce(makeSnapshot(1000, 1000));
      const v1 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "close",
      });
      expect(v1).not.toBeNull();

      // Same content, fresh updatedAt — simulates the "close" trigger flushing
      // the editor (bumps chapter timestamps) without any real text change.
      mockSerializeBook.mockResolvedValueOnce(makeSnapshot(1000, 9999));
      const v2 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "close",
      });
      expect(v2).toBeNull();

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE book_id = ?",
        ["book-1"]
      );
      expect(rows).toHaveLength(1);
    });

    it("preends new version to local state when currentBookId matches", async () => {
      const snapshot = makeSnapshot(1000, 1000);
      mockSerializeBook.mockResolvedValue(snapshot);

      useVersionStore.setState({ currentBookId: "book-1" });

      await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "First",
        triggerType: "manual",
      });

      expect(useVersionStore.getState().versions).toHaveLength(1);
      expect(useVersionStore.getState().versions[0].name).toBe("First");
    });

    describe("auto-idle retention", () => {
      const MAX_KEEP = VERSION_AUTO_PRUNE_KEEP;

      async function seedAutoIdle(count: number) {
        const baseTime = Math.floor(Date.now() / 1000) - count * 60;
        for (let i = 0; i < count; i++) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `auto-${String(i).padStart(4, "0")}`,
              "book-1",
              null,
              "{}",
              i,
              `seed-${i}`,
              "auto-idle",
              baseTime + i,
            ]
          );
        }
      }

      it("prunes older auto-idle checkpoints when one is created beyond the cap", async () => {
        await seedAutoIdle(MAX_KEEP); // already at the cap with seeded rows

        // The new auto-idle insert must keep the count at MAX_KEEP (insert + prune one).
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        const rows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'auto-idle'`,
          ["book-1"]
        );
        expect(Number(rows[0].c)).toBe(MAX_KEEP);
      });

      it("prunes a large backlog of auto-idle rows down to the cap in one insert", async () => {
        await seedAutoIdle(100);

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        const rows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'auto-idle'`,
          ["book-1"]
        );
        expect(Number(rows[0].c)).toBe(MAX_KEEP);
      });

      it("never prunes manual or pre-restore versions", async () => {
        const baseTime = Math.floor(Date.now() / 1000) - 10000;
        for (const trigger of ["manual", "pre-restore"] as const) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `keep-${trigger}`,
              "book-1",
              `keep-${trigger}`,
              "{}",
              0,
              `keep-${trigger}`,
              trigger,
              baseTime,
            ]
          );
        }
        await seedAutoIdle(MAX_KEEP + 5);

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        for (const trigger of ["manual", "pre-restore"]) {
          const rows = await testDb.select<Record<string, unknown>[]>(
            "SELECT id FROM book_versions WHERE id = ?",
            [`keep-${trigger}`]
          );
          expect(rows).toHaveLength(1);
        }
      });

      it("does not prune when the trigger type is manual", async () => {
        await seedAutoIdle(MAX_KEEP + 5);

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          name: "Important draft",
          triggerType: "manual",
        });

        const rows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'auto-idle'`,
          ["book-1"]
        );
        expect(Number(rows[0].c)).toBe(MAX_KEEP + 5);
      });

      it("prunes close-trigger backlog when a new close version is inserted", async () => {
        const baseTime = Math.floor(Date.now() / 1000) - 50_000;
        for (let i = 0; i < 50; i++) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `close-${String(i).padStart(4, "0")}`,
              "book-1",
              null,
              "{}",
              i,
              `close-${i}`,
              "close",
              baseTime + i,
            ]
          );
        }

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "close",
        });

        const rows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'close'`,
          ["book-1"]
        );
        expect(Number(rows[0].c)).toBe(MAX_KEEP);
      });

      it("prunes pre-sync backlog when a new pre-sync version is inserted", async () => {
        const baseTime = Math.floor(Date.now() / 1000) - 50_000;
        for (let i = 0; i < 30; i++) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `psync-${String(i).padStart(4, "0")}`,
              "book-1",
              null,
              "{}",
              i,
              `psync-${i}`,
              "pre-sync",
              baseTime + i,
            ]
          );
        }

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "pre-sync",
        });

        const rows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'pre-sync'`,
          ["book-1"]
        );
        expect(Number(rows[0].c)).toBe(MAX_KEEP);
      });

      it("each trigger type has its own quota — inserting close does not touch auto-idle", async () => {
        await seedAutoIdle(MAX_KEEP);

        const baseTime = Math.floor(Date.now() / 1000) - 100;
        for (let i = 0; i < MAX_KEEP; i++) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `close-quota-${i}`,
              "book-1",
              null,
              "{}",
              i,
              `close-q-${i}`,
              "close",
              baseTime + i,
            ]
          );
        }

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "close",
        });

        const auto = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'auto-idle'`,
          ["book-1"]
        );
        const close = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'close'`,
          ["book-1"]
        );
        expect(Number(auto[0].c)).toBe(MAX_KEEP); // auto-idle untouched
        expect(Number(close[0].c)).toBe(MAX_KEEP); // close pruned back to cap
      });

      it("only prunes auto-idle rows belonging to the same book", async () => {
        await seedBook(testDb, "book-2");
        const baseTime = Math.floor(Date.now() / 1000) - 100;
        for (let i = 0; i < 3; i++) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `other-${i}`,
              "book-2",
              null,
              "{}",
              i,
              `o-${i}`,
              "auto-idle",
              baseTime + i,
            ]
          );
        }
        await seedAutoIdle(MAX_KEEP + 10);

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        const otherRows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'auto-idle'`,
          ["book-2"]
        );
        expect(Number(otherRows[0].c)).toBe(3);
      });
    });
  });

  describe("loadVersions", () => {
    async function seedVersions(count: number) {
      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < count; i++) {
        await testDb.execute(
          `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `ver-${String(i).padStart(3, "0")}`,
            "book-1",
            `v${i}`,
            "{}",
            i,
            `chk-${i}`,
            "manual",
            baseTime + i,
          ]
        );
      }
    }

    it("returns versions ordered by created_at DESC, id DESC", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-a", "book-1", null, "{}", 0, "chk-a", "auto-idle", now]
      );
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-b", "book-1", null, "{}", 0, "chk-b", "manual", now]
      );

      await useVersionStore.getState().loadVersions("book-1");

      const ids = useVersionStore.getState().versions.map((v) => v.id);
      expect(ids).toEqual(["ver-b", "ver-a"]);
      expect(useVersionStore.getState().totalCount).toBe(2);
      expect(useVersionStore.getState().currentPage).toBe(1);
    });

    it("loads only the requested page (LIMIT/OFFSET at SQL level)", async () => {
      await seedVersions(25);

      await useVersionStore.getState().loadVersions("book-1", 1, 10);
      expect(useVersionStore.getState().versions).toHaveLength(10);
      expect(useVersionStore.getState().totalCount).toBe(25);

      await useVersionStore.getState().loadVersions("book-1", 2, 10);
      expect(useVersionStore.getState().versions).toHaveLength(10);
      expect(useVersionStore.getState().currentPage).toBe(2);

      await useVersionStore.getState().loadVersions("book-1", 3, 10);
      expect(useVersionStore.getState().versions).toHaveLength(5);
      expect(useVersionStore.getState().currentPage).toBe(3);
    });

    it("clamps an out-of-range page to the last available page", async () => {
      await seedVersions(15);

      await useVersionStore.getState().loadVersions("book-1", 99, 10);
      expect(useVersionStore.getState().currentPage).toBe(2);
      expect(useVersionStore.getState().versions).toHaveLength(5);
    });

    it("opportunistically prunes auto-idle backlog on the first load per book", async () => {
      const baseTime = Math.floor(Date.now() / 1000) - 100000;
      for (let i = 0; i < 100; i++) {
        await testDb.execute(
          `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `legacy-${String(i).padStart(4, "0")}`,
            "book-1",
            null,
            "{}",
            i,
            `chk-legacy-${i}`,
            "auto-idle",
            baseTime + i,
          ]
        );
      }

      await useVersionStore.getState().loadVersions("book-1", 1, 10);

      const remaining = await testDb.select<Record<string, unknown>[]>(
        `SELECT COUNT(*) AS c FROM book_versions
         WHERE book_id = ? AND trigger_type = 'auto-idle'`,
        ["book-1"]
      );
      expect(Number(remaining[0].c)).toBe(VERSION_AUTO_PRUNE_KEEP);
      expect(useVersionStore.getState().totalCount).toBe(VERSION_AUTO_PRUNE_KEEP);
    });

    it("prunes ALL automatic trigger backlogs (auto-idle, close, pre-sync) on first load", async () => {
      const baseTime = Math.floor(Date.now() / 1000) - 100_000;
      const seed = async (trigger: string, count: number, prefix: string) => {
        for (let i = 0; i < count; i++) {
          await testDb.execute(
            `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              `${prefix}-${String(i).padStart(4, "0")}`,
              "book-1",
              null,
              "{}",
              i,
              `${prefix}-chk-${i}`,
              trigger,
              baseTime + i,
            ]
          );
        }
      };
      // Mirror the user's actual situation: thousands of "close" rows + a manual
      // that must NOT be pruned.
      await seed("auto-idle", 50, "ai");
      await seed("close", 8500, "cl");
      await seed("pre-sync", 35, "ps");
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["manual-keepme", "book-1", "Important", "{}", 0, "manual-chk", "manual", baseTime + 10_000]
      );

      await useVersionStore.getState().loadVersions("book-1", 1, 10);

      const counts = await testDb.select<Record<string, unknown>[]>(
        `SELECT trigger_type, COUNT(*) AS c FROM book_versions
         WHERE book_id = ? GROUP BY trigger_type`,
        ["book-1"]
      );
      const byTrigger = Object.fromEntries(
        counts.map((r) => [r.trigger_type as string, Number(r.c)])
      );
      expect(byTrigger["auto-idle"]).toBe(VERSION_AUTO_PRUNE_KEEP);
      expect(byTrigger.close).toBe(VERSION_AUTO_PRUNE_KEEP);
      expect(byTrigger["pre-sync"]).toBe(VERSION_AUTO_PRUNE_KEEP);
      expect(byTrigger.manual).toBe(1);
    });

    it("does not re-prune on subsequent page navigation for the same book", async () => {
      const baseTime = Math.floor(Date.now() / 1000) - 1000;
      // Seed exactly at the cap so the prune is a no-op on first load.
      for (let i = 0; i < VERSION_AUTO_PRUNE_KEEP; i++) {
        await testDb.execute(
          `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `auto-${String(i).padStart(4, "0")}`,
            "book-1",
            null,
            "{}",
            i,
            `chk-${i}`,
            "auto-idle",
            baseTime + i,
          ]
        );
      }
      // Add one extra auto-idle row AFTER the first load: page navigation must NOT prune it.
      await useVersionStore.getState().loadVersions("book-1", 1, 10);

      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["extra", "book-1", null, "{}", 999, "chk-extra", "auto-idle", baseTime + 9999]
      );

      // Page navigation through setPage → loadVersions(currentBookId, …). Should not prune.
      await useVersionStore.getState().setPage(2);

      const remaining = await testDb.select<Record<string, unknown>[]>(
        `SELECT COUNT(*) AS c FROM book_versions
         WHERE book_id = ? AND trigger_type = 'auto-idle'`,
        ["book-1"]
      );
      expect(Number(remaining[0].c)).toBe(VERSION_AUTO_PRUNE_KEEP + 1);
    });

    it("never exposes the snapshot field", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", null, '{"secret": true}', 0, "chk-1", "manual", now]
      );

      await useVersionStore.getState().loadVersions("book-1");

      const version = useVersionStore.getState().versions[0];
      expect(version).toBeDefined();
      expect("snapshot" in version).toBe(false);
    });
  });

  describe("getVersionSnapshot", () => {
    it("returns the stored JSON string", async () => {
      const now = Math.floor(Date.now() / 1000);
      const snapshot = '{"book":{"title":"Test"}}';
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", null, snapshot, 0, "chk-1", "manual", now]
      );

      const result = await useVersionStore.getState().getVersionSnapshot("ver-1");
      expect(result).toBe(snapshot);
    });

    it("throws when version is not found", async () => {
      await expect(
        useVersionStore.getState().getVersionSnapshot("missing")
      ).rejects.toThrow("Version not found");
    });
  });

  describe("restoreVersion", () => {
    it("creates a pre-restore version with correct triggerType and name", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "Target",
        triggerType: "manual",
      });

      await useVersionStore.getState().restoreVersion(target!.id, {
        preRestoreName: "Before restoring \"Target\"",
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        `SELECT * FROM book_versions WHERE book_id = ? AND trigger_type = ?`,
        ["book-1", "pre-restore"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Before restoring "Target"');
    });

    it("bumps updatedAt timestamps in the snapshot before applying", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });

      const beforeRestore = Math.floor(Date.now() / 1000);
      await useVersionStore.getState().restoreVersion(target!.id);
      const afterRestore = Math.floor(Date.now() / 1000);

      expect(mockApplyBookSnapshot).toHaveBeenCalledTimes(1);
      const applied = mockApplyBookSnapshot.mock.calls[0][0] as {
        book: { updatedAt: number };
        chapters: Array<{ updatedAt: number }>;
      };

      expect(applied.book.updatedAt).toBeGreaterThanOrEqual(beforeRestore);
      expect(applied.book.updatedAt).toBeLessThanOrEqual(afterRestore);
    });

    it("refreshes version list after restore", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });

      useVersionStore.setState({ currentBookId: "book-1" });
      await useVersionStore.getState().restoreVersion(target!.id);

      // Should have the original + pre-restore versions in state
      expect(useVersionStore.getState().versions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("renameVersion", () => {
    it("updates the name in DB and state", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", "Old Name", "{}", 0, "chk-1", "manual", now]
      );

      useVersionStore.setState({
        currentBookId: "book-1",
        versions: [
          {
            id: "ver-1",
            bookId: "book-1",
            name: "Old Name",
            wordCount: 0,
            checksum: "chk-1",
            triggerType: "manual",
            createdAt: new Date(now * 1000),
            syncedAt: null,
          },
        ],
      });

      await useVersionStore.getState().renameVersion("ver-1", "New Name");

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT name FROM book_versions WHERE id = ?",
        ["ver-1"]
      );
      expect(rows[0].name).toBe("New Name");
      expect(useVersionStore.getState().versions[0].name).toBe("New Name");
    });
  });

  describe("setPage", () => {
    it("loads the requested page for the current book", async () => {
      const baseTime = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 15; i++) {
        await testDb.execute(
          `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `v-${String(i).padStart(3, "0")}`,
            "book-1",
            `v${i}`,
            "{}",
            i,
            `c-${i}`,
            "manual",
            baseTime + i,
          ]
        );
      }

      await useVersionStore.getState().loadVersions("book-1", 1, 10);
      await useVersionStore.getState().setPage(2);

      expect(useVersionStore.getState().currentPage).toBe(2);
      expect(useVersionStore.getState().versions).toHaveLength(5);
    });

    it("is a no-op when no book is loaded", async () => {
      await useVersionStore.getState().setPage(3);
      expect(useVersionStore.getState().currentPage).toBe(1);
    });
  });

  describe("deleteVersion", () => {
    it("removes the row from DB and state", async () => {
      const now = Math.floor(Date.now() / 1000);
      await testDb.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["ver-1", "book-1", null, "{}", 0, "chk-1", "manual", now]
      );

      useVersionStore.setState({
        currentBookId: "book-1",
        versions: [
          {
            id: "ver-1",
            bookId: "book-1",
            name: null,
            wordCount: 0,
            checksum: "chk-1",
            triggerType: "manual",
            createdAt: new Date(now * 1000),
            syncedAt: null,
          },
        ],
      });

      await useVersionStore.getState().deleteVersion("ver-1");

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT * FROM book_versions WHERE id = ?",
        ["ver-1"]
      );
      expect(rows).toHaveLength(0);
      expect(useVersionStore.getState().versions).toHaveLength(0);
    });
  });
});
