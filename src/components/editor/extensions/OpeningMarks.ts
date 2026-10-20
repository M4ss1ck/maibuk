import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

type Closer = "?" | "!";

const OPENER: Record<Closer, string> = { "?": "¿", "!": "¡" };
const OPENERS = "¿¡";
const CLOSERS = "?!";

// Where a question or exclamation can start: after the end of a sentence or
// clause or a line break, or after an opening quote or bracket still open.
const ENDS = new Set([".", "…", "?", "!", ";", ":", ",", "—", "–", "\n"]);
const OPENING = new Set(["(", "[", "«", "“", "‘"]);
// "’" is left out: it is also the apostrophe.
const CLOSING: Record<string, string> = { ")": "(", "]": "[", "»": "«", "”": "“" };

const OBJECT_REPLACEMENT = String.fromCodePoint(0xfffc);

/** Hard breaks read as a line break; any other inline leaf as an opaque character. */
const leafText = (node: PMNode) => (node.type.name === "hardBreak" ? "\n" : OBJECT_REPLACEMENT);

const isDigit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";

/** A comma or period inside a number ("3,5", "3.5") ends nothing. */
const isNumberSeparator = (text: string, index: number) =>
  (text[index] === "." || text[index] === ",") &&
  isDigit(text[index - 1]) &&
  isDigit(text[index + 1]);

function skipSpaces(text: string, index: number): number {
  let start = index;
  while (start < text.length && /\s/.test(text[start])) start += 1;
  return start;
}

/**
 * Index where the question or exclamation ending at the end of `text` starts.
 * Scans back to the nearest boundary, passing over any quote or bracket the
 * text already closed: "(ya) vienes" is one question, "(ya vienes" starts
 * inside the bracket.
 */
function questionStart(text: string): number {
  const awaiting: string[] = [];
  let insideStraightQuote = false;
  let straightQuotes = [...text].filter((char) => char === '"').length;

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === '"') {
      // An odd count up to here makes this quote an opening one.
      const opening = straightQuotes % 2 === 1;
      straightQuotes -= 1;
      if (!opening) insideStraightQuote = true;
      else if (insideStraightQuote) insideStraightQuote = false;
      else if (awaiting.length === 0) return skipSpaces(text, index + 1);
      continue;
    }
    if (insideStraightQuote) continue;
    if (char in CLOSING) {
      awaiting.push(CLOSING[char]);
      continue;
    }
    if (OPENING.has(char)) {
      if (awaiting.length === 0) return skipSpaces(text, index + 1);
      if (awaiting[awaiting.length - 1] === char) awaiting.pop();
      continue;
    }
    if (awaiting.length === 0 && ENDS.has(char) && !isNumberSeparator(text, index)) {
      return skipSpaces(text, index + 1);
    }
  }
  return skipSpaces(text, 0);
}

/**
 * Where to insert the opening mark for a ? or ! typed at the end of `before`
 * (the paragraph's text up to the caret), or null when nothing should change.
 * A closer typed right after a run of closers extends the matching run of
 * openers at its outer edge, so "?!" opens as "¡¿".
 */
export function openingMarkOffset(before: string): number | null {
  let runStart = before.length;
  while (runStart > 0 && CLOSERS.includes(before[runStart - 1])) runStart -= 1;
  const runLength = before.length - runStart;
  const body = before.slice(0, runStart);
  const start = questionStart(body);

  if (runLength > 0) {
    let openers = 0;
    while (start + openers < body.length && OPENERS.includes(body[start + openers])) {
      openers += 1;
    }
    const hasText = /[\p{L}\p{N}]/u.test(body.slice(start + openers));
    return openers === runLength && hasText ? start : null;
  }

  const span = body.slice(start);
  if (!/[\p{L}\p{N}]/u.test(span)) return null;
  if ([...OPENERS].some((opener) => span.includes(opener))) return null;
  return start;
}

export function isSpanish(language: string | null | undefined): boolean {
  return typeof language === "string" && /^es(?:[-_]|$)/i.test(language);
}

interface LastOpener {
  /** Position of the opening mark just inserted. */
  at: number;
  /** Caret position right after its closing mark. */
  caret: number;
}

const openingMarksKey = new PluginKey<LastOpener | null>("openingMarks");

function inCode(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.spec.code) return true;
  }
  return $from.marks().some((mark) => mark.type.spec.code);
}

function addOpeningMark(view: EditorView, from: number, to: number, text: string): boolean {
  if (text !== "?" && text !== "!") return false;
  const { state } = view;
  if (from !== to || inCode(state)) return false;

  const { $from } = state.selection;
  if (!$from.parent.isTextblock) return false;
  const blockStart = $from.start();
  const before = state.doc.textBetween(blockStart, from, undefined, leafText);
  const offset = openingMarkOffset(before);
  if (offset === null) return false;

  // Type the closer as its own step first so undo can take the opener back alone.
  view.dispatch(state.tr.insertText(text, from, to));

  const at = blockStart + offset;
  const next = view.state;
  const marks = next.doc.nodeAt(at)?.marks ?? next.doc.resolve(at).marks();
  const tr = next.tr.insert(at, next.schema.text(OPENER[text], marks));
  closeHistory(tr);
  tr.setMeta(openingMarksKey, { at, caret: tr.selection.from });
  view.dispatch(tr);
  return true;
}

function removeLastOpener(view: EditorView): boolean {
  const last = openingMarksKey.getState(view.state);
  const { selection } = view.state;
  if (!last || !selection.empty || selection.from !== last.caret) return false;
  view.dispatch(view.state.tr.delete(last.at, last.at + 1));
  return true;
}

export interface OpeningMarksOptions {
  /** The language of the text being edited, or null while Opening Marks are off. */
  getLanguage: () => string | null;
}

/**
 * Opening Marks: typing ? or ! in Spanish text adds the matching ¿ or ¡ where
 * the question or exclamation starts. Backspace right after takes it back.
 */
export const OpeningMarks = Extension.create<OpeningMarksOptions>({
  name: "openingMarks",

  // Its Backspace only acts right after an opener lands; run it before any other
  // Backspace handler so none of them can take that keystroke first.
  priority: 1000,

  addOptions() {
    return { getLanguage: () => null };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => removeLastOpener(editor.view),
    };
  },

  addProseMirrorPlugins() {
    const { getLanguage } = this.options;
    return [
      new Plugin<LastOpener | null>({
        key: openingMarksKey,
        state: {
          init: () => null,
          apply(tr, last) {
            const meta = tr.getMeta(openingMarksKey) as LastOpener | null | undefined;
            if (meta !== undefined) return meta;
            return tr.docChanged || tr.selectionSet ? null : last;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (!isSpanish(getLanguage())) return false;
            return addOpeningMark(view, from, to, text);
          },
        },
      }),
    ];
  },
});
