/**
 * The Maps Fills (#748): pouring one colour into a face, and keeping every
 * Fill on its face after an edit. Every test pours through `pourFill` and
 * reconciles through `reconcileFills` with real Map Lines, in page millimetres,
 * so the rules are the ones the editor runs.
 */

import { describe, expect, it } from "vitest";
import { type Face, deepestPoint, faceAt, findFaces, GAP_TOLERANCE_MM } from "./faces";
import { type MakeFill, pourFill, reconcileFills } from "./fills";
import type { MapElement, MapFillElement, MapLineElement, MapPoint } from "./maps";

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
      { id: "label", kind: "label", name: "The Reach", hidden: false, locked: false },
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
