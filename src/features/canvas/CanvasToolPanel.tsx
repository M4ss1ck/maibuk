import { useTranslation } from "react-i18next";
import {
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  ArrowUpRight,
  Circle,
  FilePlus2,
  Link2,
  Maximize,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useCanvasStore } from "./store";

const NODE_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function CanvasToolPanel({
  onAddText,
  onAddNoteRef,
  onFitView,
}: {
  onAddText: () => void;
  onAddNoteRef: () => void;
  onFitView: () => void;
}) {
  const { t } = useTranslation();
  const toolMode = useCanvasStore((state) => state.toolMode);
  const setToolMode = useCanvasStore((state) => state.setToolMode);
  const penWidth = useCanvasStore((state) => state.penWidth);
  const setPenWidth = useCanvasStore((state) => state.setPenWidth);
  const penColor = useCanvasStore((state) => state.penColor);
  const setPenColor = useCanvasStore((state) => state.setPenColor);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedNode = useCanvasStore((state) =>
    state.doc.nodes.find((node) => node.id === state.selectedNodeId),
  );
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);

  const tools = [
    { mode: "select" as const, icon: MousePointer2, label: t("canvas.toolSelect") },
    { mode: "pen" as const, icon: Pencil, label: t("canvas.toolPen") },
    { mode: "eraser" as const, icon: Eraser, label: t("canvas.toolEraser") },
  ];
  const comingSoon = [
    { icon: Square, label: t("canvas.toolRectangle") },
    { icon: ArrowUpRight, label: t("canvas.toolArrow") },
    { icon: Circle, label: t("canvas.toolEllipse") },
  ];

  return (
    <div className="absolute right-4 top-4 z-20 flex w-56 flex-col gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-1">
        {tools.map(({ mode, icon: Icon, label }) => (
          <Button
            key={mode}
            size="sm"
            variant={toolMode === mode ? "primary" : "ghost"}
            onClick={() => setToolMode(mode)}
            aria-label={label}
            title={label}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        ))}
        {comingSoon.map(({ icon: Icon, label }) => (
          <Button
            key={label}
            size="sm"
            variant="ghost"
            disabled
            aria-label={label}
            title={`${label} — ${t("canvas.comingSoon")}`}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        ))}
      </div>

      {toolMode === "pen" && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("canvas.penWidth")}
            <input
              type="range"
              min={1}
              max={20}
              value={penWidth}
              onChange={(event) => setPenWidth(Number(event.target.value))}
              className="flex-1"
            />
          </label>
          <div className="flex items-center gap-1">
            {NODE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`${t("canvas.penColor")} ${color}`}
                onClick={() => setPenColor(color)}
                className={`size-5 rounded-full border ${
                  penColor === color ? "ring-2 ring-primary" : "border-border"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Button size="sm" onClick={onAddText}>
          <FilePlus2 className="size-4" aria-hidden="true" />
          {t("canvas.addTextNode")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onAddNoteRef}>
          <Link2 className="size-4" aria-hidden="true" />
          {t("canvas.addNoteRef")}
        </Button>
      </div>

      {selectedNode?.kind === "text" && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("canvas.nodeColor")}</span>
          <div className="flex items-center gap-1">
            {NODE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`${t("canvas.nodeColor")} ${color}`}
                onClick={() =>
                  selectedNodeId && updateTextNode(selectedNodeId, { color })
                }
                className="size-5 rounded-full border border-border"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}

      <Button size="sm" variant="ghost" onClick={onFitView} className="justify-start">
        <Maximize className="size-4" aria-hidden="true" />
        {t("canvas.fitView")}
      </Button>
    </div>
  );
}
