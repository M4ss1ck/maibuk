import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleDropdownToggle = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownWidth = 192; // w-48 = 12rem = 192px
      const viewportWidth = window.innerWidth;
      const padding = 8;

      // Ensure dropdown doesn't overflow right edge of viewport
      let left = rect.left;
      if (left + dropdownWidth > viewportWidth - padding) {
        left = viewportWidth - dropdownWidth - padding;
      }
      // Ensure dropdown doesn't overflow left edge
      if (left < padding) {
        left = padding;
      }

      setPosition({
        top: rect.bottom + 4,
        left,
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <>
      <div ref={containerRef} className="flex items-center">
        {/* Main button - triggers toggle action */}
        <Tooltip content={label} shortcut={shortcut} markdown={markdownHint}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={label}
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
            type="button"
            onClick={handleDropdownToggle}
            aria-label={t("editor.colorOptions", { label })}
            className={`px-1 py-2 rounded-r transition-colors border-l border-border/50 ${
              isOpen ? "bg-muted" : "hover:bg-muted"
            }`}
          >
            <ChevronDownIcon className="w-2 h-2" />
          </button>
        </Tooltip>
      </div>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed p-2 bg-background border border-border rounded-lg shadow-lg z-50 w-48"
            style={{ top: position.top, left: position.left }}
          >
            <div className="grid grid-cols-5 gap-1 mb-2">
              {PRESET_COLORS.map((color) => (
                <Tooltip key={color} content={color}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(color);
                      setIsOpen(false);
                    }}
                    className={`w-7 h-7 rounded border-2 transition-transform hover:scale-110 ${
                      value === color ? "border-primary" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={color}
                  />
                </Tooltip>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <Tooltip content={t("editor.customColor")}>
                <input
                  type="color"
                  value={value || "#000000"}
                  onChange={(e) => {
                    onChange(e.target.value);
                  }}
                  className="w-8 h-8 cursor-pointer rounded border border-border"
                  aria-label={t("editor.customColor")}
                />
              </Tooltip>
              <span className="text-xs text-muted-foreground flex-1">{t("cover.custom")}</span>
              {onClear && (
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    setIsOpen(false);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                >
                  {t("editor.clear")}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
