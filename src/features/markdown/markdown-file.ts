/**
 * Helpers for the `.md` file boundary: deriving a filename from a title, and
 * deriving a title from dropped Markdown content.
 */

/** Slugifies a title into a safe `.md` filename. */
export function markdownFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "untitled"}.md`;
}

/**
 * Picks a title for an imported Markdown document: the first ATX `# ` heading
 * if present, otherwise the provided fallback (typically the file's stem).
 */
export function titleFromMarkdown(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return fallback.trim() || "Untitled";
}
