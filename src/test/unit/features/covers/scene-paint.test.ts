import { describe, expect, it } from "vitest";
import { linearGradientCoords, sortStops } from "@/features/covers/scene/paint";

describe("sortStops", () => {
  it("orders stops by offset ascending", () => {
    const sorted = sortStops([
      { offset: 1, color: "#fff" },
      { offset: 0, color: "#000" },
      { offset: 0.5, color: "#888" },
    ]);
    expect(sorted.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { offset: 1, color: "#fff" },
      { offset: 0, color: "#000" },
    ];
    sortStops(input);
    expect(input[0].offset).toBe(1);
  });
});

describe("linearGradientCoords", () => {
  it("0deg goes left-to-right across the width", () => {
    const c = linearGradientCoords(0, 100, 200);
    expect(c.x1).toBeCloseTo(0);
    expect(c.x2).toBeCloseTo(100);
    expect(c.y1).toBeCloseTo(100);
    expect(c.y2).toBeCloseTo(100);
  });

  it("90deg goes top-to-bottom across the height", () => {
    const c = linearGradientCoords(90, 100, 200);
    expect(c.x1).toBeCloseTo(50);
    expect(c.x2).toBeCloseTo(50);
    expect(c.y1).toBeCloseTo(0);
    expect(c.y2).toBeCloseTo(200);
  });
});
