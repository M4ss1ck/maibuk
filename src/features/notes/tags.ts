/**
 * Tags as the Note UI stores them: trimmed, empty ones dropped, exact
 * duplicates dropped in the order they were given. The Tag Editor writes this
 * way, and the Plugin API shares the rule (#588), so a Plugin's Tags read back
 * the way the author's do.
 */
export function normalizeNoteTags(tags: readonly string[]): string[] {
  return tags
    .map((tag) => tag.trim())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
}
