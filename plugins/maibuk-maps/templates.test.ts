/**
 * The Maps Map Templates (#754): the ready-made Maps an author starts a new Map
 * from. Every test builds the Elements and the whole document a Map made from
 * the Template would hold, then checks it the way the model and the editor do:
 * `isMapDocument`, `findFaces`, and `reconcileFills`, in page millimetres.
 */

import { describe, expect, it } from "vitest";
import { PLUGIN_MESSAGE_MAX_BYTES } from "@/plugin-sdk/protocol";
import { CUBA_BORDERS, CUBA_COASTS, CUBA_PROVINCES } from "./cuba";
import { faceAt, findFaces, type Face } from "./faces";
import { reconcileFills } from "./fills";
import {
  DATA_VERSION,
  PAGE_PRESETS,
  PAGE_SIZES,
  isMapDocument,
  type MapDocument,
  type MapElement,
  type MapFillElement,
  type MapLabelElement,
  type MapLineElement,
  type MapPoint,
  type MapStampElement,
  type PagePreset,
} from "./maps";
import { stampArt } from "./stamps";
import { isMapStyleId } from "./styles";
import {
  CARTOUCHE_ART_WIDTH,
  CARTOUCHE_PLAQUE_HEIGHT,
  CARTOUCHE_PLAQUE_WIDTH,
  GEOGRAPHY_MARGIN,
  MAP_TEMPLATE_IDS,
  TITLE_SIZE_RATIO,
  isMapTemplateId,
  templateElements,
  templateLabelKey,
  templateStyle,
  type MapTemplateId,
} from "./templates";
import { translate } from "./i18n";

/** The page the Cuba Template's size and labels are measured on: A4, upright. */
const A4 = { widthMm: 210, heightMm: 297 };

/** The Map name every test starts from. */
const TITLE = "The Reach";

/** The Fill roles that cover land, whichever land a Template has. */
const LAND_ROLES = ["land", "forest", "desert"];

/** What each Template draws, as the faces and Fills an author can see. */
const EXPECTED: Readonly<
  Record<MapTemplateId, { style: string; waterFills: number; landFills: number; faces: number }>
> = {
  continent: { style: "atlas", waterFills: 1, landFills: 1, faces: 2 },
  // Six islands of varied size, one Fill each.
  archipelago: { style: "parchment", waterFills: 1, landFills: 6, faces: 7 },
  "two-continents": { style: "atlas", waterFills: 1, landFills: 2, faces: 3 },
  // The outer face is land, and the kingdom inside its border is a second land face.
  "inland-kingdom": { style: "parchment", waterFills: 0, landFills: 2, faces: 2 },
  "blank-sea": { style: "atlas", waterFills: 1, landFills: 0, faces: 1 },
  // Real geography: the sea, fifteen provinces, and Isla de la Juventud.
  cuba: { style: "atlas", waterFills: 1, landFills: 16, faces: 17 },
};

/** A fresh id for every Element, so two calls never share one. */
function idMaker(): () => string {
  let next = 0;
  return () => `t${++next}`;
}

/** The Elements a Template draws on one page preset. */
function elementsOf(
  id: MapTemplateId,
  preset: PagePreset = "landscape",
  title = TITLE
): MapElement[] {
  return templateElements(id, PAGE_SIZES[preset], title, idMaker());
}

/** The whole document a Map made from a Template would store. */
function documentOf(id: MapTemplateId, preset: PagePreset = "landscape"): MapDocument {
  return {
    id: "map1",
    bookId: null,
    name: TITLE,
    page: { preset, ...PAGE_SIZES[preset] },
    styleId: templateStyle(id),
    overrides: {},
    elements: elementsOf(id, preset),
    createdAt: 1,
    updatedAt: 1,
    dataVersion: DATA_VERSION,
  };
}

function linesOf(elements: readonly MapElement[]): MapLineElement[] {
  return elements.filter((element): element is MapLineElement => element.kind === "line");
}

function fillsOf(elements: readonly MapElement[]): MapFillElement[] {
  return elements.filter((element): element is MapFillElement => element.kind === "fill");
}

function stampsOf(elements: readonly MapElement[]): MapStampElement[] {
  return elements.filter((element): element is MapStampElement => element.kind === "stamp");
}

function labelsOf(elements: readonly MapElement[]): MapLabelElement[] {
  return elements.filter((element): element is MapLabelElement => element.kind === "label");
}

