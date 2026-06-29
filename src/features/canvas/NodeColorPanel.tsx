import { useState } from "react";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@/features/canvas/store";

const NODE_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

export function NodeColorPanel() {
  const { t } = useTranslation();
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);
  const [expanded, setExpanded] = useState(false);

  if (!selectedNodeId) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        aria-label={t("canvas.nodeColor")}
        title={t("canvas.nodeColor")}
        onClick={() => setExpanded((previous) => !previous)}
        className={`flex size-8 items-center justify-center rounded-lg border shadow-sm backdrop-blur transition-colors ${
          expanded
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-card/95 text-foreground hover:bg-muted"
        }`}
      >
        <Palette className="size-4" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="flex w-56 flex-col gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
          <span className="text-xs text-muted-foreground">{t("canvas.nodeColor")}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t("canvas.defaultNodeColor")}
              onClick={() => updateTextNode(selectedNodeId, { color: "" })}
              className="rounded-full"
            >
              <span className="flex size-5 overflow-hidden rounded-full border border-border">
                <span className="h-full w-1/2 bg-black" />
                <span className="h-full w-1/2 bg-white" />
              </span>
            </button>
            {NODE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`${t("canvas.nodeColor")} ${color}`}
                onClick={() => updateTextNode(selectedNodeId, { color })}
                className="size-5 rounded-full border border-border"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
