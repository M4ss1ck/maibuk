import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import type { Note } from "../../features/notes";
import { NoteTagsRow } from "./NoteTagsRow";
import { timeAgo } from "./timeAgo";

interface NoteCardProps {
  note: Note;
  bookTitle?: string | null;
  onClick: () => void;
}

function toPreview(content: string) {
  return content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function NoteCard({ note, bookTitle, onClick }: NoteCardProps) {
  const { t, i18n } = useTranslation();
  const title = note.title || t("notes.untitled");
  const preview = toPreview(note.content);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-44 flex-col overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
    >
      <h3 className="truncate font-medium text-foreground">{title}</h3>

      <p className="mt-1 line-clamp-2 min-h-8 text-sm text-muted-foreground">
        {preview}
      </p>

      {bookTitle && (
        <span className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{bookTitle}</span>
        </span>
      )}

      <div className="mt-auto pt-2">
        <NoteTagsRow
          tags={note.tags}
          dateLabel={timeAgo(note.updatedAt, i18n.language, t)}
        />
      </div>
    </button>
  );
}
