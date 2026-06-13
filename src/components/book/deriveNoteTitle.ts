/**
 * Derives a note title from quick-note rich-text HTML: the first block of text,
 * with whitespace collapsed. Returns an empty string when the HTML has no text.
 */
export function deriveNoteTitle(html: string): string {
  const blocks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n");

  for (const block of blocks) {
    const line = block.replace(/\s+/g, " ").trim();
    if (line) return line;
  }

  return "";
}
