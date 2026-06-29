import { describe, expect, it, vi } from "vitest";
import {
  CHARSET,
  FALLBACK_RGB,
  cellIntensity,
  hexToRgb,
  parseArt,
  randomGlyph,
} from "@/components/settings/asciiBanner.helpers";

describe("hexToRgb()", () => {
  it("parses a standard 6-digit hex", () => {
    // Brand gold, the field's default tint.
    expect(hexToRgb("#F4AC1C")).toEqual({ r: 244, g: 172, b: 28 });
  });

  it("accepts a hex without the leading #", () => {
    expect(hexToRgb("ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("expands 3-digit shorthand", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("trims surrounding whitespace", () => {
    expect(hexToRgb("  #000000  ")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("falls back to brand gold for malformed input", () => {
    for (const bad of ["", "#xyz", "nothex", "#12", "#1234567"]) {
      expect(hexToRgb(bad)).toEqual(FALLBACK_RGB);
    }
    expect(FALLBACK_RGB).toEqual({ r: 244, g: 172, b: 28 });
  });
});

describe("parseArt()", () => {
  it("strips leading and trailing blank lines", () => {
    const grid = parseArt("\n\nAB\nC\n\n");
    expect(grid.rows).toBe(2);
  });

  it("pads every row to the widest line", () => {
    const grid = parseArt("AB\nC");
    expect(grid.cols).toBe(2);
    expect(grid.cells.every((row) => row.length === 2)).toBe(true);
    // The short row is padded with a space, which marks an empty field cell.
    expect(grid.cells[1]).toEqual(["C", " "]);
  });

  it("preserves interior spaces as their own cells", () => {
    const grid = parseArt("A B");
    expect(grid.cells[0]).toEqual(["A", " ", "B"]);
  });
});

describe("cellIntensity()", () => {
  it("peaks at the cursor and is zero at/after the radius", () => {
    expect(cellIntensity(0, 100)).toBe(1);
    expect(cellIntensity(100, 100)).toBe(0);
    expect(cellIntensity(150, 100)).toBe(0);
  });

  it("eases in (quadratic falloff)", () => {
    expect(cellIntensity(50, 100)).toBeCloseTo(0.25);
  });

  it("decreases monotonically with distance", () => {
    const a = cellIntensity(20, 100);
    const b = cellIntensity(40, 100);
    const c = cellIntensity(60, 100);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
});

describe("randomGlyph()", () => {
  it("always returns a single character from CHARSET", () => {
    const pool = new Set(CHARSET);
    for (let i = 0; i < 200; i++) {
      const glyph = randomGlyph();
      expect(glyph).toHaveLength(1);
      expect(pool.has(glyph)).toBe(true);
    }
  });

  it("maps the random range across the whole pool", () => {
    const first = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(randomGlyph()).toBe(CHARSET[0]);
    first.mockReturnValue(0.999999);
    expect(randomGlyph()).toBe(CHARSET[CHARSET.length - 1]);
    first.mockRestore();
  });

  it("includes the MAIBUK brand letters in the pool", () => {
    for (const ch of "MAIBUK") {
      expect(CHARSET).toContain(ch);
    }
  });
});
