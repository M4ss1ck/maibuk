/**
 * A Map Label's lines (#800): where its text breaks and how wide and tall its
 * box is, in page millimetres. The Worker lays every label out here and nowhere
 * else, so the Frame's scene, the SVG export, and a Place draw the same lines
 * from one answer; nothing measures text in a DOM.
 *
 * A line's width is the sum of its glyphs' advances, read from the bundled
 * face's own `hmtx` (`ttf-metrics.ts`), plus the label's letter spacing after
 * every character, which is how SVG adds `letter-spacing`. The drawn text turns
 * kerning and ligatures off (`LABEL_TEXT_STYLE`), so what the browser paints is
 * exactly what was measured. Whitespace collapses as SVG's own default does: a
 * run of spaces draws as one, and a line's leading and trailing spaces draw as
 * none, so the layout drops them too.
 */

import { bundledFontBytes } from "./font-bytes";
import {
  type LabelSizing,
  type MapLabelElement,
  type MapLabelFont,
  MIN_LABEL_WIDTH_MM,
  MAP_LABEL_FONT_FAMILIES,
} from "./maps";
import { type FontMetrics, readFontMetrics } from "./ttf-metrics";

/** How far apart a Map Label's lines sit, as a multiple of its cap size. */
export const LABEL_LINE_HEIGHT = 1.2;

/**
 * The style every drawn Map Label carries, in the Frame and in an export:
 * kerning and ligatures off, because the layout measures plain advances.
 */
export const LABEL_TEXT_STYLE = "font-kerning:none;font-variant-ligatures:none";

/**
 * The author's PDF Font has no bytes in the Worker: the Frame receives its file
 * from the host, and the layout never does. Its lines are measured with this
 * estimate instead, the average advance of a book face's lowercase text per em,
 * so an `auto` label in the PDF Font is about as wide as its words and a
 * `fixed` one wraps near where the face would. The ascent and descent are the
 * usual book-face proportions, used only to place the Frame's text box.
 */
const PDF_FONT_ADVANCE_EM = 0.5;
const PDF_FONT_ASCENT_EM = 0.8;
const PDF_FONT_DESCENT_EM = 0.2;

/** The metrics of each bundled face, read once on its first measure and kept. */
const metricsByFont = new Map<MapLabelFont, FontMetrics | null>();

/** The bundled face's metrics, or null for the PDF Font, which is estimated. */
function fontMetrics(font: MapLabelFont): FontMetrics | null {
  if (font === "pdf") return null;
  const known = metricsByFont.get(font);
  if (known !== undefined) return known;
  const bytes = bundledFontBytes(MAP_LABEL_FONT_FAMILIES[font]);
  const metrics = bytes === null ? null : readFontMetrics(bytes);
  metricsByFont.set(font, metrics);
  return metrics;
}

/** How far a face rises above and falls below its baseline, per em. */
export interface LabelFontExtent {
  ascent: number;
  descent: number;
}

/** The face's ascent and descent per em, so the Frame can seat its text box on the baseline. */
export function labelFontExtent(font: MapLabelFont): LabelFontExtent {
  const metrics = fontMetrics(font);
  if (metrics === null) return { ascent: PDF_FONT_ASCENT_EM, descent: PDF_FONT_DESCENT_EM };
  return {
    ascent: metrics.ascender / metrics.unitsPerEm,
    descent: -metrics.descender / metrics.unitsPerEm,
  };
}

/** The type a line is measured in: the face, the cap size, and the letter spacing. */
export type LabelType = Pick<MapLabelElement, "font" | "size" | "letterSpacing">;

/** One line's drawn width, in page millimetres. */
export function lineWidth(line: string, type: LabelType): number {
  const metrics = fontMetrics(type.font);
  let width = 0;
  for (const character of line) {
    const advance =
      metrics === null
        ? PDF_FONT_ADVANCE_EM
        : metrics.advance(character.codePointAt(0) ?? 0) / metrics.unitsPerEm;
    width += advance * type.size + type.letterSpacing;
  }
  return width;
}

/** A line as SVG draws it: runs of whitespace as one space, none at either end. */
function collapsed(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/**
 * One paragraph broken into lines no wider than `width`: words go on a line
 * while they fit, and a word wider than the box breaks between its letters,
 * so no line ever leaves the box. Every line keeps at least one character.
 */
function wrapParagraph(paragraph: string, width: number, type: LabelType): string[] {
  if (paragraph === "") return [""];
  const lines: string[] = [];
  let line = "";
  const push = (word: string) => {
    const joined = line === "" ? word : `${line} ${word}`;
    if (line === "" || lineWidth(joined, type) <= width) {
      line = joined;
      return;
    }
    lines.push(line);
    line = word;
  };
  for (const word of paragraph.split(" ")) {
    if (lineWidth(word, type) <= width) {
      push(word);
      continue;
    }
    // A word the box cannot hold starts its own lines and breaks by letter.
    if (line !== "") lines.push(line);
    line = "";
    for (const character of word) {
      if (line !== "" && lineWidth(line + character, type) > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  lines.push(line);
  return lines;
}

/** A Map Label's lines and its box, in page millimetres. */
export interface LabelLayout {
  /** The lines as drawn, first to last; an empty one draws nothing but keeps its place. */
  lines: string[];
  /** The box's width: the longest line for `auto`, the stored width for `fixed`. */
  width: number;
  /** The box's height: one cap size, and one line height for each line after the first. */
  height: number;
  /** How far apart the lines' baselines sit. */
  lineHeight: number;
  /** Whether the lines are the placeholder's, because the label has no text. */
  placeholder: boolean;
}

/** What a label is laid out from. */
export type LabelLayoutInput = Pick<
  MapLabelElement,
  "text" | "font" | "size" | "letterSpacing" | "width"
> & { sizing: LabelSizing };

/**
 * Lays one Map Label out (#800). An `auto` label breaks only where the author
 * pressed Enter and is as wide as its longest line; a `fixed` one also wraps
 * each paragraph at its stored width. A label with no text lays out its
 * `placeholder` instead, when the caller draws one, so the editor's box fits the
 * prompt it shows; with none, it is one empty line.
 */
export function layoutLabel(label: LabelLayoutInput, placeholder?: string): LabelLayout {
  const isPlaceholder = label.text === "" && placeholder !== undefined && placeholder !== "";
  const source = isPlaceholder ? (placeholder ?? "") : label.text;
  const paragraphs = source.split("\n").map(collapsed);
  const lines =
    label.sizing === "fixed"
      ? paragraphs.flatMap((paragraph) => wrapParagraph(paragraph, label.width, label))
      : paragraphs;
  const width =
    label.sizing === "fixed"
      ? label.width
      : Math.max(MIN_LABEL_WIDTH_MM, ...lines.map((line) => lineWidth(line, label)));
  const lineHeight = label.size * LABEL_LINE_HEIGHT;
  return {
    lines,
    width,
    height: label.size + (lines.length - 1) * lineHeight,
    lineHeight,
    placeholder: isPlaceholder,
  };
}
