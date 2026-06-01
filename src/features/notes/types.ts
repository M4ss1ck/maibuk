export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  order: number;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateNoteInput {
  title: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
  order?: number;
  wordCount?: number;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
  order?: number;
  wordCount?: number;
}
