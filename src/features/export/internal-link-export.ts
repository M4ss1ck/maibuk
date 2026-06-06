import { parseLinkUri } from "../links/link-uri";

export interface ExportLinkContext {
  chapterHref: Map<string, string>; // chapterId -> package-relative href
  firstChapterHref: string;
}

export function rewriteInternalLinksForExport(
  html: string,
  ctx: ExportLinkContext,
): string {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const anchor of Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('a[href^="maibuk://"]'),
  )) {
    const parsed = parseLinkUri(anchor.getAttribute("href"));
    if (!parsed) continue;

    let resolved: string | null = null;
    switch (parsed.targetType) {
      case "book":
        resolved = ctx.firstChapterHref;
        break;
      case "chapter":
        resolved = ctx.chapterHref.get(parsed.targetId) ?? null;
        break;
      case "heading": {
        const base = ctx.chapterHref.get(parsed.targetId);
        resolved = base ? `${base}#${parsed.headingId}` : null;
        break;
      }
      case "note":
        resolved = null; // notes are never exported
        break;
    }

    if (resolved) {
      anchor.setAttribute("href", resolved);
    } else {
      // Unresolvable target: keep the text, drop the dead href.
      anchor.removeAttribute("href");
    }
  }

  return doc.body.innerHTML;
}
