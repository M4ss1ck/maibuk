import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Redo2, Undo2 } from "lucide-react";
import { useCoverStore } from "../../features/covers/store";
import {
  PRESETS,
  createImageLayer,
  createTextLayer,
  getPreset,
} from "../../features/covers/scene/defaults";
import type { ExportFormat } from "../../features/covers/export";
import { Button } from "../ui/Button";
import {
  ChevronDownIcon,
  DimensionIcon,
  ExportIcon,
  ImageIcon,
  TextIcon,
  TrashIcon,
} from "../icons";

interface ToolbarProps {
  onExport: (format: ExportFormat) => void;
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function Toolbar({ onExport }: ToolbarProps) {
  const { t } = useTranslation();
  const scene = useCoverStore((s) => s.scene);
  const selectedId = useCoverStore((s) => s.selectedId);
  const addLayer = useCoverStore((s) => s.addLayer);
  const removeLayer = useCoverStore((s) => s.removeLayer);
  const duplicateSelected = useCoverStore((s) => s.duplicateSelected);
  const setDoc = useCoverStore((s) => s.setDoc);
  const undo = useCoverStore((s) => s.undo);
  const redo = useCoverStore((s) => s.redo);

  const [showPresets, setShowPresets] = useState(false);
  const [showTextMenu, setShowTextMenu] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const currentPreset = PRESETS.find((p) => p.id === scene.doc.presetId) ?? PRESETS[0];

  const addText = (role: "title" | "subtitle" | "author" | "custom") => {
    addLayer(
      createTextLayer({
        role,
        text:
          role === "title"
            ? t("cover.toolbar.title")
            : role === "subtitle"
              ? t("cover.toolbar.subtitle")
              : role === "author"
                ? t("cover.toolbar.author")
                : t("cover.addText"),
        docWidth: scene.doc.width,
        docHeight: scene.doc.height,
      })
    );
    setShowTextMenu(false);
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const src = await readFileAsDataUrl(file);
      const { width, height } = await loadImageSize(src);
      addLayer(
        createImageLayer({
          src,
          naturalWidth: width,
          naturalHeight: height,
          docWidth: scene.doc.width,
          docHeight: scene.doc.height,
        })
      );
    }
    e.target.value = "";
  };

  const changePreset = (presetId: string) => {
    const p = getPreset(presetId);
    setDoc({
      width: p.width,
      height: p.height,
      dpi: p.dpi,
      bleed: scene.doc.bleed,
      safeMargin: Math.round(p.width * 0.05),
      presetId: p.id,
    });
    setShowPresets(false);
  };

  return (
    <div className="min-h-14 border-b border-border bg-background flex flex-wrap items-center px-2 sm:px-4 py-2 gap-1 sm:gap-2">
      {/* Preset selector */}
      <div className="relative">
        <Button variant="ghost" size="sm" onClick={() => setShowPresets((v) => !v)} className="gap-1 sm:gap-2 text-xs sm:text-sm">
          <DimensionIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{currentPreset.name}</span>
          <ChevronDownIcon className="w-3 h-3" />
        </Button>
        {showPresets && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => changePreset(p.id)}
                className={`w-full px-4 py-2 text-left hover:bg-muted flex justify-between items-center ${p.id === currentPreset.id ? "bg-muted" : ""}`}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

      {/* Add text */}
      <div className="relative">
        <Button variant="ghost" size="sm" onClick={() => setShowTextMenu((v) => !v)} className="gap-1 sm:gap-2 text-xs sm:text-sm">
          <TextIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{t("cover.addText")}</span>
        </Button>
        {showTextMenu && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50">
            <button type="button" onClick={() => addText("title")} className="w-full px-4 py-2 text-left hover:bg-muted">
              {t("cover.toolbar.title")}
            </button>
            <button type="button" onClick={() => addText("subtitle")} className="w-full px-4 py-2 text-left hover:bg-muted">
              {t("cover.toolbar.subtitle")}
            </button>
            <button type="button" onClick={() => addText("author")} className="w-full px-4 py-2 text-left hover:bg-muted">
              {t("cover.toolbar.author")}
            </button>
          </div>
        )}
      </div>

      {/* Add image */}
      <Button variant="ghost" size="sm" onClick={() => imageInputRef.current?.click()} className="gap-1 sm:gap-2 text-xs sm:text-sm" title={t("cover.addImage")}>
        <ImageIcon className="w-4 h-4" />
        <span className="hidden sm:inline">{t("cover.addImage")}</span>
      </Button>
      <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImage} className="hidden" />

      <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

      {/* History */}
      <Button variant="ghost" size="sm" onClick={() => undo()} title={t("cover.undo")}>
        <Undo2 className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => redo()} title={t("cover.redo")}>
        <Redo2 className="w-4 h-4" />
      </Button>

      <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

      {/* Selection actions */}
      <Button variant="ghost" size="sm" onClick={() => duplicateSelected()} disabled={!selectedId} title={t("cover.duplicate")}>
        <Copy className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => selectedId && removeLayer(selectedId)}
        disabled={!selectedId}
        title={t("common.delete")}
        className="text-destructive hover:text-destructive"
      >
        <TrashIcon className="w-4 h-4" />
      </Button>

      <div className="flex-1 min-w-2" />

      {/* Export */}
      <div className="relative">
        <Button variant="primary" size="sm" onClick={() => setShowExport((v) => !v)} className="gap-1 sm:gap-2 text-xs sm:text-sm">
          <ExportIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{t("cover.export")}</span>
        </Button>
        {showExport && (
          <div className="absolute top-full right-0 mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg z-50">
            <button type="button" onClick={() => { onExport("png"); setShowExport(false); }} className="w-full px-4 py-2 text-left hover:bg-muted">
              {t("cover.pngExport")}
            </button>
            <button type="button" onClick={() => { onExport("jpeg"); setShowExport(false); }} className="w-full px-4 py-2 text-left hover:bg-muted">
              {t("cover.jpgExport")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
