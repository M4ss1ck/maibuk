import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { notePlainText } from "@/components/notes/notes-list-model";
import { useCanvasStore } from "@/features/canvas/store";
import type { CanvasNode } from "@/features/canvas/types";
import { useNoteStore } from "@/features/notes";

const LABEL_LENGTH = 60;

/** Keyboard and touch path for making a Connection without dragging a handle. */
export function ConnectToDialog() {
  const { t } = useTranslation();
  const sourceId = useCanvasStore((state) => state.connectSourceNodeId);
  const nodes = useCanvasStore((state) => state.doc.nodes);
  const edges = useCanvasStore((state) => state.doc.edges);
  const closeConnectPicker = useCanvasStore((state) => state.closeConnectPicker);
  const connectNodes = useCanvasStore((state) => state.connectNodes);
  const notes = useNoteStore((state) => state.notes);
  const [query, setQuery] = useState("");

  const labelOf = (node: CanvasNode) => {
    if (node.kind === "noteRef") {
      const note = notes.find((candidate) => candidate.id === node.noteId);
      return note?.title || node.label || t("canvas.missingNote");
    }
    const text = notePlainText(node.html);
    if (!text) return t("canvas.emptyTextNode");
    return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}…` : text;
  };

  const source = nodes.find((node) => node.id === sourceId) ?? null;
  const connected = new Set(
    edges.flatMap((edge) =>
      edge.source === sourceId ? [edge.target] : edge.target === sourceId ? [edge.source] : []
    )
  );
  const needle = query.trim().toLocaleLowerCase();
  const targets = nodes
    .filter((node) => node.id !== sourceId && !connected.has(node.id))
    .map((node) => ({ node, label: labelOf(node) }))
    .filter(({ label }) => label.toLocaleLowerCase().includes(needle));

  const close = () => {
    setQuery("");
    closeConnectPicker();
  };

  return (
    <Modal
      isOpen={source !== null}
      onClose={close}
      title={source ? t("canvas.connectFrom", { title: labelOf(source) }) : t("canvas.connectTo")}
    >
      <Input
        autoFocus
        aria-label={t("canvas.searchNodesPlaceholder")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("canvas.searchNodesPlaceholder")}
      />
      <div className="mt-4 max-h-80 space-y-1 overflow-auto">
        {targets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("canvas.noConnectTargets")}
          </p>
        ) : (
          targets.map(({ node, label }) => (
            <Button
              key={node.id}
              variant="ghost"
              className="w-full justify-start text-left"
              onClick={() => {
                if (sourceId) connectNodes(sourceId, node.id);
                close();
              }}
            >
              <span className="truncate">{label}</span>
            </Button>
          ))
        )}
      </div>
    </Modal>
  );
}
