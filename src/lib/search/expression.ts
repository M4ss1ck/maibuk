/**
 * The one search expression the editor's Find and Replace and Library Search
 * agree on: a query plus Match case, Whole word, and Regex becomes a matcher,
 * and its matches are counted the same way in the open Chapter and in the
 * Library index.
 *
 * Default is case-insensitive with accents exact, which is FTS5's `trigram`
 * default too. A match never crosses the text block it was found in; callers
 * run this once per block.
 */

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** One match, as a half-open `[start, end)` range inside the text it was found in. */
export interface MatchRange {
  start: number;
  end: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the RegExp used for searching. Throws if the user-supplied pattern is
 * an invalid regular expression, so callers can surface the error.
 */
export function buildSearchRegExp(term: string, options: SearchOptions): RegExp {
  let pattern = options.regex ? term : escapeRegExp(term);
  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }
  return new RegExp(pattern, options.caseSensitive ? "g" : "gi");
}

/** Every non-empty match of a compiled expression in one text block. */
export function matchRanges(regex: RegExp, text: string): MatchRange[] {
  const ranges: MatchRange[] = [];
  regex.lastIndex = 0;

  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    if (match[0].length > 0) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    // Guard against zero-length matches causing an infinite loop.
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }
  }

  return ranges;
}

/**
 * Matches of `term` in one text block. `[]` for an empty term; throws on an
 * invalid Regex, so the caller decides whether that is an error or no match.
 */
export function findMatchRanges(text: string, term: string, options: SearchOptions): MatchRange[] {
  if (!term) return [];
  return matchRanges(buildSearchRegExp(term, options), text);
}

/** How many matches `term` has in one text block, with the same rules as Find. */
export function countMatches(text: string, term: string, options: SearchOptions): number {
  return findMatchRanges(text, term, options).length;
}
