import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Keys whose default action only moves the caret or that carry no command:
// the browser handles them, so the stale state selection does not matter.
const PASSIVE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
]);

interface DomObserverView extends EditorView {
  domObserver?: { flush?: () => void };
}

/**
 * Reads the DOM selection into the editor state before a key's command runs.
 * A caret move (End, Home, a click) changes the DOM selection immediately, but
 * ProseMirror only reads it on `selectionchange`, which fires a moment later;
 * its own keydown flush covers pending DOM mutations, not this. A Backspace,
 * Delete, Enter, or formatting shortcut pressed inside that moment acted on
 * the old caret. Flushing the observer applies ProseMirror's own reading of
 * the DOM selection (node views and node selections included).
 */
export const DomSelectionSync = Extension.create({
  name: "domSelectionSync",
  // Ahead of every keymap, so they all see the caret the author sees.
  priority: 10000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("domSelectionSync"),
        props: {
          handleKeyDown(view, event) {
            if (!PASSIVE_KEYS.has(event.key) && view.hasFocus()) {
              (view as DomObserverView).domObserver?.flush?.();
            }
            return false;
          },
        },
      }),
    ];
  },
});
