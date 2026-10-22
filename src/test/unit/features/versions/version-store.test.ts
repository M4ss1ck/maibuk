import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import type { BookSnapshot } from "@/features/sync/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { retainVersions } from "@/features/versions/retention";
import {
  convertInlineVersions,
  insertSplitVersionStatements,
  readVersionSnapshot,
  type VersionRowInput,
} from "@/features/versions/content-store";
import { PendingEditsFlushError, registerPendingEditsFlush } from "@/features/sync/pending-edits";

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

const { useVersionStore, applyVersionRetention, withVersionWrites } = await import(
  "@/features/versions/store"
);

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

// Retention bins are UTC days and weeks counted from the epoch, so every seeded
// age is measured against this fixed instant.
const NOW_MS = Date.UTC(2026, 9, 22, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);
const DAY = 24 * 60 * 60;

interface SeededVersion {
  id: string;
  triggerType: string;
  createdAt: number;
}

/** A Book with one chapter per entry; the snapshot a split Version stores. */
function makeChapterSnapshot(chapters: Array<{ id: string; content: string }>): string {
  const base = JSON.parse(makeSnapshot(2000, 1000));
  base.chapters = chapters.map((chapter, order) => ({
    id: chapter.id,
    bookId: "book-1",
    title: chapter.id,
    content: chapter.content,
    synopsis: null,
    order,
    parentId: null,
    chapterType: "chapter",
    wordCount: 1000,
    status: "draft",
    isIncludedInExport: true,
    createdAt: 1000,
    updatedAt: 1000,
  }));
  return JSON.stringify(base);
}

/** The retention rule's kept set over `candidates`, sorted, for comparing with the DB. */
function expectedKept(candidates: SeededVersion[]): string[] {
  return [...retainVersions(candidates, NOW)].sort();
}

/**
 * Stores a Version the way the app does now: a split manifest with format
 * 'split'. A raw INSERT would leave format at its 'inline' default, which
 * holds every Version back until the upgrade has converted it.
 */
async function insertSplitRow(
  db: DatabaseAdapter,
  row: VersionRowInput,
  snapshotJson: string
): Promise<void> {
  await db.executeAtomic(
    await insertSplitVersionStatements(db, row, JSON.parse(snapshotJson) as BookSnapshot)
  );
}

