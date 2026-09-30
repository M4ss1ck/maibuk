// The browser stops painting the DOM selection when focus moves to a toolbar
// button, so the range the bubble acts on is painted by a decoration instead;
// plugin state only, never stored, synced, or in history.
import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export const selectionKeptPluginKey = new PluginKey<boolean>("selectionKept");

function clearKept(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(selectionKeptPluginKey, false).setMeta("addToHistory", false));
}

export function isSelectionKept(state: EditorState): boolean {
  return selectionKeptPluginKey.getState(state) === true;
}

export function setSelectionKept(editor: Editor, kept: boolean): void {
  if (editor.isDestroyed) return;
  const current = selectionKeptPluginKey.getState(editor.state);
  if (current === undefined) return;
  if (current === kept) return;
  editor.view.dispatch(
    editor.state.tr.setMeta(selectionKeptPluginKey, kept).setMeta("addToHistory", false)
  );
}

export const SelectionKept = Extension.create({
  name: "selectionKept",

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: selectionKeptPluginKey,
        state: {
          init: () => false,
          apply(tr, value) {
            const meta = tr.getMeta(selectionKeptPluginKey);
            return typeof meta === "boolean" ? meta : value;
          },
        },
        props: {
          decorations(state) {
            if (selectionKeptPluginKey.getState(state) !== true) return DecorationSet.empty;
            if (state.selection.empty) return DecorationSet.empty;
            if (state.selection instanceof NodeSelection) return DecorationSet.empty;
            const { from, to } = state.selection;
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { class: "selection-kept" }),
            ]);
          },
          handleDOMEvents: {
            focus(view) {
              if (selectionKeptPluginKey.getState(view.state) === true) {
                clearKept(view);
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
