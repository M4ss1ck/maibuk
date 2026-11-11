/**
 * The Maps scene (#745): smoothing a Pencil stroke, turning points into an SVG
 * path, serializing a whole Map to SVG for the Frame and the list preview, and
 * the immutable element operations the Elements list calls.
 */

import { describe, expect, it } from "vitest";
import {
  LINE_STROKE,
  type MapDocument,
  type MapElement,
  type MapFillElement,
  type MapFillOutline,
  type MapLineElement,
  type MapPoint,
  type MapStampElement,
  type PagePreset,
} from "./maps";
import { linePath } from "./geometry";
import {
  EMPTY_MAP_COLOR,
  SMOOTH_TOLERANCE_MM,
  TEXT_FONT_FAMILY,
  type LineShape,
  type SceneShape,
  type TextShape,
  addElement,
  canMove,
  lineShapes,
  moveElement,
  removeElement,
  renameElement,
  reorder,
  sceneShapes,
  sceneToSvg,
  setHidden,
  setLocked,
  smoothStroke,
} from "./scene";
import { SCALE_BAR_STAMP_REF } from "./stamps";

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

function fill(
  id: string,
  anchor: [number, number],
  extra: Partial<MapFillElement> = {}
): MapFillElement {
  return {
    id,
    kind: "fill",
    name: id,
    hidden: false,
    locked: false,
    anchor,
    content: { color: "#c8d5a3" },
    ...extra,
  };
}

/** A closed square Map Line, `sizeMm` across, with its top-left corner at `offsetMm`. */
function ring(id: string, sizeMm = 40, offsetMm = 0): MapLineElement {
  return line(
    id,
    [
      [offsetMm, offsetMm],
      [offsetMm + sizeMm, offsetMm],
      [offsetMm + sizeMm, offsetMm + sizeMm],
      [offsetMm, offsetMm + sizeMm],
    ],
    { closed: true, curves: [false, false, false, false] }
  );
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

/** The 20 mm square at (0, 0), as an Area Fill's own outline. */
const AREA_OUTLINE: MapFillOutline = {
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  curves: [false, false, false, false],
  roughened: false,
};

/** An Area Fill over `AREA_OUTLINE`, in the default land colour. */
function areaFill(overrides: Partial<MapFillElement> = {}): MapFillElement {
  return fill("forest", [10, 10], { outline: AREA_OUTLINE, ...overrides });
}

/** The paths of one Element's primitives, which an Area Fill's content draws. */
function pathsOf(shapes: readonly SceneShape[]): LineShape[] {
  return shapes.filter((shape): shape is LineShape => !("text" in shape));
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

  it("keeps a closed roughened line closed, its path returning to where it started", () => {
    const closed: MapLineElement = line(
      "closed",
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      { closed: true, curves: [false, false, false, false], roughened: true }
    );
    const shapes = lineShapes(closed);
    expect(shapes).toHaveLength(1);
    const d = shapes[0].d;
    const start = /^M\s*(-?[\d.]+)\s+(-?[\d.]+)/.exec(d);
    expect(start).not.toBeNull();
    // The last coordinate pair the path draws is the first point again, so the
    // ink loop meets itself instead of leaving a break at the seam.
    const end = /(-?[\d.]+)\s+(-?[\d.]+)\s*$/.exec(d);
    expect(end).not.toBeNull();
    expect(Number(end?.[1])).toBeCloseTo(Number(start?.[1]), 5);
    expect(Number(end?.[2])).toBeCloseTo(Number(start?.[2]), 5);
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
      mapWith([{ id: "label-1", kind: "label", name: "The Reach", hidden: false, locked: false }])
    );
    expect(svg).not.toContain("label-1");
  });
});

