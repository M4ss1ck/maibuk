export type ChapterType =
  | "chapter"
  | "prologue"
  | "epilogue"
  | "part"
  | "frontmatter"
  | "backmatter";

export type ChapterStatus = "draft" | "revised" | "final";

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
