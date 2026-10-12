/**
 * The plain-text coordinate system the Plugin editor API shares with the
 * Library reads (#396, #441). `buildPlainTextMap` walks a ProseMirror document
 * exactly the way `editor.getText()` does (`getTextBetween`: a `"\n\n"` block
 * separator, inline atoms and images contributing nothing), recording for every
 * text run where it sits in the plain text and where it sits in the document.
 * `plainOffsetToPm`, `pmToPlainOffset`, and `plainRangeToPmRange` convert
 * between the two, so a selection read, a highlight range, and a reveal range
 * all speak the same offsets.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** One text run: its plain-text span and the document position it starts at. */
export interface PlainTextSegment {
  textStart: number;
  textEnd: number;
  pmStart: number;
}

export interface PlainTextMap {
  text: string;
  segments: PlainTextSegment[];
}

/**
 * Replicates `getTextBetween(doc, { from: 0, to: doc.content.size })` while
 * recording the document position behind every text run.
 */
export function buildPlainTextMap(doc: ProseMirrorNode): PlainTextMap {
  const range = { from: 0, to: doc.content.size };
  let text = "";
  const segments: PlainTextSegment[] = [];
  doc.nodesBetween(range.from, range.to, (node, pos, parent, index) => {
    if (node.isBlock && pos > 0) text += "\n\n";
    // A node with `renderText` contributes synthesized text that has no text
    // node behind it (a hard break's newline, a Wikilink's `[[label]]`): it
    // moves the offsets but no highlight can cover it.
    const serializer = node.type.spec.toText;
    if (serializer) {
      text += serializer({ node, pos, parent, index, range });
      return false;
    }
    const value = node.isText ? (node.text ?? "") : "";
    if (value.length === 0) return;
    const textStart = text.length;
    segments.push({ textStart, textEnd: textStart + value.length, pmStart: pos });
    text += value;
  });
  return { text, segments };
}

/**
 * A document position as a plain-text offset. A position in a block gap (the
 * space between two text runs, where no character exists) resolves to the next
 * run's start; a position past the last run resolves to its end.
 */
export function pmToPlainOffset(map: PlainTextMap, pos: number): number {
  for (const segment of map.segments) {
    if (pos <= segment.pmStart) return segment.textStart;
    const length = segment.textEnd - segment.textStart;
    if (pos <= segment.pmStart + length) return segment.textStart + (pos - segment.pmStart);
  }
  const last = map.segments[map.segments.length - 1];
  return last ? last.textEnd : 0;
}

/**
 * A plain-text offset as a document position. `start` picks the position of the
 * character at the offset (an offset in a gap lands on the next run), `end`
 * picks the position just after the character before it (an offset in a gap
 * lands on the previous run's end).
 */
export function plainOffsetToPm(map: PlainTextMap, offset: number, bias: "start" | "end"): number {
  const segments = map.segments;
  if (segments.length === 0) return 0;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (offset <= 0) return first.pmStart;
  if (offset >= map.text.length) return last.pmStart + (last.textEnd - last.textStart);

  if (bias === "start") {
    for (const segment of segments) {
      if (offset <= segment.textStart) return segment.pmStart;
      if (offset < segment.textEnd) return segment.pmStart + (offset - segment.textStart);
    }
    return last.pmStart + (last.textEnd - last.textStart);
  }

  let result = first.pmStart;
  for (const segment of segments) {
    if (offset >= segment.textEnd) {
      result = segment.pmStart + (segment.textEnd - segment.textStart);
    } else if (offset > segment.textStart) {
      return segment.pmStart + (offset - segment.textStart);
    } else {
      break;
    }
  }
  return result;
}

/**
 * A plain-text range as a document range, or null when the range covers no
 * text (an empty range, or one entirely inside a block gap). Ranges that start
 * or end in a gap are clamped to the neighbouring text.
 */
export function plainRangeToPmRange(
  map: PlainTextMap,
  from: number,
  to: number
): { from: number; to: number } | null {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const pmFrom = plainOffsetToPm(map, start, "start");
  const pmTo = Math.max(pmFrom, plainOffsetToPm(map, end, "end"));
  if (pmFrom === pmTo) return null;
  return { from: pmFrom, to: pmTo };
}

/** A document range as a plain-text range. */
export function pmRangeToPlainRange(
  map: PlainTextMap,
  from: number,
  to: number
): { from: number; to: number } {
  const start = pmToPlainOffset(map, Math.min(from, to));
  const end = pmToPlainOffset(map, Math.max(from, to));
  return { from: Math.min(start, end), to: Math.max(start, end) };
}
