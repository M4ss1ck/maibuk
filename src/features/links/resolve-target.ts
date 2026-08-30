import { parseLinkUri } from "@/features/links/link-uri";
import type { ParsedLink } from "@/features/links/types";
import { getDatabase } from "@/lib/db";

export type LinkToastKey = "deepLink.resourceGone" | "deepLink.headingGone" | "deepLink.genericError";

export type LinkTarget = {
  to: string;
  state?: { scrollToHeadingId?: string; openChapterId?: string };
  toastKey?: LinkToastKey;
};

export type LinkOutcome = LinkTarget | { to: null; toastKey: LinkToastKey };

function hasHeading(html: string | null | undefined, headingId: string): boolean {
  if (!html) return false;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return !!doc.getElementById(headingId);
  } catch {
    return false;
  }
}

export async function resolveParsedLink(parsed: ParsedLink): Promise<LinkOutcome> {
  try {
    const db = await getDatabase();
    switch (parsed.targetType) {
      case "note": {
        const rows = await db.select<Record<string, unknown>[]>(
          "SELECT id FROM notes WHERE id = ?",
          [parsed.targetId]
        );
        if (rows.length === 0) {
          return { to: "/notes", toastKey: "deepLink.resourceGone" };
        }
        return { to: `/notes/${parsed.targetId}` };
      }
      case "noteHeading": {
        const rows = await db.select<Record<string, unknown>[]>(
          "SELECT id, content FROM notes WHERE id = ?",
          [parsed.targetId]
        );
        if (rows.length === 0) {
          return { to: "/notes", toastKey: "deepLink.resourceGone" };
        }
        const content = rows[0].content as string | null;
        if (!hasHeading(content, parsed.headingId)) {
          return {
            to: `/notes/${parsed.targetId}`,
            toastKey: "deepLink.headingGone",
          };
        }
        return {
          to: `/notes/${parsed.targetId}`,
          state: { scrollToHeadingId: parsed.headingId },
        };
      }
      case "book": {
        const rows = await db.select<Record<string, unknown>[]>(
          "SELECT id FROM books WHERE id = ?",
          [parsed.targetId]
        );
        if (rows.length === 0) {
          return { to: "/", toastKey: "deepLink.resourceGone" };
        }
        return { to: `/book/${parsed.targetId}` };
      }
      case "chapter": {
        const rows = await db.select<{ id: string; book_id: string }[]>(
          "SELECT id, book_id FROM chapters WHERE id = ?",
          [parsed.targetId]
        );
        if (rows.length === 0) {
          return { to: "/", toastKey: "deepLink.resourceGone" };
        }
        return {
          to: `/book/${rows[0].book_id}`,
          state: { openChapterId: parsed.targetId },
        };
      }
      case "heading": {
        const rows = await db.select<{ id: string; book_id: string; content: string | null }[]>(
          "SELECT id, book_id, content FROM chapters WHERE id = ?",
          [parsed.targetId]
        );
        if (rows.length === 0) {
          return { to: "/", toastKey: "deepLink.resourceGone" };
        }
        const row = rows[0];
        if (!hasHeading(row.content, parsed.headingId)) {
          return {
            to: `/book/${row.book_id}`,
            state: { openChapterId: parsed.targetId },
            toastKey: "deepLink.headingGone",
          };
        }
        return {
          to: `/book/${row.book_id}`,
          state: { openChapterId: parsed.targetId, scrollToHeadingId: parsed.headingId },
        };
      }
    }
  } catch {
    return { to: null, toastKey: "deepLink.genericError" };
  }
}

export async function resolveLinkTarget(href: string): Promise<LinkOutcome | null> {
  const parsed = parseLinkUri(href);
  if (!parsed) return null;
  return resolveParsedLink(parsed);
}
