import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import { serializeBook, applyBookSnapshot } from "../sync/serializer";
import { computeChecksum } from "../../lib/checksum";
import { VERSION_AUTO_PRUNE_KEEP } from "../../constants";
import type {
  BookVersion,
  CreateVersionInput,
  RestoreOptions,
  VersionTrigger,
} from "./types";
import type { BookSnapshot } from "../sync/types";

export const DEFAULT_VERSIONS_PAGE_SIZE = 10;

// Trigger types that represent automatic/system-generated snapshots and are
// subject to the retention cap. Manual stays uncapped (explicit user intent);
// pre-restore stays uncapped (safety breadcrumbs around destructive operations).
const PRUNABLE_TRIGGERS = ["auto-idle", "close", "pre-sync"] as const;
type PrunableTrigger = (typeof PRUNABLE_TRIGGERS)[number];

function isPrunable(trigger: VersionTrigger): trigger is PrunableTrigger {
  return (PRUNABLE_TRIGGERS as readonly string[]).includes(trigger);
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

  loadVersions: (bookId: string, page?: number, pageSize?: number) => Promise<void>;
  setPage: (page: number) => Promise<void>;
  createVersion: (input: CreateVersionInput) => Promise<BookVersion | null>;
  getVersionSnapshot: (versionId: string) => Promise<string>;
  restoreVersion: (versionId: string, options?: RestoreOptions) => Promise<void>;
  renameVersion: (versionId: string, name: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
}

async function pruneTriggerType(
  db: Awaited<ReturnType<typeof getDatabase>>,
  bookId: string,
  trigger: PrunableTrigger,
  keep: number
): Promise<number> {
  // Find the cutoff — the (keep+1)th most-recent row of this trigger type.
  // Anything older (or tied at the same created_at with a smaller id) is excess.
  //
  // Two-step (SELECT cutoff → DELETE everything past it) to avoid SQLite-isms
  // like `LIMIT -1` or `DELETE … WHERE id IN (SELECT …)` patterns that some
  // drivers (notably tauri-plugin-sql via sqlx) handle inconsistently.
  const cutoffRows = await db.select<Array<{ created_at: number; id: string }>>(
    `SELECT created_at, id FROM book_versions
     WHERE book_id = ? AND trigger_type = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1 OFFSET ?`,
    [bookId, trigger, keep]
  );

  if (cutoffRows.length === 0) {
    return 0;
  }

  const cutoff = cutoffRows[0];
  const result = await db.execute(
    `DELETE FROM book_versions
     WHERE book_id = ?
       AND trigger_type = ?
       AND (created_at < ? OR (created_at = ? AND id <= ?))`,
    [bookId, trigger, cutoff.created_at, cutoff.created_at, cutoff.id]
  );
  return result.rowsAffected ?? 0;
}

async function pruneAllAutoTriggers(
  db: Awaited<ReturnType<typeof getDatabase>>,
  bookId: string,
  keep: number
): Promise<number> {
  let total = 0;
  for (const trigger of PRUNABLE_TRIGGERS) {
    total += await pruneTriggerType(db, bookId, trigger, keep);
  }
  return total;
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

  loadVersions: async (bookId, page = 1, pageSize = DEFAULT_VERSIONS_PAGE_SIZE) => {
    // First load of this book in the session → opportunistically prune the
    // auto-idle backlog. Page navigation (same currentBookId) skips this.
    const isFirstLoad = get().currentBookId !== bookId;

    set({
      isLoading: true,
      error: null,
      currentBookId: bookId,
      pageSize,
    });

    // Prune is non-fatal: if it fails we still want to render the page.
    if (isFirstLoad) {
      try {
        const db = await getDatabase();
        const pruned = await pruneAllAutoTriggers(db, bookId, VERSION_AUTO_PRUNE_KEEP);
        if (pruned > 0) {
          console.info(
            `[versions] Pruned ${pruned} auto-version(s) for book ${bookId}`
          );
        }
      } catch (err) {
        console.warn("[versions] Auto-version prune failed:", err);
      }
    }

    try {
      const { versions, totalCount, clampedPage } = await fetchPage(
        bookId,
        page,
        pageSize
      );
      set({
        versions,
        totalCount,
        currentPage: clampedPage,
        isLoading: false,
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

  createVersion: async (input: CreateVersionInput) => {
    const db = await getDatabase();
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
    const now = Math.floor(Date.now() / 1000);

    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.bookId,
        input.name ?? null,
        snapshotStr,
        snapshot.book.wordCount,
        checksum,
        input.triggerType,
        now,
        null,
      ]
    );

    // Retention: cap automatic trigger types per book. Each prunable type has
    // its own quota (so heavy "close" activity can't starve "auto-idle" history).
    // Manual and pre-restore are never pruned.
    let prunedCount = 0;
    if (isPrunable(input.triggerType)) {
      prunedCount = await pruneTriggerType(
        db,
        input.bookId,
        input.triggerType,
        VERSION_AUTO_PRUNE_KEEP
      );
    }

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
  },

  getVersionSnapshot: async (versionId: string) => {
    const db = await getDatabase();
    const result = await db.select<Record<string, unknown>[]>(
      "SELECT snapshot FROM book_versions WHERE id = ?",
      [versionId]
    );
    if (result.length === 0) {
      throw new Error("Version not found");
    }
    return result[0].snapshot as string;
  },

  restoreVersion: async (versionId: string, options?: RestoreOptions) => {
    const db = await getDatabase();

    // Load target version metadata and snapshot
    const result = await db.select<Record<string, unknown>[]>(
      "SELECT book_id, snapshot FROM book_versions WHERE id = ?",
      [versionId]
    );
    if (result.length === 0) {
      throw new Error("Version not found");
    }

    const bookId = result[0].book_id as string;
    const targetJson = result[0].snapshot as string;

    // Create pre-restore version
    await useVersionStore.getState().createVersion({
      bookId,
      triggerType: "pre-restore",
      name: options?.preRestoreName,
    });

    const snapshot = JSON.parse(targetJson) as BookSnapshot;
    const now = Math.floor(Date.now() / 1000);

    // Bump timestamps so restore reads as a fresh local edit
    snapshot.book.updatedAt = now;
    snapshot.chapters.forEach((c) => {
      c.updatedAt = now;
    });

    await applyBookSnapshot(snapshot);
    // Re-fetch page 1 so the new pre-restore version is visible on top.
    await useVersionStore.getState().loadVersions(bookId, 1);
  },

  renameVersion: async (versionId: string, name: string) => {
    const db = await getDatabase();
    await db.execute(
      "UPDATE book_versions SET name = ? WHERE id = ?",
      [name, versionId]
    );

    set((state) => ({
      versions: state.versions.map((v) =>
        v.id === versionId ? { ...v, name } : v
      ),
    }));
  },

  deleteVersion: async (versionId: string) => {
    const db = await getDatabase();
    await db.execute("DELETE FROM book_versions WHERE id = ?", [versionId]);

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
