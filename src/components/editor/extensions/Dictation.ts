import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dictationHub } from "@/features/dictation/hub";
import type { DictationTarget } from "@/features/dictation/session";
import type { DictationEdit } from "@/features/dictation/router";
import {
  findSentenceStartOffset,
} from "@/features/dictation/interpreter";
import { normalizeLanguage } from "@/features/settings/types";

/** Plugin state: the in-progress spoken line, "" when none. Never document content. */
export const dictationPluginKey = new PluginKey<string>("dictation");

// No space after whitespace or an opening mark (¿ ¡ « “ ( [ { — –).
const NO_SPACE_AFTER = /[\s([{"'“‘«¿¡—–-]/;

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
export function findSentenceStartPos(doc: ProseMirrorNode, caretPos: number): number {
  const $from = doc.resolve(caretPos);
  const blockStart = $from.start();
  const sliceEnd = caretPos;
  const sliceStart = Math.max(blockStart, sliceEnd - 500);
  const text = doc.textBetween(sliceStart, sliceEnd, "\n", "\n");
  return sliceStart + findSentenceStartOffset(text);
}

/** Apply a finished line in one transaction and one undo step. */
export function applyDictationEdits(editor: Editor, edits: DictationEdit[]): void {
  if (edits.length === 0) return;
  const { state } = editor;
  const tr = closeHistory(state.tr);
  for (const edit of edits) {
    if (edit.kind === "paragraph") {
      tr.deleteSelection();
      tr.split(tr.selection.from, 1, [{ type: state.schema.nodes.paragraph }]);
    } else if (edit.kind === "line_break") {
      const hardBreak = state.schema.nodes.hardBreak;
      if (hardBreak) tr.replaceSelectionWith(hardBreak.create());
    } else if (edit.kind === "list_item") {
      tr.deleteSelection();
      const pos = tr.selection.from;
      if (isInListItem(tr.doc, pos)) {
        const $at = tr.doc.resolve(pos);
        if ($at.parent.content.size === 0) {
          // Empty list item: lift out of the list, like pressing Enter.
          const range = $at.blockRange();
          const target = range && liftTarget(range);
          if (range && target != null) tr.lift(range, target);
          else if ($at.depth >= 2) tr.split(pos, 2);
          else tr.split(pos, 1, [{ type: state.schema.nodes.paragraph }]);
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
    } else if (edit.kind === "opener") {
      const caret = tr.selection.from;
      const at = findSentenceStartPos(tr.doc, caret);
      // Never duplicate an opener the author already has.
      const existing = tr.doc.textBetween(at, Math.min(at + 1, tr.doc.content.size), "\n", "\n");
      if (existing !== edit.mark) {
        tr.insertText(edit.mark, at);
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
      const spaced =
        (needsSpaceBefore(tr.doc, from) && !startsWithClosingMark ? " " : "") + edit.text;
      tr.insertText(spaced, from, to);
    }
  }
  tr.setMeta(dictationPluginKey, "");
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
      new Plugin<string>({
        key: dictationPluginKey,
        state: {
          init: () => "",
          apply: (tr, value) => {
            const meta = tr.getMeta(dictationPluginKey);
            return typeof meta === "string" ? meta : value;
          },
        },
        props: {
          decorations(state) {
            const text = dictationPluginKey.getState(state);
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
      showPartial: (text) => {
        if (editor.isDestroyed) return;
        editor.view.dispatch(
          editor.state.tr.setMeta(dictationPluginKey, text).setMeta("addToHistory", false)
        );
      },
      before: () => textBeforeCaret(editor),
      apply: (edits) => {
        if (editor.isDestroyed || !editor.isEditable) return;
        applyDictationEdits(editor, edits);
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
