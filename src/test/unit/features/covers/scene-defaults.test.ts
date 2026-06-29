import { describe, expect, it } from "vitest";
import {
  PRESETS,
  FONT_FAMILIES,
  PRESET_COLORS,
  DEFAULT_FILTERS,
  createDefaultScene,
  createTextLayer,
  createShapeLayer,
} from "@/features/covers/scene/defaults";

describe("PRESETS", () => {
  it("has unique ids and positive dimensions", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PRESETS) {
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
    }
  });
  it("includes 6x9 and kindle", () => {
    expect(PRESETS.find((p) => p.id === "6x9")).toBeTruthy();
    expect(PRESETS.find((p) => p.id === "kindle")?.width).toBe(1600);
  });
});

describe("createDefaultScene", () => {
  it("builds a v1 scene with solid background and no layers", () => {
    const s = createDefaultScene("6x9");
    expect(s.schemaVersion).toBe(1);
    expect(s.doc.width).toBe(1800);
    expect(s.background.type).toBe("solid");
    expect(s.layers).toEqual([]);
  });
});

describe("createTextLayer", () => {
  it("creates a title layer with an id and centered text", () => {
    const l = createTextLayer({ role: "title", text: "Hi", docWidth: 1800, docHeight: 2700 });
    expect(l.type).toBe("text");
    expect(l.id).toMatch(/.+/);
    expect(l.text).toBe("Hi");
    expect(l.align).toBe("center");
  });
});

describe("createShapeLayer", () => {
  it("creates a centered rect with a solid fill", () => {
    const l = createShapeLayer({ shape: "rect", docWidth: 1800, docHeight: 2700 });
    expect(l.type).toBe("shape");
    expect(l.shape).toBe("rect");
    expect(l.fill.type).toBe("solid");
    expect(l.id).toMatch(/.+/);
    expect(l.width).toBeGreaterThan(0);
  });
});

describe("DEFAULT_FILTERS", () => {
  it("is a neutral (no-op) filter set", () => {
    expect(DEFAULT_FILTERS).toEqual({ brightness: 0, contrast: 0, saturation: 0, blur: 0 });
  });
});

describe("FONT_FAMILIES / PRESET_COLORS", () => {
  it("are non-empty", () => {
    expect(FONT_FAMILIES.length).toBeGreaterThan(3);
    expect(PRESET_COLORS.length).toBeGreaterThan(3);
  });
});
