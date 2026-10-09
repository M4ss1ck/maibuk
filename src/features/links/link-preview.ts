import DOMPurify from "dompurify";

import { LINK_PREVIEW_CACHE_MS, LINK_PREVIEW_SNIPPET_CHARS } from "@/constants";
import { deriveHeadingIds } from "@/features/links/heading-ids";
import { parseLinkUri } from "@/features/links/link-uri";
import type {
  LinkPreviewData,
  LinkPreviewHeading,
  LinkPreviewSnippet,
  ParsedLink,
} from "@/features/links/types";
import { onChange } from "@/features/sync/change-feed";
import { getDatabase } from "@/lib/db";

export interface ExtractSnippetOptions {
  maxChars?: number;
}

const ELLIPSIS = "…";

function removeFollowing(node: Node, root: Node): void {
  let current: Node | null = node;
  while (current && current !== root) {
    while (current.nextSibling) current.parentNode?.removeChild(current.nextSibling);
    current = current.parentNode;
  }
}

function cutAtWord(text: string, budget: number): string {
  const head = text.slice(0, budget + 1);
  const lastSpace = head.search(/\s\S*$/);
  return (lastSpace > 0 ? head.slice(0, lastSpace) : text.slice(0, budget)).trimEnd();
}

/** Cuts `root` after `maxChars` visible characters; true when something was cut. */
function truncate(root: Node, maxChars: number): boolean {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let used = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (used + text.length <= maxChars) {
      used += text.length;
      continue;
    }
    node.textContent = cutAtWord(text, maxChars - used) + ELLIPSIS;
    removeFollowing(node, root);
    return true;
  }
  return false;
}

const DROPPED = "img, figure, sup[data-footnote], script, style";

// The snippet sits beside the editor, so nothing in it may be followed, take
// an id the editor's headings own, or render at heading size.
function clean(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const sceneBreak of Array.from(root.querySelectorAll("[data-scene-break]"))) {
    const symbols =
      sceneBreak.querySelector(".scene-break-symbols")?.textContent?.trim() || "* * *";
    const plain = doc.createElement("div");
    plain.setAttribute("data-scene-break", "");
    plain.className = "scene-break";
    const span = doc.createElement("span");
    span.className = "scene-break-symbols";
    span.textContent = symbols;
    plain.append(span);
    sceneBreak.replaceWith(plain);
  }
  for (const element of Array.from(root.querySelectorAll(DROPPED))) element.remove();
  for (const anchor of Array.from(root.querySelectorAll("a"))) {
    const span = doc.createElement("span");
    span.className = "link-preview-link";
    span.append(...Array.from(anchor.childNodes));
    anchor.replaceWith(span);
  }
  for (const heading of Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    const line = doc.createElement("p");
    const strong = doc.createElement("strong");
    strong.append(...Array.from(heading.childNodes));
    line.append(strong);
    heading.replaceWith(line);
  }
  for (const element of Array.from(root.querySelectorAll("[id]"))) element.removeAttribute("id");
}

const OUTLINE_HEADING_OPEN = /<h[1-3][\s>]/gi;
// Raw HTML read per attempt. Markup outweighs text, so a window is many times
// the visible budget; a window that still shows too little text doubles.
const FIRST_WINDOW = 2_000;
// A window cut mid-tag or mid-entity can garble its last characters: keep
// them past the cut.
const WINDOW_TAIL_MARGIN = 32;

// A slice of a text to preview. A heading's section starts at the heading
// itself, so one parse reads both its text and what follows it.
interface Section {
  html: string;
  start: number;
  end: number;
  leadingHeading: boolean;
}

function nextOutlineHeading(html: string, from: number): number {
  OUTLINE_HEADING_OPEN.lastIndex = from;
  return OUTLINE_HEADING_OPEN.exec(html)?.index ?? html.length;
}

