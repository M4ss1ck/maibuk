import {
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { keepRowFromActing } from "@/lib/arrow-navigation";
import { Network, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Canvas } from "@/features/canvas/types";
import { Button } from "@/components/ui/Button";

interface CanvasCardProps {
  canvas: Canvas;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePinned: () => void;
  /** The Tutorial step that points at this card, if any. */
  tutorialAnchor?: string;
}

interface CanvasCardFaceProps {
  canvas: Canvas;
  /** The heading slot: the renaming card puts its input here instead. */
  title?: ReactNode;
  /** The delete prompt takes the metadata's room on the fixed-height card. */
  showMetadata?: boolean;
}

/**
 * Header row and metadata shared by the Gallery Canvas card and the Canvas
 * Reference card. Display only: it renders no handlers, so each card keeps its
 * own interactions.
 *
 * `title` replaces the default heading, and `showMetadata` hides the counts and
 * date when the owning card needs their room for something else.
 */
export function CanvasCardFace({ canvas, title, showMetadata = true }: CanvasCardFaceProps) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <div className="flex items-center gap-2">
        <Network className="size-5 shrink-0 text-primary" aria-hidden="true" />
        {title ?? <h2 className="truncate font-medium">{canvas.title || t("canvas.untitled")}</h2>}
        {canvas.pinned && <Pin className="size-4 shrink-0 text-primary" aria-hidden="true" />}
      </div>
      {showMetadata && (
        <>
          <div className="mt-4 flex gap-3 text-sm text-muted-foreground">
            <span>{t("canvas.nodeCount", { count: canvas.doc.nodes.length })}</span>
            <span>{t("canvas.edgeCount", { count: canvas.doc.edges.length })}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
              new Date(canvas.updatedAt * 1000)
            )}
          </p>
        </>
      )}
    </>
  );
}

export function CanvasCard({
  canvas,
  onOpen,
  onRename,
  onDelete,
  onTogglePinned,
  tutorialAnchor,
}: CanvasCardProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(canvas.title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const saveRename = () => {
    if (draft !== canvas.title) onRename(draft);
    setRenaming(false);
  };

  // A card action must not read as activating the whole card: React Aria's
  // GridListItem treats a bubbled Enter/Space (or the click it produces) as the
  // row's action, so a nested button would navigate instead of acting.
  const stopRowActionClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") saveRename();
    if (event.key === "Escape") {
      setDraft(canvas.title);
      setRenaming(false);
    }
  };

  return (
    <article
      data-tutorial={tutorialAnchor}
      className="flex h-48 flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-lg"
    >
      {renaming ? (
        <div className="min-w-0 flex-1 text-left">
          <CanvasCardFace
            canvas={canvas}
            title={
              <input
                autoFocus
                className="min-w-0 flex-1 cursor-text rounded-lg border border-border bg-background px-2 py-1 text-sm font-medium outline-none focus:border-primary"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={saveRename}
              />
            }
          />
        </div>
      ) : (
        <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={onOpen}>
          {/* The card has a fixed height, so the delete prompt takes the metadata's room. */}
          <CanvasCardFace canvas={canvas} showMetadata={!confirmingDelete} />
        </button>
      )}
      {confirmingDelete ? (
        <div className="mt-2 border-t border-border pt-2">
          <p className="mb-2 text-xs text-muted-foreground">{t("canvas.deleteCanvasConfirm")}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="destructive"
              size="sm"
              className="whitespace-nowrap"
              onKeyDown={keepRowFromActing}
              onClick={(event) => {
                stopRowActionClick(event);
                setConfirmingDelete(false);
                onDelete();
              }}
            >
              {t("canvas.deleteCanvas")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="whitespace-nowrap"
              onKeyDown={keepRowFromActing}
              onClick={(event) => {
                stopRowActionClick(event);
                setConfirmingDelete(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex justify-end gap-1 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={canvas.pinned ? t("canvas.unpinCanvas") : t("canvas.pinCanvas")}
            onKeyDown={keepRowFromActing}
            onClick={(event) => {
              stopRowActionClick(event);
              onTogglePinned();
            }}
          >
            {canvas.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("canvas.renameCanvas")}
            onKeyDown={keepRowFromActing}
            onClick={(event) => {
              stopRowActionClick(event);
              setRenaming(true);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("canvas.deleteCanvas")}
            onKeyDown={keepRowFromActing}
            onClick={(event) => {
              stopRowActionClick(event);
              setConfirmingDelete(true);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </article>
  );
}
