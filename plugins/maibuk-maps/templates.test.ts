/**
 * The Maps Map Templates (#754): the ready-made Maps an author starts a new Map
 * from. Every test builds the Elements and the whole document a Map made from
 * the Template would hold, then checks it the way the model and the editor do:
 * `isMapDocument`, `findFaces`, and `reconcileFills`, in page millimetres.
 */

import { describe, expect, it } from "vitest";
import { faceAt, findFaces } from "./faces";
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
  MAP_TEMPLATE_IDS,
  TITLE_SIZE_RATIO,
  isMapTemplateId,
  templateElements,
  templateLabelKey,
  templateStyle,
  type MapTemplateId,
} from "./templates";
import { translate } from "./i18n";

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
    ]);
    expect(isMapTemplateId("continent")).toBe(true);
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

  it("covers the sea and each land face with a Fill of its own", () => {
    for (const id of MAP_TEMPLATE_IDS) {
      const elements = elementsOf(id, "portrait");
      const fills = fillsOf(elements);
      const water = fills.filter((fill) => fillRole(fill) === "water");
      const land = fills.filter((fill) => LAND_ROLES.includes(fillRole(fill)));

      expect(water.length, id).toBe(EXPECTED[id].waterFills);
      expect(land.length, id).toBe(EXPECTED[id].landFills);
      expect(fills.length, id).toBe(water.length + land.length);

      const faces = findFaces(linesOf(elements));
      expect(faces.length, id).toBe(EXPECTED[id].faces);
      const landed = fills.map((fill) => faceAt(faces, fill.anchor));
      for (const [index, face] of landed.entries()) {
        expect(face, `${id} fill ${index}`).not.toBeNull();
      }
      // Two Fills in one face would fight over it, so every Fill sits in its own.
      expect(new Set(landed).size, id).toBe(fills.length);
      for (const [index, fill] of fills.entries()) {
        expect(fill.outline, `${id} fill ${index}`).toBeUndefined();
      }
    }
  });

  it("draws a compass rose, a title cartouche, and the title as the only Map Label", () => {
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
      expect(labels, id).toHaveLength(1);
      const [label] = labels;
      expect(label.text, id).toBe(TITLE);
      const cartouche = stampsOf(elements).find(
        (stamp) => stamp.stampRef === "base:cartouche"
      ) as MapStampElement;
      expect(label.x, id).toBeCloseTo(cartouche.transform.x, 6);
      expect(label.y, id).toBeCloseTo(cartouche.transform.y, 6);
    }
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
