import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCoverStore } from "../../../features/covers/store";
import { PRESET_COLORS } from "../../../features/covers/scene/defaults";
import type { Background, Paint } from "../../../features/covers/scene/schema";
import { PaintControl } from "./PaintControl";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const FITS = [
  { id: "cover", key: "cover.fit.cover" },
  { id: "contain", key: "cover.fit.contain" },
  { id: "stretch", key: "cover.fit.stretch" },
] as const;

export function BackgroundPanel() {
  const { t } = useTranslation();
  const background = useCoverStore((s) => s.scene.background);
  const setBackground = useCoverStore((s) => s.setBackground);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const src = await readFileAsDataUrl(file);
      setBackground({ type: "image", src, fit: "cover", opacity: 1 });
    }
    e.target.value = "";
  };

  const asPaint: Paint =
    background.type === "image" ? { type: "solid", color: "#1a1a2e" } : (background as Paint);

  return (
    <div className="p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("cover.background")}
      </p>

      {background.type !== "image" && (
        <>
          <div className="grid grid-cols-8 gap-1">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setBackground({ type: "solid", color })}
                className={`w-6 h-6 rounded border transition-transform hover:scale-110 ${
                  background.type === "solid" && background.color === color
                    ? "border-primary"
                    : "border-border"
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
          <PaintControl paint={asPaint} onChange={(p) => setBackground(p as Background)} />
        </>
      )}

      {background.type === "image" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("cover.backgroundImage")}</p>
          <div className="flex gap-1">
            {FITS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`flex-1 px-2 py-1 rounded text-xs ${background.fit === f.id ? "bg-primary text-white" : "bg-muted"}`}
                onClick={() => setBackground({ ...background, fit: f.id })}
              >
                {t(f.key)}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t("cover.props.opacity")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={background.opacity}
              onChange={(e) => setBackground({ ...background, opacity: Number(e.target.value) })}
              className="flex-1"
            />
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full text-sm px-3 py-2 rounded-lg bg-muted hover:bg-muted/80"
      >
        {t("cover.backgroundImage")}
      </button>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} className="hidden" />

      {background.type === "image" && (
        <button
          type="button"
          onClick={() => setBackground({ type: "solid", color: "#1a1a2e" })}
          className="w-full text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted"
        >
          {t("cover.removeBackgroundImage")}
        </button>
      )}
    </div>
  );
}
