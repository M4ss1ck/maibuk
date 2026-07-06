import type { FormattedShortcut } from "@/lib/shortcut-registry";

interface KeyboardShortcutProps {
  shortcut: FormattedShortcut;
  className?: string;
  alwaysVisible?: boolean;
}

export function KeyboardShortcut({
  shortcut,
  className = "",
  alwaysVisible = false,
}: KeyboardShortcutProps) {
  return (
    <span
      className={`kbd-shortcut ${alwaysVisible ? "kbd-shortcut-always" : ""} inline-flex items-center gap-1 whitespace-nowrap ${className}`.trim()}
    >
      {shortcut.groups.map((chips, groupIndex) => (
        <span key={`${chips.join("-")}-${groupIndex}`} className="inline-flex items-center gap-0.5">
          {chips.map((chip, chipIndex) => (
            <kbd
              key={`${chip}-${chipIndex}`}
              className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono leading-none text-muted-foreground"
            >
              {chip}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
