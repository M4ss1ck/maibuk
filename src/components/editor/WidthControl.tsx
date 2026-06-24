import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MoveHorizontal } from "lucide-react";
import { useSettingsStore } from "../../features/settings/store";
import {
  EDITOR_CONTENT_WIDTH_MIN,
  EDITOR_CONTENT_WIDTH_MAX,
  EDITOR_CONTENT_WIDTH_STEP,
  EDITOR_CONTENT_WIDTH_PRESETS,
  EDITOR_CONTENT_WIDTH_FULL,
  DEFAULT_EDITOR_CONTENT_WIDTH,
} from "../../features/settings/types";

export function WidthControl() {
  const { t } = useTranslation();
  const editorContentWidth = useSettingsStore((s) => s.editorContentWidth);
  const setEditorContentWidth = useSettingsStore((s) => s.setEditorContentWidth);
  const editorShowBorder = useSettingsStore((s) => s.editorShowBorder);
  const setEditorShowBorder = useSettingsStore((s) => s.setEditorShowBorder);

  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [isEditingWidth, setIsEditingWidth] = useState(false);
  const [widthInputDraft, setWidthInputDraft] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const widthInputRef = useRef<HTMLInputElement>(null);

  const handleShowMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popoverWidth = 352;
      const left = Math.min(rect.left, window.innerWidth - popoverWidth - 8);
      setMenuPosition({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setShowMenu(true);
  };

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  // The slider gets one extra stop after the max px value for "Full".
  const sliderFullValue = EDITOR_CONTENT_WIDTH_MAX + EDITOR_CONTENT_WIDTH_STEP;
  const isFullWidth = editorContentWidth >= EDITOR_CONTENT_WIDTH_FULL;
  const sliderValue = isFullWidth
    ? sliderFullValue
    : Math.min(editorContentWidth, EDITOR_CONTENT_WIDTH_MAX);
  const measuredPresets = EDITOR_CONTENT_WIDTH_PRESETS.filter(
    (preset) => preset.value !== EDITOR_CONTENT_WIDTH_FULL,
  );
  const visualPresetValue =
    isFullWidth
      ? EDITOR_CONTENT_WIDTH_FULL
      : measuredPresets.reduce((nearest, preset) =>
          Math.abs(preset.value - editorContentWidth) <
          Math.abs(nearest.value - editorContentWidth)
            ? preset
            : nearest,
        ).value;

  const formatPresetValue = (value: number) =>
    value === EDITOR_CONTENT_WIDTH_FULL ? "100%" : `${value}px`;
  const displayedWidthValue = isFullWidth
    ? t("editor.widthFull")
    : `${editorContentWidth}px`;
  const valueControlBaseClass =
    "h-8 w-20 shrink-0 rounded px-2 text-right text-sm text-foreground";

  useEffect(() => {
    setWidthInputDraft(isFullWidth ? "" : String(editorContentWidth));
  }, [editorContentWidth, isFullWidth]);

  const commitWidthInput = () => {
    if (!widthInputDraft.trim()) {
      setWidthInputDraft(isFullWidth ? "" : String(editorContentWidth));
      return;
    }
    setEditorContentWidth(Number(widthInputDraft));
  };

  useEffect(() => {
    if (isEditingWidth) {
      widthInputRef.current?.focus();
      widthInputRef.current?.select();
    }
  }, [isEditingWidth]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (showMenu ? setShowMenu(false) : handleShowMenu())}
        title={t("editor.contentWidth")}
        className={`px-2 py-1 rounded transition-colors ${
          showMenu ? "bg-primary text-white" : "hover:bg-muted text-muted-foreground"
        }`}
      >
        <MoveHorizontal className="w-4 h-4" />
      </button>

      {showMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="width-control-portal fixed bg-card border border-border rounded-lg shadow-lg p-3 z-50 flex flex-col gap-3 w-[22rem] max-w-[calc(100vw-1rem)]"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
              {EDITOR_CONTENT_WIDTH_PRESETS.map((preset) => (
                <button
                  key={preset.labelKey}
                  type="button"
                  onClick={() => setEditorContentWidth(preset.value)}
                  className={`min-w-0 rounded-md px-1.5 py-1.5 text-center transition-colors ${
                    visualPresetValue === preset.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="block truncate text-xs font-medium leading-tight">
                    {t(preset.labelKey)}
                  </span>
                  <span className="block text-[11px] leading-tight">
                    {formatPresetValue(preset.value)}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={EDITOR_CONTENT_WIDTH_MIN}
                max={sliderFullValue}
                step={EDITOR_CONTENT_WIDTH_STEP}
                value={sliderValue}
                onChange={(e) => {
                  const nextValue = Number(e.target.value);
                  setEditorContentWidth(
                    nextValue >= sliderFullValue
                      ? EDITOR_CONTENT_WIDTH_FULL
                      : nextValue,
                  );
                }}
                aria-label={t("editor.contentWidth")}
                className="min-w-0 flex-1"
              />
              {isEditingWidth ? (
                <input
                  ref={widthInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={widthInputDraft}
                  placeholder={isFullWidth ? t("editor.widthFull") : undefined}
                  onChange={(e) =>
                    setWidthInputDraft(e.target.value.replace(/\D/g, ""))
                  }
                  onBlur={() => {
                    commitWidthInput();
                    setIsEditingWidth(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitWidthInput();
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      setWidthInputDraft(
                        isFullWidth ? "" : String(editorContentWidth),
                      );
                      setIsEditingWidth(false);
                    }
                  }}
                  aria-label={`${t("editor.contentWidth")} px`}
                  className={`${valueControlBaseClass} border border-border bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingWidth(true)}
                  onFocus={() => setIsEditingWidth(true)}
                  aria-label={`${t("editor.contentWidth")} px`}
                  className={`${valueControlBaseClass} transition-colors text-muted-foreground hover:text-foreground`}
                >
                  {displayedWidthValue}
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={editorShowBorder}
                onChange={(e) => setEditorShowBorder(e.target.checked)}
              />
              {t("editor.showBorder")}
            </label>
            <button
              type="button"
              onClick={() => setEditorContentWidth(DEFAULT_EDITOR_CONTENT_WIDTH)}
              className="px-2 py-1 text-sm rounded hover:bg-muted self-start"
            >
              {t("editor.resetWidth")}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
