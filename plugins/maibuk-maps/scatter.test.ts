/**
 * The Maps scatter (#750): the points a Fill scatters its Stamps on, sampled
 * over the whole page inside the area it covers and the same set for one seed
 * every time.
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

/** The page the tests scatter over, in millimetres. */
const PAGE_MM = 60;

describe("scatterPoints", () => {
  it("scatters points inside a closed ring", () => {
    const points = scatterPoints([square()], 8, 7, PAGE_MM, PAGE_MM);

    expect(points.length).toBeGreaterThan(4);
    for (const point of points) expect(inSquare(point)).toBe(true);
  });

  it("keeps the points off a hole cut out of the area", () => {
    const points = scatterPoints([square(), square(15, 10)], 5, 3, PAGE_MM, PAGE_MM);

    expect(points.length).toBeGreaterThan(4);
    for (const point of points) {
      expect(inSquare(point)).toBe(true);
      expect(inSquare(point, 15, 10)).toBe(false);
    }
    // The hole takes room the outer ring alone would have scattered into.
    expect(points.length).toBeLessThan(scatterPoints([square()], 5, 3, PAGE_MM, PAGE_MM).length);
  });

  it("scatters the same points for the same seed, in the same order", () => {
    expect(scatterPoints([square()], 6, 42, PAGE_MM, PAGE_MM)).toEqual(
      scatterPoints([square()], 6, 42, PAGE_MM, PAGE_MM)
    );
  });

  it("scatters a different set for a different seed", () => {
    expect(scatterPoints([square()], 6, 42, PAGE_MM, PAGE_MM)).not.toEqual(
      scatterPoints([square()], 6, 43, PAGE_MM, PAGE_MM)
    );
  });

  it("keeps a spot inside two overlapping areas at the same page point", () => {
    // Both areas are sampled in page space from the same seed, so a spot the
    // old and the new area both cover does not slide with the area.
    const before = scatterPoints([square(0)], 6, 9, PAGE_MM, PAGE_MM);
    const after = scatterPoints([square(10)], 6, 9, PAGE_MM, PAGE_MM);

    const shared = before.filter(([x, y]) => x > 10 && x < 40 && y > 10 && y < 40);
    expect(shared.length).toBeGreaterThan(0);
    for (const point of shared) expect(after).toContainEqual(point);
  });

  it("keeps the points no closer together than the spacing", () => {
    const points = scatterPoints([square(0, 60)], 7, 11, PAGE_MM, PAGE_MM);

    for (let one = 0; one < points.length; one++) {
      for (let two = one + 1; two < points.length; two++) {
        const gap = Math.hypot(points[one][0] - points[two][0], points[one][1] - points[two][1]);
        expect(gap).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("scatters nothing for an empty area, a ring with no area, or no spacing", () => {
    expect(scatterPoints([], 5, 1, PAGE_MM, PAGE_MM)).toEqual([]);
    expect(
      scatterPoints(
        [
          [
            [0, 0],
            [10, 0],
          ],
        ],
        5,
        1,
        PAGE_MM,
        PAGE_MM
      )
    ).toEqual([]);
    expect(scatterPoints([square()], 0, 1, PAGE_MM, PAGE_MM)).toEqual([]);
    expect(scatterPoints([square()], Number.NaN, 1, PAGE_MM, PAGE_MM)).toEqual([]);
    expect(scatterPoints([square()], 5, 1, 0, PAGE_MM)).toEqual([]);
  });
});
