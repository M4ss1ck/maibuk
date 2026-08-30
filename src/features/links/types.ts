export type LinkTargetType = "note" | "book" | "chapter" | "heading" | "noteHeading";

export type ParsedLink =
  | { targetType: "note"; targetId: string }
  | { targetType: "noteHeading"; targetId: string; headingId: string }
  | { targetType: "book"; targetId: string }
  | { targetType: "chapter"; targetId: string }
  | { targetType: "heading"; targetId: string; headingId: string };

export type ExtractedLink = ParsedLink & { label: string };
