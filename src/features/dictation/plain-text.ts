import { findSentenceStartOffset } from "@/features/dictation/interpreter";
import type { DictationEdit } from "@/features/dictation/router";

/** Scratch that reaches back this many dictated sentences. */
export const MAX_DICTATED_SENTENCES = 10;

// No space after whitespace or an opening mark (¿ ¡ « “ ( [ { — –).
export const NO_SPACE_AFTER = /[\s([{"'“‘«¿¡—–-]/;

export function isSentenceEndMark(ch: string): boolean {
  return ch === "." || ch === "?" || ch === "!";
}

/** Closing marks a sentence end takes with it: `hola.»` is one sentence. */
export const SENTENCE_CLOSERS = new Set(['»', '”', '’', '"', "'", ")", "]", "}"]);

/**
 * Split one text slice into dictated sentences. Shares the interpreter's
 * boundary rule (`.`, `?`, `!`, hard breaks). A hard break belongs to the
 * sentence after it, so scratching that sentence removes the break too.
 * Spaces after a mark belong to the next sentence, so scratching leaves no
 * trailing space.
 */
export function splitSliceIntoSentences(sliceText: string): { start: number; end: number }[] {
  const bounds: { start: number; end: number }[] = [];
  let start = 0;
  let i = 0;
  while (i < sliceText.length) {
    const ch = sliceText[i];
    if (isSentenceEndMark(ch)) {
      let j = i + 1;
      while (j < sliceText.length && isSentenceEndMark(sliceText[j])) j += 1;
      while (j < sliceText.length && SENTENCE_CLOSERS.has(sliceText[j])) j += 1;
      bounds.push({ start, end: j });
      start = j;
      i = j;
    } else if (ch === "\n") {
      if (i > start) bounds.push({ start, end: i });
      let j = i + 1;
      while (j < sliceText.length && sliceText[j] === "\n") j += 1;
      start = i;
      i = j;
    } else {
      i += 1;
    }
  }
  if (start < sliceText.length) bounds.push({ start, end: sliceText.length });
  return bounds.filter(({ start: s, end: e }) => {
    const text = sliceText.slice(s, e);
    return /[^\s]/.test(text) || text.includes("\n");
  });
}

export type FieldKind = "text" | "multiline" | "secret";

export function dictationFieldKind(el: Element | null): FieldKind | null {
  if (!el) return null;
  if ((el as HTMLInputElement).disabled) return null;
  if ((el as HTMLInputElement).readOnly) return null;
  if (el.closest('[data-dictation="off"]') !== null) return null;
  if (el instanceof HTMLTextAreaElement) return "multiline";
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (type === "" || type === "text" || type === "search" || type === "email" || type === "url")
      return "text";
    if (type === "password") return "secret";
    return null;
  }
  return null;
}

export function isVerbatimField(el: Element): boolean {
  return el.closest('[data-dictation="verbatim"]') !== null;
}

/** Keep context reads constant-size even in a very long field. */
export const FIELD_BEFORE_LIMIT = 256;

export interface FieldEditPlan {
  from: number;
  to: number;
  text: string;
  value: string;
  caret: number;
  changed: boolean;
  layoutIgnored: boolean;
  dictatedStart: number;
  openerAt: number[];
  /** The line replaced a selected range: earlier sentence positions no longer hold. */
  replacedSelection: boolean;
}

export function planFieldEdits(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  edits: DictationEdit[],
  multiline: boolean
): FieldEditPlan {
  const head = value.slice(0, selectionStart);
  const tail = value.slice(selectionEnd);
  let out = head;
  let mark = head.length;
  let layoutIgnored = false;
  const openerAt: number[] = [];
  for (const edit of edits) {
    if (edit.kind === "text") {
      const startsWithClosing = ",.;:?!»”’)]}…".includes(edit.text[0] ?? "");
      if (startsWithClosing) {
        out = out.replace(/[ \t]+$/, "");
        if (mark > out.length) mark = out.length;
      }
      const last = out[out.length - 1];
      const leading =
        out !== "" && last !== undefined && !NO_SPACE_AFTER.test(last) && !startsWithClosing;
      out += (leading ? " " : "") + edit.text;
    } else if (edit.kind === "paragraph" || edit.kind === "line_break") {
      if (multiline) out += "\n";
      else layoutIgnored = true;
    } else if (edit.kind === "list_item") {
      if (multiline) out += `${out === "" || out.endsWith("\n") ? "" : "\n"}- `;
      else layoutIgnored = true;
    } else {
      const at = findSentenceStartOffset(out);
      out = out.slice(0, at) + edit.mark + out.slice(at);
      if (at < mark) mark += 1;
      for (let i = 0; i < openerAt.length; i += 1) {
        if (at <= openerAt[i]) openerAt[i] += 1;
      }
      openerAt.push(at);
      // A sentence that starts here starts with a capital (Spanish openers).
      const ch = out[at + 1];
      if (ch !== undefined && ch.toUpperCase() !== ch) {
        const upper = ch.toUpperCase();
        out = out.slice(0, at + 1) + upper + out.slice(at + 2);
        const diff = upper.length - 1;
        if (diff !== 0) {
          if (at + 1 < mark) mark += diff;
          for (let i = 0; i < openerAt.length; i += 1) {
            if (at + 1 < openerAt[i]) openerAt[i] += diff;
          }
        }
      }
    }
  }
  let from = 0;
  const max = Math.min(head.length, out.length);
  while (from < max && head[from] === out[from]) from += 1;
  const to = selectionEnd;
  const text = out.slice(from);
  return {
    from,
    to,
    text,
    value: out + tail,
    caret: out.length,
    changed: !(out === head && selectionStart === selectionEnd),
    layoutIgnored,
    dictatedStart: mark,
    openerAt,
    replacedSelection: selectionStart !== selectionEnd,
  };
}

export interface FieldSentence {
  start: number;
  end: number;
  text: string;
  lines: { start: number; end: number }[];
}

export interface FieldHistory {
  entries: FieldSentence[];
  barrier: boolean;
  expected: string | null;
}

export const EMPTY_FIELD_HISTORY: FieldHistory = { entries: [], barrier: false, expected: null };

function mapStartPos(p: number, plan: FieldEditPlan, headLen: number): number {
  if (p < plan.from) return p;
  if (p > headLen) return p - headLen + plan.caret;
  const sorted = [...plan.openerAt].sort((a, b) => a - b);
  let k = 0;
  for (const at of sorted) {
    if (at <= p + k) k += 1;
  }
  return p + k;
}

function mapEndPos(p: number, plan: FieldEditPlan, headLen: number): number {
  if (p < plan.from) return p;
  if (p > headLen) return p - headLen + plan.caret;
  const sorted = [...plan.openerAt].sort((a, b) => a - b);
  let k = 0;
  for (const at of sorted) {
    if (at < p + k) k += 1;
  }
  return p + k;
}

export function recordFieldInsert(
  history: FieldHistory,
  valueBefore: string,
  plan: FieldEditPlan
): FieldHistory {
  if (!plan.changed) return history;
  let base: FieldSentence[];
  let barrier = history.barrier;
  if (plan.replacedSelection || (history.expected !== null && valueBefore !== history.expected)) {
    // The author edited the field since our last change, or the line replaced
    // a selection: positions are unreliable, so the old sentences can never
    // be scratched.
    base = [];
    barrier = history.barrier || history.entries.length > 0;
  } else {
    // Dictation lands at a collapsed caret, so the head end is the
    // selection end; a replaced selection collapses the same way.
    const headLen = plan.to;
    base = [];
    for (const entry of history.entries) {
      const start = mapStartPos(entry.start, plan, headLen);
      const end = mapEndPos(entry.end, plan, headLen);
      if (start >= end) continue;
      const lines = entry.lines
        .map((line) => ({
          start: mapStartPos(line.start, plan, headLen),
          end: mapEndPos(line.end, plan, headLen),
        }))
        .filter((line) => line.start < line.end && line.start >= start && line.end <= end);
      base.push({
        start,
        end,
        text: plan.value.slice(start, end),
        lines: lines.length > 0 ? lines : [{ start, end }],
      });
    }
  }
  const pieces: FieldSentence[] = [];
  for (const { start, end } of splitSliceIntoSentences(
    plan.value.slice(plan.dictatedStart, plan.caret)
  )) {
    const s = plan.dictatedStart + start;
    const e = plan.dictatedStart + end;
    pieces.push({ start: s, end: e, text: plan.value.slice(s, e), lines: [{ start: s, end: e }] });
  }
  if (base.length > 0 && pieces.length > 0) {
    const last = base[base.length - 1];
    const first = pieces[0];
    const between = plan.value.slice(last.end, first.start);
    const prefix = plan.value.slice(0, first.start);
    if (
      !/[.!?]/.test(last.text) &&
      /^[ \t]*$/.test(between) &&
      findSentenceStartOffset(prefix) !== prefix.length
    ) {
      const start =
        plan.openerAt.includes(last.start - 1) ? last.start - 1 : last.start;
      base[base.length - 1] = {
        start,
        end: first.end,
        text: plan.value.slice(start, first.end),
        lines: [...last.lines, { start: first.start, end: first.end }],
      };
      pieces.shift();
    }
  }
  const entries = [...base, ...pieces].slice(-MAX_DICTATED_SENTENCES);
  return { entries, barrier, expected: plan.value };
}

export type FieldScratchPlan =
  | { outcome: "empty" | "refused" }
  | { outcome: "removed"; from: number; to: number; value: string; history: FieldHistory };

export function planFieldScratch(history: FieldHistory, value: string): FieldScratchPlan {
  if (history.entries.length === 0) return { outcome: history.barrier ? "refused" : "empty" };
  if (history.expected !== null && value !== history.expected) return { outcome: "refused" };
  const last = history.entries[history.entries.length - 1];
  if (value.slice(last.start, last.end) !== last.text) return { outcome: "refused" };
  if (/[.?!…]/.test(last.text) || last.lines.length <= 1) {
    const from = last.start;
    const to = last.end;
    const next = value.slice(0, from) + value.slice(to);
    return {
      outcome: "removed",
      from,
      to,
      value: next,
      history: {
        entries: history.entries.slice(0, -1),
        barrier: history.barrier,
        expected: next,
      },
    };
  }
  const line = last.lines[last.lines.length - 1];
  if (line.start < last.start || line.start > last.end) return { outcome: "refused" };
  const from = line.start;
  const to = last.end;
  const next = value.slice(0, from) + value.slice(to);
  const lines = last.lines.slice(0, -1);
  return {
    outcome: "removed",
    from,
    to,
    value: next,
    history: {
      entries: [
        ...history.entries.slice(0, -1),
        { start: last.start, end: from, text: next.slice(last.start, from), lines },
      ],
      barrier: history.barrier,
      expected: next,
    },
  };
}
