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
  status: "draft" | "in-progress" | "completed";
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt?: Date;
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
  status?: "draft" | "in-progress" | "completed";
  targetWordCount?: number;
}