describe("useVersionStore", () => {
  let testDb: DatabaseAdapter;

  /** Stores a split Version on book-1, the way the app saves one. */
  async function seedVersion(
    id: string,
    triggerType: string,
    createdAt: number,
    extra: { name?: string | null; syncedAt?: number | null; checksum?: string } = {}
  ): Promise<SeededVersion> {
    await insertSplitRow(
      testDb,
      {
        id,
        bookId: "book-1",
        name: extra.name ?? null,
        wordCount: 1000,
        checksum: extra.checksum ?? `chk-${id}`,
        triggerType,
        createdAt,
        syncedAt: extra.syncedAt ?? null,
      },
      makeSnapshot(1000, createdAt)
    );
    return { id, triggerType, createdAt };
  }

  /** Ids of every Version the Book holds in the DB, sorted. */
  async function keptIds(): Promise<string[]> {
    const rows = await testDb.select<{ id: string }[]>(
      "SELECT id FROM book_versions WHERE book_id = ?",
      ["book-1"]
    );
    return rows.map((r) => r.id).sort();
  }

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await seedBook(testDb);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_MS);
    mockSerializeBook.mockReset();
    mockApplyBookSnapshot.mockReset();
    // applyBookSnapshot resolves with the rows as stored; restore reads the
    // applied book id off it to refresh the views.
    mockApplyBookSnapshot.mockResolvedValue({ book: { id: "book-1" }, chapters: [] });

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

  afterEach(() => {
    vi.useRealTimers();
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
      expect(rows[0].format).toBe("split");
      expect(rows[0].trigger_type).toBe("manual");
      // The stored `snapshot` is the split form with chapterCount; the Book it
      // rebuilds is the one that was saved.
      expect((await readVersionSnapshot(testDb, version!.id))?.snapshot).toEqual(
        JSON.parse(snapshot)
      );
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
      // First snapshot at updatedAt=1000. auto-idle, not close: a close inside
      // 10 minutes of another Version is coalesced, which would hide the dedup.
      mockSerializeBook.mockResolvedValueOnce(makeSnapshot(1000, 1000));
      const v1 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "auto-idle",
      });
      expect(v1).not.toBeNull();

      // Same content, fresh updatedAt — simulates a flush that bumps chapter
      // timestamps without any real text change.
      mockSerializeBook.mockResolvedValueOnce(makeSnapshot(1000, 9999));
      const v2 = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "auto-idle",
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

    describe("Version Retention", () => {
      /** One automatic Version per day, `count` days back, an hour before each day mark. */
      async function seedDailyHistory(trigger: string, count: number): Promise<SeededVersion[]> {
        const seeded: SeededVersion[] = [];
        for (let k = 0; k < count; k++) {
          seeded.push(await seedVersion(`${trigger}-day-${k}`, trigger, NOW - k * DAY - 3600));
        }
        return seeded;
      }

      it("keeps what retainVersions keeps when an auto-idle Version lands on a 30-day history", async () => {
        const seeded = await seedDailyHistory("auto-idle", 30);
        useVersionStore.setState({ currentBookId: "book-1", totalCount: seeded.length });
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        expect(version).not.toBeNull();
        const kept = await keptIds();
        expect(kept).toEqual(
          expectedKept([...seeded, { id: version!.id, triggerType: "auto-idle", createdAt: NOW }])
        );
        expect(kept.length).toBeLessThan(seeded.length + 1);
        expect(useVersionStore.getState().totalCount).toBe(kept.length);
      });

      it("keeps the newest 10 automatic Versions of the last day when 20 sit inside the last hour", async () => {
        const seeded: SeededVersion[] = [];
        for (let i = 0; i < 20; i++) {
          seeded.push(await seedVersion(`hour-${i}`, "auto-idle", NOW - (i + 1) * 60));
        }
        useVersionStore.setState({ currentBookId: "book-1", totalCount: seeded.length });
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        const kept = await keptIds();
        expect(kept).toEqual(
          expectedKept([...seeded, { id: version!.id, triggerType: "auto-idle", createdAt: NOW }])
        );
        expect(kept).toHaveLength(10);
        expect(useVersionStore.getState().totalCount).toBe(10);
      });

      it("prunes a large auto-idle backlog to the retention rule in one insert", async () => {
        const seeded: SeededVersion[] = [];
        for (let i = 0; i < 100; i++) {
          seeded.push(await seedVersion(`backlog-${i}`, "auto-idle", NOW - i * 3600 - 60));
        }
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        const kept = await keptIds();
        expect(kept).toEqual(
          expectedKept([...seeded, { id: version!.id, triggerType: "auto-idle", createdAt: NOW }])
        );
        expect(kept.length).toBeLessThan(seeded.length + 1);
      });

      it("never prunes manual or pre-restore versions", async () => {
        const baseTime = NOW - 10000;
        for (const trigger of ["manual", "pre-restore"] as const) {
          await seedVersion(`keep-${trigger}`, trigger, baseTime, { name: `keep-${trigger}` });
        }
        await seedDailyHistory("auto-idle", 30);
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        const kept = await keptIds();
        expect(kept).toContain("keep-manual");
        expect(kept).toContain("keep-pre-restore");
      });

      it("does not prune when the trigger type is manual", async () => {
        const seeded = await seedDailyHistory("auto-idle", 30);
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          name: "Important draft",
          triggerType: "manual",
        });

        // A manual Version runs no retention: the 30 automatic rows stay, plus the new one.
        const kept = await keptIds();
        expect(kept).toHaveLength(seeded.length + 1);
        for (const v of seeded) expect(kept).toContain(v.id);
      });

      it("prunes close-trigger backlog when a new close version is inserted", async () => {
        const seeded: SeededVersion[] = [];
        for (let i = 0; i < 50; i++) {
          seeded.push(
            await seedVersion(`close-${String(i).padStart(4, "0")}`, "close", NOW - 50_000 + i)
          );
        }
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "close",
        });

        expect(version).not.toBeNull();
        const kept = await keptIds();
        expect(kept).toEqual(
          expectedKept([...seeded, { id: version!.id, triggerType: "close", createdAt: NOW }])
        );
        expect(kept.length).toBeLessThan(seeded.length + 1);
      });

      it("prunes pre-sync backlog when a new pre-sync version is inserted", async () => {
        const seeded: SeededVersion[] = [];
        for (let i = 0; i < 30; i++) {
          seeded.push(
            await seedVersion(`psync-${String(i).padStart(4, "0")}`, "pre-sync", NOW - 50_000 + i)
          );
        }
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "pre-sync",
        });

        expect(version).not.toBeNull();
        const kept = await keptIds();
        expect(kept).toEqual(
          expectedKept([...seeded, { id: version!.id, triggerType: "pre-sync", createdAt: NOW }])
        );
        expect(kept.length).toBeLessThan(seeded.length + 1);
      });

      it("never prunes plugin Versions, like manual and pre-restore", async () => {
        const baseTime = Math.floor(Date.now() / 1000) - 50_000;
        for (let i = 0; i < 30; i++) {
          await insertSplitRow(
            testDb,
            {
              id: `plugin-${String(i).padStart(4, "0")}`,
              bookId: "book-1",
              name: "Plugin checkpoint",
              wordCount: i,
              checksum: `plugin-${i}`,
              triggerType: "plugin",
              createdAt: baseTime + i,
              syncedAt: null,
            },
            makeSnapshot(i, baseTime + i)
          );
        }
        await insertSplitRow(
          testDb,
          {
            id: "manual-keepme",
            bookId: "book-1",
            name: "Important",
            wordCount: 0,
            checksum: "manual-chk",
            triggerType: "manual",
            createdAt: baseTime + 10_000,
            syncedAt: null,
          },
          makeSnapshot(0, baseTime + 10_000)
        );

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, Date.now()));

        await useVersionStore.getState().createVersion({
          bookId: "book-1",
          name: "Plugin checkpoint",
          triggerType: "plugin",
        });

        const pluginRows = await testDb.select<Record<string, unknown>[]>(
          `SELECT COUNT(*) AS c FROM book_versions
           WHERE book_id = ? AND trigger_type = 'plugin'`,
          ["book-1"]
        );
        // A Plugin Checkpoint is a safety breadcrumb, so it stays uncapped:
        // checksum dedup is what keeps a chatty Plugin from spamming history.
        expect(Number(pluginRows[0].c)).toBe(31);

        const manualRows = await testDb.select<Record<string, unknown>[]>(
          "SELECT id FROM book_versions WHERE id = ?",
          ["manual-keepme"]
        );
        expect(manualRows).toHaveLength(1);
      });

      it("runs one rule across both automatic triggers instead of a quota per trigger", async () => {
        const seeded: SeededVersion[] = [];
        for (let i = 0; i < 20; i++) {
          seeded.push(await seedVersion(`auto-${i}`, "auto-idle", NOW - 3600 - i * 60));
          seeded.push(await seedVersion(`close-${i}`, "close", NOW - 7200 - i * 60));
        }
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "close",
        });

        expect(version).not.toBeNull();
        const kept = await keptIds();
        expect(kept).toEqual(
          expectedKept([...seeded, { id: version!.id, triggerType: "close", createdAt: NOW }])
        );
        // The newest 10 automatic Versions of the last day, whatever their trigger.
        expect(kept).toHaveLength(10);
      });

      it("only prunes automatic Versions belonging to the same book", async () => {
        await seedBook(testDb, "book-2");
        const baseTime = NOW - 100;
        for (let i = 0; i < 3; i++) {
          await insertSplitRow(
            testDb,
            {
              id: `other-${i}`,
              bookId: "book-2",
              name: null,
              wordCount: i,
              checksum: `o-${i}`,
              triggerType: "auto-idle",
              createdAt: baseTime + i,
              syncedAt: null,
            },
            makeSnapshot(i, baseTime + i)
          );
        }
        await seedDailyHistory("auto-idle", 40);

        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

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

      it("keeps manual, pre-restore and plugin Versions 200 days old through createVersion and loadVersions", async () => {
        const old = NOW - 200 * DAY;
        for (const trigger of ["manual", "pre-restore", "plugin"] as const) {
          for (let i = 0; i < 2; i++) {
            await seedVersion(`${trigger}-old-${i}`, trigger, old - i * 60);
          }
        }
        for (let k = 0; k < 30; k++) {
          await seedVersion(`auto-old-${k}`, "auto-idle", old - k * DAY);
        }
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });
        expect(version).not.toBeNull();

        const countByTrigger = async () =>
          Object.fromEntries(
            (
              await testDb.select<{ trigger_type: string; c: number }[]>(
                "SELECT trigger_type, COUNT(*) AS c FROM book_versions WHERE book_id = ? GROUP BY trigger_type",
                ["book-1"]
              )
            ).map((r) => [r.trigger_type, Number(r.c)])
          );

        // Retention drops the 200-day-old automatic rows, and only those.
        const afterCreate = await countByTrigger();
        expect(afterCreate.manual).toBe(2);
        expect(afterCreate["pre-restore"]).toBe(2);
        expect(afterCreate.plugin).toBe(2);
        expect(afterCreate["auto-idle"]).toBe(1);

        await useVersionStore.getState().loadVersions("book-1");

        const afterLoad = await countByTrigger();
        expect(afterLoad.manual).toBe(2);
        expect(afterLoad["pre-restore"]).toBe(2);
        expect(afterLoad.plugin).toBe(2);
      });
    });

    describe("while an inline Version waits for the upgrade", () => {
      /** Thirty daily automatic Versions on book-1: more than the rule keeps. */
      async function seedThirtyDays(): Promise<SeededVersion[]> {
        const seeded: SeededVersion[] = [];
        for (let k = 0; k < 30; k++) {
          seeded.push(await seedVersion(`gate-day-${k}`, "auto-idle", NOW - k * DAY - 3600));
        }
        return seeded;
      }

      /** One inline row on another Book: the upgrade gate is Library-wide. */
      async function seedInlineRowOnOtherBook(): Promise<void> {
        await seedBook(testDb, "book-2");
        await testDb.execute(
          `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "inline-other",
            "book-2",
            null,
            makeSnapshot(1000, NOW),
            1000,
            "chk-inline",
            "manual",
            NOW,
            null,
          ]
        );
      }

      it("createVersion and loadVersions drop nothing, and retention resumes once the upgrade converts the row", async () => {
        const seeded = await seedThirtyDays();
        await seedInlineRowOnOtherBook();
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const first = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });
        expect(first).not.toBeNull();
        const everything = [...seeded.map((s) => s.id), first!.id].sort();
        expect(await keptIds()).toEqual(everything);

        await useVersionStore.getState().loadVersions("book-1");
        expect(await keptIds()).toEqual(everything);

        expect(await convertInlineVersions(testDb, 10)).toBe(1);

        mockSerializeBook.mockResolvedValue(makeSnapshot(9998, NOW));
        const second = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });
        expect(second).not.toBeNull();
        const afterUpgrade: SeededVersion[] = [
          ...seeded,
          { id: first!.id, triggerType: "auto-idle", createdAt: NOW },
          { id: second!.id, triggerType: "auto-idle", createdAt: NOW },
        ];
        expect(await keptIds()).toEqual(expectedKept(afterUpgrade));
        expect((await keptIds()).length).toBeLessThan(afterUpgrade.length);
      });

      it("applyVersionRetention drops only when called as the upgrade, even with an inline row present", async () => {
        const seeded = await seedThirtyDays();
        await seedInlineRowOnOtherBook();

        const held = await withVersionWrites(() => applyVersionRetention(testDb, "book-1", NOW));
        expect(held).toEqual([]);
        expect(await keptIds()).toEqual(seeded.map((s) => s.id).sort());

        const dropped = await withVersionWrites(() =>
          applyVersionRetention(testDb, "book-1", NOW, { upgrading: true })
        );
        expect(dropped.length).toBeGreaterThan(0);
        expect(await keptIds()).toEqual(expectedKept(seeded));
      });
    });

    describe("close coalescing", () => {
      it("skips a close Version when the Book has a Version created 5 minutes ago", async () => {
        await seedVersion("recent", "auto-idle", NOW - 300);
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "close",
        });

        expect(version).toBeNull();
        expect(await keptIds()).toEqual(["recent"]);
      });

      it("creates a close Version once the newest Version is 11 minutes old", async () => {
        await seedVersion("older", "auto-idle", NOW - 660);
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "close",
        });

        expect(version).not.toBeNull();
        expect(await keptIds()).toHaveLength(2);
      });

      it("never coalesces an auto-idle Version", async () => {
        await seedVersion("recent", "auto-idle", NOW - 300);
        mockSerializeBook.mockResolvedValue(makeSnapshot(9999, NOW));

        const version = await useVersionStore.getState().createVersion({
          bookId: "book-1",
          triggerType: "auto-idle",
        });

        expect(version).not.toBeNull();
        expect(await keptIds()).toHaveLength(2);
      });
    });

    it("stores a new Version in the split format with one manifest row per Chapter", async () => {
      mockSerializeBook.mockResolvedValue(
        makeChapterSnapshot([
          { id: "ch-1", content: "<p>First chapter</p>" },
          { id: "ch-2", content: "<p>Second chapter</p>" },
        ])
      );

      const version = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        name: "Split",
        triggerType: "manual",
      });

      expect(version).not.toBeNull();
      const rows = await testDb.select<{ format: string }[]>(
        "SELECT format FROM book_versions WHERE id = ?",
        [version!.id]
      );
      expect(rows[0].format).toBe("split");

      const manifest = await testDb.select<
        { chapter_id: string; position: number; content_hash: string | null }[]
      >(
        "SELECT chapter_id, position, content_hash FROM book_version_chapters WHERE version_id = ? ORDER BY position",
        [version!.id]
      );
      expect(manifest.map((r) => [r.chapter_id, r.position])).toEqual([
        ["ch-1", 0],
        ["ch-2", 1],
      ]);
      expect(manifest.every((r) => r.content_hash !== null)).toBe(true);

      const restored = JSON.parse(
        await useVersionStore.getState().getVersionSnapshot(version!.id)
      ) as { chapters: { id: string; content: string }[] };
      expect(restored.chapters.map((c) => [c.id, c.content])).toEqual([
        ["ch-1", "<p>First chapter</p>"],
        ["ch-2", "<p>Second chapter</p>"],
      ]);
    });

    it("creates exactly one Version when two identical saves run concurrently", async () => {
      mockSerializeBook.mockResolvedValue(makeSnapshot(1000, NOW));
      const store = useVersionStore.getState();

      const results = await Promise.all([
        store.createVersion({ bookId: "book-1", triggerType: "manual" }),
        store.createVersion({ bookId: "book-1", triggerType: "manual" }),
      ]);

      expect(results.filter((v) => v !== null)).toHaveLength(1);
      expect(await keptIds()).toHaveLength(1);
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

    /** Close and pre-sync Versions, three a day for ten days starting 40 days back. */
    async function seedOldBacklog(): Promise<SeededVersion[]> {
      const seeded: SeededVersion[] = [];
      for (let d = 40; d < 50; d++) {
        for (let j = 0; j < 3; j++) {
          seeded.push(await seedVersion(`close-${d}-${j}`, "close", NOW - d * DAY - j * 600));
          seeded.push(
            await seedVersion(`psync-${d}-${j}`, "pre-sync", NOW - d * DAY - j * 600 - 60)
          );
        }
      }
      return seeded;
    }

    it("drops on the first load of a Book what Version Retention does not keep", async () => {
      const seeded = await seedOldBacklog();

      await useVersionStore.getState().loadVersions("book-1");

      const kept = await keptIds();
      expect(kept).toEqual(expectedKept(seeded));
      expect(kept.length).toBeLessThan(seeded.length);
      expect(useVersionStore.getState().totalCount).toBe(kept.length);
    });

    it("does not prune again on a page change for the same Book", async () => {
      const seeded = await seedOldBacklog();
      await useVersionStore.getState().loadVersions("book-1");
      const afterFirstLoad = await keptIds();

      // Same week as the oldest backlog rows and older than their newest, so
      // retention would drop it if it ran again.
      const late = await seedVersion("late-old", "auto-idle", NOW - 40 * DAY - 5);
      expect(expectedKept([...seeded, late])).not.toContain("late-old");

      await useVersionStore.getState().setPage(2);

      expect(await keptIds()).toEqual([...afterFirstLoad, "late-old"].sort());
    });

    it("opportunistically prunes auto-idle backlog on the first load per book", async () => {
      const seeded: SeededVersion[] = [];
      for (let i = 0; i < 100; i++) {
        seeded.push(
          await seedVersion(`legacy-${String(i).padStart(4, "0")}`, "auto-idle", NOW - 100_000 + i)
        );
      }

      await useVersionStore.getState().loadVersions("book-1", 1, 10);

      const kept = await keptIds();
      expect(kept).toEqual(expectedKept(seeded));
      expect(kept.length).toBeLessThan(seeded.length);
      expect(useVersionStore.getState().totalCount).toBe(kept.length);
    });

    it("prunes ALL automatic trigger backlogs (auto-idle, close, pre-sync) on first load", async () => {
      const baseTime = NOW - 100_000;
      const seeded: SeededVersion[] = [];
      const seed = async (trigger: string, count: number, prefix: string) => {
        for (let i = 0; i < count; i++) {
          seeded.push(
            await seedVersion(`${prefix}-${String(i).padStart(4, "0")}`, trigger, baseTime + i)
          );
        }
      };
      // Mirror the user's actual situation: thousands of "close" rows + a manual
      // that must NOT be pruned.
      await seed("auto-idle", 50, "ai");
      await seed("close", 8500, "cl");
      await seed("pre-sync", 35, "ps");
      seeded.push(
        await seedVersion("manual-keepme", "manual", baseTime + 10_000, { name: "Important" })
      );

      await useVersionStore.getState().loadVersions("book-1", 1, 10);

      const kept = await keptIds();
      expect(kept).toEqual(expectedKept(seeded));
      expect(kept).toContain("manual-keepme");

      const counts = await testDb.select<Record<string, unknown>[]>(
        `SELECT trigger_type, COUNT(*) AS c FROM book_versions
         WHERE book_id = ? GROUP BY trigger_type`,
        ["book-1"]
      );
      const byTrigger = Object.fromEntries(
        counts.map((r) => [r.trigger_type as string, Number(r.c)])
      );
      // Retention ranks all automatic triggers together, so a trigger whose
      // rows are all older than a newer bin-mate can drop to zero.
      expect(byTrigger["auto-idle"] ?? 0).toBeLessThan(50);
      expect(byTrigger.close ?? 0).toBeLessThan(8500);
      expect(byTrigger["pre-sync"] ?? 0).toBeLessThan(35);
      expect(byTrigger.manual).toBe(1);
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
      await expect(useVersionStore.getState().getVersionSnapshot("missing")).rejects.toThrow(
        "Version not found"
      );
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
        preRestoreName: 'Before restoring "Target"',
      });

      const rows = await testDb.select<Record<string, unknown>[]>(
        `SELECT * FROM book_versions WHERE book_id = ? AND trigger_type = ?`,
        ["book-1", "pre-restore"]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Before restoring "Target"');
    });

    it("hands the stored snapshot to the local snapshot apply", async () => {
      const targetSnapshot = makeSnapshot(1000, 1000);
      const currentSnapshot = makeSnapshot(1200, 2000);

      mockSerializeBook
        .mockResolvedValueOnce(targetSnapshot)
        .mockResolvedValueOnce(currentSnapshot);

      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });

      await useVersionStore.getState().restoreVersion(target!.id);

      // Timestamp bumps and the local Change live in the snapshot write path
      // (covered with a live serializer in the restore integration test);
      // restore owns routing the stored snapshot through it as local.
      expect(mockApplyBookSnapshot).toHaveBeenCalledTimes(1);
      const [snapshotArg, origin] = mockApplyBookSnapshot.mock.calls[0];
      expect(snapshotArg).toEqual(JSON.parse(targetSnapshot));
      expect(origin).toBe("local");
    });

    it("lands pending editor saves before taking the pre-restore version", async () => {
      mockSerializeBook.mockResolvedValue(makeSnapshot(1000, 1000));
      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      mockSerializeBook.mockClear();
      const flush = vi.fn();
      const unregister = registerPendingEditsFlush(flush);

      try {
        await useVersionStore.getState().restoreVersion(target!.id);
      } finally {
        unregister();
      }

      expect(flush).toHaveBeenCalledTimes(1);
      // The pre-restore version serializes the book; it must include the flushed text.
      expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
        mockSerializeBook.mock.invocationCallOrder[0]
      );
    });

    it("leaves the book untouched when a pending editor save fails", async () => {
      mockSerializeBook.mockResolvedValue(makeSnapshot(1000, 1000));
      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      const unregister = registerPendingEditsFlush(() => Promise.reject(new Error("disk full")));

      try {
        await expect(useVersionStore.getState().restoreVersion(target!.id)).rejects.toBeInstanceOf(
          PendingEditsFlushError
        );
      } finally {
        unregister();
      }

      expect(mockApplyBookSnapshot).not.toHaveBeenCalled();
      const preRestore = await testDb.select<Record<string, unknown>[]>(
        `SELECT id FROM book_versions WHERE trigger_type = 'pre-restore'`
      );
      expect(preRestore).toHaveLength(0);
    });

    it("applies the restored snapshot as a local change so Auto Sync picks it up", async () => {
      mockSerializeBook.mockResolvedValue(makeSnapshot(1000, 1000));
      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      // The snapshot apply itself is mocked here; what this owns is routing
      // the restore through it as a local apply. The real local emission is
      // covered by the restore integration test with a live serializer.
      await useVersionStore.getState().restoreVersion(target!.id);

      expect(mockApplyBookSnapshot).toHaveBeenCalled();
      const [, origin] = mockApplyBookSnapshot.mock.calls[0];
      expect(origin).toBe("local");
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

    it("leaves Plugin storage untouched", async () => {
      mockSerializeBook.mockResolvedValue(makeSnapshot(1000, 1000));
      const target = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      await testDb.execute(
        `INSERT INTO plugin_storage (plugin_id, "key", "value", updated_at)
         VALUES ('echoes', 'ignored', '["chapter-1"]', 1)`
      );
      await testDb.execute(
        `INSERT INTO plugin_data_versions (plugin_id, data_version, updated_at)
         VALUES ('echoes', 2, 1)`
      );

      await useVersionStore.getState().restoreVersion(target!.id);

      const values = await testDb.select<Record<string, unknown>[]>(
        `SELECT plugin_id, "key", "value" FROM plugin_storage`
      );
      expect(values).toEqual([{ plugin_id: "echoes", key: "ignored", value: '["chapter-1"]' }]);
      const versions = await testDb.select<Record<string, unknown>[]>(
        "SELECT plugin_id, data_version FROM plugin_data_versions"
      );
      expect(versions).toEqual([{ plugin_id: "echoes", data_version: 2 }]);
    });
  });

  describe("renameVersion", () => {
    it("replaces a synced Version with a manual copy under the new name and tombstones the old id", async () => {
      const created = NOW - 3600;
      const snapshot = makeSnapshot(1000, created);
      await seedVersion("ver-1", "auto-idle", created, { syncedAt: NOW - 100, checksum: "chk-1" });
      useVersionStore.setState({ currentBookId: "book-1" });

      await useVersionStore.getState().renameVersion("ver-1", "Named draft");

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT id, name, trigger_type, created_at, checksum, synced_at FROM book_versions WHERE book_id = ?",
        ["book-1"]
      );
      expect(rows).toHaveLength(1);
      const renamed = rows[0];
      expect(renamed.id).not.toBe("ver-1");
      expect(renamed.name).toBe("Named draft");
      expect(renamed.trigger_type).toBe("manual");
      expect(renamed.created_at).toBe(created);
      expect(renamed.checksum).toBe("chk-1");
      expect(renamed.synced_at).toBeNull();

      const tombstones = await testDb.select<Record<string, unknown>[]>(
        "SELECT version_id, book_id FROM version_tombstones"
      );
      expect(tombstones).toEqual([{ version_id: "ver-1", book_id: "book-1" }]);

      expect(await useVersionStore.getState().getVersionSnapshot(renamed.id as string)).toBe(
        snapshot
      );
      expect(useVersionStore.getState().versions.map((v) => v.name)).toEqual(["Named draft"]);
    });

    it("records a tombstone even when the renamed Version was never synced", async () => {
      await seedVersion("ver-2", "auto-idle", NOW - 3600);

      await useVersionStore.getState().renameVersion("ver-2", "Local only");

      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT name, trigger_type, synced_at FROM book_versions WHERE book_id = ?",
        ["book-1"]
      );
      expect(rows).toEqual([{ name: "Local only", trigger_type: "manual", synced_at: null }]);
      // A push may be uploading the old id right now, so the tombstone is
      // recorded whether or not this device ever synced it.
      const tombstones = await testDb.select<Record<string, unknown>[]>(
        "SELECT version_id, book_id FROM version_tombstones"
      );
      expect(tombstones).toEqual([{ version_id: "ver-2", book_id: "book-1" }]);
    });

    it("rejects when the Version does not exist", async () => {
      await expect(useVersionStore.getState().renameVersion("missing", "Nope")).rejects.toThrow(
        "Version not found"
      );
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

    it("records a tombstone and drops the manifest rows of a synced split Version", async () => {
      mockSerializeBook.mockResolvedValue(
        makeChapterSnapshot([
          { id: "ch-1", content: "<p>First</p>" },
          { id: "ch-2", content: "<p>Second</p>" },
        ])
      );
      const version = await useVersionStore.getState().createVersion({
        bookId: "book-1",
        triggerType: "manual",
      });
      await testDb.execute("UPDATE book_versions SET synced_at = ? WHERE id = ?", [
        NOW - 100,
        version!.id,
      ]);
      const manifestBefore = await testDb.select<Record<string, unknown>[]>(
        "SELECT chapter_id FROM book_version_chapters WHERE version_id = ?",
        [version!.id]
      );
      expect(manifestBefore).toHaveLength(2);

      await useVersionStore.getState().deleteVersion(version!.id);

      const tombstones = await testDb.select<Record<string, unknown>[]>(
        "SELECT version_id, book_id FROM version_tombstones"
      );
      expect(tombstones).toEqual([{ version_id: version!.id, book_id: "book-1" }]);
      const manifestAfter = await testDb.select<Record<string, unknown>[]>(
        "SELECT chapter_id FROM book_version_chapters WHERE version_id = ?",
        [version!.id]
      );
      expect(manifestAfter).toEqual([]);
      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT id FROM book_versions WHERE id = ?",
        [version!.id]
      );
      expect(rows).toEqual([]);
    });

    it("records a tombstone even when the deleted Version was never synced", async () => {
      await seedVersion("ver-unsynced", "manual", NOW - 60);

      await useVersionStore.getState().deleteVersion("ver-unsynced");

      const tombstones = await testDb.select<Record<string, unknown>[]>(
        "SELECT version_id, book_id FROM version_tombstones"
      );
      expect(tombstones).toEqual([{ version_id: "ver-unsynced", book_id: "book-1" }]);
      const rows = await testDb.select<Record<string, unknown>[]>(
        "SELECT id FROM book_versions WHERE id = ?",
        ["ver-unsynced"]
      );
      expect(rows).toEqual([]);
    });
  });
});
