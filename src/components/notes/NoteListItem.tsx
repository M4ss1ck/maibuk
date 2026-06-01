import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Pin } from "lucide-react";
import type { Note } from "../../features/notes";

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (e: DragEvent<HTMLLIElement>) => void;
  onDrop?: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLLIElement>) => void;
  isDragging?: boolean;
}

// Strip HTML tags for a plain-text preview (content is TipTap HTML).
function toPreview(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function NoteListItem({
  note,
  isSelected,
  onSelect,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging = false,
}: NoteListItemProps) {
  const { t } = useTranslation();
  const title = note.title.trim() || t("notes.untitled");
  const preview = toPreview(note.content);

  return (
    <li
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group rounded transition-colors ${isDragging ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        draggable={false}
        onClick={() => onSelect(note)}
        className={`w-full text-left rounded p-3 transition-colors ${
          isSelected ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"
        }`}
      >
        <span className="flex items-center gap-1">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          {note.pinned && (
            <Pin className="w-3.5 h-3.5 text-primary fill-current" />
          )}
          <span className="block truncate font-medium text-sm">{title}</span>
        </span>
        {preview && (
          <span className="mt-1 block text-xs text-muted-foreground line-clamp-2">
            {preview}
          </span>
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          {formatDate(note.updatedAt)}
        </span>
      </button>
    </li>
  );
}
