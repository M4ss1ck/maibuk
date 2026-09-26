import { useTranslation } from "react-i18next";
import { ColorPickerControl } from "@/components/ui/ColorPickerControl";
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
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("canvas.penColor")}</span>
        <ColorPickerControl
          label={t("canvas.penColor")}
          value={penColor}
          presets={PEN_COLORS}
          onCommit={setPenColor}
          contrastKind="non-text"
          showUnknownContrast
        />
      </div>
    </div>
  );
}
