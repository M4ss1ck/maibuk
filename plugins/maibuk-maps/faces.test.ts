/**
 * The Maps faces (#748): the areas Map Lines enclose, which a Fill follows.
 * Every fact here is a value the editor can rely on: crossing and touching
 * lines bound the areas between them, a near-miss closes and a wider gap does
 * not, a line that does not enclose Fills is ignored, and the deepest point of
 * a face stays inside it. All real page millimetres.
 */

import { describe, expect, it } from "vitest";
import { deepestPoint, faceAt, findFaces, GAP_TOLERANCE_MM, nodeLines } from "./faces";
import { shapeOutline } from "./geometry";
import type { MapLineElement, MapPoint, MapShape } from "./maps";

/** A Map Line that encloses Fills, which is what a face is built from. */
function line(
  id: string,
  points: MapPoint[],
  overrides: Partial<MapLineElement> = {}
): MapLineElement {
  return {
    id,
    kind: "line",
    name: id,
    hidden: false,
    locked: false,
    points,
    style: "plain",
    enclosesFills: true,
    closed: false,
    curves: points.map(() => false),
    roughened: false,
    ...overrides,
  };
}

/** A closed rectangle, drawn corner by corner. */
function rectangle(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  overrides: Partial<MapLineElement> = {}
): MapLineElement {
  return line(
    id,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    { closed: true, ...overrides }
  );
}

/** The faces' areas in whole square millimetres, smallest first, for exact comparisons. */
function areas(faces: ReturnType<typeof findFaces>): number[] {
  return faces.map((face) => Math.round(face.area)).sort((one, two) => one - two);
}

/** The one face with about `areaMm2` square millimetres. */
function faceOfArea(faces: ReturnType<typeof findFaces>, areaMm2: number) {
  const found = faces.find((face) => Math.abs(face.area - areaMm2) < 1);
  if (found === undefined) throw new Error(`no face of ${areaMm2} mm2`);
  return found;
}

describe("nodeLines", () => {
  it("splits two crossing lines into four segments that meet at the crossing", () => {
    const segments = nodeLines([
      line("one", [
        [0, 0],
        [40, 40],
      ]),
      line("two", [
        [0, 40],
        [40, 0],
      ]),
    ]);

    expect(segments).toHaveLength(4);
    const atCrossing = segments.filter(([a, b]) =>
      [a, b].some((point) => point[0] === 20 && point[1] === 20)
    );
    expect(atCrossing).toHaveLength(4);
  });

  it("snaps an almost closed line shut and leaves a wider gap alone", () => {
    const almost = nodeLines([
      line("ring", [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
        [0, 1],
      ]),
    ]);
    expect(almost).toHaveLength(4);
    expect(almost.flat().some((point) => point[0] === 0 && point[1] === 1)).toBe(false);

    const wider = nodeLines([
      line("ring", [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
        [0, 5],
      ]),
    ]);
    expect(wider.flat().some((point) => point[0] === 0 && point[1] === 5)).toBe(true);
  });

  it("drops a repeated point instead of keeping a zero length segment", () => {
    const segments = nodeLines([
      line(
        "ring",
        [
          [0, 0],
          [40, 0],
          [40, 0],
          [40, 40],
          [0, 40],
        ],
        { closed: true }
      ),
    ]);
    expect(segments).toHaveLength(4);
  });

  it("leaves out a line that does not enclose Fills", () => {
    expect(nodeLines([rectangle("ring", 0, 0, 40, 40, { enclosesFills: false })])).toEqual([]);
  });
});

describe("findFaces crossing", () => {
  it("gives three faces where two closed rectangles overlap", () => {
    const faces = findFaces([rectangle("one", 0, 0, 40, 40), rectangle("two", 20, 20, 60, 60)]);

    // The two arms of each rectangle, and the corner both share.
    expect(areas(faces)).toEqual([400, 1200, 1200]);
  });

  it("gives no face where two open lines cross", () => {
    const faces = findFaces([
      line("one", [
        [0, 0],
        [40, 40],
      ]),
      line("two", [
        [0, 40],
        [40, 0],
      ]),
    ]);

    expect(faces).toEqual([]);
  });
});

describe("findFaces touching", () => {
  it("gives two faces where two rectangles share an edge", () => {
    const faces = findFaces([rectangle("one", 0, 0, 40, 40), rectangle("two", 40, 0, 80, 40)]);

    expect(areas(faces)).toEqual([1600, 1600]);
  });

  it("splits the face a line crosses when its ends touch the lines around it", () => {
    const faces = findFaces([
      rectangle("ring", 0, 0, 40, 40),
      line("divider", [
        [20, 0],
        [20, 40],
      ]),
    ]);

    expect(areas(faces)).toEqual([800, 800]);
  });
});

describe("findFaces degenerate", () => {
  it("gives no face for the ring an island's own lines tile exactly", () => {
    // The sea, and an island inside it that one divider splits in two. The
    // island's ring comes back beside the two faces the divider makes of it,
    // and its interior is exactly those two: it covers no ground of its own, so
    // a Fill poured there would fight the one in the province beside it.
    const faces = findFaces([
      rectangle("sea", 0, 0, 100, 100),
      rectangle("island", 20, 20, 60, 60),
      line("divider", [
        [40, 20],
        [40, 60],
      ]),
    ]);

    expect(areas(faces)).toEqual([800, 800, 8400]);
  });
});

