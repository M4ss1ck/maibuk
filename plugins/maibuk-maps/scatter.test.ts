/**
 * The Maps scatter (#750): the points a Fill scatters its Stamps on, sampled
 * inside the area it covers and the same set for one seed every time.
 */

import { describe, expect, it } from "vitest";
import type { MapPoint } from "./maps";
import { scatterPoints } from "./scatter";

/** A square ring 40 mm a side, with its top-left corner at `origin`. */
function square(origin = 0, size = 40): MapPoint[] {
  return [
    [origin, origin],
    [origin + size, origin],
    [origin + size, origin + size],
    [origin, origin + size],
  ];
}

/** Whether a point lies inside the square `square()` draws, holes aside. */
function inSquare(point: MapPoint, origin = 0, size = 40): boolean {
  return (
    point[0] > origin && point[0] < origin + size && point[1] > origin && point[1] < origin + size
  );
}

describe("scatterPoints", () => {
  it("scatters points inside a closed ring", () => {
    const points = scatterPoints([square()], 8, 7);

    expect(points.length).toBeGreaterThan(4);
    for (const point of points) expect(inSquare(point)).toBe(true);
  });

  it("keeps the points off a hole cut out of the area", () => {
    const points = scatterPoints([square(), square(15, 10)], 5, 3);

    expect(points.length).toBeGreaterThan(4);
    for (const point of points) {
      expect(inSquare(point)).toBe(true);
      expect(inSquare(point, 15, 10)).toBe(false);
    }
    // The hole takes room the outer ring alone would have scattered into.
    expect(points.length).toBeLessThan(scatterPoints([square()], 5, 3).length);
  });

  it("scatters the same points for the same seed, in the same order", () => {
    expect(scatterPoints([square()], 6, 42)).toEqual(scatterPoints([square()], 6, 42));
  });

  it("scatters a different set for a different seed", () => {
    expect(scatterPoints([square()], 6, 42)).not.toEqual(scatterPoints([square()], 6, 43));
  });

  it("keeps the points no closer together than the spacing", () => {
    const points = scatterPoints([square(0, 60)], 7, 11);

    for (let one = 0; one < points.length; one++) {
      for (let two = one + 1; two < points.length; two++) {
        const gap = Math.hypot(points[one][0] - points[two][0], points[one][1] - points[two][1]);
        expect(gap).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("scatters nothing for an empty area, a ring with no area, or no spacing", () => {
    expect(scatterPoints([], 5, 1)).toEqual([]);
    expect(
      scatterPoints(
        [
          [
            [0, 0],
            [10, 0],
          ],
        ],
        5,
        1
      )
    ).toEqual([]);
    expect(scatterPoints([square()], 0, 1)).toEqual([]);
    expect(scatterPoints([square()], Number.NaN, 1)).toEqual([]);
  });
});
