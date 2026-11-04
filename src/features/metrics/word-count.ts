import { HAN_KANA_LETTER } from "@/lib/search/expression";

// The lookahead leaves letters and numbers in these blocks (〇, fullwidth Ａ ４) out.
const CJK_PUNCTUATION =
  "(?=[\\p{P}\\p{S}\\p{Zs}])[\\u3000-\\u303F\\u30A0\\u30FB\\uFE30-\\uFE4F\\uFF00-\\uFFEF]";

const HAN_KANA_OR_PUNCTUATION = new RegExp(`${HAN_KANA_LETTER}|${CJK_PUNCTUATION}`, "u");
const HAN_KANA_LETTERS = new RegExp(HAN_KANA_LETTER, "gu");
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

/**
 * The word count for a Chapter, the editor, and the metrics classifier.
 *
 * Not `Intl.Segmenter`: its word boundaries depend on the engine's ICU
 * version, so devices on different builds would store different counts for
 * the same Chapter and sync would see them as edits.
 *
 * English and Spanish are whitespace tokens, unchanged. In Han and kana text
 * every letter is a word of its own, and CJK punctuation separates words.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  if (!HAN_KANA_OR_PUNCTUATION.test(trimmed)) return trimmed.split(/\s+/).length;

  let words = 0;
  for (const token of trimmed.split(/\s+/)) {
    if (!HAN_KANA_OR_PUNCTUATION.test(token)) {
      words += 1;
      continue;
    }
    words += token.match(HAN_KANA_LETTERS)?.length ?? 0;
    for (const fragment of token.split(HAN_KANA_OR_PUNCTUATION)) {
      if (HAS_LETTER_OR_NUMBER.test(fragment)) words += 1;
    }
  }
  return words;
}
