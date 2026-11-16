import type { CanvasPosition } from "@/features/canvas/types";

// A field, an editor, or anything in a dialog owns its own paste.
function isOwnedElement(element: EventTarget | null): boolean {
  if (!(element instanceof Element)) return false;
  return element.closest('input, textarea, select, [contenteditable], [role="dialog"]') !== null;
}

// The Canvas owns a paste only while focus rests on the bare page (a click on
// the pane focuses nothing) or inside the Canvas surface.
function isCanvasFocus(focused: Element | null, surface: Element | null): boolean {
  if (focused === null || focused === focused.ownerDocument.body) return true;
  return surface !== null && surface.contains(focused);
}

/**
 * Routes a paste over the Canvas: where a pasted image lands, or null when
 * something else owns the paste (a Text Node being edited, a read-only Canvas,
 * or an editable field or open dialog). A pointer over the Canvas places the
 * image there, otherwise it lands at the viewport center. Whether the paste
 * brings an image at all is `claimPastedImage`'s call.
 */
export function routeCanvasPaste({
  target,
  focused,
  surface,
  editingNodeId,
  readOnly,
  pointer,
  center,
}: {
  /** The paste event target. */
  target: EventTarget | null;
  /** `document.activeElement` when the paste fired. */
  focused: Element | null;
  /** The Canvas surface element. */
  surface: Element | null;
  /** From the canvas store. */
  editingNodeId: string | null;
  /** `editorReadOnly`. */
  readOnly: boolean;
  /** Flow position of the pointer if it is over the Canvas, else null. */
  pointer: CanvasPosition | null;
  /** Flow position of the viewport center. */
  center: CanvasPosition;
}): CanvasPosition | null {
  if (editingNodeId || readOnly) return null;
  if (isOwnedElement(target) || isOwnedElement(focused)) return null;
  if (!isCanvasFocus(focused, surface)) return null;
  return pointer ?? center;
}
