import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { useSettingsStore } from "@/features/settings/store";
import { EDITOR_ZOOM_MIN, EDITOR_ZOOM_MAX, EDITOR_ZOOM_STEP } from "@/features/settings/types";
import { Tooltip } from "@/components/ui";

export function ZoomControl() {
  const { t } = useTranslation();
  const editorZoom = useSettingsStore((s) => s.editorZoom);
  const setEditorZoom = useSettingsStore((s) => s.setEditorZoom);
  const zoomIn = useSettingsStore((s) => s.zoomIn);
  const zoomOut = useSettingsStore((s) => s.zoomOut);
  const resetZoom = useSettingsStore((s) => s.resetZoom);

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
      if (target && !buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <>
      <Tooltip content={t("editor.zoom")}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => (showMenu ? setShowMenu(false) : handleShowMenu())}
          className={`px-2 py-1 rounded text-sm transition-colors ${
            showMenu ? "bg-primary text-white" : "hover:bg-muted"
          }`}
        >
          {editorZoom}%
        </button>
      </Tooltip>

      {showMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="zoom-control-portal fixed bg-card border border-border rounded-lg shadow-lg p-3 z-50 flex items-center gap-2"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <Tooltip content={t("editor.zoomOut")} shortcut="editor.zoomOut">
              <button
                type="button"
                onClick={zoomOut}
                aria-label={t("editor.zoomOut")}
                className="p-1 rounded hover:bg-muted"
              >
                <Minus className="w-4 h-4" />
              </button>
            </Tooltip>
            <input
              type="range"
              min={EDITOR_ZOOM_MIN}
              max={EDITOR_ZOOM_MAX}
              step={EDITOR_ZOOM_STEP}
              value={editorZoom}
              onChange={(e) => setEditorZoom(Number(e.target.value))}
              aria-label={t("editor.zoom")}
              className="w-32"
            />
            <Tooltip content={t("editor.zoomIn")} shortcut="editor.zoomIn">
              <button
                type="button"
                onClick={zoomIn}
                aria-label={t("editor.zoomIn")}
                className="p-1 rounded hover:bg-muted"
              >
                <Plus className="w-4 h-4" />
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={resetZoom}
              className="px-2 py-1 text-sm rounded hover:bg-muted whitespace-nowrap"
            >
              {t("editor.resetZoom")}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
