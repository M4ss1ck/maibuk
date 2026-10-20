export const CHAPTER_TYPES = [
  "chapter",
  "prologue",
  "epilogue",
  "part",
  "frontmatter",
  "backmatter",
] as const;

export type ChapterType = (typeof CHAPTER_TYPES)[number];

export const CHAPTER_STATUSES = ["draft", "revised", "final"] as const;

export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: string | null;
  synopsis?: string;
  order: number;
  parentId?: string;
  chapterType: ChapterType;
  wordCount: number;
  status: ChapterStatus;
  isIncludedInExport: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChapterInput {
  bookId: string;
  title: string;
  chapterType?: ChapterType;
  parentId?: string;
}

export interface UpdateChapterInput {
  title?: string;
  content?: string;
  synopsis?: string;
  chapterType?: ChapterType;
  status?: ChapterStatus;
  isIncludedInExport?: boolean;
}
