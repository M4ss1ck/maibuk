import { useState, useRef } from "react";
import { Button } from "../ui/Button";
import {
  COVER_DIMENSIONS,
  PRESET_COLORS,
  DEFAULT_TEXT_STYLES,
  type CoverDimension,
  type TextStyle,
} from "../../features/covers/types";
import { useTranslation } from "react-i18next";
import {
  DimensionIcon,
  ChevronDownIcon,
  TextIcon,
  ImageIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  TrashIcon,
  ExportIcon
} from "../icons";

interface CoverToolbarProps {
  dimension: CoverDimension;
  onDimensionChange: (dimension: CoverDimension) => void;
  onAddText: (text: string, style: TextStyle, type: string) => void;
  onAddImage: (file: File) => void;
  onBackgroundColor: (color: string) => void;
  onBackgroundImage: (file: File) => void;
  onDelete: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onExport: (format: "png" | "jpeg") => void;
  hasSelection: boolean;
  bookTitle?: string;
  bookAuthor?: string;
}

export function CoverToolbar({
  dimension,
  onDimensionChange,
  onAddText,
  onAddImage,
  onBackgroundColor,
  onBackgroundImage,
  onDelete,
  onBringForward,
  onSendBackward,
  onExport,
  hasSelection,
  bookTitle = "Your Title",
  bookAuthor = "Author Name",
}: CoverToolbarProps) {
  const { t } = useTranslation();
  const [showDimensions, setShowDimensions] = useState(false);
  const [showTextMenu, setShowTextMenu] = useState(false);
  const [showBackgroundMenu, setShowBackgroundMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState("#1a1a2e");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  const handleAddTitle = () => {
    onAddText(bookTitle, DEFAULT_TEXT_STYLES.title, "title");
    setShowTextMenu(false);
  };

  const handleAddSubtitle = () => {
    onAddText("Subtitle", DEFAULT_TEXT_STYLES.subtitle, "subtitle");
    setShowTextMenu(false);
  };

  const handleAddAuthor = () => {
    onAddText(bookAuthor, DEFAULT_TEXT_STYLES.author, "author");
    setShowTextMenu(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onAddImage(file);
    }
    e.target.value = "";
  };

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onBackgroundImage(file);
      setShowBackgroundMenu(false);
    }
    e.target.value = "";
  };

  const handleColorChange = (color: string) => {
    setBackgroundColor(color);
    onBackgroundColor(color);
    setShowBackgroundMenu(false);
  };

  return (
    <div className="h-14 border-b border-border bg-background flex items-center px-4 gap-2">
      {/* Dimension selector */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDimensions(!showDimensions)}
          className="gap-2"
        >
          <DimensionIcon className="w-4 h-4" />
          {dimension.name}
          <ChevronDownIcon className="w-3 h-3" />
        </Button>

        {showDimensions && (
          <div className="absolute top-full left-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg z-50">
            {COVER_DIMENSIONS.map((dim) => (
              <button
                key={dim.id}
                onClick={() => {
                  onDimensionChange(dim);
                  setShowDimensions(false);
                }}
                className={`w-full px-4 py-2 text-left hover:bg-muted flex justify-between items-center ${dim.id === dimension.id ? "bg-muted" : ""
                  }`}
              >
                <span className="font-medium">{dim.name}</span>
                <span className="text-xs text-muted-foreground">{dim.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-border mx-2" />

      {/* Add Text */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTextMenu(!showTextMenu)}
          className="gap-2"
        >
          <TextIcon className="w-4 h-4" />
          {t("cover.addText")}
        </Button>

        {showTextMenu && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50">
            <button
              onClick={handleAddTitle}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.toolbar.title")}
            </button>
            <button
              onClick={handleAddSubtitle}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.toolbar.subtitle")}
            </button>
            <button
              onClick={handleAddAuthor}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.toolbar.author")}
            </button>
          </div>
        )}
      </div>

      {/* Add Image */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => imageInputRef.current?.click()}
        className="gap-2"
      >
        <ImageIcon className="w-4 h-4" />
        {t("cover.addImage")}
      </Button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
        className="hidden"
      />

      {/* Background */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowBackgroundMenu(!showBackgroundMenu)}
          className="gap-2"
        >
          <div
            className="w-4 h-4 rounded border border-border"
            style={{ backgroundColor }}
          />
          {t("cover.background")}
        </Button>

        {showBackgroundMenu && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 p-3">
            <p className="text-sm font-medium mb-2">{t("cover.backgroundColor")}</p>
            <div className="grid grid-cols-8 gap-1 mb-3">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => handleColorChange(color)}
                  className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <p className="text-sm font-medium mb-2">{t("cover.custom")}</p>
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-full h-8 cursor-pointer"
            />
            <div className="border-t border-border mt-3 pt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => bgImageInputRef.current?.click()}
                className="w-full"
              >
                {t("cover.upload")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <input
        ref={bgImageInputRef}
        type="file"
        accept="image/*"
        onChange={handleBgImageUpload}
        className="hidden"
      />

      <div className="w-px h-6 bg-border mx-2" />

      {/* Layer controls */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onBringForward}
        disabled={!hasSelection}
        title={t("cover.bringForward")}
      >
        <ArrowUpIcon className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onSendBackward}
        disabled={!hasSelection}
        title={t("cover.sendBackward")}
      >
        <ArrowDownIcon className="w-4 h-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={!hasSelection}
        title={t("common.delete")}
        className="text-destructive hover:text-destructive"
      >
        <TrashIcon className="w-4 h-4" />
      </Button>

      <div className="flex-1" />

      {/* Export */}
      <div className="relative">
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowExportMenu(!showExportMenu)}
          className="gap-2"
        >
          <ExportIcon className="w-4 h-4" />
          {t("cover.export")}
        </Button>

        {showExportMenu && (
          <div className="absolute top-full right-0 mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg z-50">
            <button
              onClick={() => {
                onExport("png");
                setShowExportMenu(false);
              }}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.pngExport")}
            </button>
            <button
              onClick={() => {
                onExport("jpeg");
                setShowExportMenu(false);
              }}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              {t("cover.jpgExport")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
