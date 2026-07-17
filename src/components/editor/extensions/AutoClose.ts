import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "`": "`",
};

const CLOSERS = new Set(Object.values(PAIRS));

/**
 * Shared autoclose transaction logic.
 * Returns true if the input was handled (autoclose engaged), false otherwise.
 */
function tryAutoclose(view: EditorView, from: number, to: number, text: string): boolean {
  const { state } = view;
  const { $from } = state.selection;

  // Disable inside code blocks (but not inline code marks)
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.spec.code) return false;
  }

  // Skip over existing closer
  const after = state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size));
  if (CLOSERS.has(text) && after === text) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(to + 1))));
    return true;
  }

  const close = PAIRS[text];
  if (!close) return false;

  const before = from > 1 ? state.doc.textBetween(from - 1, from) : "";
  if (before === "\\") return false;

  // Fence exception: when two backticks immediately precede the caret,
  // a third backtick should insert literally (for markdown code fences).
  if (text === "`" && from >= 3) {
    const twoBefore = state.doc.textBetween(from - 2, from);
    if (twoBefore === "``") return false;
  }

  if (!state.selection.empty) {
    const tr = state.tr.insert(to, state.schema.text(close)).insert(from, state.schema.text(text));
    tr.setSelection(TextSelection.near(tr.doc.resolve(to + 2)));
    view.dispatch(tr);
    return true;
  }

  const tr = state.tr.insertText(text + close, from, to);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
  view.dispatch(tr);
  return true;
}

export const AutoClose = Extension.create({
  name: "autoClose",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            return tryAutoclose(view, from, to, text);
          },

          handleDOMEvents: {
            beforeinput(view, event) {
              // Narrow the generic Event to InputEvent safely.
              // We check for the properties we need rather than relying on instanceof.
              const inputEvent = event as InputEvent;
              if (
                inputEvent.inputType !== "insertText" ||
                !inputEvent.data ||
                inputEvent.data.length !== 1 ||
                inputEvent.isComposing
              ) {
                return false;
              }

              const { state } = view;
              const { from, to } = state.selection;
              const handled = tryAutoclose(view, from, to, inputEvent.data);

              if (handled) {
                event.preventDefault();
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
