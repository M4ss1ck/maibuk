import type { DragEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { Note } from "@/features/notes";
import { NoteTagsRow } from "@/components/notes/NoteTagsRow";

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (note: Note) => void;
  onRename?: (note: Note, title: string) => void;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (e: DragEvent<HTMLLIElement>) => void;
  onDrop?: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLLIElement>) => void;
}

function formatDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function toPreview(content: string) {
  return content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function NoteListItem({
  note,
  isSelected,
  onSelect,
  onDelete,
  onDuplicate,
  onRename,
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: NoteListItemProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(note.title);
  const title = note.title || t("notes.untitled");
  const preview = toPreview(note.content);

  const commitTitle = () => {
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== note.title) {
      onRename?.(note, nextTitle);
    }
    setIsEditing(false);
  };

  const cancelTitleEdit = () => {
    setDraftTitle(note.title);
    setIsEditing(false);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTitle();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelTitleEdit();
    }
  };

  return (
    <li
      draggable={draggable && !isEditing ? true : undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group relative border-l-2 py-3 pl-2 pr-3 transition-colors ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${
        isSelected ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50"
      } ${isDragging ? "opacity-50" : ""}`}
      onClick={() => {
        if (!isEditing) onSelect(note);
      }}
      onKeyDown={(e) => {
        if (!isEditing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(note);
        }
      }}
    >
      {/* Line 1: title + action buttons (edit, duplicate, delete) */}
      <div className="flex min-w-0 items-center gap-1">
        {isEditing ? (
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleEditKeyDown}
            onClick={(event) => event.stopPropagation()}
            className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            autoFocus
          />
        ) : (
          <>
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h3>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {onRename && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDraftTitle(note.title);
                    setIsEditing(true);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={t("common.edit")}
                  aria-label={t("common.edit")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {onDuplicate && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicate(note);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={t("notes.duplicate")}
                  aria-label={t("notes.duplicate")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(note.id);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Line 2: description + drag handle */}
      <div className="mt-1 flex min-h-4 min-w-0 items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</p>
        <GripVertical
          data-testid="note-drag-handle"
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      {/* Line 3: tags + last-modified */}
      <div className="mt-2 min-h-4">
        <NoteTagsRow tags={note.tags} dateLabel={formatDate(note.contentUpdatedAt)} />
      </div>
    </li>
  );
}
