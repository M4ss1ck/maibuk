/**
 * The Maps geometry (#746, #747): the Eraser's split of a Map Line, the Roughen
 * pass that gives a line the rough ink look, and the outline an exact Shape
 * draws. All pure, so every fact here is a value the editor can rely on: a cut
 * leaves two lines where there was one, a closed line opened at the cut, the
 * same seed always roughens the same way, and a Shape's outline is a function of
 * its numbers alone.
 */

import { describe, expect, it } from "vitest";
import {
  convertShapeLine,
  eraseLines,
  roughen,
  seedFor,
  shapeFromCorners,
  shapeOutline,
} from "./geometry";
import {
  DEFAULT_POLYGON_SIDES,
  MIN_SHAPE_SIZE_MM,
  type MapLineElement,
  type MapPoint,
  type MapShape,
} from "./maps";

/** A straight segment's length, for spacing assertions. */
function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** A Shape to vary: an ellipse 40 by 20 mm centred on (100, 50). */
function shape(overrides: Partial<MapShape> = {}): MapShape {
  return {
    kind: "ellipse",
    cx: 100,
    cy: 50,
    width: 40,
    height: 20,
    rotation: 0,
    sides: DEFAULT_POLYGON_SIDES,
    cornerRadius: 0,
    ...overrides,
  };
}

/** A Map Line that carries a Shape: the outline its numbers draw. */
function shapeLine(overrides: Partial<MapLineElement> = {}): MapLineElement {
  const exact = shape(overrides.shape);
  const outline = shapeOutline(exact);
  return {
    id: "shape-1",
    kind: "line",
    name: "Ellipse 1",
    hidden: false,
    locked: false,
    points: outline.points,
    style: "plain",
    enclosesFills: true,
    closed: true,
    curves: outline.curves,
    roughened: false,
    shape: exact,
    ...overrides,
  };
}

