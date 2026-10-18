// A React Aria keyboard drag calls ariaHideOutside, which marks the page
// outside the dragged list `inert` and re-runs on every `inert` change. A
// Chapter list virtualizes its rows, so each scroll mounts rows, each mount
// flips `inert` off and on for the whole page, and WebKit restyles the long
// TipTap editor's subtree twice per flip (#551).
//
// An ancestor that is already `inert` when React Aria first hides the page is
// skipped by it and never flipped in the restore/re-hide cycle. This shields
// the editor by making its outermost non-list ancestor inert ourselves, before
// React Aria's session starts, and removing only that attribute afterwards.

const NO_RELEASE = () => {};

// React Aria starts a keyboard or screen-reader drag with a session; a native
// pointer drag starts none, so only the former hides the page. The last input
// kind tells them apart (react-aria's modality is not a public export).
let lastInputWasKeyboard = false;
if (typeof document !== "undefined") {
  document.addEventListener("keydown", () => (lastInputWasKeyboard = true), true);
  document.addEventListener("pointerdown", () => (lastInputWasKeyboard = false), true);
}

/** True when the most recent input was a key press, so a drag it starts is a session. */
export function dragStartedByKeyboard(): boolean {
  return lastInputWasKeyboard;
}

/**
 * Sets `inert` on the top-most ancestor of the editor that does not contain
 * `list`. Returns a function that removes it, but only if this call set it.
 * Does nothing when there is no editor, the editor is in the list, or an
 * ancestor of the editor is already inert.
 */
export function inertEditorOutside(list: Element): () => void {
  const editor = document.querySelector(".ProseMirror");
  if (!editor || editor.contains(list) || editor.closest("[inert]")) return NO_RELEASE;

  let shield: Element = editor;
  while (
    shield.parentElement &&
    shield.parentElement !== document.body &&
    !shield.parentElement.contains(list)
  ) {
    shield = shield.parentElement;
  }

  shield.setAttribute("inert", "");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (shield.isConnected) shield.removeAttribute("inert");
  };
}
