import { InputRule } from "@tiptap/core";
import Italic from "@tiptap/extension-italic";

/**
 * Italic with markdown-style input rules that behave like CommonMark and the
 * editors authors expect (GitHub, Obsidian, Typora):
 *
 * - Underscores are **boundary-triggered**: `_word_` only turns italic once a
 *   word boundary (space, punctuation) is typed after the closing `_`. This
 *   keeps identifiers such as `_named_function` and `snake_case` literal, since
 *   a closing `_` touching a word character never emphasizes. A WYSIWYG input
 *   rule cannot look ahead, so we trigger on the boundary char rather than the
 *   closing `_`.
 * - Asterisks keep the immediate trigger (italic on the closing `*`), matching
 *   CommonMark where `*` is allowed intraword.
 * - A leading backslash escapes either delimiter (`\_word_`, `\*word*`) and is
 *   stripped, leaving the literal text.
 *
 * Italicizing part of a word is still available by selecting it and toggling
 * italic (Ctrl/Cmd+I or the toolbar) — unaffected by these rules.
 */

// Boundary-triggered: `<lead>` `<\?>` `_` inner `_` `<boundary>` at the cursor.
// Inner must not start/end with whitespace; boundary is the just-typed char.
const underscoreRegex = /(^|\s)(\\?)_(?!\s)([^_]*[^\s_])_(\W)$/;

// Immediate: fires on the closing `*` typed at the cursor.
const starRegex = /(^|\s)(\\?)\*(?!\s)([^*]+?)\*$/;

export const SmartItalic = Italic.extend({
  addInputRules() {
    const markType = this.type;

    return [
      new InputRule({
        find: underscoreRegex,
        handler: ({ state, range, match }) => {
          const lead = match[1] ?? "";
          const escaped = Boolean(match[2]);
          const inner = match[3];
          const boundary = match[4] ?? "";
          if (!inner) return null;

          const { tr } = state;
          const start = range.from + lead.length;
          const replacement = escaped ? `_${inner}_` : inner;

          tr.insertText(replacement + boundary, start, range.to);

          if (!escaped) {
            tr.addMark(start, start + inner.length, markType.create());
            tr.removeStoredMark(markType);
          }
        },
      }),
      new InputRule({
        find: starRegex,
        handler: ({ state, range, match }) => {
          const lead = match[1] ?? "";
          const escaped = Boolean(match[2]);
          const inner = match[3];
          if (!inner) return null;

          const { tr } = state;
          const start = range.from + lead.length;
          // The closing `*` was typed (not yet in the doc); re-add it only for
          // the escaped (literal) case.
          const replacement = escaped ? `*${inner}*` : inner;

          tr.insertText(replacement, start, range.to);

          if (!escaped) {
            tr.addMark(start, start + inner.length, markType.create());
            tr.removeStoredMark(markType);
          }
        },
      }),
    ];
  },
});
