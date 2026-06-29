import { useTranslation } from "react-i18next";
import { useCanvasStore } from "@/features/canvas/store";

const PEN_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

export function PenSettingsPanel() {
  const { t } = useTranslation();
  const penWidth = useCanvasStore((state) => state.penWidth);
  const setPenWidth = useCanvasStore((state) => state.setPenWidth);
  const penColor = useCanvasStore((state) => state.penColor);
  const setPenColor = useCanvasStore((state) => state.setPenColor);

  return (
    <div className="flex w-56 flex-col gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
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
        {PEN_COLORS.map((color) => (
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
  );
}
