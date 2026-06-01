import { useEffect } from "react";
import { useNoteStore } from "../features/notes";
import type { Note, UpdateNoteInput } from "../features/notes";
import { NotesList, NoteEditor, EmptyNotes } from "../components/notes";

export function Notes() {
  const notes = useNoteStore((s) => s.notes);
  const currentNote = useNoteStore((s) => s.currentNote);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);

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

  return (
    <div className="flex h-full">
      <div
        className={`w-full md:w-80 shrink-0 ${currentNote ? "hidden md:flex" : "flex"} flex-col`}
      >
        <NotesList
          notes={notes}
          currentNoteId={currentNote?.id ?? null}
          onSelectNote={handleSelectNote}
          onCreateNote={handleCreateNote}
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
