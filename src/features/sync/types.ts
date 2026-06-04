export type AuthStatus = "logged-out" | "logged-in";

export type SyncStatus =
  | "idle"
  | "syncing"
  | "awaiting-confirmation"
  | "error"
  | "success"
  | "cancelled"
  | "partial";

export type SyncAction = "pushed" | "pulled" | "skipped" | "cancelled";
export type SyncOutcome = "success" | "cancelled" | "partial";

export interface SingleSyncResult {
  outcome: SyncOutcome;
  action: SyncAction;
}

export interface BatchSyncResult {
  outcome: SyncOutcome;
  actions: SyncAction[];
}

export interface SyncConflict {
  bookId: string;
  bookTitle: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export type ConflictResolver = (conflict: SyncConflict) => Promise<"push" | "pull" | "cancel">;

export interface SyncItemMeta {
  remoteId: string;
  bookId: string;
  checksum: string;
  updatedAt: number; // Unix seconds
}

export interface NoteSyncItemMeta {
  remoteId: string;
  noteId: string;
  checksum: string;
  updatedAt: number; // Unix seconds
}

import type { MetricEvent } from "../metrics/types";

export interface MetricsSyncBlob {
  events: MetricEvent[];
  tombstones: Array<{
    id: string;
    deleted_at: string;
    device_id: string;
    reason: string;
  }>;
  updatedAt: number;
}

export interface BookSnapshot {
  book: {
    id: string;
    title: string;
    subtitle: string | null;
    authorName: string;
    description: string | null;
    genre: string | null;
    language: string;
    coverImagePath: string | null;
    coverData: string | null;
    wordCount: number;
    targetWordCount: number | null;
    status: string;
    createdAt: number; // Unix seconds
    updatedAt: number;
    lastOpenedAt: number | null;
    lastChapterId: string | null;
  };
  chapters: Array<{
    id: string;
    bookId: string;
    title: string;
    content: string | null;
    synopsis: string | null;
    order: number;
    parentId: string | null;
    chapterType: string;
    wordCount: number;
    status: string;
    isIncludedInExport: boolean;
    createdAt: number;
    updatedAt: number;
  }>;
}

export interface NoteSnapshot {
  note: {
    id: string;
    title: string;
    content: string | null;
    tags: string | null; // JSON array string, stored verbatim
    pinned: boolean;
    order: number;
    wordCount: number;
    createdAt: number; // Unix seconds
    updatedAt: number;
  };
}
