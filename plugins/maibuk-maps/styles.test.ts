/**
 * The Maps Map Styles (#752): the four Styles, the colour roles they share,
 * and how every Element kind settles its colour against a Style.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILL_COLOR,
  DEFAULT_STAMP_SIZE_MM,
  type MapFillElement,
  type MapLabelElement,
  type MapLineElement,
  type MapStampElement,
} from "./maps";
import { sceneShapes, sceneToSvg, type LineShape, type SceneShape, type TextShape } from "./scene";
import {
  MAP_STYLE_IDS,
  MAP_STYLES,
  STYLE_ROLES,
  isMapColor,
  isMapStyleId,
  resolveColor,
  styleOf,
  styleSwatches,
  type MapStyleId,
} from "./styles";

/** The Styles, in the order the picker will list them. */
const STYLES = MAP_STYLE_IDS;

function line(overrides: Partial<MapLineElement> = {}): MapLineElement {
  return {
    id: "line",
    kind: "line",
    name: "Line",
    hidden: false,
    locked: false,
    points: [
      [10, 10],
      [90, 10],
    ],
    style: "plain",
    enclosesFills: true,
    closed: false,
    curves: [false],
    roughened: false,
    ...overrides,
  };
}

/** An Area Fill over a 40 mm square, so no Map Lines are needed to give it a face. */
function fill(content: MapFillElement["content"]): MapFillElement {
  return {
    id: "fill",
    kind: "fill",
    name: "Fill",
    hidden: false,
    locked: false,
    anchor: [20, 20],
    outline: {
      points: [
        [0, 0],
        [40, 0],
        [40, 40],
        [0, 40],
      ],
      curves: [false, false, false, false],
      roughened: false,
    },
    content,
  };
}

function stamp(overrides: Partial<MapStampElement> = {}): MapStampElement {
  return {
    id: "stamp",
    kind: "stamp",
    name: "City",
    hidden: false,
    locked: false,
    stampRef: "base:marker",
    transform: { x: 50, y: 50, size: DEFAULT_STAMP_SIZE_MM, rotation: 0 },
    ...overrides,
  };
}

function label(overrides: Partial<MapLabelElement> = {}): MapLabelElement {
  return {
    id: "label",
    kind: "label",
    name: "The Reach",
    hidden: false,
    locked: false,
    text: "The Reach",
    x: 50,
    y: 50,
    rotation: 0,
    width: 40,
    bend: 0,
    font: "im-fell-english",
    size: 6,
    letterSpacing: 0,
    halo: 0.8,
    ...overrides,
  };
}

function pathsOf(shapes: readonly SceneShape[]): LineShape[] {
  return shapes.filter((shape): shape is LineShape => !("text" in shape));
}

function textsOf(shapes: readonly SceneShape[]): TextShape[] {
  return shapes.filter((shape): shape is TextShape => "text" in shape);
}

