/**
 * The Maps Stamps (#749): the built-in art a Stamp ref resolves to, and the
 * scale bar's maths, which picks the distance a bar can label in the room the
 * page leaves it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import {
  BASE_STAMP_IDS,
  DEFAULT_STAMP_ID,
  SCALE_BAR_STAMP_REF,
  baseStampRef,
  scaleBarLayout,
  stampArt,
  stampNameKey,
  stampTakesColour,
  type StampNameKey,
} from "./stamps";

/** The built-in Stamps, in the order the art set lists them. */
const ORDERED_IDS = [
  "capital",
  "city",
  "town",
  "village",
  "castle",
  "ruin",
  "port",
  "tower",
  "temple",
  "cave",
  "bridge",
  "battle",
  "volcano",
  "mountain",
  "tree",
  "marker",
  "compass-rose",
  "cartouche",
  "border-frame",
  "sea-monster",
  "ship",
  "scale-bar",
];

/** The Stamps drawn in-house or from one-colour sources: every part recolours. */
const ONE_COLOUR_IDS = [
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

/** The Stamps whose own art keeps its colours, so it never takes the Stamp's. */
const MULTI_COLOUR_IDS = ["capital", "city", "castle", "temple", "volcano", "mountain", "tree"];

/** The Stamps derived from Azgaar's Fantasy Map Generator art. */
const AZGAAR_IDS = [
  "capital",
  "city",
  "castle",
  "temple",
  "volcano",
  "mountain",
  "tree",
  "port",
  "marker",
  "compass-rose",
];

/** The padding each art box carries on every side, as a fraction of its size. */
const PAD = 0.04;

/** Points along one path `d`, dense enough on curves to bound the ink. */
function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  const points: [number, number][] = [];
  const samples = 32;
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const number = () => Number(tokens[index++]);
  const more = () => index < tokens.length && !/[A-Za-z]/.test(tokens[index]);
  const at = (px: number, py: number) => points.push([px, py]);

  // An arc as its centre form, then sampled; a cubic as a sampled Bezier.
  const arc = (rx: number, ry: number, x2: number, y2: number, large: number, sweep: number) => {
    const dx = (x - x2) / 2;
    const dy = (y - y2) / 2;
    const scale = Math.sqrt(
      Math.max(
        0,
        (rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx) /
          (rx * rx * dy * dy + ry * ry * dx * dx)
      )
    );
    const sign = large === sweep ? -1 : 1;
    const cxp = (sign * scale * rx * dy) / ry;
    const cyp = (-sign * scale * ry * dx) / rx;
    const cx = cxp + (x + x2) / 2;
    const cy = cyp + (y + y2) / 2;
    const angle = (ux: number, uy: number, vx: number, vy: number) =>
      Math.acos(
        Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))
      ) * (ux * vy - uy * vx < 0 ? -1 : 1);
    const from = angle(1, 0, (dx - cxp) / rx, (dy - cyp) / ry);
    let span = angle((dx - cxp) / rx, (dy - cyp) / ry, (-dx - cxp) / rx, (-dy - cyp) / ry);
    if (sweep === 0 && span > 0) span -= 2 * Math.PI;
    if (sweep === 1 && span < 0) span += 2 * Math.PI;
    for (let step = 0; step <= samples; step++) {
      const a = from + (span * step) / samples;
      at(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
  };

  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++];
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const point = (px: number, py: number): [number, number] =>
      relative ? [x + px, y + py] : [px, py];
    if (upper === "Z") {
      x = startX;
      y = startY;
    } else if (upper === "M") {
      [x, y] = point(number(), number());
      at(x, y);
      startX = x;
      startY = y;
      while (more()) {
        [x, y] = point(number(), number());
        at(x, y);
      }
    } else if (upper === "L") {
      while (more()) {
        [x, y] = point(number(), number());
        at(x, y);
      }
    } else if (upper === "H") {
      while (more()) {
        x = relative ? x + number() : number();
        at(x, y);
      }
    } else if (upper === "V") {
      while (more()) {
        y = relative ? y + number() : number();
        at(x, y);
      }
    } else if (upper === "C" || upper === "Q") {
      // Sampled, not just the control points, so the box is the curve's own.
      const count = upper === "C" ? 3 : 2;
      while (more()) {
        const pairs: [number, number][] = [];
        for (let part = 0; part < count; part++) pairs.push(point(number(), number()));
        const [px, py] = pairs[pairs.length - 1];
        for (let step = 0; step <= samples; step++) {
          const u = step / samples;
          const v = 1 - u;
          if (upper === "C") {
            const [x1, y1] = pairs[0];
            const [x2, y2] = pairs[1];
            at(
              v * v * v * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * px,
              v * v * v * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * py
            );
          } else {
            const [x1, y1] = pairs[0];
            at(v * v * x + 2 * v * u * x1 + u * u * px, v * v * y + 2 * v * u * y1 + u * u * py);
          }
        }
        x = px;
        y = py;
      }
    } else if (upper === "A") {
      while (more()) {
        const rx = number();
        const ry = number();
        number();
        const large = number();
        const sweep = number();
        const [px, py] = point(number(), number());
        arc(rx, ry, px, py, large, sweep);
        x = px;
        y = py;
      }
    } else {
      throw new Error(`unsupported path command ${command}`);
    }
  }
  return points;
}

