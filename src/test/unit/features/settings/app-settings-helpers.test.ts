import { describe, expect, it } from "vitest";

/**
 * Tests for the pure helper functions in AppSettingsProvider.
 * Since hexToRgb, rgbToHex, and darken are not exported, we replicate them
 * here to verify the logic. If the project ever extracts these as shared
 * utils, switch to direct imports.
 */

// Replicated from src/features/settings/AppSettingsProvider.tsx
function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const safeHex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : normalized;

  const r = Number.parseInt(safeHex.slice(0, 2), 16);
  const g = Number.parseInt(safeHex.slice(2, 4), 16);
  const b = Number.parseInt(safeHex.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`.toUpperCase();
}

function darken(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

describe("hexToRgb()", () => {
  it("parses a standard 6-digit hex", () => {
    expect(hexToRgb("#3B82F6")).toEqual({ r: 59, g: 130, b: 246 });
  });

  it("parses hex without # prefix", () => {
    expect(hexToRgb("FF0000")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("expands 3-digit shorthand hex", () => {
    expect(hexToRgb("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#F00")).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe("rgbToHex()", () => {
  it("converts RGB to uppercase hex", () => {
    expect(rgbToHex(255, 0, 0)).toBe("#FF0000");
    expect(rgbToHex(0, 255, 0)).toBe("#00FF00");
    expect(rgbToHex(0, 0, 255)).toBe("#0000FF");
  });

  it("pads single-digit hex values", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(1, 2, 3)).toBe("#010203");
  });

  it("clamps values outside 0-255", () => {
    expect(rgbToHex(300, -10, 128)).toBe("#FF0080");
  });
});

describe("darken()", () => {
  it("returns the same color when amount is 0", () => {
    expect(darken("#FF0000", 0)).toBe("#FF0000");
  });

  it("returns black when amount is 1", () => {
    expect(darken("#FF8040", 1)).toBe("#000000");
  });

  it("darkens a color by the given fraction", () => {
    // #FFFFFF darkened by 0.5 → each channel: 255 * 0.5 = 127.5 → 128
    const result = darken("#FFFFFF", 0.5);
    expect(result).toBe("#808080");
  });

  it("darkens primary blue by 12%", () => {
    // This is the exact use case in AppSettingsProvider
    const result = darken("#3B82F6", 0.12);

    // Each channel: 59*0.88=51.92→52, 130*0.88=114.4→114, 246*0.88=216.48→216
    expect(result).toBe("#3472D8");
  });
});
