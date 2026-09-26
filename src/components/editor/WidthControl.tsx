import { useState, useRef, useEffect } from "react";
import { Dialog as AriaDialog, Popover } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { MoveHorizontal } from "lucide-react";
import { Tooltip } from "@/components/ui";
import { useSettingsStore } from "@/features/settings/store";
import {
  EDITOR_CONTENT_WIDTH_MIN,
  EDITOR_CONTENT_WIDTH_MAX,
  EDITOR_CONTENT_WIDTH_STEP,
  EDITOR_CONTENT_WIDTH_PRESETS,
  EDITOR_CONTENT_WIDTH_FULL,
  DEFAULT_EDITOR_CONTENT_WIDTH,
} from "@/features/settings/types";
import { PagePaddingControl } from "@/components/editor/PagePaddingControl";

export function WidthControl() {
  const { t } = useTranslation();
  const editorContentWidth = useSettingsStore((s) => s.editorContentWidth);
  const setEditorContentWidth = useSettingsStore((s) => s.setEditorContentWidth);
  const editorPagePadding = useSettingsStore((s) => s.editorPagePadding);
  const setEditorPagePadding = useSettingsStore((s) => s.setEditorPagePadding);
  const resetEditorPagePadding = useSettingsStore((s) => s.resetEditorPagePadding);
  const editorShowBorder = useSettingsStore((s) => s.editorShowBorder);
  const setEditorShowBorder = useSettingsStore((s) => s.setEditorShowBorder);

  const [showMenu, setShowMenu] = useState(false);
  const [isEditingWidth, setIsEditingWidth] = useState(false);
  const [widthInputDraft, setWidthInputDraft] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const widthInputRef = useRef<HTMLInputElement>(null);

  // The slider gets one extra stop after the max px value for "Full".
  const sliderFullValue = EDITOR_CONTENT_WIDTH_MAX + EDITOR_CONTENT_WIDTH_STEP;
  const isFullWidth = editorContentWidth >= EDITOR_CONTENT_WIDTH_FULL;
  const sliderValue = isFullWidth
    ? sliderFullValue
    : Math.min(editorContentWidth, EDITOR_CONTENT_WIDTH_MAX);
  // Measured presets (ascending), excluding the Full sentinel.
  const measuredPresetValues = EDITOR_CONTENT_WIDTH_PRESETS.filter(
    (preset) => preset.value !== EDITOR_CONTENT_WIDTH_FULL
  ).map((preset) => preset.value);

  // How strongly a preset is "active" for the current width, in [0, 1].
  // Adjacent presets blend linearly so the value's position between them is
  // visible; the tail regions and the Full sentinel stay fully lit / discrete.
  const presetWeight = (presetValue: number): number => {
    if (presetValue === EDITOR_CONTENT_WIDTH_FULL) return isFullWidth ? 1 : 0;
    if (isFullWidth) return 0;
    const first = measuredPresetValues[0];
    const last = measuredPresetValues[measuredPresetValues.length - 1];
    if (editorContentWidth <= first) return presetValue === first ? 1 : 0;
    if (editorContentWidth >= last) return presetValue === last ? 1 : 0;
    for (let i = 0; i < measuredPresetValues.length - 1; i++) {
      const lo = measuredPresetValues[i];
      const hi = measuredPresetValues[i + 1];
      if (editorContentWidth >= lo && editorContentWidth <= hi) {
        const t = (editorContentWidth - lo) / (hi - lo);
        if (presetValue === lo) return 1 - t;
        if (presetValue === hi) return t;
        return 0;
      }
    }
    return 0;
  };

  const formatPresetValue = (value: number) =>
    value === EDITOR_CONTENT_WIDTH_FULL ? "100%" : `${value}px`;
  const displayedWidthValue = isFullWidth ? t("editor.widthFull") : `${editorContentWidth}px`;
  const valueControlBaseClass = "h-8 w-20 shrink-0 rounded px-2 text-right text-sm text-foreground";

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
      <Tooltip content={t("editor.contentWidth")}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setShowMenu((open) => !open)}
          aria-label={t("editor.contentWidth")}
          aria-expanded={showMenu}
          className={`px-2 py-1 rounded transition-colors ${
            showMenu ? "bg-primary text-white" : "hover:bg-muted"
          }`}
        >
          <MoveHorizontal className="w-4 h-4" />
        </button>
      </Tooltip>

      {/* A React Aria popover: focus moves into it, Tab stays, Esc closes and returns to the trigger. */}
      <Popover
        triggerRef={buttonRef}
        isOpen={showMenu}
        onOpenChange={setShowMenu}
        placement="bottom end"
        className="width-control-portal z-50 rounded-lg border border-border bg-card p-3 shadow-lg"
      >
        <AriaDialog
          aria-label={t("editor.contentWidth")}
          className="flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col gap-3 outline-none"
        >
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
            {EDITOR_CONTENT_WIDTH_PRESETS.map((preset) => {
              const weight = presetWeight(preset.value);
              return (
                <button
                  key={preset.labelKey}
                  type="button"
                  onClick={() => setEditorContentWidth(preset.value)}
                  className="relative min-w-0 rounded-md px-1.5 py-1.5 text-center text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground"
                  style={
                    weight > 0
                      ? {
                          color: `color-mix(in srgb, var(--color-foreground) ${weight * 100}%, var(--color-muted-foreground))`,
                        }
                      : undefined
                  }
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-md bg-background shadow-sm transition-opacity duration-200 ease-out"
                    style={{ opacity: weight }}
                  />
                  <span className="relative block truncate text-xs font-medium leading-tight">
                    {t(preset.labelKey)}
                  </span>
                  <span className="relative block text-[11px] leading-tight">
                    {formatPresetValue(preset.value)}
                  </span>
                </button>
              );
            })}
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
                  nextValue >= sliderFullValue ? EDITOR_CONTENT_WIDTH_FULL : nextValue
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
                onChange={(e) => setWidthInputDraft(e.target.value.replace(/\D/g, ""))}
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
                    setWidthInputDraft(isFullWidth ? "" : String(editorContentWidth));
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
          <PagePaddingControl padding={editorPagePadding} onChange={setEditorPagePadding} />
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
            onClick={() => {
              setEditorContentWidth(DEFAULT_EDITOR_CONTENT_WIDTH);
              resetEditorPagePadding();
            }}
            className="px-2 py-1 text-sm rounded hover:bg-muted self-start"
          >
            {t("editor.resetLayout")}
          </button>
        </AriaDialog>
      </Popover>
    </>
  );
}