describe("findFaces nested", () => {
  const faces = findFaces([rectangle("outer", 0, 0, 60, 60), rectangle("inner", 20, 20, 40, 40)]);

  it("gives the inner face and the outer one with the inner as its hole", () => {
    expect(areas(faces)).toEqual([400, 3200]);
    expect(faceOfArea(faces, 3200).holes).toHaveLength(1);
    expect(faceOfArea(faces, 400).holes).toEqual([]);
  });

  it("answers with the outer face in the ring and the inner face in the middle", () => {
    expect(faceAt(faces, [30, 10])).toBe(faceOfArea(faces, 3200));
    expect(faceAt(faces, [30, 30])).toBe(faceOfArea(faces, 400));
  });
});

describe("findFaces gap tolerance", () => {
  /** A square whose last corner stops `gapMm` short of closing it. */
  function almostClosed(gapMm: number): MapLineElement {
    return line("ring", [
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
      [0, gapMm],
    ]);
  }

  it("closes a one millimetre gap into one face", () => {
    expect(GAP_TOLERANCE_MM).toBe(2);
    expect(areas(findFaces([almostClosed(1)]))).toEqual([1600]);
  });

  it("leaves a five millimetre gap open", () => {
    expect(findFaces([almostClosed(5)])).toEqual([]);
  });

  it("takes the tolerance it is given", () => {
    expect(areas(findFaces([almostClosed(5)], 6))).toEqual([1600]);
  });

  it("leaves ends that already meet at a junction where they are, beside a nearer line", () => {
    // Three borders meet exactly at (20, 20); a fourth line passes 1 mm away.
    // Snapping the junction ends onto it would bend the upright border and
    // move area between the faces above.
    const faces = findFaces([
      rectangle("box", 0, 0, 40, 40),
      line("west", [
        [0, 20],
        [20, 20],
      ]),
      line("east", [
        [20, 20],
        [40, 20],
      ]),
      line("north", [
        [20, 20],
        [20, 40],
      ]),
      line("near", [
        [21, 0],
        [21, 40],
      ]),
    ]);
    expect(areas(faces)).toEqual([20, 380, 380, 400, 420]);
  });

  it("does not close a short line onto itself when both its ends meet other lines", () => {
    // A border cutting a corner off the box: its ends are under 2 mm apart,
    // but each one already lies on the box.
    const faces = findFaces([
      rectangle("box", 0, 0, 40, 40),
      line("corner", [
        [1.4, 0],
        [0, 1.4],
      ]),
    ]);
    expect(faces).toHaveLength(2);
  });
});

describe("findFaces and Encloses Fills", () => {
  it("does not split a face with a line that does not enclose Fills", () => {
    const faces = findFaces([
      rectangle("ring", 0, 0, 40, 40),
      line(
        "crossing",
        [
          [20, -10],
          [20, 50],
        ],
        { enclosesFills: false }
      ),
    ]);

    expect(areas(faces)).toEqual([1600]);
  });
});

describe("findFaces curved lines and Shapes", () => {
  it("follows the curve of a closed line rather than its corners", () => {
    const centre: MapPoint = [50, 50];
    const radius = 20;
    const points: MapPoint[] = Array.from({ length: 8 }, (_sample, index): MapPoint => {
      const angle = (2 * Math.PI * index) / 8;
      return [centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)];
    });
    const faces = findFaces([
      line("blob", points, { closed: true, curves: points.map(() => true) }),
    ]);

    expect(faces).toHaveLength(1);
    const circle = Math.PI * radius * radius;
    // A straight 8-gon would cover 1131 mm2; the drawn curve stays on the circle.
    expect(faces[0].area).toBeGreaterThan(1200);
    expect(Math.abs(faces[0].area - circle) / circle).toBeLessThan(0.02);
  });

  it("gives an exact ellipse Shape the area of its ellipse", () => {
    const shape: MapShape = {
      kind: "ellipse",
      cx: 100,
      cy: 60,
      width: 40,
      height: 20,
      rotation: 0,
      sides: 6,
      cornerRadius: 0,
    };
    const outline = shapeOutline(shape);
    const faces = findFaces([
      line("ellipse", outline.points, {
        closed: true,
        curves: outline.curves,
        shape,
      }),
    ]);

    expect(faces).toHaveLength(1);
    const ellipse = Math.PI * 20 * 10;
    expect(Math.abs(faces[0].area - ellipse) / ellipse).toBeLessThan(0.01);
  });
});

describe("faceAt", () => {
  it("returns null outside every face", () => {
    const faces = findFaces([rectangle("ring", 0, 0, 40, 40)]);

    expect(faces).toHaveLength(1);
    expect(faceAt(faces, [200, 200])).toBeNull();
  });
});

describe("deepestPoint", () => {
  it("is the centre of a rectangle", () => {
    const faces = findFaces([rectangle("ring", 0, 0, 40, 40)]);
    const [x, y] = deepestPoint(faces[0]);

    expect(x).toBeCloseTo(20, 1);
    expect(y).toBeCloseTo(20, 1);
  });

  it("lies inside an L shaped face and away from its missing corner", () => {
    const faces = findFaces([
      line(
        "l",
        [
          [0, 0],
          [40, 0],
          [40, 15],
          [15, 15],
          [15, 40],
          [0, 40],
        ],
        { closed: true }
      ),
    ]);
    const point = deepestPoint(faces[0]);

    expect(faceAt(faces, point)).toBe(faces[0]);
    expect(point[0] > 15 && point[1] > 15).toBe(false);
  });

  it("stays out of the hole of a face that has one", () => {
    const faces = findFaces([rectangle("outer", 0, 0, 60, 60), rectangle("inner", 20, 20, 40, 40)]);
    const outer = faceOfArea(faces, 3200);
    const point = deepestPoint(outer);
    const inHole = point[0] > 20 && point[0] < 40 && point[1] > 20 && point[1] < 40;

    expect(inHole).toBe(false);
    expect(faceAt(faces, point)).toBe(outer);
  });
});
