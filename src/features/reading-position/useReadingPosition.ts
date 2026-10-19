import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useLayoutEffect } from "react";
import { useReadingPositionStore } from "@/features/reading-position/store";

const CAPTURE_DEBOUNCE_MS = 400;
/** Horizontal inset used when probing the block under the viewport's top edge. */
const PROBE_INSET_X = 8;
/**
 * How long a restored place is held while the document above it settles. On a
 * fresh launch images decode and React node views mount after the restore has
 * measured, which pushes the text down; WebKit has no scroll anchoring to
 * compensate. Any input from the author ends the hold sooner.
 */
const SETTLE_MS = 10_000;
const AUTHOR_INPUT_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

export interface UseReadingPositionOptions {
  editor: Editor | null;
  scrollEl: HTMLElement | null;
  storageKey: string | null;
  suppressRestore?: boolean;
}

function clamp(pos: number, docSize: number): number {
  return Math.max(0, Math.min(pos, docSize - 1));
}

function scrollToPos(editor: Editor, scrollEl: HTMLElement, pos: number): void {
  if (editor.isDestroyed) return;
  try {
    const coords = editor.view.coordsAtPos(pos);
    const containerTop = scrollEl.getBoundingClientRect().top;
    scrollEl.scrollTop += coords.top - containerTop;
  } catch {
    // Leave scroll untouched if ProseMirror can no longer resolve the position.
  }
}

/** Restores the caret and scroll; returns the position kept at the top, if any. */
function restore(editor: Editor, scrollEl: HTMLElement, key: string): number | null {
  const saved = useReadingPositionStore.getState().getPosition(key);
  if (!saved) return null;

  const docSize = editor.state.doc.content.size;

  try {
    const selection = TextSelection.create(editor.state.doc, clamp(saved.caret, docSize));
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  } catch {
    // Stale positions can become invalid after edits; restore is best-effort.
  }

  const top = clamp(saved.top, docSize);
  if (top <= 0) return null;

  scrollToPos(editor, scrollEl, top);
  return top;
}

/** Keeps `pos` at the top while the document resizes, until the author acts. */
function holdPosition(editor: Editor, scrollEl: HTMLElement, pos: number): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};

  const observer = new ResizeObserver(() => scrollToPos(editor, scrollEl, pos));
  const release = () => {
    observer.disconnect();
    clearTimeout(deadline);
    for (const type of AUTHOR_INPUT_EVENTS) {
      document.removeEventListener(type, release, true);
    }
  };
  const deadline = setTimeout(release, SETTLE_MS);
  for (const type of AUTHOR_INPUT_EVENTS) {
    document.addEventListener(type, release, { capture: true, passive: true });
  }
  observer.observe(editor.view.dom);
  return release;
}

export function useReadingPosition({
  editor,
  scrollEl,
  storageKey,
  suppressRestore = false,
}: UseReadingPositionOptions): void {
  useLayoutEffect(() => {
    if (!editor || !scrollEl || !storageKey) return;

    let releaseHold = () => {};
    if (!suppressRestore) {
      const top = restore(editor, scrollEl, storageKey);
      if (top !== null) releaseHold = holdPosition(editor, scrollEl, top);
    }

    let pending: { caret: number; top: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stash = () => {
      if (editor.isDestroyed) return;
      const scrollRect = scrollEl.getBoundingClientRect();
      const editorRect = editor.view.dom.getBoundingClientRect();
      const probe = editor.view.posAtCoords({
        left: editorRect.left + PROBE_INSET_X,
        top: scrollRect.top + 1,
      });
      pending = {
        caret: editor.state.selection.from,
        top: probe ? probe.pos : 0,
      };
    };

    const flush = () => {
      if (pending) {
        useReadingPositionStore.getState().savePosition(storageKey, pending);
      }
    };

    // Reading the scroll position and probing the top block forces a layout, so
    // a burst of keystrokes or a scroll must not do it per event: wait for the
    // author to rest, then capture the place they landed on (issue #556).
    const capture = () => {
      timer = undefined;
      stash();
      flush();
    };

    const scheduleCapture = () => {
      clearTimeout(timer);
      timer = setTimeout(capture, CAPTURE_DEBOUNCE_MS);
    };

    scrollEl.addEventListener("scroll", scheduleCapture, { passive: true });
    editor.on("selectionUpdate", scheduleCapture);

    return () => {
      releaseHold();
      scrollEl.removeEventListener("scroll", scheduleCapture);
      editor.off("selectionUpdate", scheduleCapture);
      // Only a captured-but-not-yet-saved place is worth flushing. With no
      // author event since the last capture there is nothing new to save, and
      // probing layout from a tearing-down effect can overwrite a good saved
      // place with an unsettled one (e.g. a quick Chapter switch).
      const capturePending = timer !== undefined;
      clearTimeout(timer);
      timer = undefined;
      if (capturePending) {
        stash();
        flush();
      }
    };
  }, [editor, scrollEl, storageKey, suppressRestore]);
}
