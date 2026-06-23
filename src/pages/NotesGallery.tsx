import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNoteStore } from "../features/notes";
import { useBookStore } from "../features/books/store";
import { useSettingsStore } from "../features/settings/store";
import { NoteCard } from "../components/notes";
import { Button } from "../components/ui/Button";
import { AddIcon, MaibukLogo } from "../components/icons";

export function NotesGallery() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);
  const createNote = useNoteStore((s) => s.createNote);
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const setLastNoteId = useSettingsStore((s) => s.setLastNoteId);

  useEffect(() => {
    void loadNotes();
    void loadBooks();
  }, [loadNotes, loadBooks]);

  const bookTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const book of books) map.set(book.id, book.title);
    return map;
  }, [books]);

  const openNote = (id: string) => {
    setLastNoteId(id);
    navigate(`/notes/${id}`);
  };

  const handleCreateNote = async () => {
    const note = await createNote({ title: "", bookId: null });
    openNote(note.id);
  };

  return (
    <div className="p-4 sm:p-8 overflow-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <h2 className="text-xl sm:text-2xl font-semibold">{t("notes.title")}</h2>
        <Button onClick={handleCreateNote} className="text-sm">
          <AddIcon className="w-5 h-5" />
          <span>{t("notes.newNote")}</span>
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 sm:py-28 text-center">
          <div className="w-20 h-20 mb-8">
            <MaibukLogo className="w-full h-full text-primary opacity-70" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-semibold mb-3 tracking-tight">
            {t("notes.empty")}
          </h3>
          <Button size="lg" onClick={handleCreateNote}>
            <AddIcon className="w-5 h-5" />
            {t("notes.newNote")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              bookTitle={note.bookId ? bookTitleById.get(note.bookId) : null}
              onClick={() => openNote(note.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
