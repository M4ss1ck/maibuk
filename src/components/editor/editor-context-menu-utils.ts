import type { Node as PMNode } from "@tiptap/pm/model";

const MENU_WIDTH = 224;
const MENU_HEIGHT = 300;
const VIEWPORT_PADDING = 8;

/**
 * Extract the word at a given ProseMirror position.
 * Uses Unicode-aware matching to support accented characters (Spanish, etc.).
 */
export function getWordAtPosition(
  doc: PMNode,
  pos: number,
): { word: string } | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;

  const offset = $pos.parentOffset;
  const text = parent.textContent;

  const isWordChar = (ch: string) => /[\p{L}\p{M}'-]/u.test(ch);

  let start = offset;
  let end = offset;

  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;

  if (start === end) return null;

  const word = text.slice(start, end);
  // Skip single-char punctuation-only results
  if (/^['-]+$/.test(word)) return null;

  return { word };
}

export function clampPosition(clientX: number, clientY: number) {
  const maxLeft = window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING;
  const maxTop = window.innerHeight - MENU_HEIGHT - VIEWPORT_PADDING;
  return {
    left: Math.min(
      Math.max(clientX, VIEWPORT_PADDING),
      Math.max(maxLeft, VIEWPORT_PADDING),
    ),
    top: Math.min(
      Math.max(clientY, VIEWPORT_PADDING),
      Math.max(maxTop, VIEWPORT_PADDING),
    ),
  };
}

export function adjustPosition(
  position: { top: number; left: number },
  rect: DOMRect,
) {
  const maxLeft = window.innerWidth - rect.width - VIEWPORT_PADDING;
  const maxTop = window.innerHeight - rect.height - VIEWPORT_PADDING;
  return {
    left: Math.min(
      Math.max(position.left, VIEWPORT_PADDING),
      Math.max(maxLeft, VIEWPORT_PADDING),
    ),
    top: Math.min(
      Math.max(position.top, VIEWPORT_PADDING),
      Math.max(maxTop, VIEWPORT_PADDING),
    ),
  };
}
