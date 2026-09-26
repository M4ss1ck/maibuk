import { useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
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
import type { AlignEdge } from "@/features/covers/store";
import { useCoverStore } from "@/features/covers/store";
import {
  PRESETS,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  getPreset,
} from "@/features/covers/scene/defaults";
import { TEMPLATES, buildTemplateScene } from "@/features/covers/scene/templates";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipGroup } from "@/components/ui";
import {
  ChevronDownIcon,
  DimensionIcon,
  ExportIcon,
  ImageIcon,
  TextIcon,
  TrashIcon,
} from "@/components/icons";

export type ExportChoice = "png" | "jpeg" | "pdf";

interface ToolbarProps {
  onExport: (format: ExportChoice) => void;
  bookTitle: string;
  bookAuthor: string;
}

// The menus follow the app's React Aria menu pattern (see TextCaseMenu): a
// menu trigger, a popover and a Menu. Arrow keys, typeahead, Escape and focus
// restoration are React Aria's, not hand-rolled.
const TRIGGER_CLASS =
  "inline-flex items-center justify-center gap-1 sm:gap-2 rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium bg-transparent text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-muted data-pressed:bg-muted";
const POPOVER_CLASS =
  "z-50 mt-1 rounded-lg border border-border bg-card py-1 shadow-lg outline-none";
