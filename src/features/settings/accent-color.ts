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

/** The four primary properties an accent color sets on the document root. */
export function accentColorVars(color: string): Record<string, string> {
  const hover = darken(color, 0.12);
  return {
    "--color-primary": color,
    "--color-primary-hover": hover,
    "--color-primary-foreground": readableForeground(color),
    "--color-primary-hover-foreground": readableForeground(hover),
  };
}

/** Apply a committed or transient accent without writing the settings store. */
export function applyAccentColor(color: string): void {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(accentColorVars(color))) {
    root.style.setProperty(property, value);
  }
}
