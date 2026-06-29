import { formatLinkUri } from "@/features/links/link-uri";
import { resolveHref } from "@/features/import/xhtml-to-editor";

export interface ImportedChapter {
  chapterId: string;
  href: string; // package-relative path of this chapter's source document
  content: string;
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export function rewriteImportedInternalLinks(chapters: ImportedChapter[]): ImportedChapter[] {
  // Map package-relative document path (no fragment) -> chapterId.
  const byPath = new Map<string, string>();
  for (const c of chapters) {
    byPath.set(stripFragment(c.href), c.chapterId);
  }

  return chapters.map((chapter) => {
    if (!chapter.content) return chapter;
    const doc = new DOMParser().parseFromString(chapter.content, "text/html");
    let changed = false;

    for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      const original = anchor.getAttribute("href");
      if (!original || isExternal(original)) continue;

      // Same-document fragment link.
      if (original.startsWith("#")) {
        anchor.setAttribute(
          "href",
          formatLinkUri({
            targetType: "heading",
            targetId: chapter.chapterId,
            headingId: original.slice(1),
          })
        );
        changed = true;
        continue;
      }

      const resolved = resolveHref(chapter.href, original);
      const [path, frag] = resolved.split("#", 2);
      let targetId = byPath.get(path);
      if (!targetId) {
        // The href may already be package-relative (e.g. from a previous export).
        targetId = byPath.get(stripFragment(original));
      }
      if (!targetId) continue; // unknown target -> leave as-is

      anchor.setAttribute(
        "href",
        frag
          ? formatLinkUri({ targetType: "heading", targetId, headingId: frag })
          : formatLinkUri({ targetType: "chapter", targetId })
      );
      changed = true;
    }

    return changed ? { ...chapter, content: doc.body.innerHTML } : chapter;
  });
}

function stripFragment(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}
