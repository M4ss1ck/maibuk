export type LinkTargetType =
  | "note"
  | "book"
  | "chapter"
  | "heading"
  | "noteHeading";

export interface ParsedLink {
  targetType: LinkTargetType;
  targetId: string; // noteId | bookId | chapterId
  headingId?: string;
}

export interface ExtractedLink extends ParsedLink {
  label: string;
}
