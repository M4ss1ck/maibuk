import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dictationHub } from "@/features/dictation/hub";
import type { DictationTarget, ScratchOutcome } from "@/features/dictation/session";
import type { DictationEdit } from "@/features/dictation/router";
import { isOutsideLayer } from "@/lib/top-layer";
import { findSentenceStartOffset } from "@/features/dictation/interpreter";
import {
  MAX_DICTATED_SENTENCES,
  NO_SPACE_AFTER,
  SENTENCE_CLOSERS,
  splitSliceIntoSentences,
} from "@/features/dictation/plain-text";
import type { VoiceCommandRun, VoiceOutcome } from "@/features/dictation/voice-commands";
import { normalizeLanguage } from "@/features/settings/types";
import { runVoiceCommand, VOICE_MARKS } from "@/components/editor/editor-commands";

/** One dictated sentence: its range in the document and the exact text there. */
export interface DictatedRange {
  from: number;
  to: number;
  text: string;
  /**
   * Set when a non-dictation transaction changed the text inside the range.
   * A dirty entry is never merged over and never scratched: when unsure,
   * refuse. Only a dictation commit creates clean entries.
   */
  dirty: boolean;
  /**
   * The finished lines the entry was dictated in, oldest first. An entry
   * without a sentence end scratches back to its lines one at a time.
   */
  lines: { from: number; to: number }[];
}

/** Plugin state: the in-progress line plus the dictated history for scratch that. */
export interface DictationPluginState {
  /** The in-progress spoken line, "" when none. Never document content. */
  partial: string;
  /** Last dictated sentences, oldest first, capped at MAX_DICTATED_SENTENCES. */
  history: DictatedRange[];
}

/** Scratch that reaches back this many dictated sentences. Re-exported so existing imports keep working. */
export { MAX_DICTATED_SENTENCES };

/** Plugin state for scratch that. Ranges map through every transaction. */
export const dictationPluginKey = new PluginKey<DictationPluginState>("dictation");

type DictationMeta =
  | string
  | {
      partial?: string;
      added?: DictatedRange[];
      scratch?: true;
      reset?: true;
      /** This commit inserted an auto `¿`/`¡` opener (possibly at last.from). */
      openersInserted?: boolean;
    }
  | undefined;

const INITIAL_PLUGIN_STATE: DictationPluginState = { partial: "", history: [] };

function sameHistory(a: readonly DictatedRange[], b: readonly DictatedRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].from !== b[i].from ||
      a[i].to !== b[i].to ||
      a[i].text !== b[i].text ||
      a[i].dirty !== b[i].dirty ||
      a[i].lines.length !== b[i].lines.length ||
      a[i].lines.some((l, j) => l.from !== b[i].lines[j].from || l.to !== b[i].lines[j].to)
    )
      return false;
  }
  return true;
}

export function needsSpaceBefore(doc: ProseMirrorNode, pos: number): boolean {
  const before = doc.textBetween(Math.max(0, pos - 1), pos, "\n", "\n");
  return before !== "" && !NO_SPACE_AFTER.test(before);
}

/** Keep context reads constant-size even in a very long Chapter. */
export const BEFORE_CARET_LIMIT = 256;

export function textBeforeCaret(editor: Editor): string {
  const { doc, selection } = editor.state;
  return doc.textBetween(
    Math.max(0, selection.from - BEFORE_CARET_LIMIT),
    selection.from,
    "\n",
    "\n"
  );
}

function isInListItem(doc: ProseMirrorNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === "listItem") return true;
  }
  return false;
}

/** Sentence start in the current textblock, for Spanish auto-openers. Shares the interpreter's boundary rule. */
function findSentenceStartPos(doc: ProseMirrorNode, caretPos: number): number {
  const $from = doc.resolve(caretPos);
  const blockStart = $from.start();
  const sliceEnd = caretPos;
  const sliceStart = Math.max(blockStart, sliceEnd - 500);
  const text = doc.textBetween(sliceStart, sliceEnd, "\n", "\n");
  return sliceStart + findSentenceStartOffset(text);
}

/**
 * Whether the block text before `pos` ends a sentence: trailing spaces and
 * closing marks are skipped, then `.?!`, a hard break, or the block start
 * counts as a boundary. Only the tail is read, so long Chapters stay cheap.
 */