describe("Stamp rendering", () => {
  /** A marker Stamp 12 mm wide, centred on (100, 50), upright, in the map ink. */
  function stamp(overrides: Partial<MapStampElement> = {}): MapStampElement {
    return {
      id: "stamp",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 100, y: 50, size: 12, rotation: 0 },
      color: LINE_STROKE,
      ...overrides,
    };
  }

  /** A scale bar Stamp 40 mm wide, centred on (100, 50), reading the default scale. */
  function scaleBar(overrides: Partial<MapStampElement> = {}): MapStampElement {
    return stamp({
      name: "Scale",
      stampRef: SCALE_BAR_STAMP_REF,
      transform: { x: 100, y: 50, size: 40, rotation: 0 },
      ...overrides,
    });
  }

  function pathsOf(shapes: readonly SceneShape[]): LineShape[] {
    return shapes.filter((shape): shape is LineShape => !("text" in shape));
  }

  function textsOf(shapes: readonly SceneShape[]): TextShape[] {
    return shapes.filter((shape): shape is TextShape => "text" in shape);
  }

  it("draws a marker's art in the Stamp's colour, scaled and centred on its point", () => {
    const [shape] = pathsOf(sceneShapes([stamp()], 152.4)[0]);

    expect(shape).toMatchObject({
      stroke: null,
      strokeWidth: 0,
      dash: null,
      fill: LINE_STROKE,
      opacity: 1,
      // The marker's own 10.8mm-wide art box at a 12 mm width, centred.
      transform: "translate(100 50) scale(1.111) translate(0 0)",
    });
    expect(shape.d).toMatch(/^M -5 0 /);
  });

  it("turns and resizes the art with the Stamp's own numbers", () => {
    const [shape] = pathsOf(
      sceneShapes([stamp({ transform: { x: 40, y: 30, size: 5, rotation: 90 } })], 152.4)[0]
    );

    expect(shape.transform).toBe("translate(40 30) rotate(90) scale(0.463) translate(0 0)");
  });

  it("paints every one-colour Stamp in the Stamp's own colour", () => {
    const oneColour = [
      "town",
      "village",
      "ruin",
      "tower",
      "cave",
      "bridge",
      "battle",
      "cartouche",
      "border-frame",
      "sea-monster",
      "ship",
      "port",
      "marker",
    ];
    for (const id of oneColour) {
      const first = pathsOf(
        sceneShapes([stamp({ stampRef: `base:${id}`, color: "#2779a8" })], 152.4)[0]
      );
      expect(first.length, id).toBeGreaterThan(0);
      for (const shape of first) {
        expect(shape.fill, id).toBe("#2779a8");
      }
      const second = pathsOf(
        sceneShapes([stamp({ stampRef: `base:${id}`, color: "#a82779" })], 152.4)[0]
      );
      for (const shape of second) {
        expect(shape.fill, id).toBe("#a82779");
      }
    }
  });

  it("keeps the multi-colour art's own paint whatever colour the Stamp carries", () => {
    const multiColour = [
      "capital",
      "city",
      "castle",
      "temple",
      "volcano",
      "mountain",
      "tree",
      "compass-rose",
    ];
    for (const id of multiColour) {
      const ink = pathsOf(sceneShapes([stamp({ stampRef: `base:${id}` })], 152.4)[0]);
      const other = pathsOf(
        sceneShapes([stamp({ stampRef: `base:${id}`, color: "#a82779" })], 152.4)[0]
      );
      expect(ink.length, id).toBeGreaterThan(0);
      // The art keeps every colour it owns: no shape takes the Stamp's ink.
      expect(
        other.map((shape) => shape.fill),
        id
      ).toEqual(ink.map((shape) => shape.fill));
      expect(
        other.map((shape) => shape.stroke),
        id
      ).toEqual(ink.map((shape) => shape.stroke));
      expect(
        other.map((shape) => shape.fill),
        id
      ).not.toContain("#a82779");
    }
  });

  it("draws nothing for a Stamp whose art is unknown", () => {
    expect(sceneShapes([stamp({ stampRef: "base:nope" })], 152.4)[0]).toEqual([]);
    expect(sceneShapes([stamp({ stampRef: "custom:castle" })], 152.4)[0]).toEqual([]);
  });

  it("draws the scale bar as four alternating segments and two labels", () => {
    const shapes = sceneShapes([scaleBar()], 152.4)[0];
    const paths = pathsOf(shapes);

    // 40 mm of a 152.4 mm page reading 1000 km labels 200 km, so 30.48 mm of bar.
    expect(paths).toHaveLength(4);
    expect(paths[0]).toMatchObject({ fill: LINE_STROKE, stroke: null, strokeWidth: 0 });
    expect(paths[1]).toMatchObject({ fill: null, stroke: LINE_STROKE });
    expect(paths[2]).toMatchObject({ fill: LINE_STROKE, stroke: null });
    expect(paths[3]).toMatchObject({ fill: null, stroke: LINE_STROKE });
    // The bar straddles the Stamp's point, turned with it.
    expect(paths[0].d).toMatch(/^M -15.24 -1.83 /);
    expect(paths[0].transform).toBe("translate(100 50)");

    const [zero, far] = textsOf(shapes);
    expect(zero).toMatchObject({
      text: "0",
      x: -15.24,
      anchor: "start",
      fill: LINE_STROKE,
      font: TEXT_FONT_FAMILY,
    });
    expect(far).toMatchObject({
      text: "200 km",
      x: 15.24,
      anchor: "end",
      fill: LINE_STROKE,
      font: TEXT_FONT_FAMILY,
    });
    expect(zero.size).toBeGreaterThan(0);
  });

  it("reads the scale in miles and in the span the Stamp carries", () => {
    const [, far] = textsOf(
      sceneShapes([scaleBar({ scale: { unit: "mi", span: 500 } })], 152.4)[0]
    );

    expect(far.text).toBe("100 mi");
  });

  it("splits the bar into five segments when the distance starts with a five", () => {
    // 200 mm of page stands for 1000 km, so a 100 mm bar is exactly 500 km.
    const shapes = sceneShapes(
      [scaleBar({ transform: { x: 100, y: 50, size: 100, rotation: 0 } })],
      200
    )[0];

    expect(pathsOf(shapes)).toHaveLength(5);
    expect(textsOf(shapes)[1].text).toBe("500 km");
  });

  it("writes the bar's labels as SVG text and the art as one transformed path", () => {
    const svg = sceneToSvg(mapWith([stamp()], "portrait"));

    expect(svg).toContain('<g data-element-id="stamp">');
    expect(svg).toContain('transform="translate(100 50) scale(1.111) translate(0 0)"');

    const bar = sceneToSvg(mapWith([scaleBar()], "portrait"));
    expect(bar).toContain("<text ");
    expect(bar).toContain(">0</text>");
    expect(bar).toContain(">200 km</text>");
    expect(bar).toContain('text-anchor="end"');
    // The one font constant, escaped for the attribute it lands in, so an
    // exported SVG draws the frame's face instead of the renderer's default.
    expect(bar).toContain(`font-family="${TEXT_FONT_FAMILY.replace(/'/g, "&apos;")}"`);
  });
});