// Fast path: the heading's stored id, found without parsing the whole text.
function sectionByStoredId(html: string, headingId: string): Section | null {
  if (!/^[\w-]+$/.test(headingId)) return null;
  const marker = `id="${headingId}"`;
  let at = html.indexOf(marker);
  while (at > 0 && !/\s/.test(html[at - 1])) at = html.indexOf(marker, at + 1);
  if (at < 0) return null;
  const open = html.lastIndexOf("<", at);
  const level = /^<h([1-3])[\s>]/i.exec(html.slice(open, open + 4))?.[1];
  if (!level) return null;
  const close = html.indexOf(`</h${level}>`, at);
  if (close < 0) return null;
  const after = close + `</h${level}>`.length;
  return { html, start: open, end: nextOutlineHeading(html, after), leadingHeading: true };
}

// A heading stored without an id is named by its derived id, which needs
// every heading before it: parse the whole text.
function sectionByDerivedId(html: string, headingId: string): Section | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = Array.from(doc.body.querySelectorAll("h1, h2, h3"));
  const ids = deriveHeadingIds(
    headings.map((el) => ({ id: el.getAttribute("id"), text: el.textContent ?? "" }))
  );
  const heading = headings[ids.indexOf(headingId)];
  if (!heading) return null;
  let body = heading.outerHTML;
  for (let node = heading.nextSibling; node; node = node.nextSibling) {
    if (node instanceof Element && /^H[1-3]$/.test(node.tagName)) break;
    body += node instanceof Element ? node.outerHTML : (node.textContent ?? "");
  }
  return { html: body, start: 0, end: body.length, leadingHeading: true };
}

interface Rendered {
  snippet: LinkPreviewSnippet;
  headingText: string;
}

function render(
  fragment: string,
  maxChars: number,
  windowCut: boolean,
  leadingHeading: boolean
): Rendered | null {
  // RETURN_DOM hands back the parsed <body>, so the window is parsed once.
  const body = DOMPurify.sanitize(fragment, { RETURN_DOM: true }) as HTMLElement;
  let headingText = "";
  if (leadingHeading) {
    const heading = body.firstElementChild;
    headingText = heading?.textContent ?? "";
    heading?.remove();
  }
  clean(body);
  if (windowCut && (body.textContent ?? "").length <= maxChars + WINDOW_TAIL_MARGIN) {
    return null;
  }
  const truncated = truncate(body, maxChars);
  return { snippet: { html: body.innerHTML, truncated }, headingText };
}

function renderSection(section: Section, maxChars: number): Rendered {
  for (let size = FIRST_WINDOW; ; size *= 2) {
    const end = Math.min(section.end, section.start + size);
    const windowCut = end < section.end;
    const fragment = section.html.slice(section.start, end);
    const rendered = render(fragment, maxChars, windowCut, section.leadingHeading);
    if (rendered) return rendered;
  }
}

/** The opening of a text as safe formatted HTML of at most `maxChars` visible characters. */
export function extractSnippet(
  html: string,
  options: ExtractSnippetOptions = {}
): LinkPreviewSnippet {
  const maxChars = options.maxChars ?? LINK_PREVIEW_SNIPPET_CHARS;
  const section = { html, start: 0, end: html.length, leadingHeading: false };
  return renderSection(section, maxChars).snippet;
}

/**
 * A heading's text and the opening of the part under it, up to the next
 * heading. Null when the heading is not in the text.
 */
export function extractHeadingPreview(
  html: string,
  headingId: string,
  options: ExtractSnippetOptions = {}
): LinkPreviewHeading | null {
  const maxChars = options.maxChars ?? LINK_PREVIEW_SNIPPET_CHARS;
  const section = sectionByStoredId(html, headingId) ?? sectionByDerivedId(html, headingId);
  if (!section) return null;
  const { snippet, headingText } = renderSection(section, maxChars);
  return { text: headingText.trim(), snippet };
}

interface CachedPreview {
  at: number;
  data: Promise<LinkPreviewData>;
}

const cache = new Map<string, CachedPreview>();
let unsubscribe: (() => void) | null = null;

