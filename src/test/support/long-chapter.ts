/**
 * The long Chapter the Plugin highlight budget is measured on (#401): the
 * `perfLongChapter` seed's shape, 300 paragraphs and 19771 words by countWords,
 * generated from a fixed seed so every run measures the same document. The
 * frame-rate lane's seed (`e2e/support/seed/perf-libraries.ts`) is the same
 * document; this copy is free of app and platform imports so a unit test or a
 * bench can build it without a Library.
 */

import type { PluginHighlightRange } from "@/features/plugins/types";

const WORDS =
  "the lamp held through the long gale while salt spray hissed on hot glass and the keeper counted every slow turn of the lens until grey dawn found the harbor quiet again with gulls crying over broken rope and tide pools full of cold light".split(
    " "
  );

/** Park-Miller: the same sequence on every build. */
export function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

export function sentence(next: () => number): string {
  const length = 8 + Math.floor(next() * 14);
  const words = Array.from({ length }, () => WORDS[Math.floor(next() * WORDS.length)]);
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return `${words.join(" ")}.`;
}

function paragraph(next: () => number): string {
  const count = 3 + Math.floor(next() * 4);
  return Array.from({ length: count }, () => sentence(next)).join(" ");
}

/** `perfLongChapter`'s long Chapter: 300 paragraphs, 19771 words by countWords. */
export const LONG_CHAPTER_PARAGRAPHS = 300;

/** The ~500 ranges the Echoes budget places on a long Chapter (#401, #403). */
export const HIGHLIGHT_RANGE_COUNT = 500;

/** A long Chapter's HTML: paragraphs with a heading and a list now and then. */
export function longChapterHtml(): string {
  const next = random(372);
  const blocks: string[] = [];
  for (let i = 0; i < LONG_CHAPTER_PARAGRAPHS; i++) {
    if (i % 40 === 0) blocks.push(`<h2>Watch ${i / 40 + 1}</h2>`);
    if (i % 55 === 27) {
      blocks.push(`<ul>${[0, 1, 2].map(() => `<li><p>${sentence(next)}</p></li>`).join("")}</ul>`);
    }
    blocks.push(`<p>${paragraph(next)}</p>`);
  }
  return blocks.join("");
}

/**
 * `count` non-overlapping ranges on whole words spread evenly through `text`,
 * the shape Echoes hands `editor.setHighlights`: in plain-text offsets, with a
 * label so the accessible rendering is exercised too.
 */
export function spreadHighlightRanges(
  text: string,
  count = HIGHLIGHT_RANGE_COUNT
): PluginHighlightRange[] {
  const words: { start: number; end: number }[] = [];
  const pattern = /\S+/g;
  let match = pattern.exec(text);
  while (match !== null) {
    words.push({ start: match.index, end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  const ranges: PluginHighlightRange[] = [];
  const step = Math.max(1, Math.floor(words.length / count));
  for (let i = 0; i < words.length && ranges.length < count; i += step) {
    ranges.push({ from: words[i].start, to: words[i].end, label: `echo ${ranges.length + 1}` });
  }
  return ranges;
}
