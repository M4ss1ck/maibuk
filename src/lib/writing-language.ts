/** A raw BCP 47 tag kept unchanged, never narrowed. */
export type WritingLanguage = string;

/**
 * The language part of a tag: everything before the first `-` or `_`, lowercased.
 * Tags arrive from imported EPUBs and sync, so anything that is not a plain
 * language subtag is rejected rather than passed on.
 */
export function baseLanguage(tag: string | null | undefined): string | null {
  const base = tag?.split(/[-_]/)[0]?.toLowerCase();
  return base && /^[a-z]{2,8}$/.test(base) ? base : null;
}

/**
 * The language a piece of text is written in: Book is the source of truth, so a
 * Note's own language wins over its Book, which wins over the app language.
 * A Chapter passes the Book, a Canvas passes only the app, and the Ephemeral
 * passes its pick as `own`.
 */
export function resolveWritingLanguage({
  own,
  book,
  app,
}: {
  own?: string | null;
  book?: string | null;
  app: string;
}): WritingLanguage {
  return own?.trim() || book?.trim() || app;
}

/** The language's name in that language, or the raw tag when it has none. */
export function languageDisplayName(tag: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Adds the tag to a language menu unless it is blank or already an exact value. */
export function withLanguageOption(
  options: { value: string; label: string }[],
  tag: string
): { value: string; label: string }[] {
  if (!tag.trim() || options.some((option) => option.value === tag)) return options;
  return [...options, { value: tag, label: languageDisplayName(tag) }];
}