function blockTextEndsSentence(
  doc: ProseMirrorNode,
  blockStart: number,
  pos: number
): boolean {
  if (pos <= blockStart) return true;
  const text = doc.textBetween(Math.max(blockStart, pos - 8), pos, "\n", "\n");
  let end = text.length;
  for (;;) {
    while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end -= 1;
    if (end > 0 && SENTENCE_CLOSERS.has(text[end - 1])) {
      end -= 1;
      continue;
    }
    break;
  }
  if (end === 0) return true;
  const ch = text[end - 1];
  return ch === "." || ch === "?" || ch === "!" || ch === "\n";
}

/**
 * Merge a commit's pieces into the still-open dictated sentence. Choice (b):
 * a piece that continues a sentence mid-sentence always joins the last entry
 * into one open entry that tracks its lines (one per finished line); a later
 * commit can still end that sentence, and the entry counts as one toward
 * `MAX_DICTATED_SENTENCES` however many lines it holds. `scratchDictation`
 * splits an entry without a sentence end back into its lines, so unfinished
 * lines keep scratching line by line (AC 4). Merging needs: the piece does
 * not start at a sentence boundary, the last entry is a clean sentence
 * fragment in the same block (never a complete sentence, never dirty),
 * adjacency with only whitespace between. Merging never reaches back over
 * typed text (which has no entry) or an author edit (which is dirty).
 */
function mergeIntoOpenSentence(
  doc: ProseMirrorNode,
  history: readonly DictatedRange[],
  added: readonly DictatedRange[],
  openersInserted: boolean
): { consumed: 0 | 1; pieces: DictatedRange[] } {
  const keep = { consumed: 0 as const, pieces: [...added] };
  if (added.length === 0 || history.length === 0) return keep;
  const first = added[0];
  const last = history[history.length - 1];
  if (last.dirty || last.from >= last.to) return keep;
  // Never cross a complete sentence: one scratch removes one sentence.
  if (/[.!?]/.test(last.text)) return keep;
  let blockStart: number;
  try {
    blockStart = doc.resolve(first.from).start();
  } catch {
    return keep;
  }
  if (blockTextEndsSentence(doc, blockStart, first.from)) return keep;
  let lastBlockStart: number;
  try {
    lastBlockStart = doc.resolve(last.from).start();
  } catch {
    return keep;
  }
  if (lastBlockStart !== blockStart) return keep;
  if (last.to > first.from) return keep;
  if (!/^[ \t]*$/.test(doc.textBetween(last.to, first.from, "\n", "\n"))) return keep;
  let from = last.from;
  if (openersInserted && from > blockStart) {
    // Assoc +1 maps `from` past an opener this commit inserted exactly there;
    // pull it back in so one scratch removes the whole sentence. The
    // skip-if-present rule means a leading opener here is this commit's own.
    const opener = doc.textBetween(from - 1, from, "\n", "\n");
    if (opener === "¿" || opener === "¡") from = from - 1;
  }
  const lastLines =
    last.lines.length > 0 ? last.lines : [{ from: last.from, to: last.to }];
  return {
    consumed: 1,
    pieces: [
      {
        from,
        to: first.to,
        text: doc.textBetween(from, first.to, "\n", "\n"),
        dirty: false,
        lines: [...lastLines, { from: first.from, to: first.to }],
      },
      ...added.slice(1),
    ],
  };
}

/**
 * Sentences inserted by one dictation commit, in document order. The span is
 * the caret's mapped start to its new position; per-block splitting keeps the
 * offset-to-position mapping exact (one char per position inside a textblock).
 * A sentence begun by hand contributes only its dictated tail, since the span
 * starts at the caret. With no sentence ends the slice is one entry, so
 * scratch falls back to removing the last dictated line.
 */
