import { create } from "zustand";
import { getDatabase } from "@/lib/db";
import { serializeBook, applyBookSnapshot } from "@/features/sync/serializer";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import { computeChecksum } from "@/lib/checksum";
import { VERSION_CLOSE_COALESCE_SECONDS } from "@/constants";
import {
  deleteVersionRows,
  historyBytes,
  insertSplitVersionStatements,
  isVersionUpgradePending,
  withVersionWrites,
  readVersionSnapshot,
} from "@/features/versions/content-store";
import { RETAINED_AUTOMATIC_TRIGGERS, retainVersions } from "@/features/versions/retention";
import type {
  BookVersion,
  CreateVersionInput,
  RestoreOptions,
  VersionTrigger,
} from "@/features/versions/types";
import type { BookSnapshot } from "@/features/sync/types";
import type { AppliedBook } from "@/features/books/write";

export const DEFAULT_VERSIONS_PAGE_SIZE = 10;

export { withVersionWrites };

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Drops the Book's Versions that Version Retention does not keep (ADR 0033),
 * with the content only they referenced. Call inside withVersionWrites.
 * Returns the dropped ids.
 */
export async function applyVersionRetention(
  db: Awaited<ReturnType<typeof getDatabase>>,
  bookId: string,
  now = nowSeconds(),
  { upgrading = false }: { upgrading?: boolean } = {}
): Promise<string[]> {
  // History older than this Release is pruned only by the upgrade, after its
  // safety Backup; until then nothing is dropped.
  if (!upgrading && (await isVersionUpgradePending(db))) return [];
  const rows = await db.select<{ id: string; trigger_type: string; created_at: number }[]>(
    "SELECT id, trigger_type, created_at FROM book_versions WHERE book_id = ?",
    [bookId]
  );
  const keep = retainVersions(
    rows.map((row) => ({ id: row.id, triggerType: row.trigger_type, createdAt: row.created_at })),
    now
  );
  const dropped = rows.filter((row) => !keep.has(row.id)).map((row) => row.id);
  await deleteVersionRows(db, dropped);
  return dropped;
}

/** Remembers that a Version's remote copy must be tombstoned on the next sync. */
async function recordVersionTombstone(
  db: Awaited<ReturnType<typeof getDatabase>>,
  versionId: string,
  bookId: string
): Promise<void> {
  await db.execute(
    "INSERT OR REPLACE INTO version_tombstones (version_id, book_id, deleted_at) VALUES (?, ?, ?)",
    [versionId, bookId, nowSeconds()]
  );
}

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Strip fields that change on every write but don't represent user-meaningful
 * content. Two snapshots with identical text/structure must produce the same
 * dedup hash regardless of when they were saved, otherwise triggers that flush
 * the editor first (e.g. "close") create a fresh version on every fire.
 */
function contentHashInput(snapshot: BookSnapshot): string {
  return JSON.stringify({
    book: {
      id: snapshot.book.id,
      title: snapshot.book.title,
      subtitle: snapshot.book.subtitle,
      authorName: snapshot.book.authorName,
      description: snapshot.book.description,
      genre: snapshot.book.genre,
      language: snapshot.book.language,
      coverImagePath: snapshot.book.coverImagePath,
      coverData: snapshot.book.coverData,
      wordCount: snapshot.book.wordCount,
      targetWordCount: snapshot.book.targetWordCount,
      status: snapshot.book.status,
      lastChapterId: snapshot.book.lastChapterId,
    },
    chapters: snapshot.chapters.map((c) => ({
      id: c.id,
      bookId: c.bookId,
      title: c.title,
      content: c.content,
      synopsis: c.synopsis,
      order: c.order,
      parentId: c.parentId,
      chapterType: c.chapterType,
      wordCount: c.wordCount,
      status: c.status,
      isIncludedInExport: c.isIncludedInExport,
    })),
  });
}

function toVersion(row: Record<string, unknown>): BookVersion {
  return {
    id: row.id as string,
    bookId: row.book_id as string,
    name: row.name as string | null,
    wordCount: row.word_count as number,
    checksum: row.checksum as string,
    triggerType: row.trigger_type as VersionTrigger,
    createdAt: new Date((row.created_at as number) * 1000),
    syncedAt: row.synced_at ? new Date((row.synced_at as number) * 1000) : null,
  };
}

interface VersionStore {
  versions: BookVersion[];
  totalCount: number;
  currentBookId: string | null;
  currentPage: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  /** Bytes the current Book's history takes; null until it is measured. */
  historyBytes: number | null;

