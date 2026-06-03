import { useTranslation } from "react-i18next";
import { useCoverStore } from "../../../features/covers/store";
import { FONT_FAMILIES } from "../../../features/covers/scene/defaults";
import type { Paint, TextLayer } from "../../../features/covers/scene/schema";
import { Select } from "../../ui/Select";
import { BackgroundPanel } from "./BackgroundPanel";

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        value={Math.round(value * 100) / 100}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 px-2 py-1 border border-border rounded bg-background text-foreground text-right"
      />
    </label>
  );
}

function solidColor(paint: Paint): string {
  return paint.type === "solid" ? paint.color : "#ffffff";
}

function TextProperties({ layer }: { layer: TextLayer }) {
  const { t } = useTranslation();
  const updateLayer = useCoverStore((s) => s.updateLayer);
  const patchFont = (patch: Partial<TextLayer["font"]>) =>
    updateLayer(layer.id, { font: { ...layer.font, ...patch } });

  return (
    <div className="space-y-3">
      <Select
        value={layer.font.family}
        onChange={(family) => patchFont({ family })}
        options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
        className="w-full"
        minWidth="none"
      />

      <div className="grid grid-cols-2 gap-2">
        <NumberField label={t("cover.props.size")} value={layer.font.size} min={1} onChange={(size) => patchFont({ size })} />
        <NumberField label={t("cover.props.lineHeight")} value={layer.font.lineHeight} step={0.1} onChange={(lineHeight) => patchFont({ lineHeight })} />
        <NumberField label={t("cover.props.letterSpacing")} value={layer.font.letterSpacing} onChange={(letterSpacing) => patchFont({ letterSpacing })} />
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          className={`flex-1 px-2 py-1 rounded text-sm font-bold ${layer.font.weight === "bold" ? "bg-primary text-white" : "bg-muted"}`}
          onClick={() => patchFont({ weight: layer.font.weight === "bold" ? "normal" : "bold" })}
        >
          B
        </button>
        <button
          type="button"
          className={`flex-1 px-2 py-1 rounded text-sm italic ${layer.font.style === "italic" ? "bg-primary text-white" : "bg-muted"}`}
          onClick={() => patchFont({ style: layer.font.style === "italic" ? "normal" : "italic" })}
        >
          I
        </button>
      </div>

      <div className="flex gap-1">
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            type="button"
            className={`flex-1 px-2 py-1 rounded text-xs capitalize ${layer.align === align ? "bg-primary text-white" : "bg-muted"}`}
            onClick={() => updateLayer(layer.id, { align })}
          >
            {align}
          </button>
        ))}
      </div>

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("cover.props.fill")}</span>
        <input
          type="color"
          value={solidColor(layer.fill)}
          onChange={(e) => updateLayer(layer.id, { fill: { type: "solid", color: e.target.value } })}
          className="w-8 h-8 cursor-pointer rounded border border-border"
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{t("cover.props.shadow")}</span>
        <input
          type="checkbox"
          checked={!!layer.shadow}
          onChange={(e) =>
            updateLayer(layer.id, {
              shadow: e.target.checked
                ? { color: "#000000", blur: 8, offsetX: 2, offsetY: 2 }
                : undefined,
            })
          }
        />
      </label>
    </div>
  );
}

export function PropertiesPanel() {
  const { t } = useTranslation();
  const selectedId = useCoverStore((s) => s.selectedId);
  const layer = useCoverStore((s) => s.scene.layers.find((l) => l.id === s.selectedId) ?? null);
  const updateLayer = useCoverStore((s) => s.updateLayer);

  if (!layer || !selectedId) {
    return <BackgroundPanel />;
  }

  return (
    <div className="p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("cover.props.title")}
      </p>

      {layer.type === "text" && <TextProperties layer={layer} />}

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
        <NumberField label="X" value={layer.x} onChange={(x) => updateLayer(layer.id, { x })} />
        <NumberField label="Y" value={layer.y} onChange={(y) => updateLayer(layer.id, { y })} />
        <NumberField label={t("cover.props.width")} value={layer.width} min={1} onChange={(width) => updateLayer(layer.id, { width })} />
        <NumberField label={t("cover.props.height")} value={layer.height} min={1} onChange={(height) => updateLayer(layer.id, { height })} />
        <NumberField label={t("cover.props.rotation")} value={layer.rotation} onChange={(rotation) => updateLayer(layer.id, { rotation })} />
        <NumberField label={t("cover.props.opacity")} value={layer.opacity} step={0.1} min={0} onChange={(opacity) => updateLayer(layer.id, { opacity })} />
      </div>
    </div>
  );
}
