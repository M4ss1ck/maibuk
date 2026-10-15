/**
 * Echoes' editor highlight model (#451, unit 2): the pure step between
 * `findEchoes` output and the host's `editor.setHighlights` call. It turns each
 * Echo into the labelled ranges the editor paints, keeps the ranges of the
 * kinds the author enabled, and exposes the one ordered list the Next/Previous
 * echo Commands step through.
 *
 * Each Echo kind maps to one host kind (decision 2): nearby -> "repetition",
 * overused -> "info", phrase -> "warning". A nearby echo highlights both of its
 * words; every range carries a localized label, e.g. "door, repeated 14 words
 * earlier" (the distance in words to the previous occurrence) or "just, used 23
 * times". The labels come from the Plugin's own runtime catalog, so this module
 * takes a `t` built by its caller and never reads the host's i18n.
 *
 * The distance in words and the surface word both come from the text the Echo
 * was found in: `findEchoes` returns plain-text offsets and no text, so the
 * caller passes the same text (or Chapter list) it detected against as `text`.
 *
 * Decision 7 caps what one editor paints (`ECHO_PAINT_LIMIT`): `buildEchoList`
 * returns the full, label-free list, `paintWindow` slices it around the caret,
 * and `echoHighlightSets` builds label text only for that slice; Next/Previous
 * walk the full list and the announcement names its full count.
 *
 * Imports only this Plugin's own files.
 */

import { type Echo, type EchoKind, type EchoOccurrence } from "./find-echoes";
import { type EchoKey, format, translate } from "./i18n";
import { type Token, tokenize } from "./language";

/** The host `editor.setHighlights` kind each Echo kind paints as (decision 2). */
export type PluginEchoHighlightKind = "repetition" | "info" | "warning";

/** The three host kinds, in a stable order. */
export const ECHO_HIGHLIGHT_KINDS: readonly PluginEchoHighlightKind[] = [
  "repetition",
  "info",
  "warning",
];

/** The host kind each Echo kind paints as. */
export const ECHO_HIGHLIGHT_KIND: Readonly<Record<EchoKind, PluginEchoHighlightKind>> = {
  nearby: "repetition",
  overused: "info",
  phrase: "warning",
};

/** The most ranges one editor paints at a time (#451, decision 7). */
export const ECHO_PAINT_LIMIT = 2000;

/** One labelled range the editor paints. */
export interface EchoHighlightRange {
  from: number;
  to: number;
  label: string;
}

/** Each host kind and the ranges it paints; a kind with nothing is an empty list. */
export type EchoHighlightSets = Readonly<Record<PluginEchoHighlightKind, readonly EchoHighlightRange[]>>;

/**
 * Everything needed to build one range's localized label (#451, decision 7): the
 * runtime key and its `{{word}}`/`{{count}}` values. A range keeps this instead
 * of a label string, so a list of thousands builds no label text until it is
 * painted or announced.
 */
export interface EchoLabelSpec {
  key: EchoKey;
  word: string;
  count: number;
}

/** One entry of the ordered list Next/Previous echo step through. */
export interface EchoNavigationEntry {
  from: number;
  to: number;
  kind: PluginEchoHighlightKind;
  /** The label's runtime key and values, built into text only when painted or announced. */
  label: EchoLabelSpec;
}

/**
 * Looks one runtime string up and fills its `{{name}}` placeholders. Built by
 * the runtime (or a test) over the Plugin's own catalog; the module never
 * chooses the language itself.
 */
export type EchoTranslate = (
  key: EchoKey,
  values?: Readonly<Record<string, string | number>>
) => string;

/** A `t` for one language over the runtime catalog. */
export function createEchoTranslator(language: string): EchoTranslate {
  return (key, values) => {
    const count = typeof values?.count === "number" ? values.count : undefined;
    const template = translate(language, key, count);
    return values === undefined ? template : format(template, values);
  };
}

/** Builds one entry's localized label text from its spec (#451, decision 7). */
export function echoLabel(spec: EchoLabelSpec, t: EchoTranslate): string {
  return t(spec.key, { word: spec.word, count: spec.count });
}

