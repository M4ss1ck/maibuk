import { useTranslation } from "react-i18next";
import type { GradientStop, Paint } from "@/features/covers/scene/schema";

type PaintType = Paint["type"];

const DEFAULT_STOPS: GradientStop[] = [
  { offset: 0, color: "#1a1a2e" },
  { offset: 1, color: "#e94560" },
];

function withType(paint: Paint, type: PaintType): Paint {
  if (type === paint.type) return paint;
  const stops = "stops" in paint ? paint.stops : DEFAULT_STOPS;
  if (type === "solid") {
    return { type: "solid", color: stops[0]?.color ?? "#1a1a2e" };
  }
  if (type === "linear-gradient") {
    return { type: "linear-gradient", angle: 90, stops };
  }
  return { type: "radial-gradient", cx: 0.5, cy: 0.5, r: 0.5, stops };
}

export function PaintControl({ paint, onChange }: { paint: Paint; onChange: (p: Paint) => void }) {
  const { t } = useTranslation();

  const types: { id: PaintType; label: string }[] = [
    { id: "solid", label: t("cover.paint.solid") },
    { id: "linear-gradient", label: t("cover.paint.linear") },
    { id: "radial-gradient", label: t("cover.paint.radial") },
  ];

  const updateStop = (i: number, patch: Partial<GradientStop>) => {
    if (!("stops" in paint)) return;
    const stops = paint.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...paint, stops });
  };

  const addStop = () => {
    if (!("stops" in paint)) return;
    onChange({ ...paint, stops: [...paint.stops, { offset: 1, color: "#ffffff" }] });
  };

  const removeStop = (i: number) => {
    if (!("stops" in paint) || paint.stops.length <= 2) return;
    onChange({ ...paint, stops: paint.stops.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {types.map((ty) => (
          <button
            key={ty.id}
            type="button"
            className={`flex-1 px-2 py-1 rounded text-xs ${paint.type === ty.id ? "bg-primary text-white" : "bg-muted"}`}
            onClick={() => onChange(withType(paint, ty.id))}
          >
            {ty.label}
          </button>
        ))}
      </div>

      {paint.type === "solid" && (
        <input
          type="color"
          value={paint.color}
          onChange={(e) => onChange({ type: "solid", color: e.target.value })}
          className="w-full h-8 cursor-pointer rounded border border-border"
        />
      )}

      {paint.type === "linear-gradient" && (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{t("cover.paint.angle")}</span>
          <input
            type="range"
            min={0}
            max={360}
            value={paint.angle}
            onChange={(e) => onChange({ ...paint, angle: Number(e.target.value) })}
            className="flex-1"
          />
          <span className="w-10 text-right text-xs">{Math.round(paint.angle)}°</span>
        </label>
      )}

      {paint.type === "radial-gradient" && (
        <div className="grid grid-cols-3 gap-1">
          {(["cx", "cy", "r"] as const).map((k) => (
            <label key={k} className="text-xs text-muted-foreground">
              {k.toUpperCase()}
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={paint[k]}
                onChange={(e) => onChange({ ...paint, [k]: Number(e.target.value) })}
                className="no-spinner w-full px-1 py-0.5 border border-border rounded bg-background text-foreground text-right"
              />
            </label>
          ))}
        </div>
      )}

      {"stops" in paint && (
        <div className="space-y-1">
          {paint.stops.map((stop, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="color"
                value={stop.color}
                onChange={(e) => updateStop(i, { color: e.target.value })}
                className="w-7 h-7 cursor-pointer rounded border border-border"
              />
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={stop.offset}
                onChange={(e) => updateStop(i, { offset: Number(e.target.value) })}
                className="no-spinner w-16 px-1 py-0.5 border border-border rounded bg-background text-foreground text-right text-xs"
              />
              <button
                type="button"
                onClick={() => removeStop(i)}
                disabled={paint.stops.length <= 2}
                className="px-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                title={t("cover.paint.removeStop")}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addStop}
            className="w-full text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80"
          >
            {t("cover.paint.addStop")}
          </button>
        </div>
      )}
    </div>
  );
}