describe("Fill rendering", () => {
  it("draws a Fill as one filled, unstroked path of its face, under its Map Line", () => {
    const svg = sceneToSvg(mapWith([fill("land", [20, 20]), ring("coast")]));

    const start = svg.indexOf('<g data-element-id="land">');
    const end = svg.indexOf("</g>", start);
    expect(start).toBeGreaterThan(-1);
    const group = svg.slice(start, end);
    expect(group.match(/<path /g)).toHaveLength(1);
    expect(group).toContain('stroke="none"');
    expect(group).toContain('fill="#c8d5a3"');
    expect(group).toContain('fill-rule="evenodd"');
    expect(group).not.toContain('stroke-width="');
    expect(/d="M [^"]+ Z"/.test(group)).toBe(true);
    // The Fill is drawn before the Map Line it sits under.
    expect(start).toBeLessThan(svg.indexOf('data-element-id="coast"'));
  });

  it("cuts a face's holes out of the Fill's path", () => {
    const svg = sceneToSvg(
      mapWith([fill("land", [10, 10]), ring("outer", 60), ring("inner", 20, 20)])
    );

    const start = svg.indexOf('<g data-element-id="land">');
    const group = svg.slice(start, svg.indexOf("</g>", start));
    expect(group.match(/M /g)).toHaveLength(2);
    expect(group).toContain('fill-rule="evenodd"');
  });

  it("does not draw a hidden Fill", () => {
    const svg = sceneToSvg(mapWith([fill("land", [20, 20], { hidden: true }), ring("coast")]));

    expect(svg).not.toContain('data-element-id="land"');
  });

  it("draws nothing for a Fill whose anchor is in no face", () => {
    const svg = sceneToSvg(mapWith([fill("land", [200, 200]), ring("coast")]));

    expect(svg).not.toContain('data-element-id="land"');
  });

  it("writes no definitions for a Fill of an old colour-only document", () => {
    const svg = sceneToSvg(mapWith([fill("land", [20, 20]), ring("coast")]));

    expect(svg).not.toContain("<defs>");
    expect(svg).not.toContain("<filter");
    expect(svg).not.toContain("<clipPath");
    expect(svg).not.toContain("filter=");
    expect(svg).not.toContain("clip-path=");
  });
});