/** A nearby echo's two ends: the word itself with the direction named. */
const NEARBY_EARLIER: EchoKey = "echo.label.nearbyEarlier";
const NEARBY_LATER: EchoKey = "echo.label.nearbyLater";
const OVERUSED: EchoKey = "echo.label.overused";
const PHRASE: EchoKey = "echo.label.phrase";

/** The runtime key for "Echo highlights are off" (decision 4). */
export const ECHO_HIGHLIGHTS_OFF_KEY: EchoKey = "echo.highlightsOff";
/** The runtime key for "No echoes found". */
export const ECHO_NO_ECHOES_KEY: EchoKey = "echo.none";

const ANNOUNCEMENT: EchoKey = "echo.announcement";

/** "Echo highlights are off", localized. */
export function echoHighlightsOff(t: EchoTranslate): string {
  return t(ECHO_HIGHLIGHTS_OFF_KEY);
}

/** "No echoes found", localized. */
export function echoNoEchoes(t: EchoTranslate): string {
  return t(ECHO_NO_ECHOES_KEY);
}

function chapterTextOf(text: string | readonly string[], chapter: number): string {
  return typeof text === "string" ? (chapter === 0 ? text : "") : (text[chapter] ?? "");
}

/** Each token's index keyed by the offset it starts at, for O(1) distance lookups. */
function tokenIndexByFrom(tokens: readonly Token[]): Map<number, number> {
  const indexes = new Map<number, number>();
  for (let index = 0; index < tokens.length; index++) indexes.set(tokens[index].from, index);
  return indexes;
}

function surface(text: string | readonly string[], occurrence: EchoOccurrence): string {
  const chapterText = chapterTextOf(text, occurrence.chapter);
  return chapterText.slice(occurrence.from, occurrence.to);
}

/**
 * The full, ordered list of an editor's Echo ranges (#451, decision 7): one
 * entry per range of an enabled kind, sorted by `from` then `to` and
 * deduplicated. Only the kinds in `enabledKinds` contribute; a nearby Echo
 * highlights both of its words, the first labelled "later" and every other
 * "earlier"; an overused word and a repeated phrase carry the word's total
 * count. Labels are kept as specs, so the whole list costs no string building.
 */
