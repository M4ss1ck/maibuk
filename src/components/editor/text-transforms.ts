import type { Editor } from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";

export type TextTransform =
  | "uppercase"
  | "lowercase"
  | "alternatingCase"
  | "sentenceCase"
  | "titleCase"
  | "horizontalMirror"
  | "upsideDown"
  | "reverseText"
  | "leetspeak";

interface GraphemeToken {
  text: string;
  marks: readonly Mark[];
}

interface TransformRange {
  from: number;
  to: number;
  parent: ProseMirrorNode;
  tokens: GraphemeToken[];
}

interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string }>;
}

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" }
) => SegmenterLike;

const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
const graphemeSegmenter = Segmenter ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

const HORIZONTAL_MIRROR_MAP = createPairMap([
  ["a", "ɒ"],
  ["b", "d"],
  ["c", "ɔ"],
  ["e", "ɘ"],
  ["p", "q"],
  ["B", "ꓭ"],
  ["C", "Ↄ"],
  ["D", "ꓷ"],
  ["E", "Ǝ"],
  ["F", "ꟻ"],
  ["G", "⅁"],
  ["J", "Ⴑ"],
  ["K", "ꓘ"],
  ["L", "⅃"],
  ["P", "ꟼ"],
  ["R", "Я"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
  ["/", "\\"],
]);

const UPSIDE_DOWN_MAP = createPairMap([
  ["a", "ɐ"],
  ["b", "q"],
  ["c", "ɔ"],
  ["d", "p"],
  ["e", "ǝ"],
  ["f", "ɟ"],
  ["g", "ƃ"],
  ["h", "ɥ"],
  ["i", "ᴉ"],
  ["j", "ɾ"],
  ["k", "ʞ"],
  ["m", "ɯ"],
  ["n", "u"],
  ["r", "ɹ"],
  ["t", "ʇ"],
  ["v", "ʌ"],
  ["w", "ʍ"],
  ["y", "ʎ"],
  ["A", "∀"],
  ["C", "Ɔ"],
  ["E", "Ǝ"],
  ["F", "Ⅎ"],
  ["G", "פ"],
  ["J", "ſ"],
  ["K", "⋊"],
  ["L", "˥"],
  ["M", "W"],
  ["P", "Ԁ"],
  ["R", "ᴚ"],
  ["T", "⊥"],
  ["U", "∩"],
  ["V", "Λ"],
  ["Y", "⅄"],
  ["1", "Ɩ"],
  ["2", "ᄅ"],
  ["3", "Ɛ"],
  ["4", "ㄣ"],
  ["5", "ϛ"],
  ["6", "9"],
  ["7", "ㄥ"],
  ["!", "¡"],
  ["?", "¿"],
  [".", "˙"],
  [",", "'"],
  ['"', "„"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
  ["_", "‾"],
]);

const LEETSPEAK_MAP = new Map([
  ["a", "4"],
  ["A", "4"],
  ["e", "3"],
  ["E", "3"],
  ["i", "1"],
  ["I", "1"],
  ["o", "0"],
  ["O", "0"],
  ["s", "5"],
  ["S", "5"],
  ["t", "7"],
  ["T", "7"],
]);

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const SENTENCE_END = /[.!?]/u;

function createPairMap(pairs: readonly (readonly [string, string])[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const [left, right] of pairs) {
    map.set(left, right);
    map.set(right, left);
  }
  return map;
}

function segmentGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

function collectTransformRanges(doc: ProseMirrorNode, from: number, to: number): TransformRange[] {
  const ranges: TransformRange[] = [];

  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isText || !node.text || !parent) return;

    const selectedFrom = Math.max(from, pos);
    const selectedTo = Math.min(to, pos + node.nodeSize);
    if (selectedFrom >= selectedTo) return;

    const text = node.text.slice(selectedFrom - pos, selectedTo - pos);
    const tokens = segmentGraphemes(text).map((grapheme) => ({
      text: grapheme,
      marks: node.marks,
    }));
    const previous = ranges[ranges.length - 1];

    if (previous && previous.parent === parent && previous.to === selectedFrom) {
      previous.to = selectedTo;
      previous.tokens.push(...tokens);
      return;
    }

    ranges.push({
      from: selectedFrom,
      to: selectedTo,
      parent,
      tokens,
    });
  });

  return ranges;
}

function mapTokens(
  tokens: readonly GraphemeToken[],
  map: ReadonlyMap<string, string>,
  reverse = false
): GraphemeToken[] {
  const ordered = reverse ? [...tokens].reverse() : tokens;
  return ordered.map((token) => ({
    ...token,
    text: map.get(token.text) ?? token.text,
  }));
}

function transformTokens(
  tokens: readonly GraphemeToken[],
  transform: TextTransform
): GraphemeToken[] {
  switch (transform) {
    case "uppercase":
      return tokens.map((token) => ({ ...token, text: token.text.toUpperCase() }));
    case "lowercase":
      return tokens.map((token) => ({ ...token, text: token.text.toLowerCase() }));
    case "alternatingCase":
      return tokens.map((token, index) => ({
        ...token,
        text: index % 2 === 0 ? token.text.toLowerCase() : token.text.toUpperCase(),
      }));
    case "sentenceCase": {
      let capitalizeNext = true;
      return tokens.map((token) => {
        const lower = token.text.toLowerCase();
        let text = lower;
        if (capitalizeNext && WORD_CHARACTER.test(lower)) {
          text = lower.toUpperCase();
          capitalizeNext = false;
        }
        if (SENTENCE_END.test(lower)) capitalizeNext = true;
        return { ...token, text };
      });
    }
    case "titleCase": {
      let wordStart = true;
      return tokens.map((token) => {
        const lower = token.text.toLowerCase();
        if (!WORD_CHARACTER.test(lower)) {
          wordStart = true;
          return { ...token, text: lower };
        }
        const text = wordStart ? lower.toUpperCase() : lower;
        wordStart = false;
        return { ...token, text };
      });
    }
    case "horizontalMirror":
      return mapTokens(tokens, HORIZONTAL_MIRROR_MAP, true);
    case "upsideDown":
      return mapTokens(tokens, UPSIDE_DOWN_MAP, true);
    case "reverseText":
      return [...tokens].reverse();
    case "leetspeak":
      return mapTokens(tokens, LEETSPEAK_MAP);
  }
}

export function transformSelectedText(editor: Editor, transform: TextTransform): boolean {
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;

  const ranges = collectTransformRanges(editor.state.doc, from, to);
  if (ranges.length === 0) return false;

  const transaction = editor.state.tr;
  for (const range of [...ranges].reverse()) {
    const content = transformTokens(range.tokens, transform).map((token) =>
      editor.schema.text(token.text, token.marks)
    );
    transaction.replaceWith(range.from, range.to, content);
  }

  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}
