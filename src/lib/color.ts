/** Normalize a CSS RGB hex color without changing the current value on invalid input. */
export function normalizeHexColor(input: string): string | null {
  const value = input.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(value)) return value;
  if (/^#[0-9A-F]{3}$/.test(value)) {
    const [red, green, blue] = value.slice(1);
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  return null;
}

function luminance(hex: string): number {
  const color = normalizeHexColor(hex);
  if (!color) return 0;
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** WCAG contrast ratio, from 1:1 through 21:1. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableForeground(background: string): "#000000" | "#FFFFFF" {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#FFFFFF")
    ? "#000000"
    : "#FFFFFF";
}
