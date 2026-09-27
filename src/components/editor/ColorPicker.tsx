import { useTranslation } from "react-i18next";
import { ColorPickerControl } from "@/components/ui/ColorPickerControl";
import { Tooltip } from "@/components/ui";
import type { ShortcutId } from "@/lib/shortcut-registry";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  onPreview?: (color: string | null) => void;
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
  onPreview,
  onClear,
  onToggle,
  isActive,
  label,
  shortcut,
  markdownHint,
  icon,
}: ColorPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center">
      <Tooltip content={label} shortcut={shortcut} markdown={markdownHint}>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-pressed={isActive}
          className={`rounded-l p-2 transition-colors ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
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
      <ColorPickerControl
        label={t("editor.colorOptions", { label })}
        value={value}
        onPreview={onPreview}
        onCommit={onChange}
        presets={PRESET_COLORS}
        onClear={onClear}
        clearLabel={t("editor.clear")}
        closeOnPreset
        showUnknownContrast
        variant="split"
      />
    </div>
  );
}