export function extractDictatedSentences(
  doc: ProseMirrorNode,
  from: number,
  to: number
): DictatedRange[] {
  const size = doc.content.size;
  const clampedFrom = Math.max(0, Math.min(from, size));
  const clampedTo = Math.max(0, Math.min(to, size));
  if (clampedFrom >= clampedTo) return [];
  const out: DictatedRange[] = [];
  doc.nodesBetween(clampedFrom, clampedTo, (node, pos) => {
    if (!node.isTextblock) return true;
    const blockFrom = Math.max(clampedFrom, pos + 1);
    const blockTo = Math.min(clampedTo, pos + node.nodeSize - 1);
    if (blockFrom >= blockTo) return false;
    const sliceText = doc.textBetween(blockFrom, blockTo, "\n", "\n");
    if (sliceText.length !== blockTo - blockFrom) {
      out.push({ from: blockFrom, to: blockTo, text: sliceText, dirty: false, lines: [{ from: blockFrom, to: blockTo }] });
      return false;
    }
    let splitFallback = false;
    for (const { start, end } of splitSliceIntoSentences(sliceText)) {
      const rFrom = blockFrom + start;
      const rTo = blockFrom + end;
      const text = sliceText.slice(start, end);
      if (doc.textBetween(rFrom, rTo, "\n", "\n") !== text) {
        splitFallback = true;
        break;
      }
      out.push({ from: rFrom, to: rTo, text, dirty: false, lines: [{ from: rFrom, to: rTo }] });
    }
    if (splitFallback) {
      out.push({ from: blockFrom, to: blockTo, text: sliceText, dirty: false, lines: [{ from: blockFrom, to: blockTo }] });
    }
    return false;
  });
  return out;
}

/** The last dictated span scratch that would remove, without removing it. */
export function lastDictatedRange(state: EditorState): { from: number; to: number } | "empty" | "refused" {
  const history = dictationPluginKey.getState(state)?.history ?? [];
  if (history.length === 0) return "empty";
  const last = history[history.length - 1];
  const doc = state.doc;
  if (last.from < 0 || last.to > doc.content.size || last.from >= last.to) return "refused";
  if (last.dirty || doc.textBetween(last.from, last.to, "\n", "\n") !== last.text)
    return "refused";
  // An entry without a sentence end is an unfinished sentence: only its last
  // dictated line is in reach, like scratch that removes it.
  if (!/[.!?]/.test(last.text)) {
    const lines = last.lines.filter(
      (line) => line.from < line.to && line.from >= last.from && line.to <= last.to
    );
    const line = lines[lines.length - 1] ?? { from: last.from, to: last.to };
    const from = Math.max(line.from, last.from);
    const to = Math.min(line.to, last.to);
    if (from >= to) return "refused";
    return { from, to };
  }
  return { from: last.from, to: last.to };
}

/** Apply one mark Command to the last dictated span, as one undo step. */
export function markLastDictated(editor: Editor, run: VoiceCommandRun): VoiceOutcome {
  const markName = VOICE_MARKS[run.id];
  const type = markName ? editor.schema.marks[markName] : undefined;
  if (!type) return "ignored";
  const range = lastDictatedRange(editor.state);
  if (range === "empty" || range === "refused") return range;
  let { from, to } = range;
  // The span's separating spaces and hard breaks stay plain, so the mark
  // covers only the dictated words.
  const text = editor.state.doc.textBetween(from, to, "\n", "\n");
  const trimmed = text.trim();
  if (trimmed === "") return "empty";
  from += text.length - text.trimStart().length;
  to -= text.length - text.trimEnd().length;
  const tr = closeHistory(editor.state.tr);
  if (run.polarity === "off") tr.removeMark(from, to, type);
  else tr.addMark(from, to, type.create());
  // Marks ride on the range, not the caret: keep the author's pending marks.
  const stored = editor.state.storedMarks;
  if (stored !== null) tr.setStoredMarks(stored);
  editor.view.dispatch(tr);
  return "ran";
}

/** Remove the last dictated sentence as one undo step. Never touches typed text. */
export function scratchDictation(editor: Editor): ScratchOutcome {
  const range = lastDictatedRange(editor.state);
  if (range === "empty") return "empty";
  if (range === "refused") return "refused";
  const pluginState = dictationPluginKey.getState(editor.state);
  const history = pluginState?.history ?? [];
  const last = history[history.length - 1];
  const { from, to } = range;
  // An entry without a sentence end is an unfinished sentence: remove only
  // its last dictated line and keep the rest as the new last entry.
  if (!/[.!?]/.test(last.text)) {
    const lines = last.lines.filter(
      (line) => line.from < line.to && line.from >= last.from && line.to <= last.to
    );
    const rest = lines.slice(0, -1);
    const tr = closeHistory(editor.state.tr);
    tr.delete(from, to);
    if (rest.length === 0 || from <= last.from) {
      tr.setMeta(dictationPluginKey, { partial: "", scratch: true });
    } else {
      tr.setMeta(dictationPluginKey, {
        partial: "",
        scratch: true,
        added: [
          {
            from: last.from,
            to: from,
            text: tr.doc.textBetween(last.from, from, "\n", "\n"),
            dirty: false,
            lines: rest,
          },
        ],
      });
    }
    editor.view.dispatch(tr);
    return "removed";
  }
  const tr = closeHistory(editor.state.tr);
  tr.delete(last.from, last.to);
  tr.setMeta(dictationPluginKey, { partial: "", scratch: true });
  editor.view.dispatch(tr);
  return "removed";
}

