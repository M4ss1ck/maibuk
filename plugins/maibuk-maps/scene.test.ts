/**
 * The Maps scene (#745): smoothing a Pencil stroke, turning points into an SVG
 * path, serializing a whole Map to SVG for the Frame and the list preview, and
 * the immutable element operations the Elements list calls.
 */

import { describe, expect, it } from "vitest";
import { type MapDocument, type MapElement, type MapLineElement, type PagePreset } from "./maps";
import {
  EMPTY_MAP_COLOR,
  SMOOTH_TOLERANCE_MM,
  addElement,
  linePath,
  moveElement,
  removeElement,
  renameElement,
  reorder,
  sceneToSvg,
  setHidden,
  setLocked,
  smoothStroke,
} from "./scene";

function line(
  id: string,
  points: [number, number][],
  extra: Partial<MapLineElement> = {}
): MapLineElement {
  return { id, kind: "line", name: id, hidden: false, locked: false, points, ...extra };
}

function mapWith(
  elements: MapElement[],
  preset: PagePreset = "square"
): Pick<MapDocument, "page" | "elements"> {
  const page = {
    portrait: { widthMm: 152.4, heightMm: 228.6 },
    landscape: { widthMm: 228.6, heightMm: 152.4 },
    spread: { widthMm: 304.8, heightMm: 228.6 },
    square: { widthMm: 203.2, heightMm: 203.2 },
  }[preset];
  return { page: { preset, ...page }, elements };
}

