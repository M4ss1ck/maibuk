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

/** One labelled range the editor paints. */
export interface EchoHighlightRange {
  from: number;
  to: number;
  label: string;
}

/** Each host kind and the ranges it paints; a kind with nothing is an empty list. */
export type EchoHighlightSets = Readonly<Record<PluginEchoHighlightKind, readonly EchoHighlightRange[]>>;

/** One entry of the ordered list Next/Previous echo step through. */
export interface EchoNavigationEntry extends EchoHighlightRange {
  kind: PluginEchoHighlightKind;
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

/** The token index of the token that starts at `from`, or -1 when none does. */
function indexOfFrom(tokens: readonly Token[], from: number): number {
  return tokens.findIndex((token) => token.from === from);
}

function surface(text: string | readonly string[], occurrence: EchoOccurrence): string {
  const chapterText = chapterTextOf(text, occurrence.chapter);
  return chapterText.slice(occurrence.from, occurrence.to);
}

/**
 * Turns `findEchoes` output into per-host-kind range lists. Only the kinds in
 * `enabledKinds` contribute; a nearby Echo highlights both of its words, the
 * first labelled "later" and every other "earlier"; an overused word and a
 * repeated phrase label every occurrence with the word's total count. Identical
 * ranges within one kind are deduplicated.
 */
export function echoHighlightRanges(
  echoes: readonly Echo[],
  enabledKinds: readonly EchoKind[],
  t: EchoTranslate,
  text: string | readonly string[]
): EchoHighlightSets {
  const enabled = new Set<EchoKind>(enabledKinds);
  const sets: Record<PluginEchoHighlightKind, EchoHighlightRange[]> = {
    repetition: [],
    info: [],
    warning: [],
  };
  const seen = new Set<string>();
  const tokensByChapter = new Map<number, Token[]>();
  const tokensFor = (chapter: number): Token[] => {
    let tokens = tokensByChapter.get(chapter);
    if (tokens === undefined) {
      tokens = tokenize(chapterTextOf(text, chapter));
      tokensByChapter.set(chapter, tokens);
    }
    return tokens;
  };
  const push = (kind: PluginEchoHighlightKind, range: EchoHighlightRange): void => {
    const key = `${kind}\u0000${range.from}\u0000${range.to}\u0000${range.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    sets[kind].push(range);
  };

  for (const echo of echoes) {
    if (!enabled.has(echo.kind)) continue;
    const hostKind = ECHO_HIGHLIGHT_KIND[echo.kind];
    const occurrences = echo.occurrences;
    if (echo.kind === "nearby") {
      const tokens = tokensFor(occurrences[0].chapter);
      const indexes = occurrences.map((occurrence) => indexOfFrom(tokens, occurrence.from));
      occurrences.forEach((occurrence, index) => {
        const word = surface(text, occurrence);
        const distance =
          index === 0 ? indexes[1] - indexes[0] : indexes[index] - indexes[index - 1];
        const key = index === 0 ? NEARBY_LATER : NEARBY_EARLIER;
        push(hostKind, { from: occurrence.from, to: occurrence.to, label: t(key, { word, count: distance }) });
      });
      continue;
    }
    const count = occurrences.length;
    const first = occurrences[0];
    const firstWord = surface(text, first);
    for (const occurrence of occurrences) {
      const word = echo.kind === "phrase" ? firstWord : surface(text, occurrence);
      const key = echo.kind === "overused" ? OVERUSED : PHRASE;
      push(hostKind, { from: occurrence.from, to: occurrence.to, label: t(key, { word, count }) });
    }
  }
  return sets;
}

/** Merges every kind's ranges into one list, ordered by `from`, then `to`. */
export function echoNavigationList(sets: EchoHighlightSets): EchoNavigationEntry[] {
  const list: EchoNavigationEntry[] = [];
  for (const kind of ECHO_HIGHLIGHT_KINDS) {
    for (const range of sets[kind]) list.push({ ...range, kind });
  }
  return list.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * The index Next/Previous echo moves to, wrapping at both ends. A null start
 * enters the list at the first entry going next, the last going previous; an
 * empty list stays null.
 */
export function stepEcho(
  list: readonly EchoNavigationEntry[],
  currentIndex: number | null,
  direction: "next" | "previous"
): number | null {
  if (list.length === 0) return null;
  if (currentIndex === null) return direction === "next" ? 0 : list.length - 1;
  const step = direction === "next" ? 1 : -1;
  return (currentIndex + step + list.length) % list.length;
}

/** "Echo 3 of 12: door, repeated 14 words earlier" (1-based); "No echoes found" when empty. */
export function echoAnnouncement(
  list: readonly EchoNavigationEntry[],
  index: number,
  t: EchoTranslate
): string {
  const entry = list[index];
  if (entry === undefined) return echoNoEchoes(t);
  return t(ANNOUNCEMENT, { index: index + 1, count: list.length, label: entry.label });
}
