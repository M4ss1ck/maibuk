/**
 * Plain-text extraction for Library Search.
 *
 * The index stores one row per block, never one string per item, so a query
 * can never match across two paragraphs, list items, or headings. Chapter and
 * Note bodies are stored as editor HTML here (not TipTap JSON), so the text
 * comes from the same `htmlToPlainText()` the Plugin Library reads use: block
 * nodes separate with TipTap's `"\n\n"`, a hard break with `"\n"`.
 */

import { htmlToPlainText } from "@/components/editor/html-to-text";
import type { SearchBlock, SearchField } from "@/features/search/types";

function toBlocks(text: string): string[] {
  return text.split(/\n{2,}/);
}

/** Editor HTML -> its non-empty blocks, in document order. */
function htmlBlocks(html: string | null | undefined): string[] {
  if (!html) return [];
  let text: string;
  try {
    text = htmlToPlainText(html);
  } catch {
    // Corrupt or unknown markup must not make a save fail: fall back to a
    // tag strip, which still yields searchable text.
    text = html.replace(/<[^>]*>/g, " ");
  }
  return toBlocks(text);
}

function toSearchBlocks(blocks: readonly string[], field: SearchField): SearchBlock[] {
  const result: SearchBlock[] = [];
  blocks.forEach((text, blockIndex) => {
    if (text.trim().length === 0) return;
    result.push({ field, blockIndex, text });
  });
  return result;
}

/** One row per paragraph, list item, heading, and other editor block. */
export function chapterContentBlocks(content: string | null | undefined): SearchBlock[] {
  return toSearchBlocks(htmlBlocks(content), "content");
}

/** Notes share the editor's HTML shape, so their blocks extract the same way. */
export function noteContentBlocks(content: string | null | undefined): SearchBlock[] {
  return toSearchBlocks(htmlBlocks(content), "content");
}

function plainFieldBlocks(value: string | null | undefined, field: SearchField): SearchBlock[] {
  if (!value) return [];
  // Book fields are plain text fields, one line per block.
  return toSearchBlocks(value.split(/\r?\n/), field);
}

/** Book title, subtitle, and description; Cover data is deliberately absent. */
export function bookFieldBlocks(book: {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
}): SearchBlock[] {
  return [
    ...plainFieldBlocks(book.title, "title"),
    ...plainFieldBlocks(book.subtitle, "subtitle"),
    ...plainFieldBlocks(book.description, "description"),
  ];
}

/**
 * Canvas card text: every text node's HTML, one row per block. The block
 * ordinal runs across the whole Canvas so unit 2 can map a match back to the
 * card it came from. Note references and edges carry no body text.
 */
export function canvasBlocks(doc: unknown): SearchBlock[] {
  if (doc === null || typeof doc !== "object") return [];
  const nodes = (doc as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];

  const blocks: string[] = [];
  for (const node of nodes) {
    if (node === null || typeof node !== "object") continue;
    const { kind, html } = node as { kind?: unknown; html?: unknown };
    if (kind !== "text" || typeof html !== "string") continue;
    blocks.push(...htmlBlocks(html));
  }
  return toSearchBlocks(blocks, "card");
}
