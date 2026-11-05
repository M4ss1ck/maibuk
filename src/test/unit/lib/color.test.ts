import { afterEach, describe, expect, it } from "vitest";
import { contrastRatio, normalizeHexColor, readableForeground, readThemeColor } from "@/lib/color";

afterEach(() => {
  document.documentElement.style.removeProperty("--color-background");
});

describe("color choices", () => {
  it("accepts RGB hex input and rejects incomplete edits", () => {
    expect(normalizeHexColor(" #f50 ")).toBe("#FF5500");
    expect(normalizeHexColor("#aabbcc")).toBe("#AABBCC");
    expect(normalizeHexColor("#ff5")).toBe("#FFFF55");
    expect(normalizeHexColor("#12")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
  });

  it("uses WCAG contrast and chooses readable accent text", () => {
    expect(contrastRatio("#3B82F6", "#FFFFFF")).toBeCloseTo(3.678, 2);
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(readableForeground("#3B82F6")).toBe("#000000");
    expect(readableForeground("#1E3A8A")).toBe("#FFFFFF");
  });

  it("reads a theme token as it is drawn on the document root", () => {
    document.documentElement.style.setProperty("--color-background", "#fafaf9");
    expect(readThemeColor("--color-background")).toBe("#FAFAF9");
  });

  it("returns null for an unset or non-hex theme token", () => {
    expect(readThemeColor("--color-background")).toBeNull();
    document.documentElement.style.setProperty("--color-background", "rebeccapurple");
    expect(readThemeColor("--color-background")).toBeNull();
  });
});
