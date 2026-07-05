import { Tooltip } from "@/components/ui";
import type { ShortcutId } from "@/lib/shortcut-registry";

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: ShortcutId;
  children: React.ReactNode;
}

export function ToolbarButton({
  onClick,
  isActive,
  disabled,
  label,
  shortcut,
  children,
}: ToolbarButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`p-2 rounded transition-colors ${
          isActive ? "bg-primary text-white" : "hover:bg-muted"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function Divider() {
  return <div className="w-px h-6 bg-border mx-1" />;
}
