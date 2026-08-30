// src/features/links/link-resolver.ts
import type { LinkTargetType } from "@/features/links/types";
import { parseLinkUri } from "@/features/links/link-uri";

export interface ResolverData {
  notes: { id: string; title: string }[];
  books: { id: string; title: string }[];
  chapters: { id: string; bookId: string; title: string }[];
  headings: { id: string; chapterId: string; text: string }[];
  noteHeadings?: { id: string; noteId: string; text: string }[];
}

export interface ResolvedTarget {
  type: LinkTargetType;
  id: string; // noteId | bookId | chapterId
  headingId?: string;
  title: string;
  bookId?: string;
  exists: boolean;
}

function bookIdForChapter(chapterId: string, data: ResolverData): string | undefined {
  return data.chapters.find((c) => c.id === chapterId)?.bookId;
}

function resolveById(
  type: LinkTargetType,
  id: string,
  headingId: string | undefined,
  data: ResolverData
): ResolvedTarget | null {
  switch (type) {
    case "note": {
      const note = data.notes.find((n) => n.id === id);
      return note ? { type, id, title: note.title, exists: true } : null;
    }
    case "book": {
      const book = data.books.find((b) => b.id === id);
      return book ? { type, id, title: book.title, exists: true } : null;
    }
    case "chapter": {
      const ch = data.chapters.find((c) => c.id === id);
      return ch ? { type, id, title: ch.title, bookId: ch.bookId, exists: true } : null;
    }
    case "heading": {
      const h = data.headings.find((x) => x.chapterId === id && x.id === headingId);
      if (!h) return null;
      return {
        type,
        id,
        headingId,
        title: h.text,
        bookId: bookIdForChapter(id, data),
        exists: true,
      };
    }
    case "noteHeading": {
      const h = data.noteHeadings?.find((x) => x.noteId === id && x.id === headingId);
      if (!h) return null;
      return {
        type,
        id,
        headingId,
        title: h.text,
        exists: true,
      };
    }
  }
}

export function resolveByTitle(title: string, data: ResolverData): ResolvedTarget | null {
  const note = data.notes.find((n) => n.title === title);
  if (note) return { type: "note", id: note.id, title: note.title, exists: true };

  const book = data.books.find((b) => b.title === title);
  if (book) return { type: "book", id: book.id, title: book.title, exists: true };

  const ch = data.chapters.find((c) => c.title === title);
  if (ch)
    return {
      type: "chapter",
      id: ch.id,
      title: ch.title,
      bookId: ch.bookId,
      exists: true,
    };

  const h = data.headings.find((x) => x.text === title);
  if (h) {
    return {
      type: "heading",
      id: h.chapterId,
      headingId: h.id,
      title: h.text,
      bookId: bookIdForChapter(h.chapterId, data),
      exists: true,
    };
  }
  const noteHeading = data.noteHeadings?.find((x) => x.text === title);
  if (noteHeading) {
    return {
      type: "noteHeading",
      id: noteHeading.noteId,
      headingId: noteHeading.id,
      title: noteHeading.text,
      exists: true,
    };
  }
  return null;
}

/**
 * Resolves a link by URI (preferred) with a label/title fallback (D2).
 * `hrefOrTitle` may be a `maibuk://` URI or a raw title (freshly typed [[Title]]).
 */
export function resolveLink(
  hrefOrTitle: string,
  label: string | undefined,
  data: ResolverData
): ResolvedTarget | null {
  const parsed = parseLinkUri(hrefOrTitle);
  if (parsed) {
    const byId = resolveById(
      parsed.targetType,
      parsed.targetId,
      "headingId" in parsed ? parsed.headingId : undefined,
      data
    );
    if (byId) return byId;
    if (label) return resolveByTitle(label, data);
    return null;
  }
  return resolveByTitle(hrefOrTitle, data);
}
