import { useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Pin, Trash2 } from "lucide-react";
import type { Note } from "../../features/notes";
import { tagColor } from "./tagColor";

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
  onPinToggle?: (note: Note) => void;
  onDelete?: (id: string) => void;
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
  onPinToggle,
  onDelete,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging = false,
}: NoteListItemProps) {
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
        className={`w-full text-left rounded py-3 pl-2 pr-3 transition-colors ${isSelected ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"
          }`}
      >
        <span className="flex items-center gap-1">
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          <span className="flex-1 min-w-0 block truncate font-medium text-sm">{title}</span>
          {confirmingDelete && onDelete ? (
            <span className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note.id);
                  setConfirmingDelete(false);
                }}
                className="px-1.5 py-0.5 text-[10px] bg-destructive text-white rounded hover:bg-destructive-hover"
              >
                {t("common.yes")}
              </button>
              <button
                type="button"
                draggable={false}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDelete(false);
                }}
                className="px-1.5 py-0.5 text-[10px] border border-border rounded hover:bg-muted"
              >
                {t("common.no")}
              </button>
            </span>
          ) : (
            <>
              {onPinToggle && (
                <button
                  type="button"
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPinToggle(note);
                  }}
                  title={note.pinned ? t("notes.unpin") : t("notes.pin")}
                  aria-label={note.pinned ? t("notes.unpin") : t("notes.pin")}
                  className={`shrink-0 p-1 rounded transition-colors ${note.pinned
                      ? "text-primary bg-primary/10 hover:bg-primary/20"
                      : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted"
                    }`}
                >
                  <Pin className={`w-3.5 h-3.5 ${note.pinned ? "fill-current" : ""}`} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDelete(true);
                  }}
                  title={t("notes.delete")}
                  aria-label={t("notes.delete")}
                  className="shrink-0 p-1 rounded transition-colors text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </span>
        {preview && (
          <span className="mt-1 block text-xs text-muted-foreground truncate">
            {preview}
          </span>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {note.tags.slice(0, 3).map((tag) => {
            const color = tagColor(tag);
            return (
              <span
                key={tag}
                className="rounded-full border px-1.5 py-0.5 text-[10px]"
                style={{ borderColor: color, backgroundColor: `${color}22`, color }}
              >
                {tag}
              </span>
            );
          })}
          <span className="text-xs text-muted-foreground">{formatDate(note.updatedAt)}</span>
        </div>
      </button>
    </li>
  );
}