describe("Area Fills", () => {
  /** The one path the group of `id` holds, as SVG. */
  function groupOf(svg: string, id: string): string {
    const start = svg.indexOf(`<g data-element-id="${id}">`);
    expect(start).toBeGreaterThan(-1);
    return svg.slice(start, svg.indexOf("</g>", start));
  }

  it("draws an Area Fill as its own outline, filled and unstroked", () => {
    // No Map Line in the Map: an Area Fill covers its outline, not a face.
    const svg = sceneToSvg(mapWith([areaFill()]));

    const group = groupOf(svg, "forest");
    expect(group).toContain('d="M 0 0 L 20 0 L 20 20 L 0 20 Z"');
    expect(group).toContain('stroke="none"');
    expect(group).toContain('fill="#c8d5a3"');
    expect(group).toContain('fill-rule="evenodd"');
    expect(group).not.toContain('stroke-width="');
  });

  it("draws an Area Fill's outline through its curved segments", () => {
    const [shape] = pathsOf(
      sceneShapes(
        [
          areaFill({
            outline: {
              points: [
                [0, 0],
                [10, 10],
                [20, 0],
              ],
              curves: [true, true, true],
              roughened: false,
            },
          }),
        ],
        152.4
      )[0]
    );

    expect(shape.d).toContain(" C ");
    expect(shape.d.endsWith(" Z")).toBe(true);
    expect(shape.stroke).toBeNull();
    expect(shape.fill).toBe("#c8d5a3");
  });

  it("draws a roughened Area Fill's outline in the rough ink look, still unstroked", () => {
    const roughened = () => areaFill({ outline: { ...AREA_OUTLINE, roughened: true } });
    const [plain] = pathsOf(sceneShapes([areaFill()], 152.4)[0]);
    const [rough] = pathsOf(sceneShapes([roughened()], 152.4)[0]);

    expect(rough.d).not.toBe(plain.d);
    expect(rough.stroke).toBeNull();
    expect(rough.fill).toBe("#c8d5a3");
    // The same Element roughens the same way every render.
    expect(pathsOf(sceneShapes([roughened()], 152.4)[0])[0].d).toBe(rough.d);
  });

  it("moves an Area Fill with its outline, and leaves a Bucket Fill where it is", () => {
    const area = areaFill();
    const moved = moveElement([area], "forest", 3, -2)[0];

    expect(moved).toMatchObject({
      anchor: [13, 8],
      outline: {
        points: [
          [3, -2],
          [23, -2],
          [23, 18],
          [3, 18],
        ],
      },
    });
    expect(canMove(area)).toBe(true);
    const bucket = fill("land", [1, 1]);
    expect(canMove(bucket)).toBe(false);
    expect(moveElement([bucket], "land", 3, -2)[0]).toBe(bucket);
  });
});

