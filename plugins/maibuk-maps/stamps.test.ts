/**
 * The Maps Stamps (#749): the built-in art a Stamp ref resolves to, and the
 * scale bar's maths, which picks the distance a bar can label in the room the
 * page leaves it.
 */

import { describe, expect, it } from "vitest";
import { BASE_STAMP_IDS, SCALE_BAR_STAMP_REF, scaleBarLayout, stampArt } from "./stamps";

describe("the base Stamp art", () => {
  it("lists its arts in order, the scale bar last", () => {
    expect(BASE_STAMP_IDS).toEqual(["marker", "scale-bar"]);
    expect(SCALE_BAR_STAMP_REF).toBe("base:scale-bar");
  });

  it("resolves a base ref to its art, and an unknown or foreign ref to nothing", () => {
    expect(stampArt("base:marker")?.id).toBe("marker");
    expect(stampArt(SCALE_BAR_STAMP_REF)?.id).toBe("scale-bar");
    expect(stampArt("base:nope")).toBeUndefined();
    expect(stampArt("marker")).toBeUndefined();
    expect(stampArt("custom:portrait")).toBeUndefined();
    expect(stampArt("")).toBeUndefined();
  });

  it("draws the marker as one path in the Stamp's own colour", () => {
    const marker = stampArt("base:marker");
    if (marker === undefined) throw new Error("the marker art is missing");

    expect(marker.viewBox).toEqual([0, 0, 10, 14]);
    expect(marker.parts).toHaveLength(1);
    expect(marker.parts[0].fill).toBeNull();
    expect(marker.parts[0].d).toMatch(/^M /);
    expect(marker.parts[0].d).toMatch(/ Z$/);
  });

  it("gives every base art a box with an area to scale", () => {
    for (const id of BASE_STAMP_IDS) {
      const art = stampArt(`base:${id}`);
      if (art === undefined) throw new Error(`the ${id} art is missing`);
      const [minX, minY, width, height] = art.viewBox;
      expect(Number.isFinite(minX)).toBe(true);
      expect(Number.isFinite(minY)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });
});

describe("scaleBarLayout", () => {
  it("labels the largest round distance that fits a 6x9 page", () => {
    // 152.4 mm of page stands for 1000 km, so 40 mm of bar can label 262 km;
    // the largest round number below that is 200 km, drawn 30.48 mm long.
    const layout = scaleBarLayout(152.4, 1000, 40);

    expect(layout.distance).toBe(200);
    expect(layout.lengthMm).toBeCloseTo(30.48, 6);
  });

  it("keeps the bar at the limit when a round distance lands exactly on it", () => {
    // 200 mm of page stands for 1000 km, so 40 mm of bar is exactly 200 km.
    expect(scaleBarLayout(200, 1000, 40)).toEqual({ distance: 200, lengthMm: 40 });
  });

  it("steps down to a fraction of a kilometre for a tiny span", () => {
    const layout = scaleBarLayout(152.4, 0.001, 40);

    expect(layout.distance).toBeCloseTo(0.0002, 12);
    expect(layout.lengthMm).toBeCloseTo(30.48, 6);
  });

  it("steps up past a million for a huge span", () => {
    const layout = scaleBarLayout(152.4, 1_000_000_000, 40);

    expect(layout.distance).toBe(200_000_000);
    expect(layout.lengthMm).toBeCloseTo(30.48, 6);
  });

  it("reads nothing from a page, span, or length with no room", () => {
    expect(scaleBarLayout(0, 1000, 40)).toEqual({ distance: 0, lengthMm: 0 });
    expect(scaleBarLayout(152.4, 0, 40)).toEqual({ distance: 0, lengthMm: 0 });
    expect(scaleBarLayout(152.4, 1000, 0)).toEqual({ distance: 0, lengthMm: 0 });
    expect(scaleBarLayout(Number.NaN, 1000, 40)).toEqual({ distance: 0, lengthMm: 0 });
  });
});
