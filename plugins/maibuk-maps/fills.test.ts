/**
 * The Maps Fills (#748): pouring one colour into a face, and keeping every
 * Fill on its face after an edit. Every test pours through `pourFill` and
 * reconciles through `reconcileFills` with real Map Lines, in page millimetres,
 * so the rules are the ones the editor runs.
 */

import { describe, expect, it } from "vitest";
import { type Face, deepestPoint, faceAt, findFaces, GAP_TOLERANCE_MM } from "./faces";
import { type MakeFill, pourFill, reconcileFills } from "./fills";
import {
  newLabel,
  type MapElement,
  type MapFillElement,
  type MapLineElement,
  type MapPoint,
} from "./maps";

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

/** A Fill maker that names each Fill in turn, the way the editor does. */
function fillMaker(prefix = "fill"): MakeFill {
  let count = 0;
  return (anchor, color) => {
    count++;
    return {
      id: `${prefix}-${count}`,
      kind: "fill",
      name: `Fill ${count}`,
      hidden: false,
      locked: false,
      anchor: [anchor[0], anchor[1]],
      content: { color },
    };
  };
}

/** The one Fill an array holds. */
function onlyFill(elements: readonly MapElement[]): MapFillElement {
  const fills = elements.filter((element): element is MapFillElement => element.kind === "fill");
  expect(fills).toHaveLength(1);
  return fills[0];
}

/** Every Fill an array holds, in array order. */
function fillsOf(elements: readonly MapElement[]): MapFillElement[] {
  return elements.filter((element): element is MapFillElement => element.kind === "fill");
}

/** The Map Lines an elements array holds. */
function linesOf(elements: readonly MapElement[]): MapLineElement[] {
  return elements.filter((element): element is MapLineElement => element.kind === "line");
}

/** The face a Fill's anchor lies in, from the elements the Fill is drawn over. */
function faceOf(elements: readonly MapElement[], fill: MapFillElement): Face | null {
  return faceAt(findFaces(linesOf(elements)), fill.anchor);
}

/** Whether a Fill sits on the deepest point of `face`. */
function expectAtDeepest(fill: MapFillElement, face: Face | null): void {
  if (face === null) throw new Error("the Fill's anchor lies in no face");
  const [x, y] = deepestPoint(face);
  expect(fill.anchor[0]).toBeCloseTo(x, 5);
  expect(fill.anchor[1]).toBeCloseTo(y, 5);
}

