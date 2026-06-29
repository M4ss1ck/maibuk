import { describe, expect, it } from "vitest";
import {
  COVER_DIMENSIONS,
  DEFAULT_TEXT_STYLES,
  FONT_FAMILIES,
  PRESET_COLORS,
} from "@/features/covers/types";

describe("COVER_DIMENSIONS", () => {
  it("contains at least 4 entries", () => {
    expect(COVER_DIMENSIONS.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique ids", () => {
    const ids = COVER_DIMENSIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has positive width and height for every entry", () => {
    for (const dim of COVER_DIMENSIONS) {
      expect(dim.width).toBeGreaterThan(0);
      expect(dim.height).toBeGreaterThan(0);
    }
  });

  it("includes the standard 6x9 paperback", () => {
    const standard = COVER_DIMENSIONS.find((d) => d.id === "6x9");
    expect(standard).toBeDefined();
    expect(standard!.width).toBe(1800);
    expect(standard!.height).toBe(2700);
  });

  it("includes the Kindle format", () => {
    const kindle = COVER_DIMENSIONS.find((d) => d.id === "kindle");
    expect(kindle).toBeDefined();
    expect(kindle!.width).toBe(1600);
    expect(kindle!.height).toBe(2560);
  });
});

describe("DEFAULT_TEXT_STYLES", () => {
  it("defines title, subtitle, and author styles", () => {
    expect(DEFAULT_TEXT_STYLES).toHaveProperty("title");
    expect(DEFAULT_TEXT_STYLES).toHaveProperty("subtitle");
    expect(DEFAULT_TEXT_STYLES).toHaveProperty("author");
  });

  it("title style has bold weight and center alignment", () => {
    const { title } = DEFAULT_TEXT_STYLES;
    expect(title.fontWeight).toBe("bold");
    expect(title.textAlign).toBe("center");
    expect(title.fontSize).toBeGreaterThan(0);
  });

  it("subtitle style is italic", () => {
    expect(DEFAULT_TEXT_STYLES.subtitle.fontStyle).toBe("italic");
  });

  it("all styles have required properties", () => {
    for (const [, style] of Object.entries(DEFAULT_TEXT_STYLES)) {
      expect(style).toHaveProperty("fontFamily");
      expect(style).toHaveProperty("fontSize");
      expect(style).toHaveProperty("fontWeight");
      expect(style).toHaveProperty("fontStyle");
      expect(style).toHaveProperty("fill");
      expect(style).toHaveProperty("textAlign");
      expect(style).toHaveProperty("lineHeight");
    }
  });
});

describe("FONT_FAMILIES", () => {
  it("is a non-empty array of strings", () => {
    expect(FONT_FAMILIES.length).toBeGreaterThan(0);
    for (const font of FONT_FAMILIES) {
      expect(typeof font).toBe("string");
    }
  });

  it("includes Georgia and Arial", () => {
    expect(FONT_FAMILIES).toContain("Georgia");
    expect(FONT_FAMILIES).toContain("Arial");
  });
});

describe("PRESET_COLORS", () => {
  it("is a non-empty array", () => {
    expect(PRESET_COLORS.length).toBeGreaterThan(0);
  });

  it("all entries are valid hex color strings", () => {
    for (const color of PRESET_COLORS) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("includes black and white", () => {
    expect(PRESET_COLORS).toContain("#000000");
    expect(PRESET_COLORS).toContain("#ffffff");
  });
});