/** The world border: the closed line that spans nearly the whole page. */
function worldBorderOf(elements: readonly MapElement[], preset: PagePreset): MapLineElement {
  const page = PAGE_SIZES[preset];
  const border = linesOf(elements).find((element) => {
    if (!element.closed || !element.enclosesFills) return false;
    const xs = element.points.map((point) => point[0]);
    const ys = element.points.map((point) => point[1]);
    return (
      Math.max(...xs) - Math.min(...xs) > page.widthMm * 0.8 &&
      Math.max(...ys) - Math.min(...ys) > page.heightMm * 0.8
    );
  });
  if (border === undefined) throw new Error(`no world border on ${preset}`);
  return border;
}

/** The land a Template draws: every line but the page-wide world border. */
function landLinesOf(elements: readonly MapElement[], preset: PagePreset): MapLineElement[] {
  const border = worldBorderOf(elements, preset);
  return linesOf(elements).filter((element) => element !== border);
}

/** A line's bounding box, in page millimetres. */
function boundsOf(line: MapLineElement): { width: number; height: number } {
  const xs = line.points.map((point) => point[0]);
  const ys = line.points.map((point) => point[1]);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** A Fill's colour role, which is all a Template Fill holds. */
function fillRole(fill: MapFillElement): string {
  return fill.content.color ?? "";
}

/** The faces a Template's lines enclose, read the way the editor reads them. */
function facesOf(elements: readonly MapElement[]): Face[] {
  return findFaces(linesOf(elements));
}

/** Every point a Template draws, with the element it belongs to. */
function pointsOf(elements: readonly MapElement[]): MapPoint[] {
  const points: MapPoint[] = [];
  for (const element of elements) {
    if (element.kind === "line") points.push(...element.points);
    if (element.kind === "fill") points.push(element.anchor);
    if (element.kind === "stamp") points.push([element.transform.x, element.transform.y]);
    if (element.kind === "label") points.push([element.x, element.y]);
  }
  return points;
}

/** Every Element of the document without its id, which is what a copy keeps. */
function geometryOf(elements: readonly MapElement[]): unknown[] {
  return elements.map(({ id: _id, ...rest }) => rest);
}

describe("MAP_TEMPLATE_IDS", () => {
  it("names every Template, and only those names", () => {
    expect([...MAP_TEMPLATE_IDS]).toEqual([
      "continent",
      "archipelago",
      "two-continents",
      "inland-kingdom",
      "blank-sea",
      "cuba",
    ]);
    expect(isMapTemplateId("continent")).toBe(true);
    expect(isMapTemplateId("cuba")).toBe(true);
    expect(isMapTemplateId("blank-sea")).toBe(true);
    expect(isMapTemplateId("blank")).toBe(false);
    expect(isMapTemplateId("")).toBe(false);
    expect(isMapTemplateId(null)).toBe(false);
    expect(isMapTemplateId(7)).toBe(false);
  });
});

describe("templateStyle", () => {
  it("gives every Template the Map Style it is drawn in", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      expect(templateStyle(id)).toBe(EXPECTED[id].style);
      expect(isMapStyleId(templateStyle(id))).toBe(true);
    }
    expect(templateStyle("inland-kingdom")).toBe("parchment");
  });
});

describe("templateLabelKey", () => {
  it("gives every Template its Start from label, in both languages", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      const key = templateLabelKey(id);
      expect(key).toBe(`template.${id}`);
      expect(translate("en", key)).not.toBe(key);
      expect(translate("es", key)).not.toBe(key);
    }
  });
});