describe("pourFill", () => {
  it("pours one Fill into an enclosed face, at its deepest point, behind Map Lines, Stamps, and Map Labels", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const elements: MapElement[] = [
      { id: "image", kind: "image", name: "Scan", hidden: false, locked: false },
      {
        id: "older",
        kind: "fill",
        name: "Older Fill",
        hidden: false,
        locked: false,
        anchor: [200, 200],
        content: { color: "#000000" },
      },
      ring,
      {
        id: "stamp",
        kind: "stamp",
        name: "Castle",
        hidden: false,
        locked: false,
        stampRef: "base:marker",
        transform: { x: 20, y: 20, size: 12, rotation: 0 },
        color: "#1f2933",
      },
      newLabel({ id: "label", name: "The Reach", text: "The Reach", point: [20, 20] }),
    ];

    const poured = pourFill(elements, [10, 10], "#c8d5a3", fillMaker());

    expect(poured.map((element) => element.id)).toEqual([
      "image",
      "older",
      "fill-1",
      "ring",
      "stamp",
      "label",
    ]);
    const fill = poured[2] as MapFillElement;
    expectAtDeepest(fill, faceAt(findFaces([ring]), [10, 10]));
    expect(fill.content.color).toBe("#c8d5a3");
  });

  it("returns the same array when the point is outside every face", () => {
    const elements: MapElement[] = [rectangle("ring", 0, 0, 40, 40)];

    expect(pourFill(elements, [200, 200], "#c8d5a3", fillMaker())).toBe(elements);
  });

  it("replaces the colour of the Fill already in that face and adds no element", () => {
    const elements: MapElement[] = [rectangle("ring", 0, 0, 40, 40)];
    const poured = pourFill(elements, [10, 10], "#c8d5a3", fillMaker());
    const before = onlyFill(poured);

    const repoured = pourFill(poured, [30, 30], "#a0522d", fillMaker());

    expect(fillsOf(repoured)).toHaveLength(1);
    const fill = onlyFill(repoured);
    expect(fill.id).toBe(before.id);
    expect(fill.anchor).toEqual(before.anchor);
    expect(fill.content.color).toBe("#a0522d");
  });

  it("returns the same array for a pour of the colour the Fill already has", () => {
    const elements: MapElement[] = [rectangle("ring", 0, 0, 40, 40)];
    const poured = pourFill(elements, [10, 10], "#c8d5a3", fillMaker());

    expect(pourFill(poured, [30, 30], "#c8d5a3", fillMaker())).toBe(poured);
  });

  it("leaves a locked Fill its colour, as every other edit of a locked Element does", () => {
    const elements: MapElement[] = [rectangle("ring", 0, 0, 40, 40)];
    const poured = pourFill(elements, [10, 10], "#c8d5a3", fillMaker());
    const locked = poured.map((element) =>
      element.kind === "fill" ? { ...element, locked: true } : element
    );

    expect(pourFill(locked, [30, 30], "#a0522d", fillMaker())).toBe(locked);
  });
});

