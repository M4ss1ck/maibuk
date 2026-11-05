/**
 * Whether the PDF's built-in fonts can render a piece of text.
 *
 * pdfkit encodes standard-font text one code unit at a time through its
 * WinAnsi table and keeps the low byte of anything the table does not list, so
 * a character outside Windows-1252 renders as a different one (or not at all).
 * The export UI uses this check to decide whether a PDF needs an embedded PDF
 * font; the encoder itself stays untouched.
 */
import type { Book } from "@/features/books/types";
import type { Chapter } from "@/features/chapters/types";
import { ENDNOTE_BACKLINK, processChapterHtml } from "@/features/export/html-sanitizer";

/**
 * Every code point Windows-1252 can represent. Building the set by decoding
 * all 256 bytes keeps it one definition with the encoder instead of a
 * hand-written character table.
 */
const WIN_ANSI_CHARS: ReadonlySet<string> = new Set(
  new TextDecoder("windows-1252").decode(Uint8Array.from({ length: 256 }, (_, byte) => byte))
);

/**
 * True when every code point in `text` survives the standard-font encoder.
 */
export function builtInFontsCanRender(text: string): boolean {
  for (const char of text) {
    if (!WIN_ANSI_CHARS.has(char)) return false;
  }
  return true;
}

function chapterText(html: string): string {
  const doc = new DOMParser().parseFromString(processChapterHtml(html), "text/html");
  for (const backlink of doc.querySelectorAll(ENDNOTE_BACKLINK)) backlink.remove();
  return doc.body.textContent ?? "";
}

/** The text a single-document PDF renders: its title and its body. */
export function documentPdfText(html: string, title: string): string {
  return [title, chapterText(html)].join("\n");
}

/**
 * The text a book PDF renders: book metadata plus every chapter included in
 * the export, in the order given. Excluded chapters contribute nothing.
 */
export function bookPdfText(book: Book, chapters: Chapter[]): string {
  // A cover image replaces the text cover, so these strings are never drawn.
  const parts = book.coverImagePath ? [] : [book.title, book.authorName, book.subtitle ?? ""];
  for (const chapter of chapters) {
    if (!chapter.isIncludedInExport) continue;
    parts.push(chapter.title, chapterText(chapter.content ?? ""));
  }
  return parts.filter((part) => part.length > 0).join("\n");
}

const MAX_WORD_LEN = 28;
const CHUNK_SIZE = 16;
const CJK_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Splits a word too long for the page. A CJK run has no spaces to break at, so
 * every character becomes its own syllable with a zero-width break after it;
 * without that, the layout drops everything past the first line.
 */
export function hyphenateWord(word: string): string[] {
  if (CJK_WORD.test(word)) return Array.from(word).flatMap((char) => [char, ""]);
  if (word.length <= MAX_WORD_LEN) return [word];
  const parts: string[] = [];
  for (let i = 0; i < word.length; i += CHUNK_SIZE) {
    parts.push(word.slice(i, i + CHUNK_SIZE));
  }
  return parts;
}
