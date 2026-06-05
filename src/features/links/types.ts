export type LinkTargetType = "note" | "book" | "chapter" | "heading";

export interface ParsedLink {
  targetType: LinkTargetType;
  targetId: string; // noteId | bookId | chapterId (chapterId for heading)
  headingId?: string;
}

export interface ExtractedLink extends ParsedLink {
  label: string;
}
