import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GridListItem } from "react-aria-components/GridList";
import { BookOpen } from "lucide-react";
import type { Note } from "@/features/notes";
import { notePlainText } from "@/components/notes/notes-list-model";
import { NoteTagsRow } from "@/components/notes/NoteTagsRow";
import { timeAgo } from "@/components/notes/timeAgo";
import { ItemActionsMenu } from "@/components/ui";
import type { ItemAction } from "@/components/ui";
import { useItemContextMenu } from "@/hooks/useItemContextMenu";

interface NoteCardProps {
  note: Note;
  bookTitle?: string | null;
  onClick: () => void;
  /** The card's Item Menu, for touch screens: long-press or the ⋯ button. */
  actions?: ItemAction[];
  /** The Tutorial step that points at this card, if any. */
  tutorialAnchor?: string;
}

export function NoteCard({ note, bookTitle, onClick, actions = [], tutorialAnchor }: NoteCardProps) {
  const { t, i18n } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const title = note.title || t("notes.untitled");
  const preview = notePlainText(note.content);
  const hasActions = actions.length > 0;
  const { itemProps } = useItemContextMenu({
    onOpen: () => setIsMenuOpen(true),
    isDisabled: !hasActions,
  });

  return (
    <GridListItem
      id={note.id}
      textValue={title}
      data-tutorial={tutorialAnchor}
      onAction={onClick}
      className={({ isFocusVisible, isHovered, isPressed }) =>
        `relative h-44 overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 ${
          isFocusVisible ? "border-primary ring-2 ring-primary ring-offset-2" : "border-border"
        } ${isHovered || isPressed ? "-translate-y-1 shadow-lg" : ""}`
      }
    >
      <div
        {...itemProps}
        className="flex h-full flex-col p-4 pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
      >
        <h2
          className={`truncate font-medium text-foreground ${hasActions ? "pointer-coarse:pr-8" : ""}`}
        >
          {title}
        </h2>

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
      </div>
      {hasActions && (
        <ItemActionsMenu
          label={t("common.moreActionsFor", { title })}
          actions={actions}
          isOpen={isMenuOpen}
          onOpenChange={setIsMenuOpen}
          className="absolute right-2 top-2.5 hidden pointer-coarse:inline-flex"
        />
      )}
    </GridListItem>
  );
}