describe("seedFor", () => {
  it("gives the same id the same number and different ids different ones", () => {
    expect(seedFor("line-1")).toBe(seedFor("line-1"));
    expect(seedFor("line-1")).not.toBe(seedFor("line-2"));
  });

  it("returns a non-negative integer a noise seed accepts", () => {
    for (const id of ["", "a", "coast-42", "é", "0"]) {
      const seed = seedFor(id);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("eraseLines", () => {
  it("leaves a line the eraser never reaches alone", () => {
    const line = {
      points: [
        [0, 0],
        [10, 0],
      ] as MapPoint[],
      curves: [true],
      closed: false,
    };
    expect(eraseLines(line, [[40, 40]], 2)).toBeNull();
    expect(
      eraseLines(
        line,
        [
          [40, 40],
          [50, 50],
        ],
        2
      )
    ).toBeNull();
  });

  it("splits an open line into two where the eraser crosses it", () => {
    const pieces = eraseLines(
      {
        points: [
          [0, 0],
          [20, 0],
        ],
        curves: [true],
        closed: false,
      },
      [
        [10, -5],
        [10, 5],
      ],
      1
    );

    expect(pieces).not.toBeNull();
    expect(pieces).toHaveLength(2);
    const [first, second] = pieces as NonNullable<typeof pieces>;
    expect(first.points).toHaveLength(2);
    expect(first.points[0]).toEqual([0, 0]);
    expect(first.points[1][0]).toBeCloseTo(9, 1);
    expect(first.points[1][1]).toBeCloseTo(0, 5);
    expect(second.points).toHaveLength(2);
    expect(second.points[0][0]).toBeCloseTo(11, 1);
    expect(second.points[1]).toEqual([20, 0]);
    expect(first.closed).toBe(false);
    expect(second.closed).toBe(false);
    expect(first.curves).toEqual([false]);
    expect(second.curves).toEqual([false]);
  });

  it("opens a closed line into one piece that starts just after the cut", () => {
    const pieces = eraseLines(
      {
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        curves: [true, true, true, true],
        closed: true,
      },
      [
        [5, 5],
        [15, 5],
      ],
      1
    );

    expect(pieces).not.toBeNull();
    expect(pieces).toHaveLength(1);
    const [piece] = pieces as NonNullable<typeof pieces>;
    expect(piece.closed).toBe(false);
    expect(piece.points).toHaveLength(6);
    expect(piece.points[0][0]).toBeCloseTo(10, 1);
    expect(piece.points[0][1]).toBeCloseTo(6, 1);
    expect(piece.points.slice(1, 5)).toEqual([
      [10, 10],
      [0, 10],
      [0, 0],
      [10, 0],
    ]);
    expect(piece.points[5][0]).toBeCloseTo(10, 1);
    expect(piece.points[5][1]).toBeCloseTo(4, 1);
    expect(piece.curves).toEqual([false, true, true, true, false]);
  });

  it("drops a line the eraser covers whole", () => {
    expect(
      eraseLines(
        {
          points: [
            [0, 0],
            [2, 0],
          ],
          curves: [true],
          closed: false,
        },
        [
          [1, -1],
          [1, 1],
        ],
        5
      )
    ).toEqual([]);
  });

  it("keeps an untouched segment's curve flag and straightens a cut one", () => {
    const pieces = eraseLines(
      {
        points: [
          [0, 0],
          [10, 0],
          [20, 0],
        ],
        curves: [true, true],
        closed: false,
      },
      [
        [15, -2],
        [15, 2],
      ],
      1
    );

    expect(pieces).toHaveLength(2);
    const [first, second] = pieces as NonNullable<typeof pieces>;
    expect(first.points).toHaveLength(3);
    expect(first.points[0]).toEqual([0, 0]);
    expect(first.points[1]).toEqual([10, 0]);
    expect(first.curves).toEqual([true, false]);
    expect(second.points[0][0]).toBeCloseTo(16, 1);
    expect(second.points[1]).toEqual([20, 0]);
    expect(second.curves).toEqual([false]);
  });

  it("cuts where the eraser path bends, not only on one straight pass", () => {
    const pieces = eraseLines(
      {
        points: [
          [0, 0],
          [20, 0],
        ],
        curves: [false],
        closed: false,
      },
      [
        [4, -6],
        [4, 0],
        [4, 6],
      ],
      1
    );

    expect(pieces).toHaveLength(2);
    const [first, second] = pieces as NonNullable<typeof pieces>;
    expect(first.points[1][0]).toBeCloseTo(3, 1);
    expect(second.points[0][0]).toBeCloseTo(5, 1);
  });
});

describe("roughen", () => {
  it("returns a line of fewer than two points unchanged", () => {
    expect(roughen([[1, 2]], false, 3, 7)).toEqual([[1, 2]]);
    expect(roughen([], true, 3, 7)).toEqual([]);
  });

  it("keeps both ends of an open line exactly where they are", () => {
    const roughened = roughen(
      [
        [0, 0],
        [10, 0],
      ],
      false,
      2,
      seedFor("coast")
    );
    expect(roughened[0]).toEqual([0, 0]);
    expect(roughened[roughened.length - 1]).toEqual([10, 0]);
  });

  it("resamples at about one millimetre and moves the points in between", () => {
    const roughened = roughen(
      [
        [0, 0],
        [10, 0],
      ],
      false,
      2,
      seedFor("coast")
    );
    expect(roughened).toHaveLength(11);
    for (let index = 1; index < roughened.length; index++) {
      expect(distance(roughened[index - 1], roughened[index])).toBeLessThan(1.6);
    }
    const moved = roughened.slice(1, -1).filter(([, y]) => Math.abs(y) > 0.01);
    expect(moved.length).toBeGreaterThan(0);
  });

  it("keeps every original point, in order", () => {
    const roughened = roughen(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
      2,
      seedFor("river")
    );
    expect(roughened[0]).toEqual([0, 0]);
    expect(roughened[roughened.length - 1]).toEqual([10, 10]);
    const corner = roughened.findIndex(([x, y]) => x === 10 && y === 0);
    expect(corner).toBeGreaterThan(0);
    expect(corner).toBeLessThan(roughened.length - 1);
  });

  it("keeps a closed line closed, with no duplicated end point", () => {
    const roughened = roughen(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      true,
      2,
      seedFor("border")
    );
    expect(roughened[0]).toEqual([0, 0]);
    expect(roughened[roughened.length - 1]).not.toEqual([0, 0]);
    // The seam joins the last point back to the first, so it stays a short step.
    expect(distance(roughened[roughened.length - 1], roughened[0])).toBeLessThan(1.6);
  });

  it("is deterministic for a seed and different for another", () => {
    const points: MapPoint[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const seed = seedFor("road");
    expect(roughen(points, false, 1.5, seed)).toEqual(roughen(points, false, 1.5, seed));
    expect(roughen(points, false, 1.5, seed)).not.toEqual(roughen(points, false, 1.5, seed + 1));
  });

  it("leaves the points on their chord when the strength is zero", () => {
    for (const [, y] of roughen(
      [
        [0, 0],
        [10, 0],
      ],
      false,
      0,
      3
    )) {
      expect(y).toBeCloseTo(0, 10);
    }
  });

  it("survives a JSON round trip", () => {
    const roughened = roughen(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
      2,
      seedFor("plain")
    );
    expect(JSON.parse(JSON.stringify(roughened))).toEqual(roughened);
  });
});

describe("shapeOutline", () => {
  it("samples an ellipse into 64 straight segments, the first at the top", () => {
    const outline = shapeOutline(shape());

    expect(outline.points).toHaveLength(64);
    expect(outline.curves).toEqual(Array.from({ length: 64 }, () => false));
    expect(outline.points[0][0]).toBeCloseTo(100, 10);
    expect(outline.points[0][1]).toBeCloseTo(40, 10);
    // The last sample is not the first one again: a closed line joins them itself.
    expect(outline.points[63]).not.toEqual(outline.points[0]);
    for (const [x, y] of outline.points) {
      expect(((x - 100) / 20) ** 2 + ((y - 50) / 10) ** 2).toBeCloseTo(1, 10);
    }
  });

  it("turns the whole outline about the centre", () => {
    const circle = shape({ height: 40 });
    const upright = shapeOutline(circle);
    const turned = shapeOutline({ ...circle, rotation: 90 });

    // The top point swings to the right side, and the left one to the top.
    expect(turned.points[0][0]).toBeCloseTo(120, 10);
    expect(turned.points[0][1]).toBeCloseTo(50, 10);
    expect(turned.points[16][0]).toBeCloseTo(100, 10);
    expect(turned.points[16][1]).toBeCloseTo(70, 10);
    expect(upright.points[16][0]).toBeCloseTo(120, 10);
    expect(turned.points[48][0]).toBeCloseTo(100, 10);
    expect(turned.points[48][1]).toBeCloseTo(30, 10);
    expect(upright.points[48][0]).toBeCloseTo(80, 10);
    // Every point keeps its distance from the centre.
    for (const [x, y] of turned.points) expect(distance([x, y], [100, 50])).toBeCloseTo(20, 10);
  });

  it("draws a rectangle's four corners, the first at the top left", () => {
    const outline = shapeOutline(shape({ kind: "rectangle", cornerRadius: 0 }));

    expect(outline.points).toEqual([
      [80, 40],
      [120, 40],
      [120, 60],
      [80, 60],
    ]);
    expect(outline.curves).toEqual([false, false, false, false]);
  });

  it("rounds a rectangle's corners into eight-point arcs", () => {
    const outline = shapeOutline(shape({ kind: "rectangle", cornerRadius: 5 }));

    expect(outline.points).toHaveLength(32);
    // The first corner's arc turns about a centre inset by the radius.
    for (const [x, y] of outline.points.slice(0, 8)) {
      expect(distance([x, y], [85, 45])).toBeCloseTo(5, 10);
    }
    // The sharp corner is gone, and every point stays inside the box.
    expect(outline.points.some(([x, y]) => x === 80 && y === 40)).toBe(false);
    for (const [x, y] of outline.points) {
      expect(x).toBeGreaterThanOrEqual(80);
      expect(x).toBeLessThanOrEqual(120);
      expect(y).toBeGreaterThanOrEqual(40);
      expect(y).toBeLessThanOrEqual(60);
    }
  });

  it("draws a regular polygon inscribed in its box, the first vertex at the top", () => {
    for (const sides of [3, 6, 12]) {
      const outline = shapeOutline(shape({ kind: "polygon", sides }));

      expect(outline.points).toHaveLength(sides);
      expect(outline.curves).toEqual(Array.from({ length: sides }, () => false));
      expect(outline.points[0][0]).toBeCloseTo(100, 10);
      expect(outline.points[0][1]).toBeCloseTo(40, 10);
      for (const [x, y] of outline.points) {
        expect(((x - 100) / 20) ** 2 + ((y - 50) / 10) ** 2).toBeCloseTo(1, 10);
      }
    }
  });
});

describe("shapeFromCorners", () => {
  it("builds the box a drag covers, with no rotation and no rounding", () => {
    expect(shapeFromCorners("rectangle", [10, 10], [50, 30], false)).toEqual({
      kind: "rectangle",
      cx: 30,
      cy: 20,
      width: 40,
      height: 20,
      rotation: 0,
      sides: DEFAULT_POLYGON_SIDES,
      cornerRadius: 0,
    });
  });

  it("squares the box on its longer side when constrained, the way the drag went", () => {
    const downRight = shapeFromCorners("ellipse", [10, 10], [50, 20], true);
    expect(downRight).toMatchObject({ cx: 30, cy: 30, width: 40, height: 40 });

    const upLeft = shapeFromCorners("ellipse", [50, 50], [10, 20], true);
    expect(upLeft).toMatchObject({ cx: 30, cy: 30, width: 40, height: 40 });
  });

  it("draws nothing when the drag is smaller than a millimetre", () => {
    expect(MIN_SHAPE_SIZE_MM).toBe(1);
    expect(shapeFromCorners("polygon", [10, 10], [10.5, 40], false)).toBeNull();
    expect(shapeFromCorners("polygon", [10, 10], [40, 10.5], false)).toBeNull();
    expect(shapeFromCorners("polygon", [10, 10], [11, 40], false)).not.toBeNull();
  });
});

describe("convertShapeLine", () => {
  it("drops the Shape, remembers what it was, and keeps the outline", () => {
    const line = shapeLine();
    const converted = convertShapeLine(line);

    expect(converted.shape).toBeUndefined();
    expect(converted.convertedFrom).toBe("ellipse");
    expect(converted.points).toEqual(line.points);
    expect(converted.curves).toEqual(line.curves);
    expect(line.shape).toEqual(shape());
  });

  it("leaves a line that never was a Shape exactly as it is", () => {
    const plain = shapeLine({
      shape: undefined,
      closed: false,
      points: [
        [0, 0],
        [10, 0],
      ],
    });
    expect(convertShapeLine(plain)).toBe(plain);
  });
});
