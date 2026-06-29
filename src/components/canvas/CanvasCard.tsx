import { useState, type KeyboardEvent } from "react";
import { Network, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Canvas } from "../../features/canvas/types";
import { Button } from "../ui/Button";

interface CanvasCardProps {
  canvas: Canvas;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePinned: () => void;
}

export function CanvasCard({
  canvas,
  onOpen,
  onRename,
  onDelete,
  onTogglePinned,
}: CanvasCardProps) {
  const { t, i18n } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(canvas.title);

  const saveRename = () => {
    if (draft !== canvas.title) onRename(draft);
    setRenaming(false);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") saveRename();
    if (event.key === "Escape") {
      setDraft(canvas.title);
      setRenaming(false);
    }
  };

  const metadata = (
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
  );

  return (
    <article className="flex h-48 flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-transform hover:-translate-y-1 hover:shadow-lg">
      {renaming ? (
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <Network className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm font-medium outline-none focus:border-primary"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={saveRename}
            />
            {canvas.pinned && <Pin className="size-4 shrink-0 text-primary" aria-hidden="true" />}
          </div>
          {metadata}
        </div>
      ) : (
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="flex items-center gap-2">
            <Network className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <h3 className="truncate font-medium">{canvas.title || t("canvas.untitled")}</h3>
            {canvas.pinned && <Pin className="size-4 shrink-0 text-primary" aria-hidden="true" />}
          </div>
          {metadata}
        </button>
      )}
      <div className="mt-2 flex justify-end gap-1 border-t border-border pt-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={canvas.pinned ? t("canvas.unpinCanvas") : t("canvas.pinCanvas")}
          onClick={onTogglePinned}
        >
          {canvas.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("canvas.renameCanvas")}
          onClick={() => setRenaming(true)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label={t("canvas.deleteCanvas")} onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </article>
  );
}