/** Drop the dictated history so scratch never reaches into another editor. */
export function resetDictationHistory(editor: Editor): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(dictationPluginKey, { partial: "", reset: true })
      .setMeta("addToHistory", false)
  );
}

/** Apply a finished line in one transaction and one undo step. */
export function applyDictationEdits(editor: Editor, edits: DictationEdit[]): void {
  if (edits.length === 0) return;
  const { state } = editor;
  const startPos = state.selection.from;
  /**
   * The mark a Voice Command set for the text dictated next. A layout edit
   * moves the selection, which clears the transaction's stored marks, so they
   * are carried across by hand or the new paragraph's text loses the mark.
   */
  const storedMarks = state.storedMarks;
  let openersInserted = false;
  const tr = closeHistory(state.tr);
  const carryStoredMarks = () => {
    if (storedMarks && storedMarks.length > 0) tr.setStoredMarks(storedMarks);
  };
  for (const edit of edits) {
    if (edit.kind === "paragraph") {
      tr.deleteSelection();
      tr.split(tr.selection.from, 1, [{ type: state.schema.nodes.paragraph }]);
      carryStoredMarks();
    } else if (edit.kind === "line_break") {
      const hardBreak = state.schema.nodes.hardBreak;
      if (hardBreak) tr.replaceSelectionWith(hardBreak.create());
      carryStoredMarks();
    } else if (edit.kind === "list_item") {
      tr.deleteSelection();
      const pos = tr.selection.from;
      if (isInListItem(tr.doc, pos)) {
        const $at = tr.doc.resolve(pos);
        if ($at.parent.content.size === 0) {
          // Empty list item: match Enter. In a nested list lift the list
          // item itself out of its list (like liftListItem), so it moves up
          // one level as an empty item; at the top level lift the empty
          // paragraph out (like liftEmptyBlock).
          const itemType = state.schema.nodes.listItem;
          const $from = tr.selection.$from;
          const itemRange = $from.blockRange(
            $from,
            (node) => node.childCount > 0 && node.firstChild?.type === itemType
          );
          const outerTarget = itemRange && liftTarget(itemRange);
          if (
            itemRange &&
            outerTarget != null &&
            $from.node(itemRange.depth - 1).type === itemType
          ) {
            tr.lift(itemRange, outerTarget);
          } else {
            const range = $at.blockRange();
            const target = range && liftTarget(range);
            if (range && target != null) tr.lift(range, target);
            else if ($at.depth >= 2) tr.split(pos, 2);
            else tr.split(pos, 1, [{ type: state.schema.nodes.paragraph }]);
          }
        } else {
          // Split the current list item, like pressing Enter inside it.
          // Depth 2 splits listItem + paragraph (prosemirror-schema-list).
          if (tr.doc.resolve(pos).depth >= 2) tr.split(pos, 2);
          else tr.split(pos, 1, [{ type: state.schema.nodes.paragraph }]);
        }
      } else {
        const bulletList = state.schema.nodes.bulletList;
        const listItem = state.schema.nodes.listItem;
        const $at = tr.doc.resolve(pos);
        if ($at.parent.type.name === "paragraph" && $at.parent.content.size === 0) {
          // Empty paragraph becomes the list item, like toggleBulletList.
          const range = $at.blockRange(tr.doc.resolve($at.end()));
          if (range) tr.wrap(range, [{ type: bulletList }, { type: listItem }]);
        } else {
          // Split, then wrap the new paragraph. TipTap leaves its usual
          // trailing paragraph after the list.
          tr.split(pos, 1, [{ type: state.schema.nodes.paragraph }]);
          const $after = tr.selection.$from;
          const itemEnd = $after.end();
          const range = $after.blockRange(tr.doc.resolve(itemEnd));
          if (range) tr.wrap(range, [{ type: bulletList }, { type: listItem }]);
        }
      }
      carryStoredMarks();
    } else if (edit.kind === "opener") {
      const caret = tr.selection.from;
      const at = findSentenceStartPos(tr.doc, caret);
      // Never duplicate an opener the author already has.
      const existing = tr.doc.textBetween(at, Math.min(at + 1, tr.doc.content.size), "\n", "\n");
      if (existing !== edit.mark) {
        tr.insertText(edit.mark, at);
        openersInserted = true;
        // A sentence that starts here starts with a capital (Spanish openers).
        // The word was already emitted in lowercase when it continued the
        // previous sentence before the hard break; fix it now that the opener
        // shows it starts a sentence. Mid-sentence explicit openers are text,
        // never this edit, so "¿me" stays lowercase.
        const after = tr.doc.textBetween(at + 1, Math.min(at + 2, tr.doc.content.size), "\n", "\n");
        const upper = after.toUpperCase();
        if (after !== "" && after !== upper) tr.insertText(upper, at + 1, at + 2);
      }
    } else {
      const startsWithClosingMark = ",.;:?!»”’)]}…".includes(edit.text[0] ?? "");
      if (startsWithClosingMark) {
        const from = tr.selection.from;
        const preceding = tr.doc.textBetween(Math.max(0, from - 64), from, "\n", "\n");
        const spaces = preceding.match(/[ \t]+$/)?.[0].length ?? 0;
        if (spaces > 0) tr.delete(from - spaces, from);
      }
      const { from, to } = tr.selection;
      const leadingSpace = needsSpaceBefore(tr.doc, from) && !startsWithClosingMark;
      // A mark the text already runs through keeps running through the space;
      // only a mark newly set (a Voice Command's stored mark) leaves it plain.
      const continued = leadingSpace ? tr.doc.resolve(from).marks() : [];
      const spaced = (leadingSpace ? " " : "") + edit.text;
      tr.insertText(spaced, from, to);
      if (leadingSpace) {
        for (const mark of tr.doc.nodeAt(from)?.marks ?? []) {
          if (!mark.isInSet(continued)) tr.removeMark(from, from + 1, mark);
        }
      }
    }
  }
  const endPos = tr.selection.from;
  // Map the caret with assoc -1 so it stays before the inserted text
  // (the default assoc 1 lands after it, leaving an empty span).
  const mappedStart = tr.mapping.map(startPos, -1);
  const added = extractDictatedSentences(tr.doc, mappedStart, endPos);
  tr.setMeta(dictationPluginKey, { partial: "", added, openersInserted });
  editor.view.dispatch(tr);
}

