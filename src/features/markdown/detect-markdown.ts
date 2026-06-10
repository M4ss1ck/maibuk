/**
 * Heuristic Markdown detection.
 *
 * Returns true when the text shows clear structural Markdown signals. The bar
 * is deliberately conservative so plain prose with a stray "-" or a number
 * isn't mistaken for Markdown: we require either two *distinct* signal types,
 * or a single strong block-level signal (fenced code or a GFM table row).
 */

interface SignalMatchers {
  /** A signal that on its own is strong enough to call the text Markdown. */
  strong: RegExp[];
  /** Signals that count toward the "two distinct types" threshold. */
  weak: RegExp[];
}

const SIGNALS: SignalMatchers = {
  strong: [
    /^```/m, // fenced code block
    /^~~~/m, // fenced code block (tilde)
    /^\|.*\|.*\n\|?[\s:|-]+\|/m, // GFM table (header + delimiter row)
  ],
  weak: [
    /^#{1,6}\s+\S/m, // ATX heading
    /^\s*[-*+]\s+\S/m, // unordered list item
    /^\s*\d+\.\s+\S/m, // ordered list item
    /^\s*>\s+\S/m, // blockquote
    /^(?:-{3,}|\*{3,}|_{3,})\s*$/m, // thematic break
    /\[[^\]]+\]\([^)]+\)/, // inline link
    /(\*\*|__)(?=\S)[\s\S]+?\S\1/, // bold
    /(?<![*\w])\*(?=\S)[^*\n]+?\S\*(?!\*)/, // italic with *
    /~~(?=\S)[\s\S]+?\S~~/, // strikethrough
    /`[^`\n]+`/, // inline code
  ],
};

export function looksLikeMarkdown(text: string): boolean {
  if (!text || !text.trim()) return false;

  for (const matcher of SIGNALS.strong) {
    if (matcher.test(text)) return true;
  }

  let distinctTypes = 0;
  for (const matcher of SIGNALS.weak) {
    if (matcher.test(text)) {
      distinctTypes++;
      if (distinctTypes >= 2) return true;
    }
  }

  return false;
}
