import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dictationHub } from "@/features/dictation/hub";
import type { DictationTarget } from "@/features/dictation/session";
import type { DictationEdit } from "@/features/dictation/router";
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

/** Apply a finished line in one transaction and one undo step. */
export function applyDictationEdits(editor: Editor, edits: DictationEdit[]): void {
  if (edits.length === 0) return;
  const { state } = editor;
  const tr = closeHistory(state.tr);
  for (const edit of edits) {
    const { from, to } = tr.selection;
    const spaced = (needsSpaceBefore(tr.doc, from) ? " " : "") + edit.text;
    tr.insertText(spaced, from, to);
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
