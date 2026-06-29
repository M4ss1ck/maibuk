import { describe, expect, it } from "vitest";
import { strokeToPath } from "@/features/canvas/drawing/strokePath";

describe("strokeToPath", () => {
  it("builds a move + line path from points", () => {
    expect(
      strokeToPath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ])
    ).toBe("M 0 0 L 10 5");
  });

  it("returns an empty string for no points", () => {
    expect(strokeToPath([])).toBe("");
  });
});