const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm text-foreground outline-none data-focused:bg-muted";

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

  const imageInputRef = useRef<HTMLInputElement>(null);

  const applyTemplate = (templateId: string) => {
    replaceScene(
      buildTemplateScene(templateId, {
        title: bookTitle,
        author: bookAuthor,
        presetId: scene.doc.presetId ?? "6x9",
      })
    );
  };

  const addShape = (shape: "rect" | "ellipse" | "line") => {
    addLayer(createShapeLayer({ shape, docWidth: scene.doc.width, docHeight: scene.doc.height }));
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
  };

  return (
    <TooltipGroup>
      <div className="min-h-14 border-b border-border bg-background flex flex-wrap items-center px-2 sm:px-4 py-2 gap-1 sm:gap-2">
        {/* Preset selector */}
        <MenuTrigger>
          <Tooltip content={t("cover.sizePreset")}>
            <AriaButton
              data-tutorial="cover-designer.size"
              className={TRIGGER_CLASS}
            >
              <DimensionIcon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{currentPreset.name}</span>
              <ChevronDownIcon className="w-3 h-3" aria-hidden="true" />
            </AriaButton>
          </Tooltip>
          <Popover placement="bottom start" className={`${POPOVER_CLASS} w-56`}>
            <Menu
              aria-label={t("cover.sizePreset")}
              onAction={(key) => changePreset(String(key))}
              className="outline-none"
            >
              {PRESETS.map((p) => (
                <MenuItem
                  key={p.id}
                  id={p.id}
                  textValue={p.name}
                  className={`${ITEM_CLASS} justify-between`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.description}</span>
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>

        {/* Templates */}
        <MenuTrigger>
          <Tooltip content={t("cover.templates")}>
            <AriaButton data-tutorial="cover-designer.templates" className={TRIGGER_CLASS}>
              <LayoutTemplate className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("cover.templates")}</span>
            </AriaButton>
          </Tooltip>
          <Popover placement="bottom start" className={`${POPOVER_CLASS} w-56`}>
            <Menu
              aria-label={t("cover.templates")}
              onAction={(key) => applyTemplate(String(key))}
              className="outline-none"
            >
              {TEMPLATES.map((tpl) => (
                <MenuItem key={tpl.id} id={tpl.id} textValue={tpl.name} className={ITEM_CLASS}>
                  {tpl.name}
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>

        <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

        {/* Add text */}
        <MenuTrigger>
          <Tooltip content={t("cover.addText")}>
            <AriaButton className={TRIGGER_CLASS}>
              <TextIcon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("cover.addText")}</span>
            </AriaButton>
          </Tooltip>
          <Popover placement="bottom start" className={`${POPOVER_CLASS} w-48`}>
            <Menu
              aria-label={t("cover.addText")}
              onAction={(key) => addText(key as "title" | "subtitle" | "author")}
              className="outline-none"
            >
              <MenuItem id="title" textValue={t("cover.toolbar.title")} className={ITEM_CLASS}>
                {t("cover.toolbar.title")}
              </MenuItem>
              <MenuItem id="subtitle" textValue={t("cover.toolbar.subtitle")} className={ITEM_CLASS}>
                {t("cover.toolbar.subtitle")}
              </MenuItem>
              <MenuItem id="author" textValue={t("cover.toolbar.author")} className={ITEM_CLASS}>
                {t("cover.toolbar.author")}
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>

        {/* Add image */}
        <Tooltip content={t("cover.addImage")}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => imageInputRef.current?.click()}
            className="gap-1 sm:gap-2 text-xs sm:text-sm"
            aria-label={t("cover.addImage")}
          >
            <ImageIcon className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("cover.addImage")}</span>
          </Button>
        </Tooltip>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImage}
          className="hidden"
          aria-label={t("cover.addImage")}
        />

        {/* Add shape */}
        <MenuTrigger>
          <Tooltip content={t("cover.addShape")}>
            <AriaButton aria-label={t("cover.addShape")} className={TRIGGER_CLASS}>
              <Shapes className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("cover.addShape")}</span>
            </AriaButton>
          </Tooltip>
          <Popover placement="bottom start" className={`${POPOVER_CLASS} w-44`}>
            <Menu
              aria-label={t("cover.addShape")}
              onAction={(key) => addShape(key as "rect" | "ellipse" | "line")}
              className="outline-none"
            >
              <MenuItem id="rect" textValue={t("cover.shape.rect")} className={ITEM_CLASS}>
                <Square className="w-4 h-4" aria-hidden="true" /> {t("cover.shape.rect")}
              </MenuItem>
              <MenuItem id="ellipse" textValue={t("cover.shape.ellipse")} className={ITEM_CLASS}>
                <Circle className="w-4 h-4" aria-hidden="true" /> {t("cover.shape.ellipse")}
              </MenuItem>
              <MenuItem id="line" textValue={t("cover.shape.line")} className={ITEM_CLASS}>
                <Minus className="w-4 h-4" aria-hidden="true" /> {t("cover.shape.line")}
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>

        <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

        {/* History */}
        <Tooltip content={t("cover.undo")} shortcut="cover.undo">
          <Button variant="ghost" size="sm" onClick={() => undo()} aria-label={t("cover.undo")}>
            <Undo2 className="w-4 h-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t("cover.redo")} shortcut="cover.redo">
          <Button variant="ghost" size="sm" onClick={() => redo()} aria-label={t("cover.redo")}>
            <Redo2 className="w-4 h-4" />
          </Button>
        </Tooltip>

        <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

        {/* Selection actions */}
        <Tooltip content={t("cover.duplicate")} shortcut="cover.duplicate">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => duplicateSelected()}
            disabled={!selectedId}
            aria-label={t("cover.duplicate")}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t("common.delete")} shortcut="cover.delete">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => selectedId && removeLayer(selectedId)}
            disabled={!selectedId}
            aria-label={t("common.delete")}
            className="text-destructive hover:text-destructive"
          >
            <TrashIcon className="w-4 h-4" />
          </Button>
        </Tooltip>

        <div className="w-px h-6 bg-border mx-1 sm:mx-2" />

        {/* Align selected to canvas */}
        {alignButtons.map(({ edge, Icon, label }) => (
          <Tooltip key={edge} content={label}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => alignSelected(edge)}
              disabled={!selectedId}
              aria-label={label}
              className="hidden md:inline-flex"
            >
              <Icon className="w-4 h-4" />
            </Button>
          </Tooltip>
        ))}

        <div className="w-px h-6 bg-border mx-1 sm:mx-2 hidden md:block" />

        {/* Layout aid toggles */}
        <Tooltip content={t("cover.toggleOverlays")}>
          <Button
            variant={overlays ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setOverlays(!overlays)}
            aria-label={t("cover.toggleOverlays")}
            aria-pressed={overlays}
          >
            <Ruler className="w-4 h-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t("cover.toggleSnapping")}>
          <Button
            variant={snapping ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSnapping(!snapping)}
            aria-label={t("cover.toggleSnapping")}
            aria-pressed={snapping}
          >
            <Magnet className="w-4 h-4" />
          </Button>
        </Tooltip>

        <div className="flex-1 min-w-2" />

        {/* Export */}
        <MenuTrigger>
          <Tooltip content={t("cover.export")}>
            <AriaButton
              data-tutorial="cover-designer.export"
              className={`${TRIGGER_CLASS} bg-primary text-white hover:bg-primary-hover`}
            >
              <ExportIcon className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("cover.export")}</span>
            </AriaButton>
          </Tooltip>
          <Popover placement="bottom end" className={`${POPOVER_CLASS} w-40`}>
            <Menu
              aria-label={t("cover.export")}
              onAction={(key) => onExport(key as ExportChoice)}
              className="outline-none"
            >
              <MenuItem id="png" textValue={t("cover.pngExport")} className={ITEM_CLASS}>
                {t("cover.pngExport")}
              </MenuItem>
              <MenuItem id="jpeg" textValue={t("cover.jpgExport")} className={ITEM_CLASS}>
                {t("cover.jpgExport")}
              </MenuItem>
              <MenuItem id="pdf" textValue={t("cover.pdfExport")} className={ITEM_CLASS}>
                {t("cover.pdfExport")}
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
    </TooltipGroup>
  );
}
