import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { FormattingButtons, LinkClickHandler, LinkDialog } from "@/components/editor";
import type { InternalTarget, InternalTargetChildrenLoader } from "@/components/editor/LinkDialog";
import { useBookStore } from "@/features/books/store";
import { getChapterForLinking, listChaptersForBookLinking } from "@/features/chapters/store";
import { assignHeadingIds } from "@/features/links/heading-ids";
import { useNoteStore } from "@/features/notes/store";
import { CanvasRichContentMenu } from "@/features/canvas/nodes/CanvasRichContentMenu";

export function NodeFormatBubble({
  editor,
  onOverlayOpenChange,
}: {
  editor: Editor;
  onOverlayOpenChange?: (open: boolean) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; maxWidth: number } | null>(null);
  const [toolbarElement, setToolbarElement] = useState<HTMLDivElement | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [menuOverlayOpen, setMenuOverlayOpen] = useState(false);
  const [editorFocused, setEditorFocused] = useState(editor.isFocused);
  const [translateX, translateY, zoom] = useStore((flowState) => flowState.transform);
  const notes = useNoteStore((state) => state.notes);
  const books = useBookStore((state) => state.books);
  const loadBooks = useBookStore((state) => state.loadBooks);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ hasSelection: !e.state.selection.empty }),
  });

  const internalTargets = useMemo<InternalTarget[]>(
    () => [
      ...notes.map((note) => ({
        type: "note" as const,
        noteId: note.id,
        title: note.title,
      })),
      ...books.map((book) => ({
        type: "book" as const,
        bookId: book.id,
        title: book.title,
      })),
    ],
    [books, notes]
  );

  const loadInternalTargetChildren = useCallback<InternalTargetChildrenLoader>(
    async (target) => {
      if (target.type === "book") {
        const chapters = await listChaptersForBookLinking(target.bookId);
        return chapters.map((chapter) => ({
          type: "chapter" as const,
          chapterId: chapter.id,
          title: chapter.title,
          headingId: null,
        }));
      }

      if (target.type === "chapter") {
        const chapter = await getChapterForLinking(target.chapterId);
        if (!chapter) return [];
        return assignHeadingIds(chapter.content).headings.map((heading) => ({
          type: "heading" as const,
          chapterId: chapter.id,
          title: heading.text,
          headingId: heading.id,
        }));
      }

      if (target.type === "note") {
        const note = notes.find((candidate) => candidate.id === target.noteId);
        if (!note) return [];
        return assignHeadingIds(note.content).headings.map((heading) => ({
          type: "noteHeading" as const,
          noteId: note.id,
          title: heading.text,
          headingId: heading.id,
        }));
      }

      return [];
    },
    [notes]
  );

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    onOverlayOpenChange?.(linkDialogOpen || menuOverlayOpen);
  }, [linkDialogOpen, menuOverlayOpen, onOverlayOpenChange]);

  const updatePosition = useCallback(() => {
    // Keep the toolbar anchored while a child overlay is open so its dialogs
    // survive the editor losing focus.
    if (!editorFocused && !menuOverlayOpen) {
      setPos(null);
      return;
    }

    const { from, to } = editor.state.selection;
    const editorRect = editor.view.dom.getBoundingClientRect();
    const start = editor.state.selection.empty
      ? { top: editorRect.top, left: editorRect.left }
      : editor.view.coordsAtPos(from);
    const end = editor.state.selection.empty
      ? { bottom: editorRect.bottom, right: editorRect.right }
      : editor.view.coordsAtPos(to);
    const canvasRect = editor.view.dom.closest(".react-flow")?.getBoundingClientRect();
    const bounds = canvasRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
    };
    const toolbarWidth = toolbarElement?.offsetWidth || 320;
    const toolbarHeight = toolbarElement?.offsetHeight || 40;
    const gap = 8;
    // Cap the bubble at the canvas bounds so it never spills past a narrow
    // viewport; the toolbar scrolls horizontally inside the cap.
    const maxWidth = Math.max(160, bounds.right - bounds.left - gap * 2);
    const centerX = (start.left + end.right) / 2;
    const left = Math.max(
      bounds.left + gap,
      Math.min(centerX - toolbarWidth / 2, bounds.right - toolbarWidth - gap)
    );
    const above = start.top - toolbarHeight - gap;
    const top =
      above >= bounds.top + gap
        ? above
        : Math.min(end.bottom + gap, bounds.bottom - toolbarHeight - gap);

    setPos({ top, left, maxWidth });
  }, [editor, editorFocused, menuOverlayOpen, toolbarElement]);

  useEffect(() => {
    updatePosition();
  }, [state.hasSelection, translateX, translateY, updatePosition, zoom]);

  useEffect(() => {
    const onFocus = () => setEditorFocused(true);
    const onBlur = () => setEditorFocused(false);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  useEffect(() => {
    let animationFrame = 0;
    const onSelectionUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePosition);
    };
    editor.on("selectionUpdate", onSelectionUpdate);
    return () => {
      cancelAnimationFrame(animationFrame);
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor, updatePosition]);

  return (
    <>
      {(editorFocused || menuOverlayOpen) &&
        !linkDialogOpen &&
        pos &&
        createPortal(
          <div
            ref={setToolbarElement}
            className="fixed z-50 flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-card px-1.5 py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left, maxWidth: pos.maxWidth }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <FormattingButtons editor={editor} onLinkClick={() => setLinkDialogOpen(true)} />
            <CanvasRichContentMenu editor={editor} onOverlayOpenChange={setMenuOverlayOpen} />
          </div>,
          document.body
        )}
      <LinkDialog
        editor={editor}
        isOpen={linkDialogOpen}
        onClose={() => {
          setLinkDialogOpen(false);
          editor.commands.focus();
        }}
        internalTargets={internalTargets}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
      <LinkClickHandler editor={editor} />
    </>
  );
}