/** The colours a piece of markup paints with, from its `fill` and `stroke` attributes. */
function coloursOf(markup: string): string[] {
  return [...markup.matchAll(/(?:fill|stroke)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((colour) => colour !== "none");
}

/** The ONE color of an element kind's primitive, drawn in `style`. */
function oneColorOf(
  element: MapLineElement | MapFillElement | MapStampElement,
  style: MapStyleId
): string | null | undefined {
  const [shape] = pathsOf(sceneShapes([element], 100, 100, style)[0]);
  return shape?.fill ?? shape?.stroke;
}

function page(style: MapStyleId): string {
  return sceneToSvg({
    page: { preset: "square", widthMm: 100, heightMm: 100 },
    elements: [],
    styleId: style,
  });
}

describe("the Map Styles", () => {
  it("names four Styles", () => {
    expect(MAP_STYLE_IDS).toEqual(["atlas", "parchment", "ink", "night"]);
  });

  it("gives every Style every role, as a hex colour", () => {
    for (const style of STYLES) {
      expect(Object.keys(MAP_STYLES[style]).sort()).toEqual([...STYLE_ROLES].sort());
      for (const role of STYLE_ROLES) {
        expect(MAP_STYLES[style][role], `${style}.${role}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("keeps Atlas the palette Maps already draw in", () => {
    // The palette Maps drew in before Map Styles existed, so an existing Map
    // renders unchanged.
    expect(MAP_STYLES.atlas.water).toBe("#d7e6ec");
    expect(MAP_STYLES.atlas.land).toBe(DEFAULT_FILL_COLOR);
    expect(MAP_STYLES.atlas.ink).toBe("#1f2933");
    expect(MAP_STYLES.atlas.river).toBe("#3b6e8f");
    expect(MAP_STYLES.atlas.label).toBe("#1f2933");
    expect(MAP_STYLES.atlas.halo).toBe("#d7e6ec");
  });

  it("reads an unknown Style id as Atlas", () => {
    expect(isMapStyleId("night")).toBe(true);
    expect(isMapStyleId("dusk")).toBe(false);
    expect(styleOf("parchment")).toBe("parchment");
    expect(styleOf("dusk")).toBe("atlas");
    expect(styleOf(undefined)).toBe("atlas");
  });
});

describe("resolveColor", () => {
  it("takes the fallback role when the field is absent", () => {
    for (const style of STYLES) {
      for (const role of STYLE_ROLES) {
        expect(resolveColor(style, undefined, role), `${style}.${role}`).toBe(
          MAP_STYLES[style][role]
        );
      }
    }
  });

  it("follows the Style when the field names a role", () => {
    for (const style of STYLES) {
      for (const role of STYLE_ROLES) {
        expect(resolveColor(style, role, "land"), `${style}.${role}`).toBe(MAP_STYLES[style][role]);
      }
    }
  });

  it("keeps a hex override whatever the Style", () => {
    for (const style of STYLES) {
      expect(resolveColor(style, "#123456", "land")).toBe("#123456");
    }
  });

  it("accepts role names and hex colours as stored colours, and nothing else", () => {
    for (const role of STYLE_ROLES) expect(isMapColor(role)).toBe(true);
    expect(isMapColor("#123456")).toBe(true);
    expect(isMapColor("#ABCDEF")).toBe(true);
    expect(isMapColor("#12345")).toBe(false);
    expect(isMapColor("scarlet")).toBe(false);
    expect(isMapColor(7)).toBe(false);
    expect(isMapColor(undefined)).toBe(false);
  });
});

describe("styleSwatches", () => {
  it("lists the roles in role order, deduped", () => {
    // Atlas draws ink and labels alike, and water and halos alike.
    expect(styleSwatches("atlas")).toEqual([
      MAP_STYLES.atlas.water,
      MAP_STYLES.atlas.land,
      MAP_STYLES.atlas.forest,
      MAP_STYLES.atlas.desert,
      MAP_STYLES.atlas.ink,
      MAP_STYLES.atlas.river,
    ]);
    for (const style of STYLES) {
      const swatches = styleSwatches(style);
      expect(new Set(swatches).size).toBe(swatches.length);
      expect(swatches.length).toBeGreaterThan(0);
    }
  });
});

describe("a Map drawn in each Style", () => {
  it("paints the page in the Style's water", () => {
    for (const style of STYLES) {
      expect(page(style)).toContain(`fill="${MAP_STYLES[style].water}"`);
    }
  });

  it("draws a plain Map Line in the Style's ink, a river in its river ink", () => {
    for (const style of STYLES) {
      expect(oneColorOf(line(), style)).toBe(MAP_STYLES[style].ink);
      expect(oneColorOf(line({ style: "river", closed: true }), style)).toBe(
        MAP_STYLES[style].river
      );
    }
  });

  it("draws a Fill in the Style's land, a Stamp in its ink, a Label in its label ink", () => {
    for (const style of STYLES) {
      expect(oneColorOf(fill({ color: "land" }), style)).toBe(MAP_STYLES[style].land);
      expect(oneColorOf(stamp(), style)).toBe(MAP_STYLES[style].ink);

      const [text] = textsOf(sceneShapes([label()], 100, 100, style)[0]);
      expect(text.fill).toBe(MAP_STYLES[style].label);
      expect(text.halo?.color).toBe(MAP_STYLES[style].halo);
    }
  });

  it("follows a Style switch when an Element names a role", () => {
    for (const style of STYLES) {
      expect(oneColorOf(line({ color: "forest" }), style)).toBe(MAP_STYLES[style].forest);
      expect(oneColorOf(fill({ color: "desert" }), style)).toBe(MAP_STYLES[style].desert);
      expect(oneColorOf(stamp({ color: "label" }), style)).toBe(MAP_STYLES[style].label);

      const [text] = textsOf(sceneShapes([label({ color: "river" })], 100, 100, style)[0]);
      expect(text.fill).toBe(MAP_STYLES[style].river);
    }
  });

  it("keeps a hex override through every Style", () => {
    for (const style of STYLES) {
      expect(oneColorOf(line({ color: "#123456" }), style)).toBe("#123456");
      expect(oneColorOf(fill({ color: "#654321" }), style)).toBe("#654321");
      expect(oneColorOf(stamp({ color: "#abcdef" }), style)).toBe("#abcdef");

      const [text] = textsOf(sceneShapes([label({ color: "#fedcba" })], 100, 100, style)[0]);
      expect(text.fill).toBe("#fedcba");
      // A halo has no override, so it still follows the Style.
      expect(text.halo?.color).toBe(MAP_STYLES[style].halo);
    }
  });

  it("draws a textured Fill in the texture's own ink in Atlas and the Style's ink elsewhere", () => {
    for (const style of STYLES) {
      const svg = sceneToSvg({
        page: { preset: "square", widthMm: 100, heightMm: 100 },
        elements: [fill({ texture: "grass" })],
        styleId: style,
      });
      const pattern = /<pattern id="([^"]+)"[^>]*>(.*?)<\/pattern>/.exec(svg);
      expect(pattern, style).not.toBeNull();
      const [, id, marks] = pattern as RegExpExecArray;
      const inks = new Set(coloursOf(marks));
      expect(inks.size, style).toBe(1);
      const [ink] = [...inks];
      if (style === "atlas") {
        // Atlas keeps each texture's own ink and the id every Atlas Map already
        // references, so an existing Map's markup does not change.
        expect(id).toBe("texture-grass");
        expect(ink).toBe("#5c7a3f");
      } else {
        expect(id).toBe(`texture-grass-${style}`);
        expect(ink).toBe(MAP_STYLES[style].ink);
      }
      // The Fill paints the pattern of its own Style.
      expect(svg).toContain(`url(#${id})`);
    }
  });

  it("scatters a Fill's Stamps in the Style's ink", () => {
    for (const style of STYLES) {
      const [shapes] = sceneShapes(
        [fill({ scatter: { stamp: "base:marker", spacing: 12, seed: 3 } })],
        100,
        100,
        style
      );
      const colours = pathsOf(shapes).flatMap((shape) =>
        [shape.fill, shape.stroke].filter((colour): colour is string => typeof colour === "string")
      );
      expect(colours.length, style).toBeGreaterThan(0);
      for (const colour of colours) expect(colour, style).toBe(MAP_STYLES[style].ink);
    }
  });
});
