import type { EditorState } from "@tiptap/pm/state";

/**
 * Whether any @tiptap/suggestion plugin in this state has an open popup.
 *
 * Suggestion's plugin state is `{ active, range, query, ... }`; an open popup
 * is the only shape that sets `active === true` and carries a `range`. Editor
 * props run before plugin key handlers in ProseMirror, so the editor's own
 * Escape handling must step aside while a suggestion is open and let the
 * plugin's keydown dismiss it.
 */
export function hasActiveSuggestion(state: EditorState): boolean {
  for (const plugin of state.plugins) {
    const pluginState = plugin.getState(state);
    if (
      pluginState !== null &&
      typeof pluginState === "object" &&
      (pluginState as { active?: unknown }).active === true &&
      "range" in pluginState
    ) {
      return true;
    }
  }
  return false;
}