describe("smoothStroke", () => {
  it("returns nothing for a click without movement", () => {
    expect(smoothStroke([])).toEqual([]);
    expect(smoothStroke([[5, 5]])).toEqual([]);
    expect(
      smoothStroke([
        [5, 5],
        [5, 5],
      ])
    ).toEqual([]);
  });

  it("drops consecutive near-duplicate points", () => {
    expect(
      smoothStroke([
        [0, 0],
        [0.01, 0.01],
        [10, 0],
      ])
    ).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("removes a point inside the tolerance but keeps one outside it", () => {
    const inside: [number, number][] = [
      [0, 0],
      [5, SMOOTH_TOLERANCE_MM - 0.05],
      [10, 0],
    ];
    const outside: [number, number][] = [
      [0, 0],
      [5, SMOOTH_TOLERANCE_MM + 0.05],
      [10, 0],
    ];
    expect(smoothStroke(inside)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(smoothStroke(outside)).toHaveLength(3);
  });

  it("simplifies a dense straight stroke to its endpoints", () => {
    const dense: [number, number][] = Array.from({ length: 50 }, (_, index) => [index, 0]);
    expect(smoothStroke(dense)).toEqual([
      [0, 0],
      [49, 0],
    ]);
  });

  it("keeps a two-point stroke as it is", () => {
    expect(
      smoothStroke([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("linePath", () => {
  it("draws a straight line through two points", () => {
    expect(
      linePath([
        [0, 0],
        [10, 5],
      ])
    ).toBe("M 0 0 L 10 5");
  });

  it("converts Catmull-Rom points to cubic Beziers and rounds to two decimals", () => {
    expect(
      linePath([
        [0, 0],
        [10, 10],
        [20, 0],
      ])
    ).toBe("M 0 0 C 1.67 1.67 6.67 10 10 10 C 13.33 10 18.33 1.67 20 0");
  });

  it("rounds the start point too", () => {
    expect(
      linePath([
        [0.1234, 0.5678],
        [10.9876, 20.4444],
      ])
    ).toBe("M 0.12 0.57 L 10.99 20.44");
  });

  it("has no path for fewer than two points", () => {
    expect(linePath([])).toBe("");
    expect(linePath([[1, 2]])).toBe("");
  });
});

describe("sceneToSvg", () => {
  it("writes a complete SVG with the Map page and its background", () => {
    const svg = sceneToSvg(mapWith([]));
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 203.2 203.2"')
    ).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`<rect width="203.2" height="203.2" fill="${EMPTY_MAP_COLOR}"/>`);
  });

  it("draws visible Map Lines in array order and omits hidden ones", () => {
    const svg = sceneToSvg(
      mapWith([
        line("below", [
          [0, 0],
          [10, 10],
        ]),
        line(
          "hidden",
          [
            [0, 10],
            [10, 0],
          ],
          { hidden: true }
        ),
        line("above", [
          [5, 0],
          [5, 20],
        ]),
      ])
    );
    expect(svg).not.toContain('data-element-id="hidden"');
    expect(svg.indexOf('data-element-id="below"')).toBeLessThan(
      svg.indexOf('data-element-id="above"')
    );
    expect(svg).toContain(
      '<path d="M 0 0 L 10 10" stroke="#1f2933" stroke-width="0.6" fill="none" stroke-linecap="round" stroke-linejoin="round" data-element-id="below"/>'
    );
  });

  it("XML-escapes an element id", () => {
    const svg = sceneToSvg(
      mapWith([
        line('a&"<', [
          [0, 0],
          [1, 1],
        ]),
      ])
    );
    expect(svg).toContain('data-element-id="a&amp;&quot;&lt;"');
  });

  it("marks the selected element", () => {
    const svg = sceneToSvg(
      mapWith([
        line("one", [
          [0, 0],
          [1, 1],
        ]),
        line("two", [
          [2, 2],
          [3, 3],
        ]),
      ]),
      { selectedId: "two" }
    );
    expect(svg).toContain('data-element-id="one"/>');
    expect(svg).toContain('data-element-id="two" data-selected="true"/>');
  });

  it("sets a pixel width and its proportional height", () => {
    const svg = sceneToSvg(mapWith([], "portrait"), { widthPx: 400 });
    expect(svg).toContain('width="400" height="600"');
    expect(svg).toContain('viewBox="0 0 152.4 228.6"');
  });

  it("ignores an element kind that has no geometry yet", () => {
    const svg = sceneToSvg(
      mapWith([{ id: "fill-1", kind: "fill", name: "Sea", hidden: false, locked: false }])
    );
    expect(svg).not.toContain("fill-1");
  });
});

describe("element operations", () => {
  const first = line("first", [
    [0, 0],
    [10, 10],
  ]);
  const second = line("second", [
    [20, 20],
    [30, 30],
  ]);

  it("moves a Map Line and leaves a locked one where it is", () => {
    const elements = [
      first,
      second,
      line(
        "locked",
        [
          [5, 5],
          [6, 6],
        ],
        { locked: true }
      ),
    ];
    const moved = moveElement(elements, "first", 3, -2);
    expect(moved).not.toBe(elements);
    expect(moved[0]).toEqual(
      line("first", [
        [3, -2],
        [13, 8],
      ])
    );
    expect(moved[2]).toBe(elements[2]);
    expect(moveElement(elements, "locked", 3, -2)[2]).toBe(elements[2]);
    expect(elements[0]).toBe(first);
  });

  it("reorders one step forward or backward, and stays put at the ends", () => {
    // "forward" walks toward the array's end, which is the top of the list.
    expect(reorder([first, second], "first", "forward").map((element) => element.id)).toEqual([
      "second",
      "first",
    ]);
    // "backward" walks toward the array's start, the bottom of the list.
    expect(reorder([first, second], "second", "backward").map((element) => element.id)).toEqual([
      "second",
      "first",
    ]);
    expect(reorder([first, second], "second", "forward").map((element) => element.id)).toEqual([
      "first",
      "second",
    ]);
    expect(reorder([first, second], "first", "backward").map((element) => element.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("adds on top, removes, renames, hides, and locks without mutating", () => {
    const elements = [first];
    const added = addElement(elements, second);
    expect(added.map((element) => element.id)).toEqual(["first", "second"]);
    expect(elements).toEqual([first]);
    expect(removeElement(added, "first")).toEqual([second]);
    expect(renameElement(added, "first", "Coast")).toMatchObject([
      { id: "first", name: "Coast" },
      { id: "second" },
    ]);
    expect(setHidden(added, "second", true)[1]).toMatchObject({ id: "second", hidden: true });
    expect(setLocked(added, "first", true)[0]).toMatchObject({ id: "first", locked: true });
    expect(added[0].hidden).toBe(false);
    expect(added[0].locked).toBe(false);
  });
});