describe("reconcileFills", () => {
  it("follows a moved border, keeping each Fill at the deepest point of its own face and its colour", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const divider = line("divider", [
      [20, 0],
      [20, 40],
    ]);
    const maker = fillMaker();
    let elements: MapElement[] = [ring, divider];
    elements = pourFill(elements, [10, 20], "#c8d5a3", maker);
    elements = pourFill(elements, [30, 20], "#a0522d", maker);
    const before = elements;

    const after = elements.map((element) =>
      element.id === "divider" && element.kind === "line"
        ? {
            ...element,
            points: [
              [24, 0],
              [24, 40],
            ] as MapPoint[],
          }
        : element
    );

    const reconciled = reconcileFills(before, after);
    const fills = fillsOf(reconciled);

    expect(fills).toHaveLength(2);
    const faces = findFaces(linesOf(after));
    const left = faceAt(faces, [5, 20]);
    const right = faceAt(faces, [35, 20]);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    const colours = fills.map((fill) => fill.content.color).sort();
    expect(colours).toEqual(["#a0522d", "#c8d5a3"]);
    for (const fill of fills) expectAtDeepest(fill, faceAt(faces, fill.anchor));
    const land = fills.find((fill) => fill.content.color === "#c8d5a3");
    const sea = fills.find((fill) => fill.content.color === "#a0522d");
    expect(land?.anchor[0]).toBeLessThan(24);
    expect(sea?.anchor[0]).toBeGreaterThan(24);
  });

  it("merges two Fills whose dividing Map Line is removed, keeping the larger face's Fill", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const divider = line("divider", [
      [30, 0],
      [30, 40],
    ]);
    const maker = fillMaker();
    let elements: MapElement[] = [ring, divider];
    elements = pourFill(elements, [15, 20], "#c8d5a3", maker);
    elements = pourFill(elements, [35, 20], "#a0522d", maker);
    const before = elements;
    const snapshot = structuredClone(before);

    const after = elements.filter((element) => element.id !== "divider");
    const reconciled = reconcileFills(before, after);

    const fill = onlyFill(reconciled);
    expect(fill.content.color).toBe("#c8d5a3");
    expect(fill.id).toBe("fill-1");
    expect(fill.anchor[0]).toBeCloseTo(20, 1);
    expect(fill.anchor[1]).toBeCloseTo(20, 1);
    expect(before).toEqual(snapshot);
  });

  it("merges the same way when the shared border is opened wider than the gap tolerance", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const divider = line("divider", [
      [30, 0],
      [30, 40],
    ]);
    const maker = fillMaker();
    let elements: MapElement[] = [ring, divider];
    elements = pourFill(elements, [15, 20], "#c8d5a3", maker);
    elements = pourFill(elements, [35, 20], "#a0522d", maker);

    const after = elements.map((element) =>
      element.id === "divider" && element.kind === "line"
        ? {
            ...element,
            points: [
              [30, 0],
              [30, 40 - GAP_TOLERANCE_MM - 0.5],
            ] as MapPoint[],
          }
        : element
    );
    const reconciled = reconcileFills(elements, after);

    const fill = onlyFill(reconciled);
    expect(fill.content.color).toBe("#c8d5a3");
    expect(fill.anchor[0]).toBeCloseTo(20, 1);
  });

  it("does not merge when the shared border's gap stays inside the tolerance", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const divider = line("divider", [
      [30, 0],
      [30, 40],
    ]);
    const maker = fillMaker();
    let elements: MapElement[] = [ring, divider];
    elements = pourFill(elements, [15, 20], "#c8d5a3", maker);
    elements = pourFill(elements, [35, 20], "#a0522d", maker);

    const after = elements.map((element) =>
      element.id === "divider" && element.kind === "line"
        ? {
            ...element,
            points: [
              [30, 0],
              [30, 40 - GAP_TOLERANCE_MM + 0.5],
            ] as MapPoint[],
          }
        : element
    );
    const reconciled = reconcileFills(elements, after);

    const fills = fillsOf(reconciled);
    expect(fills).toHaveLength(2);
    expect(fills.map((fill) => fill.content.color).sort()).toEqual(["#a0522d", "#c8d5a3"]);
    for (const fill of fills) expect(faceOf(reconciled, fill)).not.toBeNull();
  });

  it("splits a filled face into two Fills of the same colour when a new enclosing Map Line crosses it", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const maker = fillMaker();
    const before = pourFill([ring], [20, 20], "#c8d5a3", maker);
    const original = onlyFill(before);
    const divider = line("divider", [
      [30, 0],
      [30, 40],
    ]);
    const after: MapElement[] = [...before, divider];

    const reconciled = reconcileFills(before, after);
    const fills = fillsOf(reconciled);

    expect(fills).toHaveLength(2);
    expect(fills.map((fill) => fill.content.color)).toEqual(["#c8d5a3", "#c8d5a3"]);
    expect(fills.map((fill) => fill.id).sort()).toEqual([original.id, `${original.id}-2`]);
    const faces = findFaces(linesOf(after));
    for (const fill of fills) expectAtDeepest(fill, faceAt(faces, fill.anchor));
    // The copy sits directly after the Fill it was copied from.
    const originalIndex = reconciled.findIndex((element) => element.id === original.id);
    expect(reconciled[originalIndex + 1]).toMatchObject({ id: `${original.id}-2` });
  });

  it("does not split a face with a Map Line that does not enclose Fills", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const maker = fillMaker();
    const before = pourFill([ring], [20, 20], "#c8d5a3", maker);
    const after: MapElement[] = [
      ...before,
      line(
        "crossing",
        [
          [30, 0],
          [30, 40],
        ],
        { enclosesFills: false }
      ),
    ];

    const reconciled = reconcileFills(before, after);

    expect(reconciled).toBe(after);
    expect(fillsOf(reconciled)).toHaveLength(1);
  });

  it("removes a Fill whose face disappears", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const maker = fillMaker();
    const before = pourFill([ring], [20, 20], "#c8d5a3", maker);
    const after = before.filter((element) => element.kind === "fill");

    const reconciled = reconcileFills(before, after);

    expect(fillsOf(reconciled)).toEqual([]);
  });

  it("leaves a face empty when the author deletes its Fill", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const before = pourFill([ring], [20, 20], "#c8d5a3", fillMaker());
    const after = before.filter((element) => element.kind !== "fill");

    const reconciled = reconcileFills(before, after);

    expect(reconciled).toBe(after);
  });

  it("returns the after array itself when an edit leaves every Fill where it was", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const maker = fillMaker();
    const elements = pourFill([ring], [20, 20], "#c8d5a3", maker);
    const original = onlyFill(elements);
    const after = elements.map((element) =>
      element.kind === "line" ? { ...element, name: "The Coast" } : element
    );

    const reconciled = reconcileFills(elements, after);

    expect(reconciled).toBe(after);
    expect(onlyFill(reconciled)).toBe(original);
  });

  it("returns the after array without computing faces when neither array holds a Fill", () => {
    const before: MapElement[] = [rectangle("ring", 0, 0, 40, 40)];
    const after: MapElement[] = [
      rectangle("ring", 0, 0, 40, 40),
      line("coast", [
        [0, 0],
        [10, 10],
      ]),
    ];

    expect(reconcileFills(before, after)).toBe(after);
  });
});

