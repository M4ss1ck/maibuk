import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { dictationHub } from "@/features/dictation/hub";
import type { DictationTarget } from "@/features/dictation/session";
import { normalizeLanguage } from "@/features/settings/types";

/** Plugin state: the in-progress spoken line, "" when none. Never document content. */
export const dictationPluginKey = new PluginKey<string>("dictation");

// No space after whitespace or an opening mark (¿ ¡ « “ ( [ { — –).
const NO_SPACE_AFTER = /[\s([{"'“‘«¿¡—–-]/;

export function needsSpaceBefore(doc: ProseMirrorNode, pos: number): boolean {
  const before = doc.textBetween(Math.max(0, pos - 1), pos, "\n", "\n");
  return before !== "" && !NO_SPACE_AFTER.test(before);
}

/**
 * One finished line at the caret (replacing a range), as its own undo step.
 * Case and punctuation are left alone: that is the Dictation Command
 * Interpreter's job (Anticipated), not the editor's.
 */
export function commitLine(editor: Editor, text: string): void {
  const { state } = editor;
  const { from, to } = state.selection;
  const spaced = (needsSpaceBefore(state.doc, from) ? " " : "") + text;
  const tr = closeHistory(state.tr.insertText(spaced, from, to)).setMeta(
    dictationPluginKey,
    "",
  );
  editor.view.dispatch(tr);
}

interface DictationStorage {
  targetId: string;
  unregister: (() => void) | null;
}

export const Dictation = Extension.create<
  Record<string, never>,
  DictationStorage
>({
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
              { side: 1, key: `dictation:${shown}` },
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
          (editor.storage as { spellCheck?: { language?: string } }).spellCheck
            ?.language,
        ),
      showPartial: (text) => {
        if (editor.isDestroyed) return;
        editor.view.dispatch(
          editor.state.tr
            .setMeta(dictationPluginKey, text)
            .setMeta("addToHistory", false),
        );
      },
      commit: (text) => {
        if (editor.isDestroyed || !editor.isEditable) return;
        commitLine(editor, text);
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
