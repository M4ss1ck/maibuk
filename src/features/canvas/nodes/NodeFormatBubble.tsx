import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  FormattingButtons,
  LinkClickHandler,
  LinkDialog,
} from "../../../components/editor";
import type {
  InternalTarget,
  InternalTargetChildrenLoader,
} from "../../../components/editor/LinkDialog";
import { useBookStore } from "../../books/store";
import {
  getChapterForLinking,
  listChaptersForBookLinking,
} from "../../chapters/store";
import { assignHeadingIds } from "../../links/heading-ids";
import { useNoteStore } from "../../notes/store";

export function NodeFormatBubble({
  editor,
  onLinkDialogOpenChange,
}: {
  editor: Editor;
  onLinkDialogOpenChange?: (open: boolean) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
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
    [books, notes],
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
    [notes],
  );

  const resolveBookIdForChapter = useCallback(async (chapterId: string) => {
    const chapter = await getChapterForLinking(chapterId);
    return chapter?.bookId;
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (!state.hasSelection) {
      setPos(null);
      return;
    }
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    setPos({ top: coords.top - 44, left: coords.left });
  }, [editor, state.hasSelection, editor.state.selection]);

  return (
    <>
      {state.hasSelection && pos && (
        <div
          className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-card px-1.5 py-1 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <FormattingButtons
            editor={editor}
            onLinkClick={() => {
              onLinkDialogOpenChange?.(true);
              setLinkDialogOpen(true);
            }}
          />
        </div>
      )}
      <LinkDialog
        editor={editor}
        isOpen={linkDialogOpen}
        onClose={() => {
          setLinkDialogOpen(false);
          onLinkDialogOpenChange?.(false);
          editor.commands.focus();
        }}
        internalTargets={internalTargets}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
      <LinkClickHandler
        editor={editor}
        resolveBookIdForChapter={resolveBookIdForChapter}
      />
    </>
  );
}
