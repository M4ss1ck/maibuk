import { useState } from "react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { GripVertical, Pin, Trash2, Copy } from "lucide-react";
import type { Note } from "../../features/notes";
import { NoteTagsRow } from "./NoteTagsRow";

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
  onPinToggle?: (note: Note) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (note: Note) => void;
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
  onDuplicate,
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
      className={`group rounded transition-colors ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isDragging ? "opacity-50" : ""}`}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: Cannot use <button> because it contains nested action <button> elements */}
      <div
        role="button"
        tabIndex={0}
        draggable={false}
        onClick={() => onSelect(note)}
        onKeyDown={() => onSelect(note)}
        className={`w-full text-left rounded py-3 pl-2 pr-3 transition-colors ${isSelected ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-muted/50"
          }`}
      >
        <span className="flex items-center gap-1">
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
                    : "text-muted-foreground hover:bg-muted"
                    }`}
                >
                  <Pin className={`w-3.5 h-3.5 ${note.pinned ? "fill-current" : ""}`} />
                </button>
              )}
              {onDuplicate && (
                <button
                  type="button"
                  draggable={false}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(note);
                  }}
                  title={t("notes.duplicate")}
                  aria-label={t("notes.duplicate")}
                  className="shrink-0 p-1 rounded transition-colors text-muted-foreground hover:bg-muted"
                >
                  <Copy className="w-3.5 h-3.5" />
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
        <span className="relative mt-1 block min-h-4 pr-4">
          {preview && (
            <span className="block truncate text-xs text-muted-foreground">
              {preview}
            </span>
          )}
          <GripVertical
            data-testid="note-drag-handle"
            className="absolute right-0 top-0 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <NoteTagsRow tags={note.tags} dateLabel={formatDate(note.updatedAt)} />
      </div>
    </li>
  );
}
