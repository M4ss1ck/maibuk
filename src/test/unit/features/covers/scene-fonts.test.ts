import { describe, expect, it } from "vitest";
import { collectFonts } from "@/features/covers/scene/fonts";
import {
  createDefaultScene,
  createTextLayer,
  createShapeLayer,
} from "@/features/covers/scene/defaults";

describe("collectFonts", () => {
  it("returns an empty list for a scene with no text", () => {
    const s = createDefaultScene("6x9");
    s.layers.push(createShapeLayer({ shape: "rect", docWidth: 1800, docHeight: 2700 }));
    expect(collectFonts(s)).toEqual([]);
  });

  it("returns unique font families used by text layers", () => {
    const s = createDefaultScene("6x9");
    const a = createTextLayer({ role: "title", text: "A", docWidth: 1800, docHeight: 2700 });
    const b = createTextLayer({ role: "author", text: "B", docWidth: 1800, docHeight: 2700 });
    const c = createTextLayer({ role: "subtitle", text: "C", docWidth: 1800, docHeight: 2700 });
    b.font.family = a.font.family; // duplicate family
    s.layers.push(a, b, c);
    const fonts = collectFonts(s);
    expect(fonts).toContain(a.font.family);
    expect(fonts).toContain(c.font.family);
    expect(new Set(fonts).size).toBe(fonts.length);
  });
});
