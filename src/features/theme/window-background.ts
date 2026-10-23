import { setWindowBackground } from "@/lib/platform";

/**
 * The `--color-background` the page is painting, as a lowercase `#rrggbb`, or
 * null when it is not a color this can report.
 */
export function normalizeWindowBackground(value: string): string | null {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    return digits.length === 3
      ? `#${[...digits].map((digit) => digit + digit).join("")}`
      : `#${digits}`;
  }
  const rgb = /^rgb\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*\)$/.exec(text);
  if (rgb) {
    const channels = rgb.slice(1, 4).map(Number);
    if (channels.every((channel) => channel <= 255)) {
      return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return null;
}

let lastReported: string | null = null;
// Reports go out one at a time: a fast light→dark→light toggle would otherwise
// let an older invoke land last and persist the wrong color.
let queue: Promise<void> = Promise.resolve();

/**
 * Report the resolved background to the desktop shell, which keeps it for the
 * window it creates hidden on the next launch (#624). Deduplicated per session
 * so a re-render does not write a file. No-op where the platform ignores it.
 */
export function syncWindowBackground(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--color-background");
  const color = normalizeWindowBackground(value);
  if (!color || color === lastReported) return;
  lastReported = color;
  queue = queue.then(() =>
    Promise.resolve(setWindowBackground(color)).catch(() => {
      // Losing the report only costs the next launch's first frame.
    })
  );
}

/** Drops the module state between tests. */
export function resetWindowBackgroundForTests(): void {
  lastReported = null;
  queue = Promise.resolve();
}
