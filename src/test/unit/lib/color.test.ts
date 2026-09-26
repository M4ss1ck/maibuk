import { describe, expect, it } from "vitest";
import { contrastRatio, readableForeground, normalizeHexColor } from "@/lib/color";

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
});
