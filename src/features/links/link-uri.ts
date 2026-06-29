import type { ExtractedLink, LinkTargetType, ParsedLink } from "./types";

const PREFIX = "maibuk://";

export function isInternalLink(href: string | null | undefined): boolean {
  return typeof href === "string" && href.startsWith(PREFIX);
}

export function formatLinkUri(link: ParsedLink): string {
  switch (link.targetType) {
    case "note":
      return `${PREFIX}note/${link.targetId}`;
    case "book":
      return `${PREFIX}book/${link.targetId}`;
    case "chapter":
      return `${PREFIX}chapter/${link.targetId}`;
    case "heading":
      return `${PREFIX}heading/${link.targetId}/${link.headingId}`;
    case "noteHeading":
      return `${PREFIX}note-heading/${link.targetId}/${link.headingId}`;
  }
}

export function parseLinkUri(href: string | null | undefined): ParsedLink | null {
  if (!isInternalLink(href)) return null;
  const parts = (href as string)
    .slice(PREFIX.length)
    .split("/")
    .filter((p) => p.length > 0);
  const kind = parts[0] as LinkTargetType;
  if (kind === "note" || kind === "book" || kind === "chapter") {
    if (parts.length !== 2) return null;
    return { targetType: kind, targetId: parts[1] };
  }
  if (kind === "heading") {
    if (parts.length !== 3) return null;
    return { targetType: "heading", targetId: parts[1], headingId: parts[2] };
  }
  if (parts[0] === "note-heading") {
    if (parts.length !== 3) return null;
    return { targetType: "noteHeading", targetId: parts[1], headingId: parts[2] };
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
