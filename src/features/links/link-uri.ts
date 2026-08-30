import type { ExtractedLink, ParsedLink } from "@/features/links/types";

const PREFIX = "maibuk://";

export function isInternalLink(href: string | null | undefined): boolean {
  return typeof href === "string" && href.startsWith(PREFIX);
}

export function formatLinkUri(link: ParsedLink): string {
  switch (link.targetType) {
    case "note":
      return `${PREFIX}note/${encodeURIComponent(link.targetId)}`;
    case "book":
      return `${PREFIX}book/${encodeURIComponent(link.targetId)}`;
    case "chapter":
      return `${PREFIX}chapter/${encodeURIComponent(link.targetId)}`;
    case "heading":
      return `${PREFIX}heading/${encodeURIComponent(link.targetId)}/${encodeURIComponent(link.headingId)}`;
    case "noteHeading":
      return `${PREFIX}note-heading/${encodeURIComponent(link.targetId)}/${encodeURIComponent(link.headingId)}`;
  }
}

export function parseLinkUri(href: string | null | undefined): ParsedLink | null {
  if (!isInternalLink(href)) return null;
  const raw = (href as string).slice(PREFIX.length);
  // Strict: no empty, no query/fragment, no repeated or trailing slash
  if (raw.length === 0) return null;
  if (raw.includes("?") || raw.includes("#")) return null;
  if (raw.startsWith("/") || raw.endsWith("/")) return null;
  if (raw.includes("//")) return null;
  const parts = raw.split("/");
  if (parts.some((part) => part.length === 0)) return null;
  try {
    if (parts.length === 2 && parts[0] === "note") {
      return { targetType: "note", targetId: decodeURIComponent(parts[1]) };
    }
    if (parts.length === 2 && parts[0] === "book") {
      return { targetType: "book", targetId: decodeURIComponent(parts[1]) };
    }
    if (parts.length === 2 && parts[0] === "chapter") {
      return { targetType: "chapter", targetId: decodeURIComponent(parts[1]) };
    }
    if (parts.length === 3 && parts[0] === "heading") {
      return {
        targetType: "heading",
        targetId: decodeURIComponent(parts[1]),
        headingId: decodeURIComponent(parts[2]),
      };
    }
    if (parts.length === 3 && parts[0] === "note-heading") {
      return {
        targetType: "noteHeading",
        targetId: decodeURIComponent(parts[1]),
        headingId: decodeURIComponent(parts[2]),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function extractLinks(html: string | null | undefined): ExtractedLink[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: ExtractedLink[] = [];
  for (const anchor of Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('a[href^="maibuk://"]')
  )) {
    const parsed = parseLinkUri(anchor.getAttribute("href"));
    if (!parsed) continue;
    out.push({ ...parsed, label: anchor.textContent ?? "" });
  }
  return out;
}
