import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useLayoutEffect } from "react";
import { useReadingPositionStore } from "./store";

const CAPTURE_DEBOUNCE_MS = 400;
/** Horizontal inset used when probing the block under the viewport's top edge. */
const PROBE_INSET_X = 8;

export interface UseReadingPositionOptions {
  editor: Editor | null;
  scrollEl: HTMLElement | null;
  storageKey: string | null;
  suppressRestore?: boolean;
}

function clamp(pos: number, docSize: number): number {
  return Math.max(0, Math.min(pos, docSize - 1));
}

function restore(editor: Editor, scrollEl: HTMLElement, key: string): void {
  const saved = useReadingPositionStore.getState().getPosition(key);
  if (!saved) return;

  const docSize = editor.state.doc.content.size;

  try {
    const selection = TextSelection.create(
      editor.state.doc,
      clamp(saved.caret, docSize),
    );
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  } catch {
    // Stale positions can become invalid after edits; restore is best-effort.
  }

  const top = clamp(saved.top, docSize);
  if (top <= 0) return;

  try {
    const coords = editor.view.coordsAtPos(top);
    const containerTop = scrollEl.getBoundingClientRect().top;
    scrollEl.scrollTop += coords.top - containerTop;
  } catch {
    // Leave scroll untouched if ProseMirror can no longer resolve the position.
  }
}

export function useReadingPosition({
  editor,
  scrollEl,
  storageKey,
  suppressRestore = false,
}: UseReadingPositionOptions): void {
  useLayoutEffect(() => {
    if (!editor || !scrollEl || !storageKey) return;

    if (!suppressRestore) {
      restore(editor, scrollEl, storageKey);
    }

    let pending: { caret: number; top: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stash = () => {
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

    const scheduleCapture = () => {
      stash();
      clearTimeout(timer);
      timer = setTimeout(flush, CAPTURE_DEBOUNCE_MS);
    };

    scrollEl.addEventListener("scroll", scheduleCapture, { passive: true });
    editor.on("selectionUpdate", scheduleCapture);

    return () => {
      scrollEl.removeEventListener("scroll", scheduleCapture);
      editor.off("selectionUpdate", scheduleCapture);
      clearTimeout(timer);
      flush();
    };
  }, [editor, scrollEl, storageKey, suppressRestore]);
}
