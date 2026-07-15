import { useTranslation } from "react-i18next";
import { GridListItem } from "react-aria-components/GridList";
import { BookOpen } from "lucide-react";
import type { Note } from "@/features/notes";
import { notePlainText } from "@/components/notes/notes-list-model";
import { NoteTagsRow } from "@/components/notes/NoteTagsRow";
import { timeAgo } from "@/components/notes/timeAgo";

interface NoteCardProps {
  note: Note;
  bookTitle?: string | null;
  onClick: () => void;
}

export function NoteCard({ note, bookTitle, onClick }: NoteCardProps) {
  const { t, i18n } = useTranslation();
  const title = note.title || t("notes.untitled");
  const preview = notePlainText(note.content);

  return (
    <GridListItem
      id={note.id}
      textValue={title}
      onAction={onClick}
      className={({ isFocusVisible, isHovered, isPressed }) =>
        `flex h-44 flex-col overflow-hidden rounded-xl border bg-card p-4 text-left transition-all duration-200 ${
          isFocusVisible ? "border-primary ring-2 ring-primary ring-offset-2" : "border-border"
        } ${isHovered || isPressed ? "-translate-y-1 shadow-lg" : ""}`
      }
    >
      <h2 className="truncate font-medium text-foreground">{title}</h2>

      <p className="mt-1 line-clamp-2 min-h-8 text-sm text-muted-foreground">{preview}</p>

      {bookTitle && (
        <span className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{bookTitle}</span>
        </span>
      )}

      <div className="mt-auto pt-2">
        <NoteTagsRow
          tags={note.tags}
          dateLabel={timeAgo(note.contentUpdatedAt, i18n.language, t)}
          interactiveOverflow={false}
        />
      </div>
    </GridListItem>
  );
}