interface DictationStorage {
  targetId: string;
  unregister: (() => void) | null;
}

export const Dictation = Extension.create<Record<string, never>, DictationStorage>({
  name: "dictation",

  addStorage() {
    return { targetId: "", unregister: null };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DictationPluginState>({
        key: dictationPluginKey,
        state: {
          init: () => ({ ...INITIAL_PLUGIN_STATE, history: [] }),
          apply: (tr, prev) => {
            const meta = tr.getMeta(dictationPluginKey) as DictationMeta;
            const isDictation =
              !!meta &&
              typeof meta === "object" &&
              (Array.isArray(meta.added) || meta.scratch === true);
            let history = prev.history;
            if (tr.docChanged) {
              history = history.map((entry) => {
                // Insertions at the edges stay outside the entry, so text
                // typed right before or after it never gets absorbed.
                const from = tr.mapping.map(entry.from, 1);
                const to = tr.mapping.map(entry.to, -1);
                const lines = entry.lines
                  .map((line) => ({
                    from: tr.mapping.map(line.from, 1),
                    to: tr.mapping.map(line.to, -1),
                  }))
                  .filter((line) => line.from < line.to && line.from >= from && line.to <= to);
                const mapped: DictatedRange = {
                  from,
                  to,
                  text: entry.text,
                  dirty: entry.dirty,
                  lines: lines.length > 0 || from >= to ? lines : [{ from, to }],
                };
                if (
                  !isDictation &&
                  !mapped.dirty &&
                  mapped.from < mapped.to &&
                  tr.doc.textBetween(mapped.from, mapped.to, "\n", "\n") !== mapped.text
                ) {
                  // A non-dictation change rewrote the entry's text: mark it
                  // dirty so merging never heals it and scratch refuses it.
                  return { ...mapped, dirty: true };
                }
                return mapped;
              });
            }
            let partial = prev.partial;
            if (typeof meta === "string") {
              partial = meta;
            } else if (meta && typeof meta === "object") {
              if (typeof meta.partial === "string") partial = meta.partial;
              if (meta.reset === true) {
                history = [];
              } else {
                if (meta.scratch === true && history.length > 0) {
                  // Pop before pruning: the just-deleted entry is still
                  // last (collapsed), and pruning first would eat a live one.
                  history = history.slice(0, -1);
                }
                if (tr.docChanged) {
                  // An undone or deleted entry collapses; drop it so it can
                  // never block scratching an earlier sentence.
                  history = history.filter((entry) => entry.from < entry.to);
                }
                if (Array.isArray(meta.added) && meta.added.length > 0) {
                  const { consumed, pieces } = mergeIntoOpenSentence(
                    tr.doc,
                    history,
                    meta.added,
                    meta.openersInserted === true
                  );
                  history = [
                    ...history.slice(0, history.length - consumed),
                    ...pieces,
                  ].slice(-MAX_DICTATED_SENTENCES);
                }
              }
            } else if (tr.docChanged) {
              history = history.filter((entry) => entry.from < entry.to);
            }
            if (partial === prev.partial && sameHistory(history, prev.history)) return prev;
            return { partial, history };
          },
        },
        props: {
          decorations(state) {
            const pluginState = dictationPluginKey.getState(state);
            const text = pluginState?.partial ?? "";
            if (!text) return null;
            const pos = state.selection.to;
            const shown = (needsSpaceBefore(state.doc, pos) ? " " : "") + text;
            const widget = Decoration.widget(
              pos,
              () => {
                const span = document.createElement("span");
                span.className = "dictation-partial";
                // The live region announces Dictation; partials would be noise.
                span.setAttribute("aria-hidden", "true");
                span.textContent = shown;
                return span;
              },
              { side: 1, key: `dictation:${shown}` }
            );
            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Registry Command `dictation.stop` (fixed Escape, editor-keymap).
      Escape: () => {
        if (!dictationHub.isListening()) return false;
        dictationHub.stop();
        return true;
      },
    };
  },

  onCreate() {
    const editor = this.editor;
    this.storage.targetId = crypto.randomUUID();
    const target: DictationTarget = {
      id: this.storage.targetId,
      language: () =>
        normalizeLanguage(
          (editor.storage as { spellCheck?: { language?: string } }).spellCheck?.language
        ),
      // Behind a modal the editor keeps its DOM but the author cannot see it:
      // the Session treats it as absent and takes the orphan path instead.
      isAvailable: () => !editor.isDestroyed && !isOutsideLayer(editor.view.dom),
      showPartial: (text) => {
        if (editor.isDestroyed) return;
        editor.view.dispatch(
          editor.state.tr
            .setMeta(dictationPluginKey, { partial: text })
            .setMeta("addToHistory", false)
        );
      },
      before: () => textBeforeCaret(editor),
      apply: (edits) => {
        if (editor.isDestroyed || !editor.isEditable) return;
        applyDictationEdits(editor, edits);
      },
      voice: (run) => {
        if (editor.isDestroyed || !editor.isEditable) return "ignored";
        // A Voice Command is its own undo step: close the group the previous
        // line (typed or dictated) opened, run the Command, then close again
        // so the next line starts a new one.
        editor.view.dispatch(closeHistory(editor.state.tr));
        // A real selection wins: "bold that" with selected text bolds the
        // selection through the usual runner, not the dictated span.
        const outcome: VoiceOutcome =
          run.that && editor.state.selection.empty
            ? markLastDictated(editor, run)
            : runVoiceCommand(editor, run);
        editor.view.dispatch(closeHistory(editor.state.tr));
        return outcome;
      },
      scratch: () => {
        if (editor.isDestroyed || !editor.isEditable) return "empty";
        return scratchDictation(editor);
      },
      resetScratch: () => {
        resetDictationHistory(editor);
      },
    };
    this.storage.unregister = dictationHub.register(target);
    if (editor.isFocused) dictationHub.focus(target.id);
  },

  onFocus() {
    dictationHub.focus(this.storage.targetId);
  },

  onDestroy() {
    this.storage.unregister?.();
    this.storage.unregister = null;
  },
});
