import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Circle,
  Copy,
  LayoutTemplate,
  Magnet,
  Minus,
  Redo2,
  Ruler,
  Shapes,
  Square,
  Undo2,
} from "lucide-react";
import type { AlignEdge } from "../../features/covers/store";
import { useCoverStore } from "../../features/covers/store";
import {
  PRESETS,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  getPreset,
} from "../../features/covers/scene/defaults";
import { TEMPLATES, buildTemplateScene } from "../../features/covers/scene/templates";
import { Button } from "../ui/Button";
import {
  ChevronDownIcon,
  DimensionIcon,
  ExportIcon,
  ImageIcon,
  TextIcon,
  TrashIcon,
} from "../icons";

export type ExportChoice = "png" | "jpeg" | "pdf";

type MenuKey = "presets" | "templates" | "text" | "shape" | "export";

interface ToolbarProps {
  onExport: (format: ExportChoice) => void;
  bookTitle: string;
  bookAuthor: string;
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

export function Toolbar({ onExport, bookTitle, bookAuthor }: ToolbarProps) {
  const { t } = useTranslation();
  const scene = useCoverStore((s) => s.scene);
  const selectedId = useCoverStore((s) => s.selectedId);
  const replaceScene = useCoverStore((s) => s.replaceScene);
  const addLayer = useCoverStore((s) => s.addLayer);
  const removeLayer = useCoverStore((s) => s.removeLayer);
  const duplicateSelected = useCoverStore((s) => s.duplicateSelected);
  const setDoc = useCoverStore((s) => s.setDoc);
  const undo = useCoverStore((s) => s.undo);
  const redo = useCoverStore((s) => s.redo);
  const alignSelected = useCoverStore((s) => s.alignSelected);
  const overlays = useCoverStore((s) => s.overlays);
  const snapping = useCoverStore((s) => s.snapping);
  const setOverlays = useCoverStore((s) => s.setOverlays);
  const setSnapping = useCoverStore((s) => s.setSnapping);

  const alignButtons: Array<{ edge: AlignEdge; Icon: typeof AlignStartVertical; label: string }> = [
    { edge: "left", Icon: AlignStartVertical, label: t("cover.align.left") },
    { edge: "hcenter", Icon: AlignCenterVertical, label: t("cover.align.hcenter") },
    { edge: "right", Icon: AlignEndVertical, label: t("cover.align.right") },
    { edge: "top", Icon: AlignStartHorizontal, label: t("cover.align.top") },
    { edge: "vcenter", Icon: AlignCenterHorizontal, label: t("cover.align.vcenter") },
    { edge: "bottom", Icon: AlignEndHorizontal, label: t("cover.align.bottom") },
  ];

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const toggleMenu = (key: MenuKey) => setOpenMenu((cur) => (cur === key ? null : key));
  const closeMenu = () => setOpenMenu(null);

  // Dismiss any open dropdown on outside click or Escape.
  useEffect(() => {
    if (openMenu === null) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const applyTemplate = (templateId: string) => {
    replaceScene(
      buildTemplateScene(templateId, {
        title: bookTitle,
        author: bookAuthor,
        presetId: scene.doc.presetId ?? "6x9",
      })
    );
    closeMenu();
  };

  const addShape = (shape: "rect" | "ellipse" | "line") => {
    addLayer(createShapeLayer({ shape, docWidth: scene.doc.width, docHeight: scene.doc.height }));
    closeMenu();
  };

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
    closeMenu();
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
    closeMenu();
  };

  return (
    <div
      ref={rootRef}
      className="min-h-14 border-b border-border bg-background flex flex-wrap items-center px-2 sm:px-4 py-2 gap-1 sm:gap-2"
    >
      {/* Preset selector */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleMenu("presets")}
          className="gap-1 sm:gap-2 text-xs sm:text-sm"
        >
          <DimensionIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{currentPreset.name}</span>
          <ChevronDownIcon className="w-3 h-3" />
        </Button>
        {openMenu === "presets" && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-50">
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

      {/* Templates */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleMenu("templates")}
          className="gap-1 sm:gap-2 text-xs sm:text-sm"
        >
          <LayoutTemplate className="w-4 h-4" />
          <span className="hidden sm:inline">{t("cover.templates")}</span>
        </Button>
        {openMenu === "templates" && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-card border border-border rounded-lg shadow-lg z-50">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl.id)}
                className="w-full px-4 py-2 text-left hover:bg-muted"
              >
                {tpl.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

      {/* Add text */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleMenu("text")}
          className="gap-1 sm:gap-2 text-xs sm:text-sm"
        >
          <TextIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{t("cover.addText")}</span>
        </Button>
        {openMenu === "text" && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-50">
            <button
              type="button"
              onClick={() => addText("title")}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.toolbar.title")}
            </button>
            <button
              type="button"
              onClick={() => addText("subtitle")}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.toolbar.subtitle")}
            </button>
            <button
              type="button"
              onClick={() => addText("author")}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.toolbar.author")}
            </button>
          </div>
        )}
      </div>

      {/* Add image */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => imageInputRef.current?.click()}
        className="gap-1 sm:gap-2 text-xs sm:text-sm"
        title={t("cover.addImage")}
      >
        <ImageIcon className="w-4 h-4" />
        <span className="hidden sm:inline">{t("cover.addImage")}</span>
      </Button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImage}
        className="hidden"
      />

      {/* Add shape */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleMenu("shape")}
          className="gap-1 sm:gap-2 text-xs sm:text-sm"
          title={t("cover.addShape")}
        >
          <Shapes className="w-4 h-4" />
          <span className="hidden sm:inline">{t("cover.addShape")}</span>
        </Button>
        {openMenu === "shape" && (
          <div className="absolute top-full left-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-lg z-50">
            <button
              type="button"
              onClick={() => addShape("rect")}
              className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
            >
              <Square className="w-4 h-4" /> {t("cover.shape.rect")}
            </button>
            <button
              type="button"
              onClick={() => addShape("ellipse")}
              className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
            >
              <Circle className="w-4 h-4" /> {t("cover.shape.ellipse")}
            </button>
            <button
              type="button"
              onClick={() => addShape("line")}
              className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2"
            >
              <Minus className="w-4 h-4" /> {t("cover.shape.line")}
            </button>
          </div>
        )}
      </div>

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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => duplicateSelected()}
        disabled={!selectedId}
        title={t("cover.duplicate")}
      >
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

      <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

      {/* Align selected to canvas */}
      {alignButtons.map(({ edge, Icon, label }) => (
        <Button
          key={edge}
          variant="ghost"
          size="sm"
          onClick={() => alignSelected(edge)}
          disabled={!selectedId}
          title={label}
          className="hidden md:inline-flex"
        >
          <Icon className="w-4 h-4" />
        </Button>
      ))}

      <div className="w-px h-6 bg-border mx-1 sm:mx-2 hidden md:block" />

      {/* Layout aid toggles */}
      <Button
        variant={overlays ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setOverlays(!overlays)}
        title={t("cover.toggleOverlays")}
      >
        <Ruler className="w-4 h-4" />
      </Button>
      <Button
        variant={snapping ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setSnapping(!snapping)}
        title={t("cover.toggleSnapping")}
      >
        <Magnet className="w-4 h-4" />
      </Button>

      <div className="flex-1 min-w-2" />

      {/* Export */}
      <div className="relative">
        <Button
          variant="primary"
          size="sm"
          onClick={() => toggleMenu("export")}
          className="gap-1 sm:gap-2 text-xs sm:text-sm"
        >
          <ExportIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{t("cover.export")}</span>
        </Button>
        {openMenu === "export" && (
          <div className="absolute top-full right-0 mt-1 w-40 bg-card border border-border rounded-lg shadow-lg z-50">
            <button
              type="button"
              onClick={() => {
                onExport("png");
                closeMenu();
              }}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.pngExport")}
            </button>
            <button
              type="button"
              onClick={() => {
                onExport("jpeg");
                closeMenu();
              }}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.jpgExport")}
            </button>
            <button
              type="button"
              onClick={() => {
                onExport("pdf");
                closeMenu();
              }}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.pdfExport")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
