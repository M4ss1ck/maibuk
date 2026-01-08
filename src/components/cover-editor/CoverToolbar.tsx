import { useState, useRef } from "react";
import { Button } from "../ui/Button";
import {
  COVER_DIMENSIONS,
  PRESET_COLORS,
  DEFAULT_TEXT_STYLES,
  type CoverDimension,
  type TextStyle,
} from "../../features/covers/types";

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
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
          </svg>
          {dimension.name}
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
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
                className={`w-full px-4 py-2 text-left hover:bg-muted flex justify-between items-center ${
                  dim.id === dimension.id ? "bg-muted" : ""
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
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
          </svg>
          Add Text
        </Button>

        {showTextMenu && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg z-50">
            <button
              onClick={handleAddTitle}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              Title
            </button>
            <button
              onClick={handleAddSubtitle}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              Subtitle
            </button>
            <button
              onClick={handleAddAuthor}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              Author Name
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
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Add Image
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
          Background
        </Button>

        {showBackgroundMenu && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 p-3">
            <p className="text-sm font-medium mb-2">Color</p>
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
            <p className="text-sm font-medium mb-2">Custom</p>
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
                Upload Background Image
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
        title="Bring Forward"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onSendBackward}
        disabled={!hasSelection}
        title="Send Backward"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={!hasSelection}
        title="Delete"
        className="text-destructive hover:text-destructive"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
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
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Export
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
              Export as PNG
            </button>
            <button
              onClick={() => {
                onExport("jpeg");
                setShowExportMenu(false);
              }}
              className="w-full px-4 py-2 text-left hover:bg-muted"
            >
              Export as JPEG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
