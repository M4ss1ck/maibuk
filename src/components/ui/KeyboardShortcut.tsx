interface KeyboardShortcutProps {
  keys: string[];
  className?: string;
  alwaysVisible?: boolean;
}

export function KeyboardShortcut({ keys, className = "", alwaysVisible = false }: KeyboardShortcutProps) {
  return (
    <kbd
      className={`kbd-shortcut ${alwaysVisible ? "kbd-shortcut-always" : ""} inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono leading-none dark:text-muted-foreground text-white whitespace-nowrap ${className}`.trim()}
    >
      {keys.join(" ")}
    </kbd>
  );
}
