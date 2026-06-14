// Pure helpers for AsciiBanner — no DOM, no canvas.

// ASCII-only mutation pool (kept to glyphs any monospace font covers, so the
// shimmer never renders tofu). The art's own block glyphs come from the art
// string, not from here.
export const CHARSET = "0123456789@#$%&*<>/\\|=+-MAIBUK".split("");

export interface Grid {
  rows: number;
  cols: number;
  cells: string[][]; // target glyph per [row][col]; " " marks an empty cell
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Brand gold, used as a fallback when the theme color can't be parsed. */
export const FALLBACK_RGB: Rgb = { r: 244, g: 172, b: 28 };

/** Parse a `#rrggbb`/`#rgb` color into rgb; fall back to brand gold. */
export function hexToRgb(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return FALLBACK_RGB;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Parse a figlet block into a padded rectangular grid. */
export function parseArt(art: string): Grid {
  const lines = art.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const cols = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const cells = lines.map((line) => line.padEnd(cols, " ").split(""));
  return { rows: cells.length, cols, cells };
}

/** Cursor-proximity falloff: 1 at the cursor, 0 at/after `radius`. */
export function cellIntensity(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t; // ease-in
}

/** A random glyph from the mutation pool. */
export function randomGlyph(): string {
  return CHARSET[(Math.random() * CHARSET.length) | 0];
}
