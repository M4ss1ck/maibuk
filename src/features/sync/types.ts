export type AuthStatus = "logged-out" | "logged-in";

export type SyncStatus = "idle" | "syncing" | "error" | "success";

export interface SyncItemMeta {
  remoteId: string;
  bookId: string;
  checksum: string;
  updatedAt: number; // Unix seconds
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
