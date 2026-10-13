import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useBookStore } from "@/features/books/store";
import { useCanvasStore } from "@/features/canvas/store";
import { useChapterStore } from "@/features/chapters/store";
import { useNoteStore } from "@/features/notes/store";
import {
  pluginItemContextForPath,
  type PluginItemContext,
} from "@/features/plugins/target-context";

/**
 * The item the author is in right now, for a targeted Plugin Command (#446).
 * Reads the stores that track the open Chapter, Note, Canvas, and Book (and a
 * Canvas's selected node) and narrows them to the active route through the
 * context-target resolver, so a Command's enablement updates the moment the
 * author opens or closes a Chapter.
 */
export function usePluginItemContext(): PluginItemContext {
  const pathname = useLocation().pathname;
  const chapter = useChapterStore((state) => state.currentChapter?.id ?? null);
  const note = useNoteStore((state) => state.currentNote?.id ?? null);
  const book = useBookStore((state) => state.currentBook?.id ?? null);
  const canvas = useCanvasStore((state) => state.current?.id ?? null);
  const canvasNode = useCanvasStore((state) => state.selectedNodeId);
  return useMemo(
    () => pluginItemContextForPath(pathname, { book, chapter, note, canvas, canvasNode }),
    [pathname, book, chapter, note, canvas, canvasNode]
  );
}