describe("Fill textures", () => {
  it("paints a Fill's texture from one pattern per texture, defined once", () => {
    const svg = sceneToSvg(
      mapWith([
        areaFill({ id: "meadow", content: { color: "#c8d5a3", texture: "grass" } }),
        areaFill({ id: "field", content: { texture: "grass" } }),
      ])
    );

    expect(svg.match(/<pattern id="texture-grass"/g)).toHaveLength(1);
    expect(svg.match(/url\(#texture-grass\)/g)).toHaveLength(2);
    expect(svg.indexOf("<defs>")).toBeLessThan(svg.indexOf("<pattern"));
  });

  it("defines only the textures the Map paints with", () => {
    const svg = sceneToSvg(mapWith([areaFill({ content: { texture: "sand" } })]));

    expect(svg).toContain('id="texture-sand"');
    expect(svg).not.toContain('id="texture-grass"');
  });
});

describe("Fill scatter", () => {
  /** Every point a scattered Stamp is placed on, once per point, in order. */
  function stampPoints(svg: string): MapPoint[] {
    const points = [...svg.matchAll(/transform="translate\((-?[\d.]+) (-?[\d.]+)\)/g)].map(
      ([, x, y]): MapPoint => [Number(x), Number(y)]
    );
    // A Stamp's art is several paths at one point, so a point repeats per part.
    const seen = new Set<string>();
    return points.filter((point) => {
      const key = `${point[0]},${point[1]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  it("scatters a Fill's Stamps inside its area, clipped to it", () => {
    const svg = sceneToSvg(
      mapWith([areaFill({ content: { scatter: { stamps: ["base:tree"], spacing: 8, seed: 5 } } })])
    );

    expect(svg).toMatch(
      /<clipPath id="fill-clip-[0-9a-f]+"><path d="[^"]+" clip-rule="evenodd"\/>/
    );
    expect(svg).toMatch(/clip-path="url\(#fill-clip-[0-9a-f]+\)"/);
    const points = stampPoints(svg);
    expect(points.length).toBeGreaterThan(2);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(20);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(20);
    }
  });

  it("samples a Bucket Fill's scatter from its face, so the Stamps follow a moved Map Line", () => {
    const scatter = { stamps: ["base:tree"], spacing: 7, seed: 4 };
    const pointsOver = (offset: number) =>
      stampPoints(
        sceneToSvg(
          mapWith([
            fill("trees", [offset + 20, offset + 20], { content: { scatter } }),
            ring("coast", 40, offset),
          ])
        )
      );

    const before = pointsOver(0);
    const after = pointsOver(40);

    expect(before.length).toBeGreaterThan(2);
    expect(after).toHaveLength(before.length);
    after.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(before[index][0] + 40, 2);
      expect(y).toBeCloseTo(before[index][1] + 40, 2);
    });
  });

  it("cycles the Stamps a Fill scatters over its points", () => {
    const scatterSvg = (stamps: string[]) =>
      sceneToSvg(mapWith([areaFill({ content: { scatter: { stamps, spacing: 8, seed: 2 } } })]));
    const one = scatterSvg(["base:tree"]);
    const two = scatterSvg(["base:tree", "base:marker"]);

    // Both Fills scatter on the same points; the second draws a marker's art at
    // every other one, so their shapes differ while their points do not.
    expect(stampPoints(two)).toEqual(stampPoints(one));
    expect(two).not.toBe(one);
  });
});

describe("Soft Edge", () => {
  it("blurs a Fill's edge with a filter in page space", () => {
    const svg = sceneToSvg(mapWith([areaFill({ softEdge: 2 })]));
    const id = /<filter id="([^"]+)"/.exec(svg)?.[1];

    expect(id).toBeDefined();
    expect(svg).toContain(`<filter id="${id}" filterUnits="userSpaceOnUse" x="`);
    expect(svg).toContain('width="');
    expect(svg).toContain('height="');
    expect(svg).toContain('<feGaussianBlur stdDeviation="2"/>');
    expect(svg).toContain(`filter="url(#${id})"`);
  });

  it("widens the filter's region past the Fill, so the blur is not cut off", () => {
    const svg = sceneToSvg(mapWith([areaFill({ softEdge: 4 })]));
    const filter = /<filter [^>]+>/.exec(svg)?.[0] ?? "";
    const value = (name: string) => Number(new RegExp(` ${name}="(-?[\\d.]+)"`).exec(filter)?.[1]);

    // The 20 mm square starts at 0 and ends at 20; the region has to reach past both.
    expect(value("x")).toBeLessThan(0);
    expect(value("y")).toBeLessThan(0);
    expect(value("x") + value("width")).toBeGreaterThan(20);
    expect(value("y") + value("height")).toBeGreaterThan(20);
  });

  it("blurs a Map Line's edge too", () => {
    const svg = sceneToSvg(
      mapWith([
        line(
          "coast",
          [
            [0, 0],
            [10, 0],
          ],
          { curves: [false], softEdge: 1.5 }
        ),
      ])
    );

    expect(svg).toContain('<feGaussianBlur stdDeviation="1.5"/>');
    expect(svg).toMatch(/filter="url\(#soft-edge-[0-9a-f]+\)"/);
  });

  it("gives each Element its own filter id, the same one every render", () => {
    const idOf = (id: string, softEdge: number) => {
      const svg = sceneToSvg(
        mapWith([
          line(
            id,
            [
              [0, 0],
              [10, 0],
            ],
            { curves: [false], softEdge }
          ),
        ])
      );
      return /<filter id="([^"]+)"/.exec(svg)?.[1];
    };

    expect(idOf("coast", 1)).toBe(idOf("coast", 1));
    expect(idOf("coast", 1)).not.toBe(idOf("river", 1));
  });

  it("writes no filter for a sharp Fill or Map Line", () => {
    const svg = sceneToSvg(
      mapWith([
        areaFill(),
        line(
          "coast",
          [
            [0, 0],
            [10, 0],
          ],
          { curves: [false] }
        ),
      ])
    );

    expect(svg).not.toContain("<filter");
    expect(svg).not.toContain("filter=");
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

  it("moves a Shape's centre with its outline", () => {
    const shaped = line(
      "shaped",
      [
        [80, 40],
        [120, 40],
        [120, 60],
        [80, 60],
      ],
      {
        closed: true,
        curves: [false, false, false, false],
        shape: {
          kind: "rectangle",
          cx: 100,
          cy: 50,
          width: 40,
          height: 20,
          rotation: 0,
          sides: 6,
          cornerRadius: 0,
        },
      }
    );

    const moved = moveElement([shaped], "shaped", 5, -10)[0] as MapLineElement;
    expect(moved.shape).toMatchObject({ cx: 105, cy: 40 });
    expect(moved.points).toEqual([
      [85, 30],
      [125, 30],
      [125, 50],
      [85, 50],
    ]);
    // A locked Shape line keeps its centre where it was.
    const locked = moveElement(
      [{ ...shaped, locked: true }],
      "shaped",
      5,
      -10
    )[0] as MapLineElement;
    expect(locked.shape).toMatchObject({ cx: 100, cy: 50 });
  });

  it("moves a Stamp by shifting its centre, and leaves a locked one where it is", () => {
    const marker: MapStampElement = {
      id: "marker",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 100, y: 50, size: 12, rotation: 45 },
      color: LINE_STROKE,
    };

    const [moved] = moveElement([marker], "marker", 5, -10);
    expect(moved).toEqual({
      ...marker,
      transform: { x: 105, y: 40, size: 12, rotation: 45 },
    });
    expect(moveElement([{ ...marker, locked: true }], "marker", 5, -10)[0]).toEqual({
      ...marker,
      locked: true,
    });
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