describe("reconcileFills after a move", () => {
  /** The Elements with one Map Line shifted by `dx`, `dy`, as `moveElement` shifts it. */
  function shifted(elements: MapElement[], id: string, dx: number, dy: number): MapElement[] {
    return elements.map((element) =>
      element.id === id && element.kind === "line"
        ? { ...element, points: element.points.map(([x, y]): MapPoint => [x + dx, y + dy]) }
        : element
    );
  }

  it("carries a Fill along with a closed Map Line moved further than its own size", () => {
    let elements: MapElement[] = [rectangle("ring", 10, 10, 30, 30)];
    elements = pourFill(elements, [20, 20], "#c8d5a3", fillMaker());
    const [poured] = fillsOf(elements);

    // 50 mm is more than the 20 mm square, so the old anchor lies outside it.
    const reconciled = reconcileFills(elements, shifted(elements, "ring", 50, 5), {
      dx: 50,
      dy: 5,
    });

    const fills = fillsOf(reconciled);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ id: poured.id, content: { color: "#c8d5a3" } });
    expect(fills[0].anchor[0]).toBeCloseTo(70, 5);
    expect(fills[0].anchor[1]).toBeCloseTo(25, 5);
  });

  it("carries a Fill however the faces round the moved corners", () => {
    // A drag lands on any offset, and faces are built from paths written to
    // the hundredth of a millimetre, so the moved ring is a rounding away.
    let elements: MapElement[] = [rectangle("ring", 94.3, 56.2, 134.3, 96.2)];
    elements = pourFill(elements, [114.3, 76.2], "#c8d5a3", fillMaker());

    const reconciled = reconcileFills(elements, shifted(elements, "ring", 30.004, -12.857), {
      dx: 30.004,
      dy: -12.857,
    });

    const fills = fillsOf(reconciled);
    expect(fills).toHaveLength(1);
    expect(fills[0].anchor[0]).toBeCloseTo(144.3, 1);
    expect(fills[0].anchor[1]).toBeCloseTo(63.34, 1);
  });

  it("keeps the land's Fill on the land when a lake is moved over the land's anchor", () => {
    let elements: MapElement[] = [
      rectangle("land", 10, 10, 190, 90),
      rectangle("lake", 20, 40, 40, 60),
    ];
    const maker = fillMaker();
    elements = pourFill(elements, [100, 20], "#c8d5a3", maker);
    elements = pourFill(elements, [30, 50], "#4a90c2", maker);
    const land = fillsOf(elements).find((fill) => fill.content.color === "#c8d5a3");
    if (land === undefined) throw new Error("no land Fill");
    // Centre the lake on the land Fill's anchor.
    const dx = land.anchor[0] - 30;
    const dy = land.anchor[1] - 50;

    const after = shifted(elements, "lake", dx, dy);
    const reconciled = reconcileFills(elements, after, { dx, dy });

    const fills = fillsOf(reconciled);
    expect(fills.map((fill) => fill.content.color).sort()).toEqual(["#4a90c2", "#c8d5a3"]);
    const faces = findFaces(linesOf(after));
    const lakeFace = faceAt(faces, [land.anchor[0], land.anchor[1]]);
    for (const fill of fills) expectAtDeepest(fill, faceAt(faces, fill.anchor));
    const lake = fills.find((fill) => fill.content.color === "#4a90c2");
    const movedLand = fills.find((fill) => fill.content.color === "#c8d5a3");
    expect(faceAt(faces, lake?.anchor ?? [0, 0])).toBe(lakeFace);
    expect(faceAt(faces, movedLand?.anchor ?? [0, 0])).not.toBe(lakeFace);
  });

  it("reshapes the Fills on both sides of a moved border just as without the offset", () => {
    const ring = rectangle("ring", 0, 0, 40, 40);
    const divider = line("divider", [
      [20, 0],
      [20, 40],
    ]);
    const maker = fillMaker();
    let elements: MapElement[] = [ring, divider];
    elements = pourFill(elements, [10, 20], "#c8d5a3", maker);
    elements = pourFill(elements, [30, 20], "#a0522d", maker);
    const after = shifted(elements, "divider", 4, 0);

    expect(reconcileFills(elements, after, { dx: 4, dy: 0 })).toEqual(
      reconcileFills(elements, after)
    );
  });
});

