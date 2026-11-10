/**
 * The Maps scene (#745): smoothing a Pencil stroke, turning points into an SVG
 * path, serializing a whole Map to SVG for the Frame and the list preview, and
 * the immutable element operations the Elements list calls.
 */

import { describe, expect, it } from "vitest";
import { type MapDocument, type MapElement, type MapLineElement, type PagePreset } from "./maps";
import {
  EMPTY_MAP_COLOR,
  LINE_STROKE,
  SMOOTH_TOLERANCE_MM,
  addElement,
  linePath,
  lineShapes,
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
    curves: points.slice(1).map(() => true),
    roughened: false,
    ...extra,
  };
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
  /** The path of a line whose segments are curved unless `curves` says otherwise. */
  function path(
    points: [number, number][],
    curves: boolean[] = points.slice(1).map(() => true),
    closed = false
  ): string {
    return linePath({ points, curves, closed });
  }

  it("draws a straight line through two points", () => {
    expect(
      path([
        [0, 0],
        [10, 5],
      ])
    ).toBe("M 0 0 L 10 5");
  });

  it("converts Catmull-Rom points to cubic Beziers and rounds to two decimals", () => {
    expect(
      path([
        [0, 0],
        [10, 10],
        [20, 0],
      ])
    ).toBe("M 0 0 C 1.67 1.67 6.67 10 10 10 C 13.33 10 18.33 1.67 20 0");
  });

  it("rounds the start point too", () => {
    expect(
      path([
        [0.1234, 0.5678],
        [10.9876, 20.4444],
      ])
    ).toBe("M 0.12 0.57 L 10.99 20.44");
  });

  it("has no path for fewer than two points", () => {
    expect(linePath({ points: [], curves: [], closed: false })).toBe("");
    expect(linePath({ points: [[1, 2]], curves: [], closed: false })).toBe("");
  });

  it("draws a straight segment as L between curved ones", () => {
    expect(
      path(
        [
          [0, 0],
          [10, 10],
          [20, 0],
        ],
        [true, false]
      )
    ).toBe("M 0 0 C 1.67 1.67 6.67 10 10 10 L 20 0");
  });

  it("ends a closed line with Z and wraps its spline across the seam", () => {
    expect(
      path(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        [true, true, true],
        true
      )
    ).toBe("M 0 0 C 0 -1.67 8.33 -1.67 10 0 C 11.67 1.67 11.67 10 10 10 C 8.33 10 0 1.67 0 0 Z");
    expect(
      path(
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        [false, false, false, false],
        true
      )
    ).toBe("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  });
});

describe("lineShapes", () => {
  /** A straight two-point line, which makes each preset's geometry easy to read. */
  function straight(extra: Partial<MapLineElement> = {}): MapLineElement {
    return line(
      "line",
      [
        [0, 0],
        [10, 0],
      ],
      { curves: [false], ...extra }
    );
  }

  it("draws a plain line as one ink stroke of 0.6mm", () => {
    expect(lineShapes(straight())).toEqual([
      {
        d: "M 0 0 L 10 0",
        stroke: LINE_STROKE,
        strokeWidth: 0.6,
        dash: null,
        fill: null,
        opacity: 1,
      },
    ]);
  });

  it("draws a coast as one ink stroke of 0.9mm", () => {
    expect(lineShapes(straight({ style: "coast" }))).toEqual([
      {
        d: "M 0 0 L 10 0",
        stroke: LINE_STROKE,
        strokeWidth: 0.9,
        dash: null,
        fill: null,
        opacity: 1,
      },
    ]);
  });

  it("draws an open river as a filled polygon 0.2mm wide at the start and 1.4mm at the end", () => {
    expect(lineShapes(straight({ style: "river", enclosesFills: false }))).toEqual([
      {
        d: "M 0 0.1 L 10 0.7 L 10 -0.7 L 0 -0.1 Z",
        stroke: null,
        strokeWidth: 0,
        dash: null,
        fill: "#3b6e8f",
        opacity: 1,
      },
    ]);
  });

  it("draws a closed river as a constant 0.8mm water stroke instead", () => {
    const closed: MapLineElement = line(
      "line",
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      { style: "river", closed: true, curves: [false, false, false] }
    );
    expect(lineShapes(closed)).toEqual([
      {
        d: "M 0 0 L 10 0 L 10 10 Z",
        stroke: "#3b6e8f",
        strokeWidth: 0.8,
        dash: null,
        fill: null,
        opacity: 1,
      },
    ]);
  });

  it("draws a road as a dashed 0.5mm ink stroke", () => {
    expect(lineShapes(straight({ style: "road", enclosesFills: false }))).toEqual([
      {
        d: "M 0 0 L 10 0",
        stroke: LINE_STROKE,
        strokeWidth: 0.5,
        dash: "2 1.2",
        fill: null,
        opacity: 1,
      },
    ]);
  });

  it("draws a border as a dash-dot 0.6mm ink stroke", () => {
    expect(lineShapes(straight({ style: "border" }))).toEqual([
      {
        d: "M 0 0 L 10 0",
        stroke: LINE_STROKE,
        strokeWidth: 0.6,
        dash: "3 1 0.5 1",
        fill: null,
        opacity: 1,
      },
    ]);
  });

  it("draws a coast ripple as the coast line plus three fading offset copies", () => {
    const shapes = lineShapes(straight({ style: "coastRipple", enclosesFills: false }));
    expect(shapes).toHaveLength(4);
    expect(shapes[0]).toEqual({
      d: "M 0 0 L 10 0",
      stroke: LINE_STROKE,
      strokeWidth: 0.9,
      dash: null,
      fill: null,
      opacity: 1,
    });
    expect(shapes.slice(1)).toEqual([
      {
        d: "M 0 1.2 L 10 1.2",
        stroke: LINE_STROKE,
        strokeWidth: 0.4,
        dash: null,
        fill: null,
        opacity: 0.6,
      },
      {
        d: "M 0 2.4 L 10 2.4",
        stroke: LINE_STROKE,
        strokeWidth: 0.4,
        dash: null,
        fill: null,
        opacity: 0.4,
      },
      {
        d: "M 0 3.6 L 10 3.6",
        stroke: LINE_STROKE,
        strokeWidth: 0.4,
        dash: null,
        fill: null,
        opacity: 0.2,
      },
    ]);
  });

  it("draws a roughened line from rough.js, the same way every time for one Element", () => {
    const first = lineShapes(straight({ roughened: true }));
    const again = lineShapes(straight({ roughened: true }));
    expect(first).toEqual(again);
    expect(first[0].stroke).toBe(LINE_STROKE);
    expect(first[0].strokeWidth).toBe(0.6);
    expect(first[0].d).not.toBe("M 0 0 L 10 0");
  });

  it("roughens two Elements differently, from their own ids", () => {
    const one = lineShapes(
      line(
        "one",
        [
          [0, 0],
          [10, 10],
        ],
        { curves: [false], roughened: true }
      )
    );
    const two = lineShapes(
      line(
        "two",
        [
          [0, 0],
          [10, 10],
        ],
        { curves: [false], roughened: true }
      )
    );
    expect(one[0].d).not.toBe(two[0].d);
  });

  it("leaves a filled river rough-free, because only strokes roughen", () => {
    const shapes = lineShapes(straight({ style: "river", roughened: true }));
    expect(shapes[0]).toMatchObject({
      d: "M 0 0.1 L 10 0.7 L 10 -0.7 L 0 -0.1 Z",
      fill: "#3b6e8f",
      stroke: null,
    });
  });

  it("roughens every stroke of a ripple", () => {
    const shapes = lineShapes(straight({ style: "coastRipple", roughened: true }));
    expect(shapes).toHaveLength(4);
    for (const shape of shapes) expect(shape.d).not.toMatch(/^M 0 0 L 10 0$/);
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
      '<g data-element-id="below"><path d="M 0 0 L 10 10" stroke="#1f2933" stroke-width="0.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'
    );
  });

  it("draws every Line style preset's primitives in one Element group", () => {
    const svg = sceneToSvg(
      mapWith([
        line(
          "ripple",
          [
            [0, 0],
            [10, 0],
          ],
          {
            style: "coastRipple",
            curves: [false],
          }
        ),
        line(
          "river",
          [
            [0, 10],
            [10, 10],
          ],
          {
            style: "river",
            curves: [false],
            enclosesFills: false,
          }
        ),
      ])
    );
    const ripple = svg.slice(
      svg.indexOf('<g data-element-id="ripple">'),
      svg.indexOf("</g>", svg.indexOf('<g data-element-id="ripple">'))
    );
    expect(ripple.match(/<path /g)).toHaveLength(4);
    expect(ripple).not.toContain("stroke-dasharray=");
    expect(svg).toContain(
      '<g data-element-id="river"><path d="M 0 10.1 L 10 10.7 L 10 9.3 L 0 9.9 Z" stroke="none" fill="#3b6e8f" stroke-linecap="round" stroke-linejoin="round"/></g>'
    );
  });

  it("writes a dash and an opacity only when a shape has them", () => {
    const svg = sceneToSvg(
      mapWith([
        line(
          "road",
          [
            [0, 0],
            [10, 0],
          ],
          { style: "road", curves: [false] }
        ),
      ])
    );
    expect(svg).toContain('stroke-width="0.5"');
    expect(svg).toContain('stroke-dasharray="2 1.2"');
    expect(svg).not.toContain('opacity="1"');
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
    expect(svg).toContain('<g data-element-id="one">');
    expect(svg).toContain('<g data-element-id="two" data-selected="true">');
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
