import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCoverStore } from "../../../features/covers/store";
import { PRESET_COLORS } from "../../../features/covers/scene/defaults";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function BackgroundPanel() {
  const { t } = useTranslation();
  const background = useCoverStore((s) => s.scene.background);
  const setBackground = useCoverStore((s) => s.setBackground);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentColor = background.type === "solid" ? background.color : "#1a1a2e";

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const src = await readFileAsDataUrl(file);
      setBackground({ type: "image", src, fit: "cover", opacity: 1 });
    }
    e.target.value = "";
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("cover.background")}
      </p>

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

      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("cover.custom")}</span>
        <input
          type="color"
          value={currentColor}
          onChange={(e) => setBackground({ type: "solid", color: e.target.value })}
          className="w-8 h-8 cursor-pointer rounded border border-border"
        />
      </label>

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