describe("Area Fills", () => {
  /** An Area Fill over a 20 mm square around `anchor`, with its own outline. */
  function areaFill(id: string, anchor: MapPoint = [10, 10]): MapFillElement {
    return {
      id,
      kind: "fill",
      name: id,
      hidden: false,
      locked: false,
      anchor,
      outline: {
        points: [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        curves: [false, false, false, false],
        roughened: false,
      },
      content: { color: "#c8d5a3" },
    };
  }

  it("leaves an Area Fill where it is when the Map Lines around it change", () => {
    const area = areaFill("forest");
    const before: MapElement[] = [rectangle("ring", 0, 0, 40, 40), area];
    const after: MapElement[] = [rectangle("ring", 0, 0, 60, 40), area];

    expect(reconcileFills(before, after)).toBe(after);
  });

  it("keeps an Area Fill whose anchor lies in no face", () => {
    const area = areaFill("forest", [200, 200]);
    const before: MapElement[] = [rectangle("ring", 0, 0, 40, 40)];

    expect(fillsOf(reconcileFills(before, [...before, area]))).toEqual([area]);
  });

  it("does not recolour an Area Fill whose anchor lies in a poured face", () => {
    const area = areaFill("forest", [20, 20]);
    const poured = pourFill(
      [rectangle("ring", 0, 0, 40, 40), area],
      [10, 10],
      "#a0522d",
      fillMaker()
    );

    const fills = fillsOf(poured);
    expect(fills).toHaveLength(2);
    expect(fills.find((fill) => fill.id === "forest")).toBe(area);
    expect(fills.find((fill) => fill.id === "fill-1")?.content.color).toBe("#a0522d");
  });

  it("does not split or merge an Area Fill when a Map Line crosses it", () => {
    const area = areaFill("forest");
    const ring = rectangle("ring", 0, 0, 40, 40);
    const before: MapElement[] = [ring, area];
    const after: MapElement[] = [
      ...before,
      line("divider", [
        [10, 0],
        [10, 40],
      ]),
    ];

    const reconciled = reconcileFills(before, after);

    expect(fillsOf(reconciled).map((fill) => fill.id)).toEqual(["forest"]);
    expect(fillsOf(reconciled)[0]).toBe(area);
  });
});