export function buildEchoList(
  echoes: readonly Echo[],
  enabledKinds: readonly EchoKind[],
  text: string | readonly string[],
  tokens?: readonly (readonly Token[])[]
): EchoNavigationEntry[] {
  const enabled = new Set<EchoKind>(enabledKinds);
  const list: EchoNavigationEntry[] = [];
  // An entry is deduplicated by (kind, from, to, label spec). One string key per
  // candidate avoids building the label text itself (#451).
  const seen = new Set<string>();
  const indexesByChapter = new Map<number, Map<number, number>>();
  const indexesFor = (chapter: number): Map<number, number> => {
    let indexes = indexesByChapter.get(chapter);
    if (indexes === undefined) {
      const chapterTokens = tokens?.[chapter] ?? tokenize(chapterTextOf(text, chapter));
      indexes = tokenIndexByFrom(chapterTokens);
      indexesByChapter.set(chapter, indexes);
    }
    return indexes;
  };
  const push = (
    kind: PluginEchoHighlightKind,
    from: number,
    to: number,
    label: EchoLabelSpec
  ): void => {
    const id = `${kind}|${from}|${to}|${label.key}|${label.word}|${label.count}`;
    if (seen.has(id)) return;
    seen.add(id);
    list.push({ from, to, kind, label });
  };

  for (const echo of echoes) {
    if (!enabled.has(echo.kind)) continue;
    const hostKind = ECHO_HIGHLIGHT_KIND[echo.kind];
    const occurrences = echo.occurrences;
    if (echo.kind === "nearby") {
      const tokenIndexes = indexesFor(occurrences[0].chapter);
      const indexes = occurrences.map((occurrence) => tokenIndexes.get(occurrence.from) ?? -1);
      occurrences.forEach((occurrence, index) => {
        const word = surface(text, occurrence);
        const distance =
          index === 0 ? indexes[1] - indexes[0] : indexes[index] - indexes[index - 1];
        const key = index === 0 ? NEARBY_LATER : NEARBY_EARLIER;
        push(hostKind, occurrence.from, occurrence.to, { key, word, count: distance });
      });
      continue;
    }
    const count = occurrences.length;
    const firstWord = surface(text, occurrences[0]);
    for (const occurrence of occurrences) {
      const word = echo.kind === "phrase" ? firstWord : surface(text, occurrence);
      const key = echo.kind === "overused" ? OVERUSED : PHRASE;
      push(hostKind, occurrence.from, occurrence.to, { key, word, count });
    }
  }
  return list.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * The painted ranges for the entries given, split by host kind and labelled
 * (#451, decision 7). Label text is built only here — for a painted window — and
 * for an announced entry, never for the whole list.
 */
export function echoHighlightSets(
  entries: readonly EchoNavigationEntry[],
  t: EchoTranslate
): EchoHighlightSets {
  const sets: Record<PluginEchoHighlightKind, EchoHighlightRange[]> = {
    repetition: [],
    info: [],
    warning: [],
  };
  for (const entry of entries) {
    sets[entry.kind].push({
      from: entry.from,
      to: entry.to,
      label: echoLabel(entry.label, t),
    });
  }
  return sets;
}

/**
 * The `[start, end)` slice of a `from`-sorted list the editor paints (#451,
 * decision 7): `min(limit, list.length)` contiguous entries centered on the
 * caret, clamped at both ends. An empty list, or a non-positive limit, yields an
 * empty slice.
 */
export function paintWindow(
  list: readonly { from: number }[],
  caret: number,
  limit: number
): { start: number; end: number } {
  const total = list.length;
  const size = Math.max(0, Math.min(Math.floor(limit), total));
  if (size === 0) return { start: 0, end: 0 };
  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(lowerBoundFrom(list, caret) - half, 0), total - size);
  return { start, end: start + size };
}

/** The first index whose `from` is at or after `caret` (binary search). */
function lowerBoundFrom(list: readonly { from: number }[], caret: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid].from < caret) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The index Next/Previous echo moves to, wrapping at both ends (#451,
 * decision 4). `caret` is the editor's caret offset when it can be read, else
 * `null`; `index` is the entry the last step landed on, `null` before the first.
 *
 * A caret picks the neighbouring Echo by offset: the first entry past it going
 * next, the last entry before it going previous. When the caret still sits on
 * the entry just stepped to, the step goes by index instead, so two Echoes of
 * different kinds that share an offset are each visited rather than skipped.
 * Without a caret, the step goes from the remembered index, entering the list
 * at the first entry going next and the last going previous. An empty list,
 * and a null start with no entry, stay `null`.
 */
export function stepFrom(
  list: readonly { from: number }[],
  caret: number | null,
  direction: "next" | "previous",
  index: number | null = null
): number | null {
  const total = list.length;
  if (total === 0) return null;
  const step = direction === "next" ? 1 : -1;
  const fromIndex =
    index === null ? (direction === "next" ? 0 : total - 1) : (index + step + total) % total;
  // A readable caret that has moved off the last stepped entry picks by offset;
  // otherwise (no caret, or the caret still on that entry) the step is by index.
  if (caret === null || (index !== null && list[index]?.from === caret)) return fromIndex;
  if (direction === "next") {
    const found = list.findIndex((entry) => entry.from > caret);
    return found === -1 ? 0 : found;
  }
  for (let current = total - 1; current >= 0; current--) {
    if (list[current].from < caret) return current;
  }
  return total - 1;
}

/**
 * "Echo 3 of 12: door, repeated 14 words earlier" (1-based); "No echoes found"
 * when empty. The label is built here, for the one announced entry, and the
 * count is the full list's (decision 7).
 */
export function echoAnnouncement(
  list: readonly EchoNavigationEntry[],
  index: number,
  t: EchoTranslate
): string {
  const entry = list[index];
  if (entry === undefined) return echoNoEchoes(t);
  return t(ANNOUNCEMENT, { index: index + 1, count: list.length, label: echoLabel(entry.label, t) });
}
