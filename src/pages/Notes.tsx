import { useEffect, useRef, useCallback } from "react";
import { useNoteStore } from "../features/notes";
import type { Note, UpdateNoteInput } from "../features/notes";
import { NotesList, NoteEditor, EmptyNotes } from "../components/notes";
import { useSettingsStore } from "../features/settings/store";

export function Notes() {
  const notes = useNoteStore((s) => s.notes);
  const currentNote = useNoteStore((s) => s.currentNote);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const reorderNotes = useNoteStore((s) => s.reorderNotes);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);
  const notesSidebarWidth = useSettingsStore((s) => s.notesSidebarWidth);
  const setNotesSidebarWidth = useSettingsStore((s) => s.setNotesSidebarWidth);
  const isResizing = useRef(false);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleCreateNote = async () => {
    const note = await createNote({ title: "" });
    setCurrentNote(note);
  };

  const handleSelectNote = (note: Note) => setCurrentNote(note);

  const handleSave = (input: UpdateNoteInput) => updateNote(input);

  const handleDelete = (id: string) => deleteNote(id);

  const handlePinNote = (note: Note) => {
    void updateNote({ id: note.id, pinned: !note.pinned });
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
    <div className="flex h-full">
      <div
        className={`h-full relative shrink-0 ${currentNote ? "hidden md:flex" : "flex"} flex-col`}
        style={{ width: `${notesSidebarWidth}px` }}
      >
        <NotesList
          notes={notes}
          currentNoteId={currentNote?.id ?? null}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
          onReorderNotes={reorderNotes}
          onPinNote={handlePinNote}
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
            onDelete={handleDelete}
            onBack={() => setCurrentNote(null)}
          />
        ) : (
          <EmptyNotes onCreateNote={handleCreateNote} />
        )}
      </div>
    </div>
  );
}