/** Drops every cached Link Preview (a saved Change or a Library switch). */
export function clearLinkPreviewCache(): void {
  cache.clear();
}

// Any saved Change may rename or delete a target, and Changes are rare next
// to hovers, so clearing everything is both correct and cheap.
function ensureSubscribed(): void {
  if (unsubscribe) return;
  unsubscribe = onChange(() => clearLinkPreviewCache());
}

function plainText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent?.trim();
  return text ? text : null;
}

function webPreview(href: string): LinkPreviewData {
  let url: URL | null = null;
  try {
    url = new URL(href);
  } catch {
    url = null;
  }
  if (url && (url.protocol === "http:" || url.protocol === "https:")) {
    return { kind: "web", scheme: "web", href, host: url.host };
  }
  if (url?.protocol === "mailto:") return { kind: "web", scheme: "mail", href, host: null };
  return { kind: "web", scheme: "other", href, host: null };
}

type Row = Record<string, unknown>;

async function readTarget(parsed: ParsedLink): Promise<LinkPreviewData> {
  const db = await getDatabase();
  switch (parsed.targetType) {
    case "note":
    case "noteHeading": {
      const rows = await db.select<Row[]>("SELECT title, content FROM notes WHERE id = ?", [
        parsed.targetId,
      ]);
      if (rows.length === 0) return { kind: "missing" };
      const title = rows[0].title as string;
      const content = (rows[0].content as string | null) ?? "";
      if (parsed.targetType === "note") {
        return { kind: "note", title, snippet: extractSnippet(content) };
      }
      return {
        kind: "noteHeading",
        noteTitle: title,
        heading: extractHeadingPreview(content, parsed.headingId),
      };
    }
    case "chapter":
    case "heading": {
      const rows = await db.select<Row[]>(
        `SELECT c.title AS chapter_title, c.content AS content, b.title AS book_title
           FROM chapters c JOIN books b ON b.id = c.book_id
          WHERE c.id = ?`,
        [parsed.targetId]
      );
      if (rows.length === 0) return { kind: "missing" };
      const bookTitle = rows[0].book_title as string;
      const chapterTitle = rows[0].chapter_title as string;
      const content = (rows[0].content as string | null) ?? "";
      if (parsed.targetType === "chapter") {
        return { kind: "chapter", bookTitle, chapterTitle, snippet: extractSnippet(content) };
      }
      return {
        kind: "heading",
        bookTitle,
        chapterTitle,
        heading: extractHeadingPreview(content, parsed.headingId),
      };
    }
    case "book": {
      const rows = await db.select<Row[]>(
        "SELECT title, author_name, description, cover_image_path FROM books WHERE id = ?",
        [parsed.targetId]
      );
      if (rows.length === 0) return { kind: "missing" };
      return {
        kind: "book",
        bookId: parsed.targetId,
        title: rows[0].title as string,
        author: rows[0].author_name as string,
        description: plainText(rows[0].description as string | null),
        coverSrc: (rows[0].cover_image_path as string | null) || null,
      };
    }
  }
}

async function read(href: string): Promise<LinkPreviewData> {
  const parsed = parseLinkUri(href);
  if (!parsed) return webPreview(href);
  try {
    return await readTarget(parsed);
  } catch (error) {
    console.error("[link-preview] could not read the target:", error);
    return { kind: "error" };
  }
}

/**
 * What the Link at `href` points to, read once and kept until a saved Change,
 * a Library switch, or `LINK_PREVIEW_CACHE_MS` (a restore emits no Change).
 * Never rejects.
 */
export function loadLinkPreview(href: string): Promise<LinkPreviewData> {
  ensureSubscribed();
  const cached = cache.get(href);
  if (cached && Date.now() - cached.at < LINK_PREVIEW_CACHE_MS) return cached.data;
  const data = read(href).then((result) => {
    if (result.kind === "error" && cache.get(href)?.data === data) cache.delete(href);
    return result;
  });
  cache.set(href, { at: Date.now(), data });
  return data;
}
