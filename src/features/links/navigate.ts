// src/features/links/navigate.ts
import { parseLinkUri } from "./link-uri";

type NavigateFn = (to: string, options?: { state?: unknown }) => void;

export interface NavigateOptions {
  // Maps a chapterId to its bookId (needed because chapter/heading URIs omit bookId).
  bookIdForChapter?: (chapterId: string) => string | undefined;
}

export function navigateToLinkTarget(
  href: string,
  navigate: NavigateFn,
  options: NavigateOptions = {},
): void {
  const parsed = parseLinkUri(href);
  if (!parsed) return;

  switch (parsed.targetType) {
    case "note":
      navigate("/notes", { state: { openNoteId: parsed.targetId } });
      return;
    case "noteHeading":
      navigate("/notes", {
        state: {
          openNoteId: parsed.targetId,
          scrollToHeadingId: parsed.headingId,
        },
      });
      return;
    case "book":
      navigate(`/book/${parsed.targetId}`, { state: {} });
      return;
    case "chapter":
    case "heading": {
      const bookId = options.bookIdForChapter?.(parsed.targetId);
      if (!bookId) return;
      navigate(`/book/${bookId}`, {
        state: {
          openChapterId: parsed.targetId,
          scrollToHeadingId: parsed.headingId,
        },
      });
      return;
    }
  }
}
