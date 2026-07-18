import { Extension } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const LEFT_DQUOTE = "“"; // U+201C left double quotation mark
const RIGHT_DQUOTE = "”"; // U+201D right double quotation mark

// Typed opener -> the pair we actually insert. Double quotes are curled so they
// match the typographic quotes used elsewhere in the document (see Typography).
const PAIRS: Record<string, { open: string; close: string }> = {
  "(": { open: "(", close: ")" },
  "[": { open: "[", close: "]" },
  "{": { open: "{", close: "}" },
  '"': { open: LEFT_DQUOTE, close: RIGHT_DQUOTE },
  "`": { open: "`", close: "`" },
};

// Typed key -> closer glyph(s) it "types over" when one already follows the caret.
// The straight-quote key steps past a curly (or legacy straight) closing quote.
const SKIP_OVER: Record<string, readonly string[]> = {
  ")": [")"],
  "]": ["]"],
  "}": ["}"],
  "`": ["`"],
  '"': [RIGHT_DQUOTE, '"'],
};

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

  // Skip over an existing closer.
  const after = state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size));
  const skip = SKIP_OVER[text];
  if (skip && skip.includes(after)) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(to + 1))));
    return true;
  }

  const pair = PAIRS[text];
  if (!pair) return false;

  const before = from > 1 ? state.doc.textBetween(from - 1, from) : "";
  if (before === "\\") return false;

  // Fence exception: when two backticks immediately precede the caret,
  // a third backtick should insert literally (for markdown code fences).
  if (text === "`" && from >= 3) {
    const twoBefore = state.doc.textBetween(from - 2, from);
    if (twoBefore === "``") return false;
  }

  if (!state.selection.empty) {
    const tr = state.tr
      .insert(to, state.schema.text(pair.close))
      .insert(from, state.schema.text(pair.open));
    tr.setSelection(TextSelection.near(tr.doc.resolve(to + 2)));
    view.dispatch(tr);
    return true;
  }

  const tr = state.tr.insertText(pair.open + pair.close, from, to);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1)));
  view.dispatch(tr);
  return true;
}

function completeComposedQuote(view: EditorView): void {
  const { state } = view;
  const { $from, empty, from } = state.selection;

  if (!empty || from <= 1) return;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.spec.code) return;
  }

  // The dead-key composition commits a straight "; upgrade it to a curly pair.
  const before = state.doc.textBetween(from - 1, from);
  const escaped = from > 2 && state.doc.textBetween(from - 2, from - 1) === "\\";
  const after = state.doc.textBetween(from, Math.min(from + 1, state.doc.content.size));
  if (before !== '"' || escaped || after === RIGHT_DQUOTE) return;

  const tr = state.tr.insertText(LEFT_DQUOTE + RIGHT_DQUOTE, from - 1, from);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from)));
  view.dispatch(tr);
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
            compositionend(view, event) {
              if ((event as CompositionEvent).data !== '"') return false;

              // ProseMirror reconciles the composition into state in its own microtask.
              queueMicrotask(() => queueMicrotask(() => completeComposedQuote(view)));
              return false;
            },

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
