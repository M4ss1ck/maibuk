import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Note } from "../../features/notes";
import { AddIcon } from "../icons/AddIcon";
import { NoteListItem } from "./NoteListItem";

interface NotesListProps {
  notes: Note[];
  currentNoteId: string | null;
  onSelectNote: (note: Note) => void;
  onCreateNote: () => void;
}

function matchesQuery(note: Note, query: string): boolean {
  const haystack = `${note.title} ${note.content.replace(/<[^>]*>/g, " ")}`.toLowerCase();
  return haystack.includes(query);
}

export function NotesList({
  notes,
  currentNoteId,
  onSelectNote,
  onCreateNote,
}: NotesListProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filtered = query ? notes.filter((n) => matchesQuery(n, query)) : notes;

  return (
    <aside className="w-full border-r border-border flex flex-col bg-background h-full shrink-0">
      {/* Sticky header */}
      <div className="p-4 pt-12 md:pt-4 border-b border-border flex items-center justify-between bg-background z-10 shrink-0">
        <h3 className="font-medium">{t("notes.title")}</h3>
        <button
          type="button"
          onClick={onCreateNote}
          className="p-1 hover:bg-muted rounded transition-colors"
          title={t("notes.newNote")}
        >
          <AddIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-border shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("notes.search")}
          className="w-full px-3 py-2 text-sm border border-border rounded bg-background text-foreground"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-8 px-4 text-muted-foreground text-sm">
            <p>{t("notes.empty")}</p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {filtered.map((note) => (
              <NoteListItem
                key={note.id}
                note={note}
                isSelected={currentNoteId === note.id}
                onSelect={onSelectNote}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer count */}
      {notes.length > 0 && (
        <div className="p-3 border-t border-border text-xs text-muted-foreground bg-background shrink-0">
          {t("notes.noteCount", { count: notes.length })}
        </div>
      )}
    </aside>
  );
}
