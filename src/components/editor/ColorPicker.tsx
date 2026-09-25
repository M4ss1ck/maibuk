import { useRef, useState } from "react";
import { Dialog as AriaDialog, Popover } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "@/components/icons";
import { Tooltip } from "@/components/ui";
import type { ShortcutId } from "@/lib/shortcut-registry";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onClear?: () => void;
  onToggle?: () => void;
  isActive?: boolean;
  label: string;
  shortcut?: ShortcutId;
  markdownHint?: string | string[];
  icon: React.ReactNode;
}

const PRESET_COLORS = [
  "#000000",
  "#374151",
  "#6B7280",
  "#9CA3AF",
  "#D1D5DB",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#14B8A6",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#F43F5E",
  "#7C2D12",
  "#713F12",
  "#365314",
  "#164E63",
  "#1E3A8A",
];

export function ColorPicker({
  value,
  onChange,
  onClear,
  onToggle,
  isActive,
  label,
  shortcut,
  markdownHint,
  icon,
}: ColorPickerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div className="flex items-center">
        {/* Main button - triggers toggle action */}
        <Tooltip content={label} shortcut={shortcut} markdown={markdownHint}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={label}
            aria-pressed={isActive}
            className={`p-2 rounded-l transition-colors ${
              isActive ? "bg-primary text-white" : "hover:bg-muted"
            }`}
          >
            <span className="relative">
              {icon}
              {value && (
                <span
                  className="absolute -bottom-0.5 left-0 right-0 h-1 rounded-sm"
                  style={{ backgroundColor: value }}
                />
              )}
            </span>
          </button>
        </Tooltip>
        {/* Dropdown arrow button - opens color picker */}
        <Tooltip content={t("editor.colorOptions", { label })}>
          <button
            ref={dropdownTriggerRef}
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-label={t("editor.colorOptions", { label })}
            aria-expanded={isOpen}
            className={`px-1 py-2 rounded-r transition-colors border-l border-border/50 ${
              isOpen ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            <ChevronDownIcon className="w-2 h-2" />
          </button>
        </Tooltip>
      </div>

      {/* A React Aria popover: focus moves into the palette, Tab stays, Esc closes. */}
      <Popover
        triggerRef={dropdownTriggerRef}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        placement="bottom start"
        className="z-50 rounded-lg border border-border bg-background p-2 shadow-lg"
      >
        <AriaDialog
          aria-label={t("editor.colorOptions", { label })}
          className="w-48 outline-none"
        >
          <div className="mb-2 grid grid-cols-5 gap-1">
            {PRESET_COLORS.map((color) => (
              <Tooltip key={color} content={color}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(color);
                    setIsOpen(false);
                  }}
                  className={`h-7 w-7 rounded border-2 transition-transform hover:scale-110 ${
                    value === color ? "border-primary" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              </Tooltip>
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-2">
            <Tooltip content={t("editor.customColor")}>
              <input
                type="color"
                value={value || "#000000"}
                onChange={(e) => {
                  onChange(e.target.value);
                }}
                className="h-8 w-8 cursor-pointer rounded border border-border"
                aria-label={t("editor.customColor")}
              />
            </Tooltip>
            <span className="flex-1 text-xs text-muted-foreground">{t("cover.custom")}</span>
            {onClear && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setIsOpen(false);
                }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("editor.clear")}
              </button>
            )}
          </div>
        </AriaDialog>
      </Popover>
    </>
  );
}
