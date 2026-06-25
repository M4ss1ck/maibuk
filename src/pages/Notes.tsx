import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useNoteStore } from "../features/notes";
import type { Note, UpdateNoteInput } from "../features/notes";
import { useBookStore } from "../features/books/store";
import { NotesList, NoteEditor, EmptyNotes } from "../components/notes";
import { useSettingsStore } from "../features/settings/store";
import { normalizeLanguage } from "../features/settings/types";
import { useShortcuts } from "../lib/shortcuts";
import {
  markdownToEditorHtml,
  titleFromMarkdown,
} from "../features/markdown";

export function Notes() {
  const notes = useNoteStore((s) => s.notes);
  const currentNote = useNoteStore((s) => s.currentNote);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const loadNote = useNoteStore((s) => s.loadNote);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const reorderNotes = useNoteStore((s) => s.reorderNotes);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const notesSidebarWidth = useSettingsStore((s) => s.notesSidebarWidth);
  const setNotesSidebarWidth = useSettingsStore((s) => s.setNotesSidebarWidth);
  const lastNoteId = useSettingsStore((s) => s.lastNoteId);
  const setLastNoteId = useSettingsStore((s) => s.setLastNoteId);
  const isResizing = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { noteId } = useParams();
  const hasPendingHeadingScroll = Boolean(
    (location.state as { scrollToHeadingId?: string } | null)
      ?.scrollToHeadingId,
  );
  const [returnTarget, setReturnTarget] = useState<{
    to: string;
    label: string;
  } | null>(null);

  const getBookLanguage = useCallback(
    (bookId?: string | null) =>
      normalizeLanguage(books.find((book) => book.id === bookId)?.language),
    [books],
  );

  useEffect(() => {
    void loadNotes();
    void loadBooks();
  }, [loadNotes, loadBooks]);

  useEffect(() => {
    const state = location.state as {
      returnTo?: string;
      returnLabel?: string;
    } | null;
    if (state?.returnTo) {
      setReturnTarget({ to: state.returnTo, label: state.returnLabel ?? "" });
    }
  }, [location.state]);

  // Open the note named in the route. Fall back to the gallery if it is gone.
  useEffect(() => {
    if (!noteId) return;
    const scrollToHeadingId = (
      location.state as { scrollToHeadingId?: string } | null
    )?.scrollToHeadingId;
    void loadNote(noteId).then(() => {
      if (!useNoteStore.getState().currentNote) {
        navigate("/notes", { replace: true });
        return;
      }
      setLastNoteId(noteId);
      if (!scrollToHeadingId) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(scrollToHeadingId)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      });
    });
  }, [noteId, loadNote, navigate, setLastNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  useShortcuts([
    {
      keys: "backspace",
      onTrigger: () => {
        navigate(returnTarget?.to ?? "/notes");
      },
    },
  ]);

  const handleCreateNote = async (bookId?: string | null) => {
    const note = await createNote({
      title: "",
      bookId: bookId ?? null,
      language: getBookLanguage(bookId),
    });
    setCurrentNote(note);
    setLastNoteId(note.id);
  };

  const handleSelectNote = (note: Note) => {
    setCurrentNote(note);
    setLastNoteId(note.id);
  };

  const handleSave = (input: UpdateNoteInput) => updateNote(input);

  const handleDelete = async (id: string) => {
    await deleteNote(id);
    if (lastNoteId === id) {
      setLastNoteId(null);
    }
  };

  const handleReassignNoteBook = (noteId: string, bookId: string | null) => {
    void updateNote({ id: noteId, bookId, language: getBookLanguage(bookId) });
  };

  const handleImportMarkdown = async (
    markdown: string,
    filenameStem: string,
  ) => {
    const title = titleFromMarkdown(markdown, filenameStem);
    const content = markdownToEditorHtml(markdown);
    const note = await createNote({ title, content, language: "en" });
    setCurrentNote(note);
    setLastNoteId(note.id);
  };

  const handleDuplicateNote = async (note: Note) => {
    const duplicated = await createNote({
      title: `${note.title} (copy)`,
      bookId: note.bookId ?? null,
      content: note.content,
      language: note.language,
      tags: [...note.tags],
      wordCount: note.wordCount,
    });
    setCurrentNote(duplicated);
    setLastNoteId(duplicated.id);
  };

  // Sidebar drag-resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = notesSidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(
          200,
          Math.min(480, startWidth + moveEvent.clientX - startX),
        );
        setNotesSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [notesSidebarWidth, setNotesSidebarWidth],
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <div
        className={`h-full relative shrink-0 ${currentNote ? "hidden md:flex" : "flex"} flex-col`}
        style={{ width: `${notesSidebarWidth}px` }}
      >
        <NotesList
          notes={notes}
          books={books}
          currentNoteId={currentNote?.id ?? null}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          onReorderNotes={reorderNotes}
          onReassignNoteBook={handleReassignNoteBook}
          onDeleteNote={handleDelete}
          onDuplicateNote={handleDuplicateNote}
          onRenameNote={(id, title) => updateNote({ id, title })}
          onImportMarkdown={handleImportMarkdown}
        />
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      </div>
      <div
        className={`flex-1 min-w-0 ${currentNote ? "flex" : "hidden md:flex"} flex-col`}
      >
        {currentNote ? (
          <NoteEditor
            key={currentNote.id}
            note={currentNote}
            onSave={handleSave}
            onBack={() => {
              setCurrentNote(null);
              setLastNoteId(null);
            }}
            onReturnToBook={
              returnTarget ? () => navigate(returnTarget.to) : undefined
            }
            returnLabel={returnTarget?.label}
            suppressRestore={hasPendingHeadingScroll}
          />
        ) : (
          <EmptyNotes
            onCreateNote={handleCreateNote}
            onBack={() => navigate("/notes")}
          />
        )}
      </div>
    </div>
  );
}
