import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import { serializeBook, applyBookSnapshot } from "../sync/serializer";
import { computeChecksum } from "../../lib/checksum";
import type {
  BookVersion,
  CreateVersionInput,
  RestoreOptions,
  VersionTrigger,
} from "./types";
import type { BookSnapshot } from "../sync/types";

export const DEFAULT_VERSIONS_PAGE_SIZE = 10;

function generateId(): string {
  return crypto.randomUUID();
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
    set({
      isLoading: true,
      error: null,
      currentBookId: bookId,
      pageSize,
    });
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
    const checksum = await computeChecksum(snapshotStr);
    const snapshot = JSON.parse(snapshotStr) as BookSnapshot;

    // Dedup: check if the last version for this book has the same checksum
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
    // We only mutate state if the new row would land on the currently visible page
    // (i.e. page 1, since rows are sorted newest-first).
    set((state) => {
      if (state.currentBookId !== input.bookId) return {};
      const newTotal = state.totalCount + 1;
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
