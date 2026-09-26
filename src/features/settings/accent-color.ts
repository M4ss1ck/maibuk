import { readableForeground } from "@/lib/color";

function darken(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((offset) =>
    Math.max(
      0,
      Math.min(255, Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * (1 - amount)))
    )
      .toString(16)
      .padStart(2, "0")
  );
  return `#${channels.join("")}`.toUpperCase();
}

/** Apply a committed or transient accent without writing the settings store. */
export function applyAccentColor(color: string): void {
  const root = document.documentElement;
  const hover = darken(color, 0.12);
  root.style.setProperty("--color-primary", color);
  root.style.setProperty("--color-primary-hover", hover);
  root.style.setProperty("--color-primary-foreground", readableForeground(color));
  root.style.setProperty("--color-primary-hover-foreground", readableForeground(hover));
}
