// View refresh on the Change Feed (ADR 0003): pulls write through the narrow
// write paths, which know nothing about the UI; this subscriber re-reads the
// affected views in place so open editors keep their mounts and selection.
// Local Changes written outside the open view's store (a Plugin write, an
// import, a Version restore) refresh the same views; a store's own save is
// emitted with the store-view meta, so it is skipped. A local write without
// the meta flushes open editors before it persists, so a refresh never
// replaces typing that never reached the database, and the Edit Session drops
// its own save's echo. Installed once at startup; idempotent.

import { isEntityChange, onChange, type Change } from "@/features/sync/change-feed";
import { useBookStore } from "@/features/books/store";
import { useChapterStore } from "@/features/chapters/store";
import { useNoteStore } from "@/features/notes/store";
import { useCanvasStore } from "@/features/canvas/store";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";

let uninstall: (() => void) | null = null;

async function refreshViews(change: Change): Promise<void> {
  if (change.entity === "book") {
    await useBookStore.getState().refreshBooks();
    await useChapterStore.getState().refreshChapters(change.id);
    // A deletion leaves the open book pointing at a row that no longer
    // exists; close it the way the old direct removal did.
    const books = useBookStore.getState();
    if (
      (books.currentBook?.id === change.id && !books.books.some((book) => book.id === change.id)) ||
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
    if (notes.currentNote?.id === change.id && !notes.notes.some((note) => note.id === change.id)) {
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
    } else if (
      canvases.current?.id === change.id &&
      // Remote Changes keep their existing handoff, metadata included. A local
      // Change here came from outside the store (a store's own save carries
      // viewUpdated and never reaches this branch): a content write hands the
      // new doc to the Edit Session as external content, while a metadata
      // write only touches the gallery row the store already has.
      (change.origin === "remote" || change.kind === "content")
    ) {
      await useCanvasStore.getState().refreshOpenCanvas();
    }
  }
}

export function installViewRefresh(): () => void {
  if (uninstall) return uninstall;

  const stop = onChange((signal, meta) => {
    if (!isEntityChange(signal)) return;
    if (signal.origin === "local") {
      // A store's own write already re-read its view; only an outside writer
      // (a Plugin, an import, a Restore) leaves views stale.
      if (meta?.viewUpdated) return;
      // Sample Changes never refresh the real views (ADR 0008); the switch
      // reloads them itself.
      if (isTutorialLibraryActive()) return;
    }
    return refreshViews(signal);
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
