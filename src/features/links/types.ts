export type LinkTargetType = "note" | "book" | "chapter" | "heading" | "noteHeading";

export type ParsedLink =
  | { targetType: "note"; targetId: string }
  | { targetType: "noteHeading"; targetId: string; headingId: string }
  | { targetType: "book"; targetId: string }
  | { targetType: "chapter"; targetId: string }
  | { targetType: "heading"; targetId: string; headingId: string };

export type ExtractedLink = ParsedLink & { label: string };

export interface LinkPreviewSnippet {
  /** Sanitized formatted HTML, safe to render. */
  html: string;
  truncated: boolean;
}

export interface LinkPreviewHeading {
  text: string;
  snippet: LinkPreviewSnippet;
}

/** What a Link Preview shows; `heading: null` is a heading no longer in its text. */
export type LinkPreviewData =
  | { kind: "note"; title: string; snippet: LinkPreviewSnippet }
  | { kind: "chapter"; bookTitle: string; chapterTitle: string; snippet: LinkPreviewSnippet }
  | {
      kind: "heading";
      bookTitle: string;
      chapterTitle: string;
      heading: LinkPreviewHeading | null;
    }
  | { kind: "noteHeading"; noteTitle: string; heading: LinkPreviewHeading | null }
  | {
      kind: "book";
      bookId: string;
      title: string;
      author: string;
      description: string | null;
      coverSrc: string | null;
    }
  | { kind: "web"; scheme: "web" | "mail" | "other"; href: string; host: string | null }
  | { kind: "missing" }
  | { kind: "error" };
