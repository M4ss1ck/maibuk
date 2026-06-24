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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleShowMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popoverWidth = 320;
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

  // The slider shows the measure; "Full" sits at the top of the track.
  const sliderValue = Math.min(editorContentWidth, EDITOR_CONTENT_WIDTH_MAX);

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
            className="width-control-portal fixed bg-card border border-border rounded-lg shadow-lg p-3 z-50 flex flex-col gap-3 w-72"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <div className="flex flex-wrap gap-1">
              {EDITOR_CONTENT_WIDTH_PRESETS.map((preset) => (
                <button
                  key={preset.labelKey}
                  type="button"
                  onClick={() => setEditorContentWidth(preset.value)}
                  className={`px-2 py-1 text-sm rounded ${
                    editorContentWidth === preset.value
                      ? "bg-primary text-white"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={EDITOR_CONTENT_WIDTH_MIN}
              max={EDITOR_CONTENT_WIDTH_MAX}
              step={EDITOR_CONTENT_WIDTH_STEP}
              value={sliderValue}
              onChange={(e) => setEditorContentWidth(Number(e.target.value))}
              aria-label={t("editor.contentWidth")}
              className="w-full"
            />
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
