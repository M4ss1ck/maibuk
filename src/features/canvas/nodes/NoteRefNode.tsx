import { FileText, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Button } from "../../../components/ui/Button";
import { useNoteStore } from "../../notes";
import type { CanvasFlowNodeData } from "../reactFlowAdapter";

type NoteRefFlowNode = Node<CanvasFlowNodeData, "noteRef">;

export function NoteRefNode({ data, selected }: NodeProps<NoteRefFlowNode>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const node = data.node;
  const note = useNoteStore((state) =>
    node.kind === "noteRef" ? state.notes.find((candidate) => candidate.id === node.noteId) : undefined,
  );

  if (node.kind !== "noteRef") return null;

  const label = note?.title || node.label || t("canvas.missingNote");

  return (
    <div
      className={`min-w-48 rounded-lg border bg-card px-4 py-3 text-foreground shadow-sm ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="max-w-52 truncate text-sm font-medium">{label}</span>
      </div>
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
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
