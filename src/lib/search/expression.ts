/**
 * The one search expression the editor's Find and Replace and Library Search
 * agree on: a query plus Match case, Whole word, and Regex becomes a matcher,
 * and its matches are counted the same way in the open Chapter and in the
 * Library index.
 *
 * A literal query (Regex off) is accent-insensitive by default, with no
 * switch: "cancion" finds "canción" and back. A Regex pins the exact accents,
 * so an author can still ask for one. A match never crosses the text block it
 * was found in; callers run this once per block.
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

/** The combining marks NFD splits an accented letter into (`ñ` -> `n` + `~`). */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * `text` with its accents folded (`canción` -> `cancion`, `ñ` -> `n`), for
 * the query side of a literal match. Case is untouched: Match case still
 * applies on top of the folding.
 */
export function foldAccents(text: string): string {
  if (isAscii(text)) return text;
  return text.normalize("NFD").replace(COMBINING_MARKS, "");
}

function isAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 128) return false;
  }
  return true;
}

/**
 * `text` with its accents folded, plus the way back: `map[i]` is the offset
 * in the original text of folded offset `i`, so a match range in the folded
 * text lands on the original characters, accents included. A decomposed
 * letter (`e` + combining mark) folds to one character and maps to the
 * letter's offset; the match end maps through the next folded character, or
 * the text end.
 */
export function foldAccentsWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let offset = 0;
  // ASCII runs copy verbatim: NFD leaves them unchanged and each unit maps
  // to itself. Only non-ASCII characters pay for normalization.
  while (offset < text.length) {
    if (text.charCodeAt(offset) < 128) {
      let end = offset + 1;
      while (end < text.length && text.charCodeAt(end) < 128) end += 1;
      folded += text.slice(offset, end);
      for (let index = offset; index < end; index += 1) map.push(index);
      offset = end;
    } else {
      const char = String.fromCodePoint(text.codePointAt(offset) ?? 0);
      const base = char.normalize("NFD").replace(COMBINING_MARKS, "");
      for (let index = 0; index < base.length; index += 1) {
        folded += base[index];
        map.push(offset);
      }
      offset += char.length;
    }
  }
  return { folded, map };
}

/**
 * The compiled form of a literal query: `null` when the query folds to
 * nothing (only combining marks), which callers then match exactly instead.
 * Compiled once per search, then run per block with `matchFoldedRanges`.
 */
export function buildFoldedLiteralRegExp(
  term: string,
  options: Pick<SearchOptions, "caseSensitive" | "wholeWord">
): RegExp | null {
  const foldedTerm = foldAccents(term);
  if (!foldedTerm) return null;
  let pattern = escapeRegExp(foldedTerm);
  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }
  return new RegExp(pattern, options.caseSensitive ? "g" : "gi");
}

/**
 * Every match of a compiled literal query in one text block: the block folds,
 * the query runs on the folded side, and every range maps back to the
 * original text. Whole word and Match case keep working on the folded side
 * (Match case is case-sensitive but still accent-insensitive).
 */
export function matchFoldedRanges(regex: RegExp, text: string): MatchRange[] {
  // Pure-ASCII text folds to itself, so its ranges already land on the
  // original: no folded copy and no offset map. Only accented blocks pay.
  if (isAscii(text)) return matchRanges(regex, text);
  const { folded, map } = foldAccentsWithMap(text);
  return matchRanges(regex, folded).map((range) => ({
    start: map[range.start],
    end: range.end < map.length ? map[range.end] : text.length,
  }));
}

/**
 * Every non-empty literal match of a folded query in folded text, mapped back
 * to the original text. A query of only combining marks matches exactly.
 */
export function foldedMatchRanges(
  text: string,
  term: string,
  options: Pick<SearchOptions, "caseSensitive" | "wholeWord">
): MatchRange[] {
  const regex = buildFoldedLiteralRegExp(term, options);
  if (!regex) return matchRanges(buildSearchRegExp(term, { ...options, regex: false }), text);
  return matchFoldedRanges(regex, text);
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
 * A literal query folds accents on both sides and maps every range back to
 * the original text; a Regex runs against the text as written.
 */
export function findMatchRanges(text: string, term: string, options: SearchOptions): MatchRange[] {
  if (!term) return [];
  if (!options.regex) return foldedMatchRanges(text, term, options);
  return matchRanges(buildSearchRegExp(term, options), text);
}

/** How many matches `term` has in one text block, with the same rules as Find. */
export function countMatches(text: string, term: string, options: SearchOptions): number {
  return findMatchRanges(text, term, options).length;
}
