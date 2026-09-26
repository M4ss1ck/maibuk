import { useRef, useState } from "react";
import { Dialog as AriaDialog, Popover } from "react-aria-components";
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
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Tooltip content={t("editor.zoom")}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setShowMenu((open) => !open)}
          aria-expanded={showMenu}
          className={`px-2 py-1 rounded text-sm transition-colors ${
            showMenu ? "bg-primary text-white" : "hover:bg-muted"
          }`}
        >
          {editorZoom}%
        </button>
      </Tooltip>

      {/* A React Aria popover: focus moves into it, Tab stays, Esc closes and returns to the trigger. */}
      <Popover
        triggerRef={buttonRef}
        isOpen={showMenu}
        onOpenChange={setShowMenu}
        placement="bottom end"
        className="zoom-control-portal z-50 rounded-lg border border-border bg-card p-3 shadow-lg"
      >
        <AriaDialog
          aria-label={t("editor.zoom")}
          className="flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-2 outline-none"
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
        </AriaDialog>
      </Popover>
    </>
  );
}
