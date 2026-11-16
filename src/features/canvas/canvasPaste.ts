import type { CanvasPosition } from "@/features/canvas/types";

function isEditableTarget(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable]") !== null;
}

function imageFileOnClipboard(clipboard: DataTransfer): File | null {
  const pastedFile = Array.from(clipboard.files).find((file) => file.type.startsWith("image/"));
  if (pastedFile) return pastedFile;

  const itemFile = Array.from(clipboard.items)
    .map((item) => (item.kind === "file" ? item.getAsFile() : null))
    .find((file): file is File => file !== null && file.type.startsWith("image/"));
  return itemFile ?? null;
}

/**
 * Routes a paste over the Canvas: the image File to place and where, or null
 * when something else owns the paste (a Text Node being edited, a read-only
 * Canvas, an editable field, or no image on the clipboard). A pointer over the
 * Canvas places the image there, otherwise it lands at the viewport center.
 */
export function routeCanvasPaste({
  clipboard,
  target,
  editingNodeId,
  readOnly,
  pointer,
  center,
}: {
  clipboard: DataTransfer | null;
  /** The paste event target. */
  target: EventTarget | null;
  /** From the canvas store. */
  editingNodeId: string | null;
  /** `editorReadOnly`. */
  readOnly: boolean;
  /** Flow position of the pointer if it is over the Canvas, else null. */
  pointer: CanvasPosition | null;
  /** Flow position of the viewport center. */
  center: CanvasPosition;
}): { file: File; position: CanvasPosition } | null {
  if (editingNodeId) return null;
  if (readOnly) return null;
  if (target && isEditableTarget(target)) return null;
  if (!clipboard) return null;

  const file = imageFileOnClipboard(clipboard);
  if (!file) return null;
  return { file, position: pointer ?? center };
}
