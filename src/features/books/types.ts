export const BOOK_STATUSES = ["draft", "in-progress", "completed", "archived"] as const;

export type BookStatus = (typeof BOOK_STATUSES)[number];

export interface Book {
  id: string;
  title: string;
  subtitle?: string;
  authorName: string;
  description?: string;
  genre?: string;
  language: string;
  coverImagePath?: string;
  coverData?: string;
  wordCount: number;
  targetWordCount?: number;
  status: BookStatus;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt?: Date;
  lastChapterId?: string;
}

export interface CreateBookInput {
  title: string;
  authorName: string;
  subtitle?: string;
  description?: string;
  genre?: string;
}

export interface UpdateBookInput {
  title?: string;
  subtitle?: string;
  authorName?: string;
  description?: string;
  genre?: string;
  language?: string;
  status?: BookStatus;
  targetWordCount?: number;
  coverImagePath?: string;
  coverData?: string;
  lastChapterId?: string;
}