/** One art's ink extent: its parts' points, each widened by half its stroke. */
function inkBox(
  parts: readonly { d: string; strokeWidth?: number }[]
): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    const half = (part.strokeWidth ?? 0) / 2;
    for (const [px, py] of pathPoints(part.d)) {
      minX = Math.min(minX, px - half);
      minY = Math.min(minY, py - half);
      maxX = Math.max(maxX, px + half);
      maxY = Math.max(maxY, py + half);
    }
  }
  return [minX, minY, maxX, maxY];
}

describe("the base Stamp art", () => {
  it("lists its arts in order, the scale bar last", () => {
    expect(BASE_STAMP_IDS).toEqual(ORDERED_IDS);
    expect(SCALE_BAR_STAMP_REF).toBe("base:scale-bar");
  });

  it("resolves every base ref to its art, and an unknown or foreign ref to nothing", () => {
    for (const id of BASE_STAMP_IDS) {
      expect(stampArt(`base:${id}`)?.id).toBe(id);
    }
    expect(stampArt("base:nope")).toBeUndefined();
    expect(stampArt("marker")).toBeUndefined();
    expect(stampArt("custom:portrait")).toBeUndefined();
    expect(stampArt("")).toBeUndefined();
  });

  it("gives every art but the scale bar one path at least, in a box with an area", () => {
    for (const id of BASE_STAMP_IDS) {
      const art = stampArt(`base:${id}`);
      if (art === undefined) throw new Error(`the ${id} art is missing`);
      const [minX, minY, width, height] = art.viewBox;
      expect(Number.isFinite(minX), `${id} viewBox`).toBe(true);
      expect(Number.isFinite(minY), `${id} viewBox`).toBe(true);
      expect(width, `${id} viewBox`).toBeGreaterThan(0);
      expect(height, `${id} viewBox`).toBeGreaterThan(0);
      if (id === "scale-bar") {
        expect(art.parts).toEqual([]);
      } else {
        expect(art.parts.length, `${id} parts`).toBeGreaterThan(0);
        for (const part of art.parts) {
          expect(part.d.length, `${id} path`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("draws the marker as one-colour ring and dot art", () => {
    const marker = stampArt("base:marker");
    if (marker === undefined) throw new Error("the marker art is missing");

    expect(marker.viewBox).toEqual([-5.4, -5.4, 10.8, 10.8]);
    expect(marker.parts).toHaveLength(2);
    for (const part of marker.parts) {
      expect(part.fill).toBeNull();
    }
    expect(marker.parts[0].d).toMatch(/^M -5 0 /);
  });

  it("keeps every one-colour Stamp to its own colour, with no fixed paint", () => {
    for (const id of ONE_COLOUR_IDS) {
      const art = stampArt(`base:${id}`);
      if (art === undefined) throw new Error(`the ${id} art is missing`);
      for (const part of art.parts) {
        expect(part.fill, `${id} fill`).toBeNull();
        expect(part.stroke ?? null, `${id} stroke`).toBeNull();
        expect(part.strokeWidth ?? 0, `${id} stroke width`).toBe(0);
      }
    }
  });

  it("bakes the multi-colour art's own paint, so no part follows the Stamp", () => {
    for (const id of MULTI_COLOUR_IDS) {
      const art = stampArt(`base:${id}`);
      if (art === undefined) throw new Error(`the ${id} art is missing`);
      for (const part of art.parts) {
        expect(part.fill, `${id} fill`).not.toBeNull();
        if (part.stroke !== undefined) {
          expect(part.stroke, `${id} stroke`).not.toBeNull();
          expect(part.strokeWidth ?? 0, `${id} stroke width`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("draws the compass rose two-tone: a halo body under the Stamp's colour", () => {
    const art = stampArt("base:compass-rose");
    if (art === undefined) throw new Error("the compass rose art is missing");
    expect(art.parts.map((part) => part.fill)).toEqual(["halo", null]);
    expect(art.parts[0].stroke).toBeNull();
    expect(stampTakesColour("base:compass-rose")).toBe(false);
  });

  it("winds the cartouche ribbon's two tails the same way, so both ends match", () => {
    const art = stampArt("base:cartouche");
    if (art === undefined) throw new Error("the cartouche art is missing");
    // Under the nonzero fill rule a tail wound against its scroll roll cancels
    // their overlap, so each tail must turn the same way as the other.
    const tails = art.parts[0].d
      .split("M")
      .map((sub) => sub.trim())
      .filter((sub) => sub.length > 0 && !sub.includes("A"))
      .map((sub) =>
        sub
          .replace("Z", "")
          .split("L")
          .map((pair) => pair.trim().split(/\s+/).map(Number) as [number, number])
      )
      .filter((points) => points.length === 5);
    const turn = (points: [number, number][]): number =>
      Math.sign(
        points.reduce((sum, [x, y], index) => {
          const [nextX, nextY] = points[(index + 1) % points.length];
          return sum + x * nextY - nextX * y;
        }, 0)
      );
    expect(tails).toHaveLength(2);
    expect(turn(tails[0])).toBe(turn(tails[1]));
  });

  it("keeps the burg art's Fantasy Map Generator paint on its bodies and outlines", () => {
    const capital = stampArt("base:capital");
    if (capital === undefined) throw new Error("the capital art is missing");

    // The illustrated burg set paints white open fills and #3e3e4b open
    // strokes, so the walls are white lines over a fixed colour instead of
    // disappearing into the Element's colour.
    expect(capital.parts.some((part) => part.fill === "#ffffff")).toBe(true);
    expect(capital.parts.some((part) => part.stroke === "#3e3e4b")).toBe(true);
    const mountain = stampArt("base:mountain");
    if (mountain === undefined) throw new Error("the mountain art is missing");
    // The relief set paints its open strokes #5c5c70.
    expect(mountain.parts.some((part) => part.stroke === "#5c5c70")).toBe(true);
  });

  it("keeps every in-house Stamp under about 1.5 KB of path data", () => {
    const inHouse = ONE_COLOUR_IDS.filter((id) => id !== "port" && id !== "marker");
    for (const id of inHouse) {
      const art = stampArt(`base:${id}`);
      if (art === undefined) throw new Error(`the ${id} art is missing`);
      const bytes = art.parts.reduce((total, part) => total + part.d.length, 0);
      expect(bytes, `${id} path data`).toBeLessThanOrEqual(1536);
    }
  });

  it("frames each picture tightly on its own ink, padded a little", () => {
    for (const id of BASE_STAMP_IDS) {
      const art = stampArt(`base:${id}`);
      if (art === undefined) throw new Error(`the ${id} art is missing`);
      if (id === "scale-bar") continue;
      const [left, top, width, height] = art.viewBox;
      const box = inkBox(art.parts);
      // 4% of the art's own size on each side, so the box is the art's width.
      expect(left, `${id} left`).toBeCloseTo(box[0] - (box[2] - box[0]) * PAD, 1);
      expect(top, `${id} top`).toBeCloseTo(box[1] - (box[3] - box[1]) * PAD, 1);
      expect(left + width, `${id} right`).toBeCloseTo(box[2] + (box[2] - box[0]) * PAD, 1);
      expect(top + height, `${id} bottom`).toBeCloseTo(box[3] + (box[3] - box[1]) * PAD, 1);
    }
  });

  it("names every Stamp in both runtime catalogs", () => {
    const english = en as Record<string, string>;
    const spanish = es as Record<string, string>;
    for (const id of BASE_STAMP_IDS) {
      expect(english[`stamp.${id}`]?.length ?? 0, `en stamp.${id}`).toBeGreaterThan(0);
      expect(spanish[`stamp.${id}`]?.length ?? 0, `es stamp.${id}`).toBeGreaterThan(0);
    }
  });

  it("builds the catalog key a Stamp's name lives under", () => {
    for (const id of BASE_STAMP_IDS) expect(stampNameKey(id)).toBe(`stamp.${id}`);
    // The Insert tool places the capital until the author picks another.
    expect(DEFAULT_STAMP_ID).toBe("capital");
  });

  it("refuses a key for an id the built-in set does not carry", () => {
    // The type is the guard: only a built-in id reaches a catalog key, so a typo
    // fails the build instead of drawing a Stamp with no name.
    // @ts-expect-error an id outside BASE_STAMP_IDS has no catalog key.
    const unknown: StampNameKey = stampNameKey("nope");
    expect(unknown).toBe("stamp.nope");
  });

  it("tells which art takes the Stamp's colour, and names a base ref", () => {
    expect(baseStampRef("marker")).toBe("base:marker");
    expect(baseStampRef("scale-bar")).toBe(SCALE_BAR_STAMP_REF);
    for (const id of ONE_COLOUR_IDS) {
      expect(stampTakesColour(baseStampRef(id)), id).toBe(true);
    }
    for (const id of MULTI_COLOUR_IDS) {
      expect(stampTakesColour(baseStampRef(id)), id).toBe(false);
    }
    // The scale bar draws in the Stamp's colour; a ref this build does not
    // know draws nothing, so nothing of it could recolour.
    expect(stampTakesColour(SCALE_BAR_STAMP_REF)).toBe(true);
    expect(stampTakesColour("custom:portrait")).toBe(false);
  });

  it("credits the Azgaar art in LICENSES", () => {
    const licenses = readFileSync(join(__dirname, "LICENSES"), "utf8");
    expect(licenses).toContain("MIT");
    expect(licenses).toContain("Azgaar");
    for (const id of AZGAAR_IDS) {
      expect(licenses, id).toContain(id);
    }
  });
});

describe("scaleBarLayout", () => {
  it("labels the largest round distance that fits a 6x9 page", () => {
    // 152.4 mm of page stands for 1000 km, so 40 mm of bar can label 262 km;
    // the largest round number below that is 200 km, drawn 30.48 mm long.
    const layout = scaleBarLayout(152.4, 1000, 40);

    expect(layout.distance).toBe(200);
    expect(layout.lengthMm).toBeCloseTo(30.48, 6);
  });

  it("keeps the bar at the limit when a round distance lands exactly on it", () => {
    // 200 mm of page stands for 1000 km, so 40 mm of bar is exactly 200 km.
    expect(scaleBarLayout(200, 1000, 40)).toEqual({ distance: 200, lengthMm: 40 });
  });

  it("steps down to a fraction of a kilometre for a tiny span", () => {
    const layout = scaleBarLayout(152.4, 0.001, 40);

    expect(layout.distance).toBeCloseTo(0.0002, 12);
    expect(layout.lengthMm).toBeCloseTo(30.48, 6);
  });

  it("steps up past a million for a huge span", () => {
    const layout = scaleBarLayout(152.4, 1_000_000_000, 40);

    expect(layout.distance).toBe(200_000_000);
    expect(layout.lengthMm).toBeCloseTo(30.48, 6);
  });

  it("reads nothing from a page, span, or length with no room", () => {
    expect(scaleBarLayout(0, 1000, 40)).toEqual({ distance: 0, lengthMm: 0 });
    expect(scaleBarLayout(152.4, 0, 40)).toEqual({ distance: 0, lengthMm: 0 });
    expect(scaleBarLayout(152.4, 1000, 0)).toEqual({ distance: 0, lengthMm: 0 });
    expect(scaleBarLayout(Number.NaN, 1000, 40)).toEqual({ distance: 0, lengthMm: 0 });
  });
});