  loadVersions: (bookId: string, page?: number, pageSize?: number) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  createVersion: (input: CreateVersionInput) => Promise<BookVersion | null>;
  getVersionSnapshot: (versionId: string) => Promise<string>;
  restoreVersion: (versionId: string, options?: RestoreOptions) => Promise<AppliedBook | undefined>;
  renameVersion: (versionId: string, name: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
}

async function fetchPage(
  bookId: string,
  page: number,
  pageSize: number
): Promise<{ versions: BookVersion[]; totalCount: number; clampedPage: number }> {
  const db = await getDatabase();

  const countRows = await db.select<Record<string, unknown>[]>(
    "SELECT COUNT(*) AS count FROM book_versions WHERE book_id = ?",
    [bookId]
  );
  const totalCount = Number(countRows[0]?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT id, book_id, name, word_count, checksum, trigger_type, created_at, synced_at
     FROM book_versions
     WHERE book_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [bookId, pageSize, offset]
  );

  return {
    versions: rows.map(toVersion),
    totalCount,
    clampedPage,
  };
}

export const useVersionStore = create<VersionStore>((set, get) => ({
  versions: [],
  totalCount: 0,
  currentBookId: null,
  currentPage: 1,
  pageSize: DEFAULT_VERSIONS_PAGE_SIZE,
  isLoading: false,
  error: null,
  historyBytes: null,

  loadVersions: async (bookId, page = 1, pageSize = DEFAULT_VERSIONS_PAGE_SIZE) => {
    // First load of this book in the session applies Version Retention. Page
    // navigation (same currentBookId) skips it.
    const isFirstLoad = get().currentBookId !== bookId;

    set({
      isLoading: true,
      error: null,
      currentBookId: bookId,
      pageSize,
    });

    // Retention is non-fatal: if it fails we still want to render the page.
    if (isFirstLoad) {
      try {
        const db = await getDatabase();
        const pruned = await withVersionWrites(() => applyVersionRetention(db, bookId));
        if (pruned.length > 0) {
          console.info(`[versions] Version Retention dropped ${pruned.length} for book ${bookId}`);
        }
      } catch (err) {
        console.warn("[versions] Version Retention failed:", err);
      }
    }

    try {
      const { versions, totalCount, clampedPage } = await fetchPage(bookId, page, pageSize);
      const bytes = await historyBytes(await getDatabase(), bookId);
      set({
        versions,
        totalCount,
        currentPage: clampedPage,
        isLoading: false,
        historyBytes: bytes,
      });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  setPage: async (page) => {
    const { currentBookId, pageSize } = get();
    if (!currentBookId) return;
    await get().loadVersions(currentBookId, page, pageSize);
  },

  createVersion: (input: CreateVersionInput) =>
    withVersionWrites(async () => {
      const db = await getDatabase();
      const now = nowSeconds();

      // A close Checkpoint right after another Version adds history without
      // adding safety: the Book was just saved (#612).
      if (input.triggerType === "close") {
        const recent = await db.select<{ id: string }[]>(
          "SELECT id FROM book_versions WHERE book_id = ? AND created_at > ? LIMIT 1",
          [input.bookId, now - VERSION_CLOSE_COALESCE_SECONDS]
        );
        if (recent.length > 0) return null;
      }

      const snapshotStr = await serializeBook(input.bookId);
      const snapshot = JSON.parse(snapshotStr) as BookSnapshot;
      // Hash the content-normalized snapshot so flushes that bump updatedAt
      // without changing text don't create new versions.
      const checksum = await computeChecksum(contentHashInput(snapshot));

      // Dedup: skip creation if the most recent version of this book has the
      // same content checksum. Applies across all trigger types.
      const lastVersions = await db.select<Record<string, unknown>[]>(
        `SELECT checksum FROM book_versions
         WHERE book_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [input.bookId]
      );

      if (lastVersions.length > 0 && lastVersions[0].checksum === checksum) {
        return null;
      }

      const id = generateId();
      await db.executeAtomic(
        await insertSplitVersionStatements(
          db,
          {
            id,
            bookId: input.bookId,
            name: input.name ?? null,
            wordCount: snapshot.book.wordCount,
            checksum,
            triggerType: input.triggerType,
            createdAt: now,
            syncedAt: null,
          },
          snapshot
        )
      );

      // Version Retention runs after every automatic Checkpoint. Named
      // Versions, pre-restore, and Plugin Checkpoints are always kept.
      const prunedCount = RETAINED_AUTOMATIC_TRIGGERS.includes(input.triggerType)
        ? (await applyVersionRetention(db, input.bookId, now)).length
        : 0;

      const version: BookVersion = {
        id,
        bookId: input.bookId,
        name: input.name ?? null,
        wordCount: snapshot.book.wordCount,
        checksum,
        triggerType: input.triggerType,
        createdAt: new Date(now * 1000),
        syncedAt: null,
      };

      // Keep the visible page in sync when the user is browsing this book's history.
      // We only mutate the visible slice when the new row would land on page 1
      // (rows are sorted newest-first); other pages get refreshed lazily on navigation.
      set((state) => {
        if (state.currentBookId !== input.bookId) return {};
        const newTotal = state.totalCount + 1 - prunedCount;
        if (state.currentPage === 1) {
          const next = [version, ...state.versions].slice(0, state.pageSize);
          return { versions: next, totalCount: newTotal };
        }
        return { totalCount: newTotal };
      });

      return version;
    }),

  getVersionSnapshot: async (versionId: string) => {
    const db = await getDatabase();
    const stored = await readVersionSnapshot(db, versionId);
    if (!stored) {
      throw new Error("Version not found");
    }
    return JSON.stringify(stored.snapshot);
  },

  restoreVersion: async (versionId: string, options?: RestoreOptions) => {
    // Open editors save first, so the pre-restore version holds the latest text
    // instead of losing it when the restored content replaces the editor. A
    // failed save rejects before anything is touched.
    await flushPendingEdits();
    const db = await getDatabase();

    // Load the target Version, whatever format it is stored in.
    const stored = await readVersionSnapshot(db, versionId);
    if (!stored) {
      throw new Error("Version not found");
    }
    const { bookId, snapshot } = stored;

    // Create pre-restore version
    await useVersionStore.getState().createVersion({
      bookId,
      triggerType: "pre-restore",
      name: options?.preRestoreName,
    });

    // A local apply reads as a fresh local edit (timestamps move to now),
    // persists through the book write path, and emits the local Change so
    // Auto Sync picks the restored book up and open views refresh through the
    // Change Feed. Resolves with the rows as stored.
    const applied = await applyBookSnapshot(snapshot, "local");
    // Re-fetch page 1 so the new pre-restore version is visible on top.
    await useVersionStore.getState().loadVersions(bookId, 1);
    return applied;
  },

  // Version metadata never changes on the sync server, so renaming makes a new
  // Named Version over the same content and tombstones the old one: the name
  // reaches every device, and Version Retention always keeps it (ADR 0033).
  renameVersion: async (versionId: string, name: string) => {
    const db = await getDatabase();
    await withVersionWrites(async () => {
      const rows = await db.select<{ book_id: string }[]>(
        "SELECT book_id FROM book_versions WHERE id = ?",
        [versionId]
      );
      const row = rows[0];
      if (!row) throw new Error("Version not found");
      const id = generateId();
      await db.executeAtomic([
        {
          sql: `INSERT INTO book_versions
                  (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at, format)
                SELECT ?, book_id, ?, snapshot, word_count, checksum, 'manual', created_at, NULL, format
                FROM book_versions WHERE id = ?`,
          params: [id, name, versionId],
        },
        {
          sql: `INSERT INTO book_version_chapters (version_id, chapter_id, position, content_hash, meta)
                SELECT ?, chapter_id, position, content_hash, meta
                FROM book_version_chapters WHERE version_id = ?`,
          params: [id, versionId],
        },
        {
          sql: `INSERT INTO book_version_assets (version_id, role, hash)
                SELECT ?, role, hash FROM book_version_assets WHERE version_id = ?`,
          params: [id, versionId],
        },
      ]);
      await deleteVersionRows(db, [versionId]);
      // Always: a push may still be uploading it, and tombstoning a key the
      // server never had only leaves a small deleted row.
      await recordVersionTombstone(db, versionId, row.book_id);
    });

    const { currentBookId, currentPage, pageSize } = get();
    if (currentBookId) await get().loadVersions(currentBookId, currentPage, pageSize);
  },

  deleteVersion: async (versionId: string) => {
    const db = await getDatabase();
    await withVersionWrites(async () => {
      const rows = await db.select<{ book_id: string }[]>(
        "SELECT book_id FROM book_versions WHERE id = ?",
        [versionId]
      );
      await deleteVersionRows(db, [versionId]);
      const row = rows[0];
      // Without the tombstone the next sync would pull the Version back, even
      // one whose push is still uploading.
      if (row) await recordVersionTombstone(db, versionId, row.book_id);
    });

    // Reload the current page so totalCount and the visible slice stay correct
    // (the page may now have one fewer row, or we may have dropped off the last page).
    const { currentBookId, currentPage, pageSize } = get();
    if (currentBookId) {
      await get().loadVersions(currentBookId, currentPage, pageSize);
    } else {
      set((state) => ({
        versions: state.versions.filter((v) => v.id !== versionId),
        totalCount: Math.max(0, state.totalCount - 1),
      }));
    }
  },
}));
