import { BookOpen, ExternalLink, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { type Node, type NodeProps } from "@xyflow/react";
import { Button } from "../../../components/ui/Button";
import { NoteTagsRow } from "../../../components/notes/NoteTagsRow";
import { notePlainText } from "../../../components/notes/notes-list-model";
import { timeAgo } from "../../../components/notes/timeAgo";
import { useBookStore } from "../../books/store";
import { useNoteStore } from "../../notes";
import { useCanvasStore } from "../store";
import type { CanvasFlowNodeData } from "../reactFlowAdapter";
import { CanvasNodeHandles } from "./CanvasNodeHandles";

type NoteRefFlowNode = Node<CanvasFlowNodeData, "noteRef">;

export function NoteRefNode({ data, selected }: NodeProps<NoteRefFlowNode>) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const node = data.node;
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const removeNode = useCanvasStore((state) => state.removeNode);
  const note = useNoteStore((state) =>
    node.kind === "noteRef" ? state.notes.find((candidate) => candidate.id === node.noteId) : undefined,
  );
  const books = useBookStore((state) => state.books);

  if (node.kind !== "noteRef") return null;

  const title = note?.title || node.label || t("canvas.missingNote");
  const preview = note ? notePlainText(note.content) : "";
  const bookTitle = note?.bookId
    ? books.find((book) => book.id === note.bookId)?.title
    : null;
  const dateLabel = note
    ? timeAgo(note.contentUpdatedAt, i18n?.language ?? "en", t)
    : "";

  return (
    <div
      className={`group relative flex h-44 w-56 flex-col rounded-xl border bg-card p-4 text-left text-foreground shadow-sm ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
    >
      {selected && !editorReadOnly && (
        <button
          type="button"
          aria-label={t("common.delete")}
          title={t("common.delete")}
          className="nodrag nopan absolute -right-2 -top-2 z-10 flex size-5 items-center justify-center rounded-full border border-border bg-card text-destructive shadow-sm transition-opacity hover:bg-destructive hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            removeNode(node.id);
          }}
        >
          <Trash2 className="size-3" aria-hidden="true" />
        </button>
      )}
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="card" />

      <h3 className="truncate font-medium text-foreground">{title}</h3>

      {preview && (
        <p className="mt-1 line-clamp-2 min-h-8 text-sm text-muted-foreground">
          {preview}
        </p>
      )}

      {bookTitle && (
        <span className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{bookTitle}</span>
        </span>
      )}

      <div className="mt-auto pt-2">
        <NoteTagsRow
          tags={note?.tags ?? []}
          dateLabel={dateLabel}
          interactiveOverflow={false}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nodrag nopan mt-2 w-full"
          disabled={!note}
          onClick={() =>
            navigate(`/notes/${node.noteId}`, {
              state: {
                returnTo: `/canvas/${data.canvasId}`,
                returnLabel: data.canvasTitle || t("canvas.untitled"),
              },
            })
          }
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {t("canvas.openNote")}
        </Button>
      </div>
    </div>
  );
}
