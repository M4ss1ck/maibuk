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
  currentBookId: string | null;
  isLoading: boolean;
  error: string | null;

  loadVersions: (bookId: string) => Promise<void>;
  createVersion: (input: CreateVersionInput) => Promise<BookVersion | null>;
  getVersionSnapshot: (versionId: string) => Promise<string>;
  restoreVersion: (versionId: string, options?: RestoreOptions) => Promise<void>;
  renameVersion: (versionId: string, name: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
}

export const useVersionStore = create<VersionStore>((set) => ({
  versions: [],
  currentBookId: null,
  isLoading: false,
  error: null,

  loadVersions: async (bookId: string) => {
    set({ isLoading: true, error: null, currentBookId: bookId });
    try {
      const db = await getDatabase();
      const result = await db.select<Record<string, unknown>[]>(
        `SELECT id, book_id, name, word_count, checksum, trigger_type, created_at, synced_at
         FROM book_versions
         WHERE book_id = ?
         ORDER BY created_at DESC, id DESC`,
        [bookId]
      );
      const versions = result.map(toVersion);
      set({ versions, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
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

    set((state) => {
      if (state.currentBookId === input.bookId) {
        return { versions: [version, ...state.versions] };
      }
      return {};
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
    await useVersionStore.getState().loadVersions(bookId);
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

    set((state) => ({
      versions: state.versions.filter((v) => v.id !== versionId),
    }));
  },
}));
