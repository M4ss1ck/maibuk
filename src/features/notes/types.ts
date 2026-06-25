export interface Note {
  id: string;
  bookId?: string | null;
  title: string;
  content: string;
  language: string;
  tags: string[];
  pinned: boolean;
  order: number;
  wordCount: number;
  collapsedHeadings: string[];
  createdAt: number;
  updatedAt: number;
  contentUpdatedAt: number;
}

export interface CreateNoteInput {
  title: string;
  bookId?: string | null;
  content?: string;
  language?: string;
  tags?: string[];
  pinned?: boolean;
  order?: number;
  wordCount?: number;
  collapsedHeadings?: string[];
}

export interface UpdateNoteInput {
  id: string;
  bookId?: string | null;
  title?: string;
  content?: string;
  language?: string;
  tags?: string[];
  pinned?: boolean;
  order?: number;
  wordCount?: number;
  collapsedHeadings?: string[];
}

export interface ReorderNoteItem {
  id: string;
  pinned: boolean;
}
