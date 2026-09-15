// View refresh on remote Changes (ADR 0003): pulls write through the narrow
// write paths, which know nothing about the UI; this subscriber re-reads the
// affected views in place so open editors keep their mounts and selection.
// Installed once at startup; idempotent. Local Changes need no refresh here:
// the writing store already updated its own view, except Version Restore,
// which refreshes explicitly after applying.

import { onChange, type Change } from "@/features/sync/change-feed";
import { useBookStore } from "@/features/books/store";
import { useChapterStore } from "@/features/chapters/store";
import { useNoteStore } from "@/features/notes/store";
import { useCanvasStore } from "@/features/canvas/store";

let uninstall: (() => void) | null = null;

async function refreshViewsForRemote(change: Change): Promise<void> {
  if (change.entity === "book") {
    await useBookStore.getState().refreshBooks();
    await useChapterStore.getState().refreshChapters(change.id);
    // A remote deletion leaves the open book pointing at a row that no longer
    // exists; close it the way the old direct removal did.
    const books = useBookStore.getState();
    if (
      (books.currentBook?.id === change.id &&
        !books.books.some((book) => book.id === change.id)) ||
      (useChapterStore.getState().currentBookId === change.id &&
        !books.books.some((book) => book.id === change.id))
    ) {
      if (books.currentBook?.id === change.id) {
        useBookStore.setState({ currentBook: null });
      }
      if (useChapterStore.getState().currentBookId === change.id) {
        useChapterStore.setState({ chapters: [], currentChapter: null, currentBookId: null });
      }
    }
  } else if (change.entity === "note") {
    await useNoteStore.getState().refreshNotes();
    const notes = useNoteStore.getState();
    if (
      notes.currentNote?.id === change.id &&
      !notes.notes.some((note) => note.id === change.id)
    ) {
      useNoteStore.setState({ currentNote: null });
    }
  } else {
    await useCanvasStore.getState().refreshCanvases();
    const canvases = useCanvasStore.getState();
    if (
      canvases.current?.id === change.id &&
      !canvases.canvases.some((canvas) => canvas.id === change.id)
    ) {
      useCanvasStore.setState({ current: null });
    } else if (canvases.current?.id === change.id) {
      // A remote Change to the open canvas hands the new doc to the Edit
      // Session as external content (never as a local edit).
      await useCanvasStore.getState().refreshOpenCanvas();
    }
  }
}

/** Refresh the views after a local snapshot apply (Version Restore). */
export async function refreshViewsForLocalRestore(bookId: string): Promise<void> {
  await useBookStore.getState().refreshBooks();
  await useChapterStore.getState().refreshChapters(bookId);
}

export function installViewRefresh(): () => void {
  if (uninstall) return uninstall;

  const stop = onChange((change) => {
    if (change.origin !== "remote") return;
    return refreshViewsForRemote(change);
  });

  uninstall = () => {
    stop();
    uninstall = null;
  };
  return uninstall;
}

export function resetViewRefreshForTests(): void {
  uninstall?.();
  uninstall = null;
}
