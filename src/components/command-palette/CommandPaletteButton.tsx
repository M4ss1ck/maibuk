import { useTranslation } from "react-i18next";
import { Command } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useCommandPaletteStore } from "@/features/command-palette/store";

interface CommandPaletteButtonProps {
  className?: string;
  size?: "sm" | "md";
  /**
   * `toolColumn` mirrors `CanvasToolPanel`'s `ToolbarButton` so the button
   * sits inside the Canvas tool card as a peer of its tools (same size,
   * border, radius, hover/focus, and icon size); the default is the ghost
   * footer button.
   */
  variant?: "default" | "toolColumn";
}

/** The inactive classes of `CanvasToolPanel`'s `ToolbarButton`; keep in sync. */
const TOOL_COLUMN_CLASS =
  "inline-flex size-9 md:size-7 items-center justify-center rounded-md border text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40 border-border bg-card hover:bg-muted";

/**
 * The always-visible Command Palette entry point. The `Command` glyph names
 * the palette's subject (`SquareTerminal` would read as a terminal, and the
 * glossary avoids "search", so neither is used). The Tooltip carries the live
 * Shortcut through its `shortcut` prop, and `data-command` names the Command
 * the button runs. Never hover-revealed: coarse pointers get a 40px target
 * through `pointer-coarse:` minimums.
 */
export function CommandPaletteButton({
  className = "",
  size = "sm",
  variant = "default",
}: CommandPaletteButtonProps) {
  const { t } = useTranslation();
  const label = t("shortcuts.openCommandPalette");

  if (variant === "toolColumn") {
    return (
      <Tooltip content={label} shortcut="global.openCommandPalette">
        <button
          type="button"
          aria-label={label}
          data-command="global.openCommandPalette"
          onClick={() => useCommandPaletteStore.getState().open()}
          className={`${TOOL_COLUMN_CLASS} ${className}`}
        >
          <Command className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={label} shortcut="global.openCommandPalette">
      <Button
        variant="ghost"
        size={size}
        type="button"
        aria-label={label}
        data-command="global.openCommandPalette"
        onClick={() => useCommandPaletteStore.getState().open()}
        className={`shrink-0 pointer-coarse:min-h-10 pointer-coarse:min-w-10 ${className}`}
      >
        <Command className="h-4 w-4" aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
