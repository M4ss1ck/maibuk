import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QuickNoteEditor } from "@/components/book/QuickNoteEditor";
import type { Note } from "@/features/notes";

interface BookNotesViewProps {
  notes: Note[];
  onCreateNote: (html: string) => void;
  onOpenNote: (noteId: string) => void;
}

function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, " ").trim().length > 0;
}

export function BookNotesView({ notes, onCreateNote, onOpenNote }: BookNotesViewProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleAdd = () => {
    if (!hasText(draft)) return;
    onCreateNote(draft);
    setDraft("");
    setEditorKey((key) => key + 1);
  };

  // The Quick Note editor keeps Tab for indentation; Escape is the way out to
  // the Add note button that follows it.
  const handleEditorEscape = () => addButtonRef.current?.focus();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2 shrink-0">
        <div className="rounded-lg border border-border bg-muted/20 py-1">
          <QuickNoteEditor
            key={editorKey}
            onChange={setDraft}
            placeholder={t("bookNotes.quickPlaceholder")}
            onEscape={handleEditorEscape}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            ref={addButtonRef}
            type="button"
            onClick={handleAdd}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("bookNotes.add")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {notes.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {t("bookNotes.empty")}
          </p>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onOpenNote(note.id)}
                  className="w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  {note.title || t("notes.untitled")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