describe("templateElements", () => {
  it("builds a document the model accepts, for every Template on every page preset", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      for (const preset of PAGE_PRESETS) {
        const doc = documentOf(id, preset);
        expect(isMapDocument(doc), `${id} on ${preset}`).toBe(true);
        expect(doc.elements.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps every point on the page and gives every Element its own id", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      for (const preset of PAGE_PRESETS) {
        const page = PAGE_SIZES[preset];
        const elements = elementsOf(id, preset);
        for (const [x, y] of pointsOf(elements)) {
          expect(x, `${id} on ${preset}`).toBeGreaterThanOrEqual(0);
          expect(x, `${id} on ${preset}`).toBeLessThanOrEqual(page.widthMm);
          expect(y, `${id} on ${preset}`).toBeGreaterThanOrEqual(0);
          expect(y, `${id} on ${preset}`).toBeLessThanOrEqual(page.heightMm);
        }
        const ids = elements.map((element) => element.id);
        expect(new Set(ids).size, `${id} on ${preset}`).toBe(ids.length);
      }
    }
  });

  it("names every Element, as the editor's own Elements are named", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      for (const element of elementsOf(id)) {
        expect(element.name, `${id} ${element.kind}`).not.toBe("");
        if (element.kind === "line") expect(element.name, id).toMatch(/^Map Line \d+$/);
        if (element.kind === "fill") expect(element.name, id).toMatch(/^Fill \d+$/);
        if (element.kind === "label") expect(element.name, id).toMatch(/^Map Label \d+$/);
      }
    }
  });

  it("names every Element in the author's language", () => {
    const spanish = templateElements("archipelago", PAGE_SIZES.landscape, TITLE, idMaker(), "es");
    const names = spanish.map((element) => element.name);
    expect(names).toContain("Línea de mapa 1");
    expect(names).toContain("Relleno 1");
    expect(names).toContain("Etiqueta de mapa 1");
    expect(names).toContain("Rosa de los vientos");
    expect(names).toContain("Cartela de título");
    // With no language named, an Element keeps the English catalog's words.
    expect(elementsOf("archipelago").map((element) => element.name)).toContain("Compass rose");
  });

  it("frames the page with a closed border line that encloses Fills", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      for (const preset of PAGE_PRESETS) {
        const page = PAGE_SIZES[preset];
        const border = linesOf(elementsOf(id, preset)).find((element) => {
          if (!element.closed || !element.enclosesFills) return false;
          const xs = element.points.map((point) => point[0]);
          const ys = element.points.map((point) => point[1]);
          return (
            Math.max(...xs) - Math.min(...xs) > page.widthMm * 0.8 &&
            Math.max(...ys) - Math.min(...ys) > page.heightMm * 0.8
          );
        });
        expect(border, `${id} on ${preset}`).toBeDefined();
        for (const [x, y] of border?.points ?? []) {
          expect(x, `${id} on ${preset}`).toBeGreaterThan(1);
          expect(y, `${id} on ${preset}`).toBeGreaterThan(1);
          expect(x, `${id} on ${preset}`).toBeLessThan(page.widthMm - 1);
          expect(y, `${id} on ${preset}`).toBeLessThan(page.heightMm - 1);
        }
      }
    }
  });

  it("draws the world border as a coast only where it meets the sea", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      for (const preset of PAGE_PRESETS) {
        const border = worldBorderOf(elementsOf(id, preset), preset);
        const expected = id === "inland-kingdom" ? "plain" : "coast";
        expect(border.style, `${id} on ${preset}`).toBe(expected);
      }
    }

    // The inland kingdom has no coast at all: its border and river keep their own styles.
    const lines = linesOf(elementsOf("inland-kingdom"));
    expect(lines.filter((line) => line.style === "coast")).toHaveLength(0);
    expect(lines.filter((line) => line.style === "border")).toHaveLength(1);
    expect(lines.filter((line) => line.style === "river")).toHaveLength(1);
  });

  it("covers the sea and each land face with a Fill of its own on every page preset", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      for (const preset of PAGE_PRESETS) {
        const where = `${id} on ${preset}`;
        const elements = elementsOf(id, preset);
        const fills = fillsOf(elements);
        const water = fills.filter((fill) => fillRole(fill) === "water");
        const land = fills.filter((fill) => LAND_ROLES.includes(fillRole(fill)));

        expect(water.length, where).toBe(EXPECTED[id].waterFills);
        expect(land.length, where).toBe(EXPECTED[id].landFills);
        expect(fills.length, where).toBe(water.length + land.length);

        const faces = facesOf(elements);
        expect(faces.length, where).toBe(EXPECTED[id].faces);
        const landed = fills.map((fill) => faceAt(faces, fill.anchor));
        for (const [index, face] of landed.entries()) {
          expect(face, `${where} fill ${index}`).not.toBeNull();
        }
        // Two Fills in one face would fight over it, so every Fill sits in its own.
        expect(new Set(landed).size, where).toBe(fills.length);
        for (const [index, fill] of fills.entries()) {
          expect(fill.outline, `${where} fill ${index}`).toBeUndefined();
        }
      }
    }
  });

  it("draws a compass rose, a title cartouche, and the title as the first Map Label", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      const elements = elementsOf(id);
      const stamps = stampsOf(elements).map((stamp) => stamp.stampRef);
      expect(
        stamps.filter((ref) => ref === "base:compass-rose"),
        id
      ).toHaveLength(1);
      expect(
        stamps.filter((ref) => ref === "base:cartouche"),
        id
      ).toHaveLength(1);

      const labels = labelsOf(elements);
      const [label] = labels;
      expect(label.text, id).toBe(TITLE);
      const cartouche = stampsOf(elements).find(
        (stamp) => stamp.stampRef === "base:cartouche"
      ) as MapStampElement;
      expect(label.x, id).toBeCloseTo(cartouche.transform.x, 6);
      expect(label.y, id).toBeCloseTo(cartouche.transform.y, 6);
      // Only a political Template names places after the title.
      expect(labels, id).toHaveLength(1 + (id === "cuba" ? CUBA_PROVINCES.length : 0));
    }
  });

  it("draws Cuba's generated coasts and province borders as real geography", () => {
    const elements = elementsOf("cuba", "portrait");
    const land = landLinesOf(elements, "portrait");
    const coasts = land.filter((line) => line.style === "coast");
    const borders = land.filter((line) => line.style === "border");

    // Two generated islands and thirty-eight generated border arcs.
    expect(CUBA_COASTS).toHaveLength(2);
    expect(CUBA_BORDERS).toHaveLength(38);
    expect(coasts).toHaveLength(CUBA_COASTS.length);
    expect(borders).toHaveLength(CUBA_BORDERS.length);

    // Real geography is neither smoothed nor roughened, and every coast closes.
    expect(coasts.map((coast) => coast.points.length)).toEqual(
      CUBA_COASTS.map((ring) => ring.length)
    );
    for (const coast of coasts) {
      expect(coast.closed).toBe(true);
      expect(coast.roughened).toBe(false);
      expect(coast.curves.every((curved) => !curved)).toBe(true);
      expect(coast.enclosesFills).toBe(true);
    }

    // One open line per generated border arc, its ends left where they meet.
    expect(borders.map((border) => border.points.length)).toEqual(
      CUBA_BORDERS.map((path) => path.length)
    );
    for (const border of borders) {
      expect(border.closed).toBe(false);
      expect(border.roughened).toBe(false);
      expect(border.curves.every((curved) => !curved)).toBe(true);
      // The border line style encloses Fills, which is what splits the land.
      expect(border.enclosesFills).toBe(true);
    }
  });

  it("covers Cuba's sea and provinces with a Fill and a Map Label of their own", () => {
    const elements = elementsOf("cuba", "portrait");
    const fills = fillsOf(elements);
    expect(fills).toHaveLength(17);
    expect(fills.filter((fill) => fillRole(fill) === "water")).toHaveLength(1);
    expect(fills.filter((fill) => fillRole(fill) === "land")).toHaveLength(16);

    const faces = facesOf(elements);
    expect(faces).toHaveLength(17);
    // Every province Fill sits in a face of its own, beside the sea's.
    const landed = fills.map((fill) => faceAt(faces, fill.anchor));
    expect(landed.every((face) => face !== null)).toBe(true);
    expect(new Set(landed).size).toBe(fills.length);

    // One ordinary Map Label per province, numbered on after the title's.
    const labels = labelsOf(elements).slice(1);
    expect(labels.map((label) => label.text)).toEqual(
      CUBA_PROVINCES.map((province) => province.name)
    );
    expect(labels.map((label) => label.name)).toEqual(
      CUBA_PROVINCES.map((_province, index) => `Map Label ${index + 2}`)
    );
    for (const label of labels) {
      expect(label.hidden).toBe(false);
      expect(label.locked).toBe(false);
    }
  });

  it("fits Cuba to the page inside the world border, clear of the cartouche and compass", () => {
    // The box the fit keeps: the island's own bounds in unit coordinates.
    const unitXs = CUBA_COASTS.flat().map((point) => point[0]);
    const unitYs = CUBA_COASTS.flat().map((point) => point[1]);
    const unitWidth = Math.max(...unitXs) - Math.min(...unitXs);
    const unitHeight = Math.max(...unitYs) - Math.min(...unitYs);

    for (const preset of PAGE_PRESETS) {
      const elements = elementsOf("cuba", preset);
      const border = worldBorderOf(elements, preset);
      const borderXs = border.points.map((point) => point[0]);
      const borderYs = border.points.map((point) => point[1]);
      const [left, right] = [Math.min(...borderXs), Math.max(...borderXs)];
      const [top, bottom] = [Math.min(...borderYs), Math.max(...borderYs)];

      const islandPoints = landLinesOf(elements, preset).flatMap((line) => line.points);
      const xs = islandPoints.map((point) => point[0]);
      const ys = islandPoints.map((point) => point[1]);
      const island = {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      };

      // Inside the world border by a margin of GEOGRAPHY_MARGIN of the inner
      // page on every side. Cuba is a long island, so the width is what binds:
      // it takes the whole width the margin leaves, rather than the page's
      // shorter side as a hand-drawn Template does.
      const marginX = (right - left) * GEOGRAPHY_MARGIN;
      const marginY = (bottom - top) * GEOGRAPHY_MARGIN;
      expect(island.left, preset).toBeCloseTo(left + marginX, 6);
      expect(island.right, preset).toBeCloseTo(right - marginX, 6);
      expect(island.top, preset).toBeGreaterThanOrEqual(top + marginY - 1e-6);
      expect(island.bottom, preset).toBeLessThanOrEqual(bottom - marginY + 1e-6);

      // Aspect kept, and centred between the top and bottom margins.
      expect((island.right - island.left) / (island.bottom - island.top), preset).toBeCloseTo(
        unitWidth / unitHeight,
        6
      );
      expect(island.top - top - marginY, preset).toBeCloseTo(bottom - marginY - island.bottom, 6);

      // The cartouche and the compass keep their places, and neither stands on
      // the island: each Stamp's art box is clear of the island's box.
      for (const stamp of stampsOf(elements)) {
        const art = stampArt(stamp.stampRef);
        const halfWidth = stamp.transform.size / 2;
        const halfHeight =
          art === undefined ? halfWidth : (halfWidth * art.viewBox[3]) / art.viewBox[2];
        const box = {
          left: stamp.transform.x - halfWidth,
          right: stamp.transform.x + halfWidth,
          top: stamp.transform.y - halfHeight,
          bottom: stamp.transform.y + halfHeight,
        };
        const apart =
          island.right <= box.left ||
          box.right <= island.left ||
          island.bottom <= box.top ||
          box.bottom <= island.top;
        expect(apart, `${preset}: ${stamp.name}`).toBe(true);
      }
    }
  });

  it("sizes the province Labels to the fitted island, apart from each other on every page", () => {
    /** A province Label's box at a cap size: its point, its width estimate, and its cap height. */
    const boxesAt = (labels: readonly MapLabelElement[], size: number) =>
      labels.map((label) => {
        const halfWidth = (label.text.length * size * 0.6) / 2;
        return {
          name: label.text,
          left: label.x - halfWidth,
          right: label.x + halfWidth,
          top: label.y - size / 2,
          bottom: label.y + size / 2,
        };
      });
    /** The pairs of those boxes that overlap. */
    const clashes = (boxes: ReturnType<typeof boxesAt>): string[] => {
      const found: string[] = [];
      for (let one = 0; one < boxes.length; one++) {
        for (let two = one + 1; two < boxes.length; two++) {
          const a = boxes[one];
          const b = boxes[two];
          const apart =
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          if (!apart) found.push(`${a.name} beside ${b.name}`);
        }
      }
      return found;
    };

    // On a landscape A4 page the cap is about 2 mm. Cuba's provinces are too
    // close for the 2.5 mm the island could carry: at that size two Labels sit
    // on each other, so the size is the largest one that keeps them apart.
    const a4Landscape = { widthMm: 297, heightMm: 210 };
    const [a4Title, ...a4Labels] = labelsOf(
      templateElements("cuba", a4Landscape, TITLE, idMaker())
    );
    expect(a4Labels[0].size).toBeCloseTo(1.97, 1);
    expect(a4Labels[0].size).toBeLessThan(a4Title.size);
    expect(clashes(boxesAt(a4Labels, 2.5)).length).toBeGreaterThan(0);
    expect(clashes(boxesAt(a4Labels, a4Labels[0].size))).toEqual([]);

    /** A province Label's cap size as a share of the island's fitted width on one preset. */
    const shareOfIsland = (preset: PagePreset): number => {
      const elements = elementsOf("cuba", preset);
      const [first] = labelsOf(elements).slice(1);
      const xs = landLinesOf(elements, preset).flatMap((line) =>
        line.points.map((point) => point[0])
      );
      return first.size / (Math.max(...xs) - Math.min(...xs));
    };
    for (const preset of PAGE_PRESETS) {
      expect(shareOfIsland(preset), preset).toBeCloseTo(shareOfIsland("landscape"), 6);
      const labels = labelsOf(elementsOf("cuba", preset)).slice(1);
      expect(clashes(boxesAt(labels, labels[0].size)), preset).toEqual([]);
    }
  });

  it("places Cuba's province Labels on their points, uncluttered on A4", () => {
    const elements = templateElements("cuba", A4, TITLE, idMaker());
    const [titleLabel, ...labels] = labelsOf(elements);

    // The two provinces farthest apart in the unit square give the scale from
    // unit coordinates to page millimetres.
    const unitXs = CUBA_PROVINCES.map((province) => province.point[0]);
    const west = unitXs.indexOf(Math.min(...unitXs));
    const east = unitXs.indexOf(Math.max(...unitXs));
    const scale = (labels[east].x - labels[west].x) / (unitXs[east] - unitXs[west]);
    for (const [index, label] of labels.entries()) {
      const [x, y] = CUBA_PROVINCES[index].point;
      expect(label.x, label.text).toBeCloseTo(labels[west].x + (x - unitXs[west]) * scale, 6);
      expect(label.y, label.text).toBeCloseTo(
        labels[west].y + (y - CUBA_PROVINCES[west].point[1]) * scale,
        6
      );
      expect(label.x, label.text).toBeGreaterThan(0);
      expect(label.x, label.text).toBeLessThan(A4.widthMm);
      expect(label.y, label.text).toBeGreaterThan(0);
      expect(label.y, label.text).toBeLessThan(A4.heightMm);
      // Small enough for a dense island, and smaller than the Map's own title.
      expect(label.size, label.text).toBeGreaterThanOrEqual(1);
      expect(label.size, label.text).toBeLessThan(titleLabel.size);
    }

    // No two province Labels overlap: a serif glyph takes about 0.6 of the cap
    // size, and a line of text stands a little taller than its caps.
    const glyphWidth = 0.6;
    const lineHeight = 1.2;
    const boxes = labels.map((label) => {
      const halfWidth = (label.text.length * label.size * glyphWidth) / 2;
      const halfHeight = (label.size * lineHeight) / 2;
      return {
        name: label.text,
        left: label.x - halfWidth,
        right: label.x + halfWidth,
        top: label.y - halfHeight,
        bottom: label.y + halfHeight,
      };
    });
    for (let one = 0; one < boxes.length; one++) {
      for (let two = one + 1; two < boxes.length; two++) {
        const a = boxes[one];
        const b = boxes[two];
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        expect(apart, `${a.name} beside ${b.name}`).toBe(true);
      }
    }
  });

  it("keeps Cuba live: a moved province border reshapes both neighbouring Fills", () => {
    const before = elementsOf("cuba", "portrait");
    // Read the faces with the editor's default tolerance, as a Map opened from
    // this Template is read once it is on screen.
    const facesBefore = findFaces(linesOf(before));
    const fills = fillsOf(before);
    const labelOf = (name: string): MapLabelElement => {
      const label = labelsOf(before).find((candidate) => candidate.text === name);
      if (label === undefined) throw new Error(`no Label names ${name}`);
      return label;
    };
    /** The Fill sitting in the same face as a province's Label. */
    const fillOf = (label: MapLabelElement): MapFillElement => {
      const face = faceAt(facesBefore, [label.x, label.y]);
      const fill = fills.find((candidate) => faceAt(facesBefore, candidate.anchor) === face);
      if (fill === undefined) throw new Error(`no Fill covers ${label.text}`);
      return fill;
    };

    const holguinFill = fillOf(labelOf("Holguín"));
    const granmaFill = fillOf(labelOf("Granma"));
    expect(holguinFill.id).not.toBe(granmaFill.id);

    // The border between the two is the one running nearest their midpoint.
    const holguin = labelOf("Holguín");
    const granma = labelOf("Granma");
    const middle: MapPoint = [(holguin.x + granma.x) / 2, (holguin.y + granma.y) / 2];
    const distanceTo = (border: MapLineElement): number =>
      Math.min(...border.points.map(([x, y]) => Math.hypot(x - middle[0], y - middle[1])));
    const borders = linesOf(before).filter((line) => line.style === "border");
    const border = borders.reduce((nearest, candidate) =>
      distanceTo(candidate) < distanceTo(nearest) ? candidate : nearest
    );
    expect(distanceTo(border)).toBeLessThan(2);

    // Move one interior point of that border a few millimetres sideways.
    const moved = Math.floor(border.points.length / 2);
    const points = border.points.map(
      (point, index): MapPoint => (index === moved ? [point[0] + 3, point[1]] : point)
    );
    const edited = before.map((element) =>
      element.id === border.id && element.kind === "line" ? { ...element, points } : element
    );

    const facesAfter = findFaces(linesOf(edited));
    expect(facesAfter).toHaveLength(facesBefore.length);

    const holguinBefore = faceAt(facesBefore, holguinFill.anchor);
    const granmaBefore = faceAt(facesBefore, granmaFill.anchor);
    const holguinAfter = faceAt(facesAfter, holguinFill.anchor);
    const granmaAfter = faceAt(facesAfter, granmaFill.anchor);
    expect(holguinBefore).not.toBeNull();
    expect(granmaBefore).not.toBeNull();
    expect(holguinAfter).not.toBeNull();
    expect(granmaAfter).not.toBeNull();
    if (
      holguinBefore === null ||
      granmaBefore === null ||
      holguinAfter === null ||
      granmaAfter === null
    ) {
      return;
    }
    // Both faces moved with the border, and neither Fill fell out of one.
    expect(Math.abs(holguinAfter.area - holguinBefore.area)).toBeGreaterThan(0.5);
    expect(Math.abs(granmaAfter.area - granmaBefore.area)).toBeGreaterThan(0.5);
  });

  it("keeps a Cuba Map well inside the per-Map storage cap", () => {
    const elements = templateElements("cuba", A4, "Cuba", idMaker());
    const bytes = new TextEncoder().encode(JSON.stringify(elements)).length;
    expect(bytes).toBeLessThan(PLUGIN_MESSAGE_MAX_BYTES / 2);
  });

  it("fits the title Label in the cartouche plaque, scaling it with the page", () => {
    const samples = PAGE_PRESETS.map((preset) => {
      const elements = elementsOf("continent", preset);
      const cartouche = stampsOf(elements).find(
        (stamp) => stamp.stampRef === "base:cartouche"
      ) as MapStampElement;
      const [label] = labelsOf(elements);
      const plaqueWidth = cartouche.transform.size * (CARTOUCHE_PLAQUE_WIDTH / CARTOUCHE_ART_WIDTH);
      const plaqueHeight =
        cartouche.transform.size * (CARTOUCHE_PLAQUE_HEIGHT / CARTOUCHE_ART_WIDTH);
      return { preset, cartouche, label, plaqueWidth, plaqueHeight };
    });

    for (const { preset, label, plaqueWidth, plaqueHeight } of samples) {
      expect(label.width, preset).toBeLessThanOrEqual(plaqueWidth);
      expect(label.size, preset).toBeCloseTo(plaqueHeight * TITLE_SIZE_RATIO, 6);
      expect(label.size, preset).toBeLessThan(plaqueHeight);
    }

    // The title grows with the cartouche, rather than staying at a fixed size.
    const bySize = [...samples].sort(
      (one, two) => one.cartouche.transform.size - two.cartouche.transform.size
    );
    for (let index = 1; index < bySize.length; index++) {
      expect(bySize[index].label.size, bySize[index].preset).toBeGreaterThan(
        bySize[index - 1].label.size
      );
    }
  });

  it("ties the plaque constants to the cartouche art", () => {
    const art = stampArt("base:cartouche");
    expect(art?.viewBox[2]).toBe(CARTOUCHE_ART_WIDTH);
    expect(CARTOUCHE_PLAQUE_WIDTH).toBeLessThan(CARTOUCHE_ART_WIDTH);
    expect(CARTOUCHE_PLAQUE_HEIGHT).toBeLessThan(art?.viewBox[3] ?? 0);
  });

  it("copies: two calls draw the same geometry with ids and objects of their own", () => {
    const newId = idMaker();
    const first = templateElements("archipelago", PAGE_SIZES.landscape, TITLE, newId);
    const second = templateElements("archipelago", PAGE_SIZES.landscape, TITLE, newId);

    expect(geometryOf(first)).toEqual(geometryOf(second));
    const firstIds = new Set(first.map((element) => element.id));
    for (const element of second) expect(firstIds.has(element.id)).toBe(false);

    // Nothing is shared, down to the points and the nested Stamp fields.
    for (const [index, element] of first.entries()) {
      expect(element).not.toBe(second[index]);
      if (element.kind === "line" && second[index].kind === "line") {
        expect(element.points).not.toBe(second[index].points);
        expect(element.points[0]).not.toBe(second[index].points[0]);
      }
      if (element.kind === "fill" && second[index].kind === "fill") {
        expect(element.anchor).not.toBe(second[index].anchor);
        expect(element.content).not.toBe(second[index].content);
      }
      if (element.kind === "stamp" && second[index].kind === "stamp") {
        expect(element.transform).not.toBe(second[index].transform);
      }
    }
  });

  it("does not share a Template's Elements with a later Map", () => {
    const first = elementsOf("continent");
    const line = first.find((element): element is MapLineElement => element.kind === "line");
    const fill = first.find((element): element is MapFillElement => element.kind === "fill");
    expect(line).toBeDefined();
    expect(fill).toBeDefined();
    if (line !== undefined) {
      line.points[0][0] += 25;
      line.name = "Moved";
    }
    if (fill !== undefined) {
      fill.anchor[1] += 25;
      fill.content.color = "desert";
    }
    first.pop();

    const later = elementsOf("continent");
    const fresh = elementsOf("continent");
    expect(geometryOf(later)).toEqual(geometryOf(fresh));
    expect(later).toHaveLength(fresh.length);
  });

  it("stays live: a moved coast point keeps the sea and land Fills on their faces", () => {
    const before = elementsOf("continent", "portrait");
    const coast = linesOf(before).find((element) => element.points.length > 4);
    expect(coast).toBeDefined();
    if (coast === undefined) return;

    const top = coast.points.reduce(
      (best, point, index) => (point[1] < coast.points[best][1] ? index : best),
      0
    );
    const points = coast.points.map(
      (point, index): MapPoint => (index === top ? [point[0], point[1] - 5] : point)
    );
    const edited = before.map((element) =>
      element.id === coast.id && element.kind === "line" ? { ...element, points } : element
    );

    const reconciled = reconcileFills(before, edited);
    const fills = fillsOf(reconciled);
    expect(fills).toHaveLength(2);
    const sea = fills.find((fill) => fillRole(fill) === "water");
    const land = fills.find((fill) => LAND_ROLES.includes(fillRole(fill)));
    expect(sea).toBeDefined();
    expect(land).toBeDefined();
    if (sea === undefined || land === undefined) return;

    const facesAfter = findFaces(linesOf(edited));
    const seaAfter = faceAt(facesAfter, sea.anchor);
    const landAfter = faceAt(facesAfter, land.anchor);
    expect(seaAfter).not.toBeNull();
    expect(landAfter).not.toBeNull();

    const facesBefore = findFaces(linesOf(before));
    const landBefore = faceAt(facesBefore, land.anchor);
    expect(landBefore).not.toBeNull();
    if (landAfter === null || landBefore === null) return;
    // The coast moved outward, so the land's face grew and both Fills stayed on theirs.
    expect(landAfter.area).toBeGreaterThan(landBefore.area);
  });

  it("fits a Template to any page size the store can make", () => {
    const portrait = templateElements("continent", PAGE_SIZES.portrait, TITLE, idMaker());
    const square = templateElements("continent", PAGE_SIZES.square, TITLE, idMaker());
    const widest = (elements: readonly MapElement[]): number =>
      Math.max(...linesOf(elements).flatMap((line) => line.points.map((point) => point[0])));
    // Land is centred on a square sized by the shorter side, so it takes the
    // same share of these two pages' widths.
    expect(widest(portrait) / PAGE_SIZES.portrait.widthMm).toBeCloseTo(
      widest(square) / PAGE_SIZES.square.widthMm,
      6
    );
    expect(widest(portrait)).toBeLessThan(PAGE_SIZES.portrait.widthMm);
  });

  it("keeps land shapes' aspect ratio on every page, inside the border", () => {
    /** The bounding-box aspect ratio of one Template's land, on one preset. */
    const landAspect = (preset: PagePreset): number => {
      const elements = elementsOf("continent", preset);
      const [coast] = landLinesOf(elements, preset);
      const { width, height } = boundsOf(coast);
      return width / height;
    };
    expect(landAspect("portrait")).toBeCloseTo(landAspect("landscape"), 6);

    // The land sits inside the page-wide border on each page, not stretched to it.
    for (const preset of PAGE_PRESETS) {
      const elements = elementsOf("inland-kingdom", preset);
      const border = worldBorderOf(elements, preset);
      const xs = border.points.map((point) => point[0]);
      const ys = border.points.map((point) => point[1]);
      const [left, right] = [Math.min(...xs), Math.max(...xs)];
      const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
      for (const line of landLinesOf(elements, preset)) {
        for (const [x, y] of line.points) {
          expect(x, `${preset} x`).toBeGreaterThanOrEqual(left);
          expect(x, `${preset} x`).toBeLessThanOrEqual(right);
          expect(y, `${preset} y`).toBeGreaterThanOrEqual(top);
          expect(y, `${preset} y`).toBeLessThanOrEqual(bottom);
        }
      }
    }
  });
});
