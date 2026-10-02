// A caret left in inert content makes every focus change cost Chromium a walk
// of the document: its text input state looks for the next editable position
// and finds none. A React Aria keyboard drag makes the editor inert and moves
// focus twice per arrow key, about 1.5 ms each in a long Chapter (#377).
//
// A selection in an editor is never put back: setting it would focus the
// editor in Chromium and WebKit, pulling focus out of the list, and cost the
// same walk again. The editor writes its own selection back when it next
// takes focus.

function isInEditor(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('[contenteditable]:not([contenteditable="false"])') != null;
}

function isInert(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("[inert]") != null;
}

const NO_RESTORE = () => {};

/**
 * Removes the document's selection when it sits in inert content. The returned
 * function puts back, once, a selection that was outside any editor, unless
 * the author selected something else meanwhile.
 */
export function parkInertSelection(): () => void {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return NO_RESTORE;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode || !(isInert(anchorNode) || isInert(focusNode))) {
    return NO_RESTORE;
  }
  selection.removeAllRanges();
  if (isInEditor(anchorNode) || isInEditor(focusNode)) return NO_RESTORE;

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    const current = document.getSelection();
    if (!current) return;
    // A focus change can leave a collapsed selection on the focused control
    // (jsdom does); text the author selected, or a caret in an editor, stays.
    const authorSelected =
      current.rangeCount > 0 &&
      (!current.isCollapsed || (current.anchorNode !== null && isInEditor(current.anchorNode)));
    if (authorSelected || !anchorNode.isConnected || !focusNode.isConnected) return;
    try {
      current.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    } catch {
      // The text under the saved offsets changed; there is nothing to put back.
    }
  };
}
