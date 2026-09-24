import type { DragEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Copy, GripVertical, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { Note } from "@/features/notes";
import { NoteTagsRow } from "@/components/notes/NoteTagsRow";
import { ItemActionsMenu } from "@/components/ui";
import type { ItemAction } from "@/components/ui";
import { useItemContextMenu } from "@/hooks/useItemContextMenu";

export interface NoteMoveTarget {
  bookId: string | null;
  label: string;
}

interface NoteListItemProps {
  note: Note;
  isSelected: boolean;
  onSelect: (note: Note) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (note: Note) => void;
  onRename?: (note: Note, title: string) => void;
  onTogglePinned?: (note: Note) => void;
  moveTargets?: NoteMoveTarget[];
  onMove?: (note: Note, bookId: string | null) => void;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
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
  onTogglePinned,
  moveTargets = [],
  onMove,
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const title = note.title || t("notes.untitled");
  const preview = toPreview(note.content);

  const actions: ItemAction[] = [];
  if (onRename) {
    actions.push({
      id: "rename",
      label: t("common.rename"),
      icon: Pencil,
      onAction: () => {
        setDraftTitle(note.title);
        setIsEditing(true);
      },
    });
  }
  if (onTogglePinned) {
    actions.push({
      id: "pin",
      label: note.pinned ? t("notes.unpin") : t("notes.pin"),
      icon: note.pinned ? PinOff : Pin,
      onAction: () => onTogglePinned(note),
    });
  }
  if (onMove && moveTargets.length > 0) {
    actions.push({
      id: "move",
      label: t("notes.moveToBook"),
      icon: BookOpen,
      children: moveTargets.map((target) => ({
        id: `move:${target.bookId ?? "unfiled"}`,
        label: target.label,
        isCurrent: (note.bookId ?? null) === target.bookId,
        onAction: () => {
          if ((note.bookId ?? null) !== target.bookId) onMove(note, target.bookId);
        },
      })),
    });
  }
  if (onDuplicate) {
    actions.push({
      id: "duplicate",
      label: t("notes.duplicate"),
      icon: Copy,
      onAction: () => onDuplicate(note),
    });
  }
  if (onDelete) {
    actions.push({
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      isDestructive: true,
      onAction: () => onDelete(note.id),
    });
  }
  const hasActions = actions.length > 0;
  const { itemProps } = useItemContextMenu({
    onOpen: () => setIsMenuOpen(true),
    isDisabled: !hasActions || isEditing,
  });

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
    <div
      data-note-row
      data-drop-id={note.id}
      draggable={draggable && !isEditing ? true : undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      {...itemProps}
      className={`group relative border-l-2 py-3 pl-2 pr-3 transition-colors pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${
        isSelected ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50"
      } ${isDragging ? "opacity-50" : ""}`}
      onClick={(e) => {
        // Menu items live in a portal but still bubble through React.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (!isEditing) onSelect(note);
      }}
      onKeyDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (!isEditing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect(note);
        }
      }}
    >
      {/* Line 1: title + item menu */}
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
            {hasActions && (
              <ItemActionsMenu
                label={t("common.moreActionsFor", { title })}
                actions={actions}
                isOpen={isMenuOpen}
                onOpenChange={setIsMenuOpen}
              />
            )}
          </>
        )}
      </div>

      {/* Line 2: description + drag handle */}
      <div className="mt-1 flex min-h-4 min-w-0 items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</p>
        {draggable && (
          <GripVertical
            data-testid="note-drag-handle"
            data-drag-handle=""
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:h-5 pointer-coarse:w-5 pointer-coarse:opacity-100"
          />
        )}
      </div>

      {/* Line 3: tags + last-modified */}
      <div className="mt-2 min-h-4">
        <NoteTagsRow tags={note.tags} dateLabel={formatDate(note.contentUpdatedAt)} />
      </div>
    </div>
  );
}
