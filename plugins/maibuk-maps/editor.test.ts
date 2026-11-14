/**
 * The Map editor's exact Shapes (#747): the lines a draw or a keyboard places
 * make, the number fields that resize, turn, and reshape one, and what the
 * Eraser and Roughen leave of it. Every test drives the editor the way the Frame
 * and the host do, through Frame messages and its own methods, and reads the
 * snapshot the page draws.
 */

import { describe, expect, it, vi } from "vitest";
import type { AssetIndexEntry, CustomFill, MapAsset } from "./assets";
import {
  DEFAULT_SOFT_EDGE_MM,
  MAX_SOFT_EDGE_MM,
  MAX_ZOOM,
  MIN_SOFT_EDGE_MM,
  MIN_ZOOM,
  createMapEditor,
  type MapEditor,
} from "./editor";
import { parseFrameMessage, type FrameSceneMessage } from "./frame-protocol";
import { shapeOutline } from "./geometry";
import { format } from "./i18n";
import { mapLibrary, smoothStroke } from "./scene";
import {
  DATA_VERSION,
  DEFAULT_FILL_COLOR,
  DEFAULT_LABEL_FONT,
  DEFAULT_LABEL_HALO_MM,
  DEFAULT_LABEL_SIZE_MM,
  DEFAULT_LABEL_WIDTH_MM,
  DEFAULT_POLYGON_SIDES,
  DEFAULT_SCALE_BAR_SIZE_MM,
  DEFAULT_SHAPE_SIZE_MM,
  DEFAULT_STAMP_SIZE_MM,
  MIN_LABEL_SIZE_MM,
  MIN_LABEL_WIDTH_MM,
  MIN_STAMP_SIZE_MM,
  MAX_IMAGE_OPACITY,
  newLabel,
  type MapDocument,
  type MapElement,
  type MapFillContent,
  type MapFillElement,
  type MapImageElement,
  type MapLabelElement,
  type MapLabelFont,
  type MapLineElement,
  type MapPoint,
  type MapShape,
  type MapStampElement,
  type StampScaleUnit,
} from "./maps";
import {
  DEFAULT_SCATTER_SPACING_MM,
  MAX_SCATTER_SPACING_MM,
  MIN_SCATTER_SPACING_MM,
} from "./scatter";
import { MAP_STYLES, resolveColor, type MapStyleId } from "./styles";

/** An editor over a square 200 by 100 mm Map, with a store that drops its saves. */
function openEditor(elements: MapElement[] = []) {
  const doc: MapDocument = {
    id: "map-1",
    bookId: null,
    name: "Map",
    page: { preset: "square", widthMm: 200, heightMm: 100 },
    styleId: "atlas",
    overrides: {},
    elements,
    createdAt: 0,
    updatedAt: 0,
    dataVersion: DATA_VERSION,
  };
  const editor = createMapEditor({
    store: {
      save: async () => {
        /* These tests read the editor's snapshot, not what it writes. */
      },
    },
    doc,
    language: () => "en",
  });
  return { editor };
}

/** The one Map Line the editor holds, which every Shape edit leaves a line. */
function onlyLine(editor: MapEditor): MapLineElement {
  const [element] = editor.getSnapshot().elements;
  if (element === undefined || element.kind !== "line") throw new Error("no Map Line");
  return element;
}

/** The Shape the one Map Line holds, which every Shape test starts from. */
function onlyShape(editor: MapEditor): MapShape {
  const shape = onlyLine(editor).shape;
  if (shape === undefined) throw new Error("the Map Line has no Shape");
  return shape;
}

describe("a Shape drawn on the Frame", () => {
  it("adds the exact Shape a drag drew, selected, as one undo step", () => {
    const { editor } = openEditor();
    editor.handleFrameMessage({
      kind: "shape",
      shape: "rectangle",
      start: [10, 10],
      end: [50, 30],
      constrain: false,
    });

    const line = onlyLine(editor);
    expect(line.shape).toEqual({
      kind: "rectangle",
      cx: 30,
      cy: 20,
      width: 40,
      height: 20,
      rotation: 0,
      sides: DEFAULT_POLYGON_SIDES,
      cornerRadius: 0,
    });
    expect(line.name).toBe("Rectangle 1");
    expect(line.style).toBe("plain");
    expect(line.enclosesFills).toBe(true);
    expect(line.closed).toBe(true);
    expect(line.roughened).toBe(false);
    expect(line.points).toEqual(shapeOutline(line.shape as MapShape).points);
    expect(line.curves).toEqual(Array.from({ length: line.points.length }, () => false));
    expect(editor.getSnapshot().selectedId).toBe(line.id);

    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("draws nothing for a drag too small to be a Shape, and takes no undo step", () => {
    const { editor } = openEditor();
    editor.handleFrameMessage({
      kind: "shape",
      shape: "ellipse",
      start: [10, 10],
      end: [10.5, 10.5],
      constrain: false,
    });

    expect(editor.getSnapshot().elements).toEqual([]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("drops a malformed Shape message", () => {
    const { editor } = openEditor();
    for (const message of [
      { kind: "shape", shape: "circle", start: [10, 10], end: [50, 30], constrain: false },
      { kind: "shape", shape: "ellipse", start: [10, 10], constrain: false },
      { kind: "shape", shape: "ellipse", start: [10, 10], end: [50, 30] },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
      editor.handleFrameMessage(message);
    }

    expect(editor.getSnapshot().elements).toEqual([]);
  });
});

describe("placing a Shape with the keyboard", () => {
  it("lands at the view centre at the default size, a circle for an Ellipse", () => {
    const { editor } = openEditor();
    expect(DEFAULT_SHAPE_SIZE_MM).toBe(40);

    editor.placeShape("ellipse");

    const line = onlyLine(editor);
    expect(line.shape).toEqual({
      kind: "ellipse",
      cx: 100,
      cy: 50,
      width: 40,
      height: 40,
      rotation: 0,
      sides: DEFAULT_POLYGON_SIDES,
      cornerRadius: 0,
    });
    expect(line.name).toBe("Ellipse 1");
    expect(line.closed).toBe(true);
    expect(editor.getSnapshot().selectedId).toBe(line.id);
  });

  it("follows the pan, and numbers each kind of Shape on its own", () => {
    const { editor } = openEditor();
    editor.placeShape("polygon");
    editor.panRight();
    editor.placeShape("polygon");
    editor.panDown();
    editor.placeShape("ellipse");

    const [first, second, third] = editor.getSnapshot().elements as MapLineElement[];
    expect(first.name).toBe("Polygon 1");
    expect(second.name).toBe("Polygon 2");
    expect(first.shape).toMatchObject({ kind: "polygon", cx: 100, cy: 50, sides: 6 });
    // One pan step is 20 mm across and 20 mm down.
    expect(second.shape).toMatchObject({ cx: 120, cy: 50 });
    expect(third.name).toBe("Ellipse 1");
    expect(third.shape).toMatchObject({ cx: 120, cy: 70 });
  });
});

describe("setShapeGeometry", () => {
  it("resizes a circle and keeps it a circle", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const id = onlyLine(editor).id;

    editor.setShapeGeometry(id, { width: 80, height: 80 });

    const shape = onlyShape(editor);
    expect(shape).toMatchObject({ width: 80, height: 80 });
    expect(onlyLine(editor).points).toEqual(shapeOutline(shape).points);
    for (const [x, y] of onlyLine(editor).points) {
      expect(Math.hypot(x - shape.cx, y - shape.cy)).toBeCloseTo(40, 10);
    }

    editor.undo();
    expect(onlyShape(editor)).toMatchObject({ width: 40, height: 40 });
  });

  it("turns a Shape about its centre", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const id = onlyLine(editor).id;

    editor.setShapeGeometry(id, { rotation: 90 });

    const shape = onlyShape(editor);
    expect(shape.rotation).toBe(90);
    // The top point swings to the right side.
    expect(onlyLine(editor).points[0][0]).toBeCloseTo(shape.cx + 20, 10);
    expect(onlyLine(editor).points[0][1]).toBeCloseTo(shape.cy, 10);
  });

  it("sets a polygon's sides, kept between three and twelve", () => {
    const { editor } = openEditor();
    editor.placeShape("polygon");
    const id = onlyLine(editor).id;
    expect(onlyLine(editor).points).toHaveLength(DEFAULT_POLYGON_SIDES);

    editor.setShapeGeometry(id, { sides: 20 });
    expect(onlyShape(editor).sides).toBe(12);
    expect(onlyLine(editor).points).toHaveLength(12);

    editor.setShapeGeometry(id, { sides: 2 });
    expect(onlyShape(editor).sides).toBe(3);
    expect(onlyLine(editor).points).toHaveLength(3);
  });

  it("rounds a rectangle's corners up to half its shorter side", () => {
    const { editor } = openEditor();
    editor.placeShape("rectangle");
    const id = onlyLine(editor).id;
    editor.setShapeGeometry(id, { width: 60, height: 20 });

    editor.setShapeGeometry(id, { cornerRadius: 100 });
    expect(onlyShape(editor).cornerRadius).toBe(10);
    expect(onlyLine(editor).points).toHaveLength(32);

    editor.setShapeGeometry(id, { cornerRadius: -5 });
    expect(onlyShape(editor).cornerRadius).toBe(0);
    expect(onlyLine(editor).points).toHaveLength(4);
  });

  it("ignores a locked Shape line", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const id = onlyLine(editor).id;
    const before = onlyShape(editor);
    editor.setLocked(id, true);

    editor.setShapeGeometry(id, { width: 90, rotation: 30 });

    expect(onlyShape(editor)).toEqual(before);
    // The last step is the lock, so the refused change committed nothing.
    editor.undo();
    expect(onlyLine(editor).locked).toBe(false);
    expect(onlyShape(editor)).toEqual(before);
  });

  it("takes no undo step when the numbers would change nothing", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const id = onlyLine(editor).id;

    editor.setShapeGeometry(id, { cx: 100, cy: 50, width: 40, sides: 6 });

    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });
});

describe("a Shape that stops being exact", () => {
  it("converts both pieces the Eraser leaves, and undo restores the exact Shape", () => {
    const { editor } = openEditor();
    editor.placeShape("rectangle");
    const original = onlyLine(editor);

    editor.handleFrameMessage({
      kind: "erase",
      points: [
        [100, 0],
        [100, 100],
      ],
      radiusMm: 1,
    });

    const pieces = editor.getSnapshot().elements as MapLineElement[];
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      expect(piece.shape).toBeUndefined();
      expect(piece.convertedFrom).toBe("rectangle");
      expect(piece.closed).toBe(false);
    }

    editor.undo();
    const restored = onlyLine(editor);
    expect(restored.shape).toEqual(original.shape);
    expect(restored.points).toEqual(original.points);
    expect(restored.convertedFrom).toBeUndefined();
  });

  it("leaves a Shape the Eraser never reaches exact", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const before = onlyShape(editor);

    editor.handleFrameMessage({ kind: "erase", points: [[0, 0]], radiusMm: 1 });

    expect(onlyShape(editor)).toEqual(before);
    expect(onlyLine(editor).convertedFrom).toBeUndefined();
  });

  it("converts a Shape before Roughen, and undo restores the exact Shape", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const original = onlyLine(editor);

    editor.roughen();

    const roughened = onlyLine(editor);
    expect(roughened.shape).toBeUndefined();
    expect(roughened.convertedFrom).toBe("ellipse");
    expect(roughened.roughened).toBe(true);
    expect(roughened.points.length).toBeGreaterThan(original.points.length);

    editor.undo();
    expect(onlyLine(editor).shape).toEqual(original.shape);
    expect(onlyLine(editor).roughened).toBe(false);
  });
});

describe("the editor snapshot", () => {
  it("carries the selected Shape and what a converted line was", () => {
    const { editor } = openEditor();
    editor.placeShape("polygon");

    expect(editor.getSnapshot().selectedShape).toEqual(onlyShape(editor));
    expect(editor.getSnapshot().selectedConvertedFrom).toBeNull();

    editor.roughen();
    expect(editor.getSnapshot().selectedShape).toBeNull();
    expect(editor.getSnapshot().selectedConvertedFrom).toBe("polygon");

    editor.select(null);
    expect(editor.getSnapshot().selectedShape).toBeNull();
    expect(editor.getSnapshot().selectedConvertedFrom).toBeNull();
  });
});

/** A closed square Map Line from (x, y) to (x + size, y + size), enclosing Fills. */
function squareLine(id: string, name: string, x: number, y: number, size: number): MapLineElement {
  return {
    id,
    kind: "line",
    name,
    hidden: false,
    locked: false,
    points: [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
    ],
    style: "plain",
    enclosesFills: true,
    closed: true,
    curves: [false, false, false, false],
    roughened: false,
  };
}

/** The Fills an editor holds, in z-order. */
function fills(editor: MapEditor): MapFillElement[] {
  return editor
    .getSnapshot()
    .elements.filter((element): element is MapFillElement => element.kind === "fill");
}

describe("pouring a Fill with the Bucket", () => {
  it("adds a Fill behind the Map Line and selects it", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);

    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });

    const elements = editor.getSnapshot().elements;
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({
      kind: "fill",
      name: "Fill 1",
      hidden: false,
      locked: false,
      content: { color: "land" },
    });
    expect(elements[1].id).toBe("ring");
    const [fill] = fills(editor);
    // The anchor sits on the face, inside the square the pour landed in.
    expect(fill.anchor[0]).toBeGreaterThan(10);
    expect(fill.anchor[0]).toBeLessThan(90);
    expect(fill.anchor[1]).toBeGreaterThan(10);
    expect(fill.anchor[1]).toBeLessThan(90);
    expect(editor.getSnapshot().selectedId).toBe(fill.id);
    expect(editor.getSnapshot().selectedIsFill).toBe(true);
    expect(editor.getSnapshot().selectedFillColor).toBe("land");
    expect(editor.getSnapshot().currentFillColor).toBe("land");
  });

  it("commits nothing for a pour outside every face", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);

    editor.handleFrameMessage({ kind: "pour", point: [150, 50] });

    expect(editor.getSnapshot().elements).toHaveLength(1);
    expect(editor.getSnapshot().selectedId).toBeNull();
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("recolours the face's Fill instead of adding another", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.setFillColor("#123456");
    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });
    const [fill] = fills(editor);

    editor.setFillColor("#abcdef");
    editor.handleFrameMessage({ kind: "pour", point: [60, 40] });

    expect(fills(editor)).toHaveLength(1);
    expect(fills(editor)[0]).toMatchObject({ id: fill.id, content: { color: "#abcdef" } });
    expect(editor.getSnapshot().selectedId).toBe(fill.id);

    // One undo puts the first colour back.
    editor.undo();
    expect(fills(editor)[0].content.color).toBe("#123456");
  });

  it("undoes the pour as one step and redoes it", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });
    const [fill] = fills(editor);

    editor.undo();
    expect(editor.getSnapshot().elements).toHaveLength(1);
    expect(editor.getSnapshot().selectedId).toBeNull();

    editor.redo();
    expect(fills(editor)).toHaveLength(1);
    expect(fills(editor)[0].id).toBe(fill.id);
  });

  it("drops a malformed pour", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    for (const message of [
      { kind: "pour" },
      { kind: "pour", point: [10] },
      { kind: "pour", point: ["10", "10"] },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
      editor.handleFrameMessage(message);
    }

    expect(editor.getSnapshot().elements).toHaveLength(1);
  });
});

describe("Fills that follow the Map Lines", () => {
  it("keeps the larger face's Fill when the line between two is deleted, as one step", () => {
    const { editor } = openEditor([
      squareLine("ring", "Ring", 10, 10, 80),
      {
        id: "divider",
        kind: "line",
        name: "Divider",
        hidden: false,
        locked: false,
        points: [
          [40, 10],
          [40, 190],
        ],
        style: "plain",
        enclosesFills: true,
        closed: false,
        curves: [false],
        roughened: false,
      },
    ]);
    editor.handleFrameMessage({ kind: "pour", point: [25, 50] });
    editor.handleFrameMessage({ kind: "pour", point: [70, 50] });
    const poured = fills(editor);
    expect(poured).toHaveLength(2);
    const larger = poured[1];

    editor.deleteElement("divider");

    const merged = fills(editor);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(larger.id);
    expect(editor.getSnapshot().elements.some((element) => element.id === "divider")).toBe(false);

    // One undo brings both Fills and the line back.
    editor.undo();
    expect(editor.getSnapshot().elements.map((element) => element.id)).toEqual(
      expect.arrayContaining(["ring", "divider", larger.id, poured[0].id])
    );
    expect(fills(editor)).toHaveLength(2);
  });

  it("gives both halves a Fill when an enclosing line splits a filled face", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });
    const [fill] = fills(editor);

    editor.handleFrameMessage({
      kind: "line",
      points: [
        [40, 0],
        [40, 100],
      ],
      curves: [false],
      closed: false,
    });

    const split = fills(editor);
    expect(split).toHaveLength(2);
    expect(split[0].id).toBe(fill.id);
    expect(split[1]).toMatchObject({ id: `${fill.id}-2`, content: { color: fill.content.color } });

    // The split came with the line, so one undo removes both.
    editor.undo();
    expect(fills(editor)).toHaveLength(1);
  });

  it("leaves the face empty when the author deletes its Fill", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });
    const [fill] = fills(editor);

    editor.deleteElement(fill.id);

    expect(fills(editor)).toEqual([]);
    expect(editor.getSnapshot().elements).toHaveLength(1);
    expect(editor.getSnapshot().selectedId).toBeNull();
  });
});

describe("a Fill's own colour", () => {
  it("changes an unlocked Fill as one undo step and ignores a locked one", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });
    const [fill] = fills(editor);

    editor.setElementFillColor(fill.id, "#445566");
    expect(fills(editor)[0].content.color).toBe("#445566");

    // The same colour again is not a step.
    editor.setElementFillColor(fill.id, "#445566");
    editor.undo();
    expect(fills(editor)[0].content.color).toBe("land");

    editor.setLocked(fill.id, true);
    editor.setElementFillColor(fill.id, "#000000");
    expect(fills(editor)[0].content.color).toBe("land");
    // The refused change is not a step either: undo unlocks the Fill.
    editor.undo();
    expect(fills(editor)[0].locked).toBe(false);
    expect(fills(editor)[0].content.color).toBe("land");
  });
});

describe("drawing an Area Fill with the Area tool", () => {
  /** The one Fill an editor holds, which every Area test starts from. */
  function onlyFill(editor: MapEditor): MapFillElement {
    const fill = editor
      .getSnapshot()
      .elements.find((element): element is MapFillElement => element.kind === "fill");
    if (fill === undefined) throw new Error("no Fill");
    return fill;
  }

  it("adds a freehand outline as a closed Area Fill in the Fill stack, selected, as one undo step", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.setFillColor("#445566");

    editor.handleFrameMessage({
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
        [10, 40],
      ],
      curves: [],
      freehand: true,
    });

    const elements = editor.getSnapshot().elements;
    expect(elements).toHaveLength(2);
    const fill = onlyFill(editor);
    // The Area Fill covers its own outline, in the colour the Bucket pours, and
    // takes the top of the Fill stack, below the Map Line it crossed.
    expect(elements[0]).toBe(fill);
    expect(fill).toMatchObject({
      kind: "fill",
      name: "Fill 1",
      hidden: false,
      locked: false,
      anchor: [25, 25],
      content: { color: "#445566" },
    });
    expect(fill.outline).toEqual({
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
        [10, 40],
      ],
      curves: [true, true, true, true],
      roughened: false,
    });
    expect(editor.getSnapshot().selectedId).toBe(fill.id);
    expect(editor.getSnapshot().selectedIsAreaFill).toBe(true);

    editor.undo();
    expect(editor.getSnapshot().elements).toHaveLength(1);
  });

  it("puts a new Area Fill at the top of the Fill stack, below Map Lines, Stamps, and Map Labels", () => {
    const { editor } = openEditor([
      {
        id: "image",
        kind: "image",
        name: "Scan",
        hidden: false,
        locked: false,
        assetRef: "scan-1",
        transform: { x: 100, y: 50, size: 60, rotation: 0 },
        opacity: 1,
        exportable: true,
      },
      {
        ...fillAt("older", [150, 50]),
        outline: {
          points: [
            [130, 30],
            [170, 30],
            [170, 70],
            [130, 70],
          ],
          curves: [false, false, false, false],
          roughened: false,
        },
      },
      squareLine("ring", "Ring", 10, 10, 40),
      {
        id: "stamp",
        kind: "stamp",
        name: "Castle",
        hidden: false,
        locked: false,
        stampRef: "base:castle",
        transform: { x: 100, y: 50, size: 12, rotation: 0 },
        color: MAP_STYLES.atlas.ink,
      },
      newLabel({ id: "label", name: "The Reach", text: "The Reach", point: [100, 20] }),
    ]);

    editor.handleFrameMessage({
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
        [10, 40],
      ],
      curves: [],
      freehand: true,
    });

    const ids = editor
      .getSnapshot()
      .elements.map((element) =>
        element.kind === "fill" && element.id !== "older" ? "new" : element.id
      );
    expect(ids).toEqual(["image", "older", "new", "ring", "stamp", "label"]);
  });

  it("smooths a freehand outline exactly as the Pencil smooths a stroke", () => {
    const { editor } = openEditor();
    const raw: [number, number][] = [
      [10, 10],
      [12, 10.1],
      [40, 10.2],
      [40, 40],
      [10, 40],
    ];

    editor.handleFrameMessage({ kind: "area", points: raw, curves: [], freehand: true });

    expect(onlyFill(editor).outline?.points).toEqual(smoothStroke(raw));
  });

  it("keeps a point-by-point outline with the curves the Frame sent", () => {
    const { editor } = openEditor();

    editor.handleFrameMessage({
      kind: "area",
      points: [
        [20, 20],
        [60, 20],
        [60, 50],
      ],
      curves: [false, true, false],
      freehand: false,
    });

    const fill = onlyFill(editor);
    expect(fill.outline).toEqual({
      points: [
        [20, 20],
        [60, 20],
        [60, 50],
      ],
      curves: [false, true, false],
      roughened: false,
    });
    expect(fill.anchor[0]).toBeCloseTo(140 / 3, 10);
    expect(fill.anchor[1]).toBeCloseTo(30, 10);
  });

  it("draws nothing for an outline that encloses no area, and takes no undo step", () => {
    const { editor } = openEditor();
    for (const message of [
      { kind: "area", points: [[10, 10]], curves: [], freehand: true },
      {
        kind: "area",
        points: [
          [10, 10],
          [40, 10],
        ],
        curves: [],
        freehand: true,
      },
      {
        kind: "area",
        points: [
          [10, 10],
          [40, 10],
        ],
        curves: [false, false],
        freehand: false,
      },
    ]) {
      editor.handleFrameMessage(message);
    }

    expect(editor.getSnapshot().elements).toEqual([]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("drops a malformed area message", () => {
    const { editor } = openEditor();
    const valid = {
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
      ],
      curves: [false, false, false],
      freehand: false,
    };
    for (const message of [
      { ...valid, curves: [false, false] },
      { ...valid, curves: [] },
      { ...valid, freehand: undefined },
      { ...valid, freehand: "yes" },
      { ...valid, points: [[10, 10]] },
      {
        ...valid,
        points: [
          [10, 10],
          [40, 10],
          [40, "40"],
        ],
      },
      { kind: "area", points: valid.points },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
      editor.handleFrameMessage(message);
    }

    expect(editor.getSnapshot().elements).toEqual([]);
  });
});

describe("Roughen on an Area Fill", () => {
  it("redraws the Area Fill's outline as one undo step", () => {
    const { editor } = openEditor();
    editor.handleFrameMessage({
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
        [10, 40],
      ],
      curves: [false, false, false, false],
      freehand: false,
    });
    const before = editor.getSnapshot().elements[0] as MapFillElement;

    editor.roughen();

    const roughened = editor.getSnapshot().elements[0] as MapFillElement;
    expect(roughened.outline?.roughened).toBe(true);
    expect(roughened.outline?.points.length).toBeGreaterThan(before.outline?.points.length ?? 0);
    // A closed outline keeps one straight flag per segment, the closing one too.
    expect(roughened.outline?.curves).toEqual(
      Array.from({ length: roughened.outline?.points.length ?? 0 }, () => false)
    );

    editor.undo();
    expect(editor.getSnapshot().elements[0]).toEqual(before);
  });

  it("leaves a locked Area Fill, and a Bucket Fill with no outline, alone", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.handleFrameMessage({
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
      ],
      curves: [false, false, false],
      freehand: false,
    });
    const area = editor
      .getSnapshot()
      .elements.find((element): element is MapFillElement => element.kind === "fill");
    if (area === undefined) throw new Error("no Area Fill");
    editor.setLocked(area.id, true);

    editor.roughen();
    expect(editor.getSnapshot().elements.find((element) => element.id === area.id)).toMatchObject({
      outline: { roughened: false },
    });

    // A Bucket Fill covers a face, not an outline, so Roughen has nothing to redraw.
    editor.handleFrameMessage({ kind: "pour", point: [50, 50] });
    const bucket = editor
      .getSnapshot()
      .elements.find(
        (element) => element.kind === "fill" && element.outline === undefined
      ) as MapFillElement;
    editor.select(bucket.id);
    const before = editor.getSnapshot().elements;
    editor.roughen();
    expect(editor.getSnapshot().elements).toBe(before);
  });
});

describe("moving a Stamp", () => {
  /** A marker Stamp centred on (100, 50), 12 mm wide, upright, in the map ink. */
  function stamp(overrides: Partial<MapStampElement> = {}): MapStampElement {
    return {
      id: "marker",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 100, y: 50, size: 12, rotation: 0 },
      color: MAP_STYLES.atlas.ink,
      ...overrides,
    };
  }

  it("shifts the selected Stamp's centre as one undo step", () => {
    const { editor } = openEditor([stamp()]);
    editor.select("marker");

    editor.move(-1, 2);

    expect(editor.getSnapshot().elements).toEqual([
      stamp({ transform: { x: 99, y: 52, size: 12, rotation: 0 } }),
    ]);
    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([stamp()]);
  });

  it("leaves a locked Stamp and a locked Map Image where they are, and moves them once unlocked", () => {
    const scan: MapImageElement = {
      id: "scan",
      kind: "image",
      name: "The Reach",
      hidden: false,
      locked: false,
      assetRef: "scan-1",
      transform: { x: 20, y: 20, size: 40, rotation: 0 },
      opacity: 1,
      exportable: true,
    };
    const { editor } = openEditor([stamp({ locked: true }), scan]);

    editor.select("marker");
    editor.move(1, 0);
    expect(editor.getSnapshot().elements[0]).toEqual(stamp({ locked: true }));

    // A Map Image moves by its transform, as a Stamp does.
    editor.select("scan");
    editor.move(1, 0);
    expect(editor.getSnapshot().elements[1]).toEqual({
      ...scan,
      transform: { x: 21, y: 20, size: 40, rotation: 0 },
    });
    editor.setLocked("scan", true);
    editor.move(1, 0);
    expect(editor.getSnapshot().elements[1]).toMatchObject({
      transform: { x: 21, y: 20, size: 40, rotation: 0 },
    });
  });
});

describe("moving an Area Fill", () => {
  /** An Area Fill over a 20 mm square at (0, 0), its selection point in its middle. */
  const AREA_FILL: MapFillElement = {
    id: "forest",
    kind: "fill",
    name: "Forest",
    hidden: false,
    locked: false,
    anchor: [10, 10],
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
    content: { color: DEFAULT_FILL_COLOR },
  };

  it("shifts the Area Fill's anchor and its own outline as one undo step", () => {
    const { editor } = openEditor([AREA_FILL]);
    editor.select("forest");

    editor.move(5, -3);

    expect(editor.getSnapshot().elements[0]).toMatchObject({
      anchor: [15, 7],
      outline: {
        points: [
          [5, -3],
          [25, -3],
          [25, 17],
          [5, 17],
        ],
      },
    });
    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([AREA_FILL]);
  });
});

describe("placing a Stamp with the Insert tool", () => {
  /** The one Stamp an editor holds, which every Insert test starts from. */
  function onlyStamp(editor: MapEditor): MapStampElement {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "stamp") throw new Error("no Stamp");
    return element;
  }

  it("places the picked Stamp where the Frame reported the point", () => {
    const { editor } = openEditor();
    editor.setStamp("castle");

    editor.handleFrameMessage({ kind: "insert", point: [30, 40] });

    const stamp = onlyStamp(editor);
    expect(stamp).toMatchObject({
      kind: "stamp",
      name: "Castle",
      hidden: false,
      locked: false,
      stampRef: "base:castle",
      transform: { x: 30, y: 40, size: DEFAULT_STAMP_SIZE_MM, rotation: 0 },
    });
    expect(stamp.color).toBeUndefined();
    expect(stamp.scale).toBeUndefined();
    expect(editor.getSnapshot().selectedId).toBe(stamp.id);

    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
    expect(editor.getSnapshot().selectedId).toBeNull();
  });

  it("places the picked Stamp at the view centre, selected, from the keyboard", () => {
    const { editor } = openEditor();
    expect(editor.getSnapshot().currentStampId).toBe("capital");

    editor.insertStamp();

    const stamp = onlyStamp(editor);
    expect(stamp.name).toBe("Capital");
    expect(stamp.stampRef).toBe("base:capital");
    expect(stamp.transform).toEqual({ x: 100, y: 50, size: DEFAULT_STAMP_SIZE_MM, rotation: 0 });
    expect(editor.getSnapshot().selectedId).toBe(stamp.id);

    // The view centre follows the pan, exactly as a placed Shape's does.
    editor.panRight();
    editor.insertStamp();
    const [first, second] = editor.getSnapshot().elements as MapStampElement[];
    expect(first.transform.x).toBe(100);
    expect(second.transform.x).toBe(120);
  });

  it("gives the scale bar its own default size and reading", () => {
    const { editor } = openEditor();
    editor.setStamp("scale-bar");

    editor.insertStamp();

    const bar = onlyStamp(editor);
    expect(bar.stampRef).toBe("base:scale-bar");
    expect(bar.transform.size).toBe(DEFAULT_SCALE_BAR_SIZE_MM);
    expect(bar.scale).toEqual({ unit: "km", span: 1000 });
  });

  it("keeps its pick to the Stamps this build knows", () => {
    const { editor } = openEditor();
    editor.setStamp("nope");
    expect(editor.getSnapshot().currentStampId).toBe("capital");
  });

  it("drops an insert message with no finite point", () => {
    const { editor } = openEditor();
    for (const message of [
      { kind: "insert" },
      { kind: "insert", point: [10] },
      { kind: "insert", point: ["10", "10"] },
      { kind: "insert", point: [Number.NaN, 20] },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
      editor.handleFrameMessage(message);
    }

    expect(editor.getSnapshot().elements).toEqual([]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("setStampTransform", () => {
  /** An editor holding one inserted marker Stamp, centred on the view centre. */
  function inserted() {
    const { editor } = openEditor();
    editor.setStamp("marker");
    editor.insertStamp();
    const [element] = editor.getSnapshot().elements as MapStampElement[];
    return { editor, id: element.id };
  }

  it("moves, sizes, and turns a Stamp, one undo step each", () => {
    const { editor, id } = inserted();

    editor.setStampTransform(id, { x: 20, y: 30 });
    expect((editor.getSnapshot().elements[0] as MapStampElement).transform).toEqual({
      x: 20,
      y: 30,
      size: DEFAULT_STAMP_SIZE_MM,
      rotation: 0,
    });

    editor.setStampTransform(id, { size: 20, rotation: 30 });
    expect((editor.getSnapshot().elements[0] as MapStampElement).transform).toEqual({
      x: 20,
      y: 30,
      size: 20,
      rotation: 30,
    });

    editor.undo();
    expect((editor.getSnapshot().elements[0] as MapStampElement).transform).toEqual({
      x: 20,
      y: 30,
      size: DEFAULT_STAMP_SIZE_MM,
      rotation: 0,
    });

    editor.undo();
    expect((editor.getSnapshot().elements[0] as MapStampElement).transform).toEqual({
      x: 100,
      y: 50,
      size: DEFAULT_STAMP_SIZE_MM,
      rotation: 0,
    });
  });

  it("keeps the art box above zero and the turn inside one full circle", () => {
    const { editor, id } = inserted();
    const transform = () => (editor.getSnapshot().elements[0] as MapStampElement).transform;

    editor.setStampTransform(id, { size: 0 });
    expect(transform().size).toBe(MIN_STAMP_SIZE_MM);
    editor.setStampTransform(id, { size: -5 });
    expect(transform().size).toBe(MIN_STAMP_SIZE_MM);

    editor.setStampTransform(id, { rotation: -90 });
    expect(transform().rotation).toBe(270);
    editor.setStampTransform(id, { rotation: 450 });
    expect(transform().rotation).toBe(90);
    editor.setStampTransform(id, { rotation: 360 });
    expect(transform().rotation).toBe(0);
  });

  it("takes no undo step when the numbers would change nothing", () => {
    const { editor, id } = inserted();

    editor.setStampTransform(id, { x: 100, y: 50, size: DEFAULT_STAMP_SIZE_MM });
    // A full turn lands back where the Stamp already stands.
    editor.setStampTransform(id, { rotation: 360 });
    editor.undo();

    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("ignores a locked Stamp, an Element that is not a Stamp, and a number it cannot use", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.setStamp("marker");
    editor.insertStamp();
    const stamp = editor.getSnapshot().elements[1] as MapStampElement;
    const before = stamp.transform;

    editor.setStampTransform(stamp.id, { x: Number.NaN });
    expect((editor.getSnapshot().elements[1] as MapStampElement).transform).toEqual(before);

    editor.setLocked(stamp.id, true);
    editor.setStampTransform(stamp.id, { x: 10, size: 40 });
    expect(editor.getSnapshot().elements[1]).toMatchObject({ transform: before, locked: true });

    // A Map Line has no place of its own to stamp on.
    editor.setStampTransform("ring", { x: 10 });
    expect(editor.getSnapshot().elements[0].kind).toBe("line");
    expect((editor.getSnapshot().elements[1] as MapStampElement).transform).toEqual(before);
  });
});

describe("setStampScale", () => {
  /** An editor holding one inserted scale bar. */
  function insertedBar() {
    const { editor } = openEditor();
    editor.setStamp("scale-bar");
    editor.insertStamp();
    const [element] = editor.getSnapshot().elements as MapStampElement[];
    return { editor, id: element.id };
  }

  it("changes the scale bar's unit and span, one undo step each", () => {
    const { editor, id } = insertedBar();
    const scale = () => (editor.getSnapshot().elements[0] as MapStampElement).scale;

    editor.setStampScale(id, { unit: "mi" });
    expect(scale()).toEqual({ unit: "mi", span: 1000 });

    editor.setStampScale(id, { span: 500 });
    expect(scale()).toEqual({ unit: "mi", span: 500 });

    editor.undo();
    expect(scale()).toEqual({ unit: "mi", span: 1000 });
    editor.undo();
    expect(scale()).toEqual({ unit: "km", span: 1000 });
  });

  it("refuses a span with no room and a unit it does not know", () => {
    const { editor, id } = insertedBar();

    editor.setStampScale(id, { span: 0 });
    editor.setStampScale(id, { span: -5 });
    editor.setStampScale(id, { span: Number.NaN });
    editor.setStampScale(id, { unit: "leagues" as StampScaleUnit });

    expect((editor.getSnapshot().elements[0] as MapStampElement).scale).toEqual({
      unit: "km",
      span: 1000,
    });
    // None of those took a step: one undo takes the insertion back.
    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("leaves a Stamp that carries no scale alone", () => {
    const { editor } = openEditor();
    editor.insertStamp();
    const before = editor.getSnapshot().elements[0] as MapStampElement;

    editor.setStampScale(before.id, { span: 500 });

    expect(editor.getSnapshot().elements[0]).toEqual(before);
  });
});

describe("a one-colour Stamp's colour", () => {
  it("recolours one-colour art as one undo step", () => {
    const { editor } = openEditor();
    editor.setStamp("marker");
    editor.insertStamp();
    const [stamp] = editor.getSnapshot().elements as MapStampElement[];

    editor.setStampColor(stamp.id, "#8b1a1a");
    expect((editor.getSnapshot().elements[0] as MapStampElement).color).toBe("#8b1a1a");

    // The colour it already has is not a step.
    editor.setStampColor(stamp.id, "#8b1a1a");
    editor.undo();
    expect((editor.getSnapshot().elements[0] as MapStampElement).color).toBeUndefined();
  });

  it("leaves art that keeps its own colours, and a locked Stamp, alone", () => {
    const { editor } = openEditor();
    editor.setStamp("castle");
    editor.insertStamp();
    const [castle] = editor.getSnapshot().elements as MapStampElement[];

    editor.setStampColor(castle.id, "#8b1a1a");
    expect((editor.getSnapshot().elements[0] as MapStampElement).color).toBeUndefined();

    editor.setStamp("marker");
    editor.insertStamp();
    const marker = editor.getSnapshot().elements[1] as MapStampElement;
    editor.setLocked(marker.id, true);
    editor.setStampColor(marker.id, "#8b1a1a");
    expect((editor.getSnapshot().elements[1] as MapStampElement).color).toBeUndefined();
  });
});

describe("the snapshot of a selected Stamp", () => {
  it("carries the Stamp itself, and nothing once it lets the Stamp go", () => {
    const { editor } = openEditor();
    editor.insertStamp();
    const [stamp] = editor.getSnapshot().elements as MapStampElement[];

    expect(editor.getSnapshot().selectedStamp).toEqual(stamp);

    editor.select(null);
    expect(editor.getSnapshot().selectedStamp).toBeNull();
  });
});

describe("dragging an Element with the Select tool", () => {
  /** An editor that counts its saves and the scenes it sends its Frame. */
  function openWatched(elements: MapElement[]) {
    let saves = 0;
    const scenes: unknown[] = [];
    const editor = createMapEditor({
      store: {
        save: async () => {
          saves += 1;
        },
      },
      doc: {
        id: "map-1",
        bookId: null,
        name: "Map",
        page: { preset: "square", widthMm: 200, heightMm: 100 },
        styleId: "atlas",
        overrides: {},
        elements,
        createdAt: 0,
        updatedAt: 0,
        dataVersion: DATA_VERSION,
      },
      language: () => "en",
    });
    editor.attachFrame({
      postMessage: (message: unknown) => scenes.push(message),
    } as unknown as MessagePort);
    scenes.length = 0;
    return { editor, saves: () => saves, scenes };
  }

  const marker: MapStampElement = {
    id: "marker",
    kind: "stamp",
    name: "City",
    hidden: false,
    locked: false,
    stampRef: "base:marker",
    transform: { x: 100, y: 50, size: 12, rotation: 0 },
    color: MAP_STYLES.atlas.ink,
  };

  it("commits a dragged Map Line as one undo step, selected, and autosaves it", async () => {
    const { editor, saves } = openWatched([squareLine("ring", "Ring", 10, 10, 20)]);

    editor.handleFrameMessage({ kind: "select", id: "ring" });
    editor.handleFrameMessage({ kind: "move", id: "ring", dx: 5, dy: -2 });

    expect(onlyLine(editor).points).toEqual([
      [15, 8],
      [35, 8],
      [35, 28],
      [15, 28],
    ]);
    expect(editor.getSnapshot().selectedId).toBe("ring");
    await editor.flush();
    expect(saves()).toBe(1);

    editor.undo();
    expect(onlyLine(editor).points[0]).toEqual([10, 10]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("moves a dragged Shape's centre with its outline, and a dragged Stamp's centre", () => {
    const { editor } = openWatched([marker]);
    editor.handleFrameMessage({ kind: "move", id: "marker", dx: -10, dy: 4 });
    expect(editor.getSnapshot().elements[0]).toMatchObject({
      transform: { x: 90, y: 54, size: 12, rotation: 0 },
    });

    const shaped = openEditor().editor;
    shaped.placeShape("ellipse");
    const before = onlyShape(shaped);
    shaped.handleFrameMessage({ kind: "move", id: onlyLine(shaped).id, dx: 3, dy: 3 });
    expect(onlyShape(shaped)).toEqual({ ...before, cx: before.cx + 3, cy: before.cy + 3 });
  });

  it("takes the same path as the arrow Commands, so a Fill on the moved line's face follows", () => {
    const divider = (): MapLineElement => ({
      id: "divider",
      kind: "line",
      name: "Divider",
      hidden: false,
      locked: false,
      points: [
        [40, 0],
        [40, 100],
      ],
      style: "plain",
      enclosesFills: true,
      closed: false,
      curves: [false],
      roughened: false,
    });
    const dragged = openEditor([squareLine("ring", "Ring", 10, 10, 80), divider()]).editor;
    const arrowed = openEditor([squareLine("ring", "Ring", 10, 10, 80), divider()]).editor;
    for (const editor of [dragged, arrowed]) {
      editor.handleFrameMessage({ kind: "pour", point: [25, 50] });
      editor.handleFrameMessage({ kind: "pour", point: [70, 50] });
    }
    const leftBefore = fills(dragged)[0].anchor;

    dragged.handleFrameMessage({ kind: "move", id: "divider", dx: 20, dy: 0 });
    arrowed.select("divider");
    arrowed.move(20, 0);

    // The left face grew 20 mm to the right, so its Fill's deepest point moved with it.
    expect(fills(dragged)[0].anchor[0]).toBeGreaterThan(leftBefore[0]);
    expect(fills(dragged).map((fill) => fill.anchor)).toEqual(
      fills(arrowed).map((fill) => fill.anchor)
    );

    // The line and both Fills come back in one undo.
    dragged.undo();
    expect(fills(dragged)[0].anchor).toEqual(leftBefore);
    expect(dragged.getSnapshot().elements.find((element) => element.id === "divider")).toEqual(
      divider()
    );
  });

  it("carries a Fill with a Map Line dragged further than its own size, and so does an arrow", () => {
    for (const moveBy of [
      (editor: MapEditor) => editor.handleFrameMessage({ kind: "move", id: "ring", dx: 60, dy: 0 }),
      (editor: MapEditor) => {
        editor.select("ring");
        for (let step = 0; step < 6; step += 1) editor.move(10, 0);
      },
    ]) {
      const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 8)]);
      editor.handleFrameMessage({ kind: "pour", point: [14, 14] });
      const [fill] = fills(editor);

      moveBy(editor);

      expect(fills(editor)).toHaveLength(1);
      expect(fills(editor)[0].id).toBe(fill.id);
      expect(fills(editor)[0].anchor[0]).toBeCloseTo(74, 5);
      expect(fills(editor)[0].anchor[1]).toBeCloseTo(14, 5);
    }
  });

  it("never carries a Fill with a dragged Stamp, even onto a face just like its own", () => {
    // Two equal squares 30 mm apart: a Fill in the left one would follow a
    // Map Line moved 30 mm right, but a Stamp moved 30 mm right is no line.
    const { editor } = openEditor([
      squareLine("left", "Left", 10, 10, 8),
      squareLine("right", "Right", 40, 10, 8),
      marker,
    ]);
    editor.handleFrameMessage({ kind: "pour", point: [14, 14] });
    const [fill] = fills(editor);

    editor.handleFrameMessage({ kind: "move", id: marker.id, dx: 30, dy: 0 });

    expect(fills(editor)).toEqual([fill]);
  });

  it("carries the Fill of a curved Shape dragged by an offset the faces round", () => {
    const { editor } = openEditor();
    editor.placeShape("ellipse");
    const ellipse = onlyLine(editor);
    const { cx, cy } = onlyShape(editor);
    editor.handleFrameMessage({ kind: "pour", point: [cx, cy] });
    const [fill] = fills(editor);

    editor.handleFrameMessage({ kind: "move", id: ellipse.id, dx: 37.123, dy: -12.857 });

    expect(fills(editor)).toHaveLength(1);
    expect(fills(editor)[0].id).toBe(fill.id);
    expect(fills(editor)[0].anchor[0]).toBeCloseTo(cx + 37.123, 0);
    expect(fills(editor)[0].anchor[1]).toBeCloseTo(cy - 12.857, 0);
  });

  it("refuses a locked, hidden, unmovable, unknown, or zero drag, and answers with a scene", async () => {
    const { editor, saves, scenes } = openWatched([
      squareLine("ring", "Ring", 10, 10, 20),
      { ...marker, id: "locked", locked: true },
      { ...marker, id: "hidden", hidden: true },
      {
        id: "fill",
        kind: "fill",
        name: "Fill 1",
        hidden: false,
        locked: false,
        anchor: [5, 5],
        content: { color: DEFAULT_FILL_COLOR },
      },
    ]);
    const before = editor.getSnapshot().elements;

    for (const move of [
      { id: "locked", dx: 4, dy: 4 },
      { id: "hidden", dx: 4, dy: 4 },
      { id: "fill", dx: 4, dy: 4 },
      { id: "ghost", dx: 4, dy: 4 },
      { id: "ring", dx: 0, dy: 0 },
    ]) {
      editor.handleFrameMessage({ kind: "move", ...move });
    }

    expect(editor.getSnapshot().elements).toBe(before);
    expect(editor.getSnapshot().canUndo).toBe(false);
    await editor.flush();
    expect(saves()).toBe(0);
    // The Frame keeps its drag preview until a scene arrives, so a refusal
    // still sends one, which puts the Element back where it was.
    expect(scenes).toHaveLength(5);
  });

  it("leaves no undo step and no save for a press that only selects", async () => {
    const { editor, saves } = openWatched([squareLine("ring", "Ring", 10, 10, 20)]);

    editor.handleFrameMessage({ kind: "select", id: "ring" });

    expect(editor.getSnapshot().selectedId).toBe("ring");
    expect(editor.getSnapshot().canUndo).toBe(false);
    await editor.flush();
    expect(saves()).toBe(0);
  });
});

/** A Bucket Fill at the middle of a closed 80 mm square, which each property test starts from. */
function bucketFill(
  content: MapFillContent = { color: DEFAULT_FILL_COLOR }
): [MapFillElement, MapLineElement] {
  const fill: MapFillElement = {
    id: "fill",
    kind: "fill",
    name: "Fill 1",
    hidden: false,
    locked: false,
    anchor: [50, 50],
    content,
  };
  return [fill, squareLine("ring", "Ring", 10, 10, 80)];
}

/** The same Fill, moved to `anchor` under another id: one Fill per face. */
function fillAt(id: string, anchor: MapPoint): MapFillElement {
  return { ...bucketFill()[0], id, anchor };
}

/** The one Fill an editor holds. */
function onlyFill(editor: MapEditor): MapFillElement {
  const [fill] = fills(editor);
  if (fill === undefined) throw new Error("no Fill");
  return fill;
}

describe("Soft Edge on a Fill and a Map Line", () => {
  it("fades a Fill's edge as one undo step, and sharpens it again", () => {
    const { editor } = openEditor(bucketFill());
    editor.select("fill");
    expect(editor.getSnapshot().selectedSoftEdge).toBeNull();

    editor.setSoftEdge("fill", DEFAULT_SOFT_EDGE_MM);
    expect(onlyFill(editor).softEdge).toBe(DEFAULT_SOFT_EDGE_MM);
    expect(editor.getSnapshot().selectedSoftEdge).toBe(DEFAULT_SOFT_EDGE_MM);
    expect(editor.getSnapshot().canUndo).toBe(true);

    editor.undo();
    expect(editor.getSnapshot().selectedSoftEdge).toBeNull();
    expect(onlyFill(editor).softEdge).toBeUndefined();

    // Turning it off stores one sharp edge, which the model keeps as absent.
    editor.redo();
    editor.setSoftEdge("fill", null);
    expect(onlyFill(editor).softEdge).toBeUndefined();
    expect(editor.getSnapshot().selectedSoftEdge).toBeNull();
  });

  it("fades a Map Line and brings an amount the slider cannot reach inside it", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);
    editor.select("ring");

    editor.setSoftEdge("ring", 40);
    expect(onlyLine(editor).softEdge).toBe(MAX_SOFT_EDGE_MM);
    expect(editor.getSnapshot().selectedSoftEdge).toBe(MAX_SOFT_EDGE_MM);

    editor.setSoftEdge("ring", 0.1);
    expect(onlyLine(editor).softEdge).toBe(MIN_SOFT_EDGE_MM);
    expect(editor.getSnapshot().selectedSoftEdge).toBe(MIN_SOFT_EDGE_MM);
  });

  it("keeps a locked Element's edge sharp and takes no step for it", () => {
    const { editor } = openEditor([{ ...squareLine("ring", "Ring", 10, 10, 80), locked: true }]);

    editor.setSoftEdge("ring", 3);
    editor.setSoftEdge("ghost", 3);

    expect(onlyLine(editor).softEdge).toBeUndefined();
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("a Fill's texture and scatter", () => {
  it("paints a texture over the colour, and clears it while another kind stays", () => {
    const { editor } = openEditor(bucketFill());
    editor.select("fill");

    editor.setFillTexture("fill", "grass");
    expect(onlyFill(editor).content).toEqual({ color: DEFAULT_FILL_COLOR, texture: "grass" });
    expect(editor.getSnapshot().selectedFillTexture).toBe("grass");

    // A texture this build does not draw is not a pick.
    editor.setFillTexture("fill", "lava");
    expect(onlyFill(editor).content.texture).toBe("grass");

    editor.setFillTexture("fill", null);
    expect(onlyFill(editor).content).toEqual({ color: DEFAULT_FILL_COLOR });
    expect(editor.getSnapshot().selectedFillTexture).toBeNull();

    editor.undo();
    expect(onlyFill(editor).content.texture).toBe("grass");
  });

  it("refuses to leave a Fill covering nothing", () => {
    const { editor } = openEditor(bucketFill({ texture: "hatching" }));

    editor.setFillTexture("fill", null);

    expect(onlyFill(editor).content).toEqual({ texture: "hatching" });
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("scatters a Stamp at the default spacing and with a fresh seed", () => {
    const { editor } = openEditor(bucketFill());
    editor.select("fill");

    editor.setFillScatter("fill", "castle");

    const scatter = onlyFill(editor).content.scatter;
    expect(scatter?.stamp).toBe("base:castle");
    expect(scatter?.spacing).toBe(DEFAULT_SCATTER_SPACING_MM);
    expect(scatter?.seed).toBeGreaterThan(0);
    expect(editor.getSnapshot().selectedFillScatter).toEqual(scatter);

    // Picking the Stamp it already scatters keeps the seed, so nothing moves.
    editor.setFillScatter("fill", "castle");
    expect(onlyFill(editor).content.scatter?.seed).toBe(scatter?.seed);
  });

  it("gives each Fill that starts scattering its own seed", () => {
    const { editor } = openEditor([
      fillAt("one", [30, 30]),
      squareLine("left", "Left", 10, 10, 40),
      fillAt("two", [130, 30]),
      squareLine("right", "Right", 110, 10, 40),
    ]);
    const scatterOf = (id: string) => {
      const element = editor.getSnapshot().elements.find((candidate) => candidate.id === id);
      return element?.kind === "fill" ? element.content.scatter : undefined;
    };

    editor.setFillScatter("one", "castle");
    editor.setFillScatter("two", "tower");

    expect(scatterOf("one")?.seed).toBeGreaterThan(0);
    expect(scatterOf("two")?.seed).toBeGreaterThan(0);
    expect(scatterOf("one")?.seed).not.toBe(scatterOf("two")?.seed);
  });

  it("reseeds and respaces a scatter, then clears it while the colour stays", () => {
    const { editor } = openEditor(bucketFill());
    editor.select("fill");
    editor.setFillScatter("fill", "castle");
    const first = onlyFill(editor).content.scatter;

    editor.reseedFillScatter("fill");
    expect(onlyFill(editor).content.scatter?.seed).not.toBe(first?.seed);
    expect(onlyFill(editor).content.scatter?.stamp).toBe("base:castle");

    editor.setFillScatterSpacing("fill", 40);
    expect(onlyFill(editor).content.scatter?.spacing).toBe(MAX_SCATTER_SPACING_MM);
    editor.setFillScatterSpacing("fill", 0.1);
    expect(onlyFill(editor).content.scatter?.spacing).toBe(MIN_SCATTER_SPACING_MM);

    editor.setFillScatter("fill", null);
    expect(onlyFill(editor).content).toEqual({ color: DEFAULT_FILL_COLOR });
  });

  it("refuses to clear the only kind a Fill has, and leaves a locked Fill's content alone", () => {
    const scatter = { stamp: "base:castle", spacing: DEFAULT_SCATTER_SPACING_MM, seed: 7 };
    const { editor } = openEditor(bucketFill({ scatter }));

    editor.setFillScatter("fill", null);

    expect(onlyFill(editor).content).toEqual({ scatter });
    expect(editor.getSnapshot().canUndo).toBe(false);

    const [fill, ring] = bucketFill();
    const locked = openEditor([{ ...fill, locked: true }, ring]).editor;
    locked.setFillTexture("fill", "grass");
    locked.setFillScatter("fill", "castle");
    expect(onlyFill(locked).content).toEqual({ color: DEFAULT_FILL_COLOR });
    expect(locked.getSnapshot().canUndo).toBe(false);
  });
});

describe("placing a Map Label with the Text tool", () => {
  /** The one Map Label an editor holds, which every label test starts from. */
  function onlyLabel(editor: MapEditor): MapLabelElement {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "label") throw new Error("no Map Label");
    return element;
  }

  it("places a Map Label at the view centre, selected, with the default text", () => {
    const { editor } = openEditor();

    editor.insertLabel();

    const label = onlyLabel(editor);
    expect(label).toMatchObject({
      kind: "label",
      name: "Map Label 1",
      text: "Write your text here",
      hidden: false,
      locked: false,
      x: 100,
      y: 50,
      rotation: 0,
      width: DEFAULT_LABEL_WIDTH_MM,
      bend: 0,
      font: DEFAULT_LABEL_FONT,
      size: DEFAULT_LABEL_SIZE_MM,
      letterSpacing: 0,
      halo: DEFAULT_LABEL_HALO_MM,
    });
    // With no colour of its own the label draws in the map ink.
    expect(label.color).toBeUndefined();
    expect(editor.getSnapshot().selectedId).toBe(label.id);

    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
    expect(editor.getSnapshot().selectedId).toBeNull();
  });

  it("places a Map Label where the Text tool was clicked, and a Stamp where Insert was", () => {
    const { editor } = openEditor();

    // The Frame reports one spot for both tools: the Worker's own tool decides
    // what lands there.
    editor.setTool("text");
    editor.handleFrameMessage({ kind: "insert", point: [30, 40] });
    const label = onlyLabel(editor);
    expect(label).toMatchObject({
      name: "Map Label 1",
      text: "Write your text here",
      x: 30,
      y: 40,
    });
    expect(editor.getSnapshot().selectedId).toBe(label.id);
    // The Text tool stays picked, so the next click writes the next label.
    expect(editor.getSnapshot().tool).toBe("text");

    editor.setTool("insert");
    editor.handleFrameMessage({ kind: "insert", point: [60, 20] });
    expect(editor.getSnapshot().elements.map((element) => element.kind)).toEqual([
      "label",
      "stamp",
    ]);

    // One click is one undo step.
    editor.undo();
    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("numbers each label in turn and lands it on the panned view centre", () => {
    const { editor } = openEditor();
    editor.insertLabel();
    editor.panRight();
    editor.insertLabel();

    const [first, second] = editor.getSnapshot().elements as MapLabelElement[];
    expect(first.name).toBe("Map Label 1");
    expect(second.name).toBe("Map Label 2");
    expect(first.x).toBe(100);
    expect(second.x).toBe(120);
    expect(second.y).toBe(50);
  });
});

describe("a Map Label's properties", () => {
  /** An editor holding one inserted Map Label, selected. */
  function labelEditor(): { editor: MapEditor; id: string } {
    const { editor } = openEditor();
    editor.insertLabel();
    const [element] = editor.getSnapshot().elements as MapLabelElement[];
    return { editor, id: element.id };
  }

  function labelOf(editor: MapEditor): MapLabelElement {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "label") throw new Error("no Map Label");
    return element;
  }

  it("writes the text as one undo step and refuses a blank one", () => {
    const { editor, id } = labelEditor();

    editor.setLabelText(id, "  The Reach  ");

    expect(labelOf(editor).text).toBe("The Reach");
    editor.undo();
    expect(labelOf(editor).text).toBe("Write your text here");
    editor.redo();
    expect(labelOf(editor).text).toBe("The Reach");

    editor.setLabelText(id, "   ");
    expect(labelOf(editor).text).toBe("The Reach");
  });

  it("sets a bundled font or the PDF Font, and refuses an id this build does not know", () => {
    const { editor, id } = labelEditor();

    editor.setLabelFont(id, "cinzel");
    expect(labelOf(editor).font).toBe("cinzel");
    editor.undo();
    expect(labelOf(editor).font).toBe(DEFAULT_LABEL_FONT);

    editor.setLabelFont(id, "pdf");
    expect(labelOf(editor).font).toBe("pdf");

    editor.setLabelFont(id, "not-a-font" as MapLabelFont);
    expect(labelOf(editor).font).toBe("pdf");
  });

  it("takes a colour as one undo step, and draws the map ink until it has one", () => {
    const { editor, id } = labelEditor();
    expect(labelOf(editor).color).toBeUndefined();

    editor.setLabelColor(id, "#8b1a1a");

    expect(labelOf(editor).color).toBe("#8b1a1a");
    editor.undo();
    expect(labelOf(editor).color).toBeUndefined();
  });

  it("moves, turns, and reshapes the baseline from its numbers, each as one undo step", () => {
    const { editor, id } = labelEditor();

    editor.setLabelLayout(id, { x: 20, y: 30 });
    expect(labelOf(editor)).toMatchObject({ x: 20, y: 30 });

    editor.setLabelLayout(id, { rotation: 450 });
    expect(labelOf(editor).rotation).toBe(90);

    editor.setLabelLayout(id, { width: 60 });
    expect(labelOf(editor).width).toBe(60);

    editor.setLabelLayout(id, { bend: 8 });
    expect(labelOf(editor).bend).toBe(8);

    editor.setLabelLayout(id, { size: 9, letterSpacing: 0.4, halo: 1.2 });
    expect(labelOf(editor)).toMatchObject({ size: 9, letterSpacing: 0.4, halo: 1.2 });

    editor.undo();
    expect(labelOf(editor)).toMatchObject({
      size: DEFAULT_LABEL_SIZE_MM,
      letterSpacing: 0,
      halo: DEFAULT_LABEL_HALO_MM,
    });
  });

  it("keeps a baseline and a cap size that still draw a name", () => {
    const { editor, id } = labelEditor();

    editor.setLabelLayout(id, { width: 0, size: 0 });
    expect(labelOf(editor).width).toBe(MIN_LABEL_WIDTH_MM);
    expect(labelOf(editor).size).toBe(MIN_LABEL_SIZE_MM);

    // A halo of none is no halo at all.
    editor.setLabelLayout(id, { halo: -1 });
    expect(labelOf(editor).halo).toBe(0);
  });

  it("moves with the arrow Commands as one undo step", () => {
    const { editor, id } = labelEditor();
    editor.select(id);

    editor.move(1, -1);

    expect(labelOf(editor)).toMatchObject({ x: 101, y: 49 });
    editor.undo();
    expect(labelOf(editor)).toMatchObject({ x: 100, y: 50 });
  });

  it("leaves a locked Map Label alone and takes no undo step for it", () => {
    const locked: MapLabelElement = {
      ...newLabel({ id: "label", name: "Map Label 1", text: "The Reach", point: [100, 50] }),
      locked: true,
    };
    const { editor } = openEditor([locked]);
    editor.select("label");

    editor.setLabelText("label", "Other");
    editor.setLabelFont("label", "cinzel");
    editor.setLabelColor("label", "#8b1a1a");
    editor.setLabelLayout("label", { x: 10, y: 10, size: 9, bend: 3 });
    editor.move(2, 2);

    expect(editor.getSnapshot().elements[0]).toEqual(locked);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("dragging a Map Label's bend handle", () => {
  /** The one Map Label the editor holds. */
  function labelOf(editor: MapEditor): MapLabelElement {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "label") throw new Error("no Map Label");
    return element;
  }

  it("applies the dragged bend as one undo step, through the layout setter", () => {
    const { editor } = openEditor();
    editor.insertLabel();
    const { id } = labelOf(editor);

    editor.handleFrameMessage({ kind: "bendLabel", id, bend: 6.4 });

    expect(labelOf(editor).bend).toBe(6.4);
    // A drag is one edit, not one per pointer step the Frame previewed.
    editor.undo();
    expect(labelOf(editor).bend).toBe(0);
    editor.redo();
    expect(labelOf(editor).bend).toBe(6.4);
  });

  it("refuses a bend on a locked Map Label, and takes no undo step for it", () => {
    const locked: MapLabelElement = {
      ...newLabel({ id: "label", name: "Map Label 1", text: "The Reach", point: [100, 50] }),
      locked: true,
    };
    const { editor } = openEditor([locked]);

    editor.handleFrameMessage({ kind: "bendLabel", id: "label", bend: 5 });

    expect(editor.getSnapshot().elements[0]).toEqual(locked);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("leaves an Element that is not a Map Label, and a bend it already has, unedited", () => {
    const line: MapLineElement = {
      id: "coast",
      kind: "line",
      name: "Coast",
      hidden: false,
      locked: false,
      points: [
        [0, 0],
        [10, 0],
      ],
      style: "plain",
      enclosesFills: true,
      closed: false,
      curves: [false],
      roughened: false,
    };
    const { editor } = openEditor([
      line,
      newLabel({ id: "reach", name: "Map Label 2", text: "The Reach", point: [100, 50] }),
    ]);

    editor.handleFrameMessage({ kind: "bendLabel", id: "coast", bend: 5 });
    editor.handleFrameMessage({ kind: "bendLabel", id: "gone", bend: 5 });
    editor.handleFrameMessage({ kind: "bendLabel", id: "reach", bend: 0 });

    expect(editor.getSnapshot().elements).toEqual([
      line,
      newLabel({ id: "reach", name: "Map Label 2", text: "The Reach", point: [100, 50] }),
    ]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("a transform handle drag from the Frame (#795)", () => {
  /** A marker Stamp 12 mm wide on (100, 50), and a Map Image 80 mm wide on (40, 60). */
  const marker: MapStampElement = {
    id: "marker",
    kind: "stamp",
    name: "City",
    hidden: false,
    locked: false,
    stampRef: "base:marker",
    transform: { x: 100, y: 50, size: 12, rotation: 0 },
  };
  const scan: MapImageElement = {
    id: "scan",
    kind: "image",
    name: "Scan",
    hidden: false,
    locked: false,
    assetRef: "a1",
    transform: { x: 40, y: 60, size: 80, rotation: 0 },
    opacity: 1,
    exportable: true,
  };

  /** An editor that records the scenes it draws its Frame from. */
  function openWatched(elements: MapElement[]) {
    const { editor } = openEditor(elements);
    const scenes: FrameSceneMessage[] = [];
    editor.attachFrame({
      postMessage: (message: FrameSceneMessage) => scenes.push(message),
    } as unknown as MessagePort);
    scenes.length = 0;
    return { editor, scenes };
  }

  it("writes a Stamp's centre, size, and turn in one undo step", () => {
    const { editor } = openEditor([marker]);
    editor.select("marker");

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "marker",
      box: { x: 40, y: 30, width: 24, height: 24, rotation: 30 },
    });

    expect(editor.getSnapshot().elements[0]).toMatchObject({
      transform: { x: 40, y: 30, size: 24, rotation: 30 },
    });
    // The panel's Size and Rotation fields read the same snapshot.
    expect(editor.getSnapshot().selectedStamp?.transform).toEqual({
      x: 40,
      y: 30,
      size: 24,
      rotation: 30,
    });

    // One drag is one edit, not one per pointer move the Frame previewed.
    editor.undo();
    expect(editor.getSnapshot().elements[0]).toEqual(marker);
    editor.redo();
    expect(editor.getSnapshot().elements[0]).toMatchObject({
      transform: { x: 40, y: 30, size: 24, rotation: 30 },
    });
  });

  it("writes a Map Image's centre, size, and turn in one undo step", () => {
    const { editor } = openEditor([scan]);

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "scan",
      box: { x: 60, y: 40, width: 40, height: 20, rotation: 15 },
    });

    expect(editor.getSnapshot().elements[0]).toMatchObject({
      transform: { x: 60, y: 40, size: 40, rotation: 15 },
    });

    editor.undo();
    expect(editor.getSnapshot().elements[0]).toEqual(scan);
  });

  it("keeps the box above zero and the turn inside one circle", () => {
    const { editor } = openEditor([marker]);

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "marker",
      box: { x: 100, y: 50, width: 0.2, height: 0.2, rotation: -90 },
    });

    expect(editor.getSnapshot().elements[0]).toMatchObject({
      transform: { x: 100, y: 50, size: MIN_STAMP_SIZE_MM, rotation: 270 },
    });
  });

  it("turns the scale bar's length, and with it the distance it reads", () => {
    const { editor, scenes } = openWatched([]);
    editor.setStamp("scale-bar");
    editor.insertStamp();
    const { id } = editor.getSnapshot().elements[0] as MapStampElement;
    const reading = (): string[] => {
      const [element] = scenes.at(-1)?.elements ?? [];
      return (element?.shapes ?? []).flatMap((shape) => ("text" in shape ? [shape.text] : []));
    };
    /** How far the bar's first segment reaches past its centre, in page millimetres. */
    const reach = (): number => {
      const [element] = scenes.at(-1)?.elements ?? [];
      const [bar] = element?.shapes ?? [];
      const match = bar !== undefined && "d" in bar ? /^M (-?[\d.]+)/.exec(bar.d) : null;
      if (match === null) throw new Error("the scene drew no scale bar");
      return Math.abs(Number(match[1]));
    };
    // 40 mm of a 200 mm page reading 1000 km labels 200 km.
    expect(reading()).toContain("200 km");
    const shortBar = reach();

    editor.handleFrameMessage({
      kind: "transformElement",
      id,
      box: { x: 100, y: 50, width: 100, height: 12, rotation: 0 },
    });

    expect(editor.getSnapshot().elements[0]).toMatchObject({ transform: { size: 100 } });
    expect(reading()).toContain("500 km");
    // A wider box draws a longer bar, which is why it reads further.
    expect(reach()).toBeGreaterThan(shortBar);
    editor.undo();
    expect(reading()).toContain("200 km");
    expect(reach()).toBe(shortBar);
  });

  it("changes nothing, and takes no undo step, for a locked or hidden Element", () => {
    const { editor } = openEditor([
      { ...marker, locked: true },
      { ...marker, id: "hidden", hidden: true },
    ]);

    for (const id of ["marker", "hidden"]) {
      editor.handleFrameMessage({
        kind: "transformElement",
        id,
        box: { x: 10, y: 10, width: 30, height: 30, rotation: 45 },
      });
    }

    expect(editor.getSnapshot().elements).toEqual([
      { ...marker, locked: true },
      { ...marker, id: "hidden", hidden: true },
    ]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("sends the Frame all four readout chip texts, so a drag can read millimetres or degrees", () => {
    const { editor, scenes } = openWatched([]);

    editor.zoomIn();

    expect(scenes.at(-1)?.readout).toEqual({
      size: "{{value}} mm",
      angle: "{{value}}°",
      shape: "{{width}} × {{height}} mm",
      label: "Cap {{size}} mm · {{width}} mm",
    });
  });

  it("leaves another kind of Element, a missing one, and the box it already has alone", () => {
    const line = squareLine("ring", "Ring", 10, 10, 80);
    const { editor } = openEditor([marker, line]);

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "ring",
      box: { x: 40, y: 40, width: 20, height: 20, rotation: 0 },
    });
    editor.handleFrameMessage({
      kind: "transformElement",
      id: "gone",
      box: { x: 40, y: 40, width: 20, height: 20, rotation: 0 },
    });
    // The box the Stamp already holds, and a whole turn back to its own.
    editor.handleFrameMessage({
      kind: "transformElement",
      id: "marker",
      box: { x: 100, y: 50, width: 12, height: 12, rotation: 360 },
    });

    expect(editor.getSnapshot().elements).toEqual([marker, line]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("scaling and turning the selection by keyboard (#795)", () => {
  /** A marker Stamp 12 mm wide on (100, 50), and a Map Image 80 mm wide on (40, 60). */
  const marker: MapStampElement = {
    id: "marker",
    kind: "stamp",
    name: "City",
    hidden: false,
    locked: false,
    stampRef: "base:marker",
    transform: { x: 100, y: 50, size: 12, rotation: 0 },
  };
  const scan: MapImageElement = {
    id: "scan",
    kind: "image",
    name: "Scan",
    hidden: false,
    locked: false,
    assetRef: "a1",
    transform: { x: 40, y: 60, size: 80, rotation: 0 },
    opacity: 1,
    exportable: true,
  };

  /** The stored transform of the Stamp or Map Image at `index`. */
  function transformOf(editor: MapEditor, index = 0): MapStampElement["transform"] {
    const element = editor.getSnapshot().elements[index];
    if (element === undefined || (element.kind !== "stamp" && element.kind !== "image"))
      throw new Error("no Stamp or Map Image");
    return element.transform;
  }

  it("scales a Stamp about its centre as one undo step", () => {
    const { editor } = openEditor([marker]);
    editor.select("marker");

    editor.scaleSelection(1.1);

    expect(transformOf(editor)).toMatchObject({ x: 100, y: 50, rotation: 0 });
    expect(transformOf(editor).size).toBeCloseTo(13.2);
    editor.undo();
    expect(editor.getSnapshot().elements[0]).toEqual(marker);
  });

  it("scales a Map Image, and a one-percent step nudges it less", () => {
    const { editor } = openEditor([scan]);
    editor.select("scan");

    editor.scaleSelection(1.01);
    expect(transformOf(editor).size).toBeCloseTo(80.8);

    editor.scaleSelection(1.1);
    expect(transformOf(editor).size).toBeCloseTo(88.88);

    editor.undo();
    expect(transformOf(editor).size).toBeCloseTo(80.8);
  });

  it("turns a Stamp clockwise and counterclockwise inside one circle, one step each", () => {
    const { editor } = openEditor([marker]);
    editor.select("marker");

    editor.rotateSelection(15);
    expect(transformOf(editor).rotation).toBe(15);
    editor.rotateSelection(1);
    expect(transformOf(editor).rotation).toBe(16);
    editor.rotateSelection(-31);
    expect(transformOf(editor).rotation).toBe(345);

    editor.undo();
    expect(transformOf(editor).rotation).toBe(16);
  });

  it("keeps a shrinking Stamp above zero, and a step that changes nothing is no undo step", () => {
    const { editor } = openEditor([
      { ...marker, transform: { ...marker.transform, size: MIN_STAMP_SIZE_MM } },
    ]);
    editor.select("marker");

    editor.scaleSelection(0.9);

    expect(transformOf(editor).size).toBe(MIN_STAMP_SIZE_MM);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("changes nothing, and takes no undo step, with nothing selected, a locked Element, or another kind", () => {
    const line = squareLine("ring", "Ring", 10, 10, 80);
    const { editor } = openEditor([{ ...marker, locked: true }, line]);

    // No selection at all.
    editor.scaleSelection(1.1);
    editor.rotateSelection(15);
    expect(editor.getSnapshot().canUndo).toBe(false);

    // A locked Stamp keeps its place, size, and turn.
    editor.select("marker");
    editor.scaleSelection(1.1);
    editor.rotateSelection(15);
    expect(transformOf(editor)).toEqual({ x: 100, y: 50, size: 12, rotation: 0 });

    // A freehand Map Line is neither a Stamp, a Map Image, a Shape, nor a Map Label.
    editor.select("ring");
    editor.scaleSelection(1.1);
    editor.rotateSelection(15);
    expect(editor.getSnapshot().canUndo).toBe(false);
    expect(editor.getSnapshot().elements[1]).toEqual(line);
  });
});

describe("a transform handle drag on Shapes and Map Labels (#796)", () => {
  /** An exact rectangle Shape line 40 by 20 mm on (30, 20), hexagon with square corners. */
  function shapeLine(overrides: Partial<MapLineElement> = {}): MapLineElement {
    const shape: MapShape = {
      kind: "rectangle",
      cx: 30,
      cy: 20,
      width: 40,
      height: 20,
      rotation: 0,
      sides: 6,
      cornerRadius: 2,
    };
    return {
      id: "shape",
      kind: "line",
      name: "Rectangle 1",
      hidden: false,
      locked: false,
      points: [
        [10, 10],
        [50, 10],
      ],
      style: "plain",
      enclosesFills: true,
      closed: true,
      curves: [false, false],
      roughened: false,
      shape,
      ...overrides,
    };
  }

  /** A Map Label 55 mm wide with a 6 mm cap size on (100, 50). */
  function mapLabel(overrides: Partial<MapLabelElement> = {}): MapLabelElement {
    return {
      ...newLabel({ id: "label", name: "Map Label 1", text: "The Reach", point: [100, 50] }),
      ...overrides,
    };
  }

  function shapeOf(editor: MapEditor): MapShape {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "line" || element.shape === undefined)
      throw new Error("no Shape");
    return element.shape;
  }

  function labelOf(editor: MapEditor): MapLabelElement {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "label") throw new Error("no Map Label");
    return element;
  }

  it("writes a Shape's width, height, rotation, and centre in one undo step, keeping sides and corner radius", () => {
    const { editor } = openEditor([shapeLine()]);
    editor.select("shape");

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "shape",
      box: { x: 40, y: 30, width: 64, height: 34, rotation: 18 },
    });

    const shape = shapeOf(editor);
    expect(shape).toMatchObject({
      cx: 40,
      cy: 30,
      width: 64,
      height: 34,
      rotation: 18,
      sides: 6,
      cornerRadius: 2,
    });
    // The outline follows the numbers, so the Frame and the preview agree.
    const [element] = editor.getSnapshot().elements as MapLineElement[];
    expect(element.points).toEqual(shapeOutline(shape).points);

    editor.undo();
    expect(shapeOf(editor)).toMatchObject({ cx: 30, cy: 20, width: 40, height: 20, rotation: 0 });
    editor.redo();
    expect(shapeOf(editor)).toMatchObject({ cx: 40, cy: 30, width: 64, height: 34, rotation: 18 });
  });

  it("writes a Map Label's cap size, width, rotation, and centre in one undo step", () => {
    const { editor } = openEditor([mapLabel()]);
    editor.select("label");

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "label",
      box: { x: 90, y: 60, width: 84, height: 7, rotation: 10 },
      size: 7,
    });

    expect(labelOf(editor)).toMatchObject({ x: 90, y: 60, width: 84, size: 7, rotation: 10 });

    editor.undo();
    expect(labelOf(editor)).toMatchObject({
      x: 100,
      y: 50,
      width: DEFAULT_LABEL_WIDTH_MM,
      size: DEFAULT_LABEL_SIZE_MM,
      rotation: 0,
    });
    editor.redo();
    expect(labelOf(editor)).toMatchObject({ x: 90, y: 60, width: 84, size: 7, rotation: 10 });
  });

  it("never lets a Map Label's cap size drop below its minimum", () => {
    const { editor } = openEditor([mapLabel({ size: MIN_LABEL_SIZE_MM })]);

    editor.handleFrameMessage({
      kind: "transformElement",
      id: "label",
      box: { x: 100, y: 50, width: DEFAULT_LABEL_WIDTH_MM, height: 0.2, rotation: 0 },
      size: 0.2,
    });

    expect(labelOf(editor).size).toBe(MIN_LABEL_SIZE_MM);
    expect(labelOf(editor).width).toBe(DEFAULT_LABEL_WIDTH_MM);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("changes nothing, and takes no undo step, for a locked, hidden, missing, or unchanged box", () => {
    const { editor } = openEditor([
      shapeLine({ id: "locked", locked: true }),
      shapeLine({ id: "hidden", hidden: true }),
      mapLabel({ id: "lockedLabel", locked: true } as Partial<MapLabelElement>),
    ]);
    const before = editor.getSnapshot().elements;

    for (const id of ["locked", "hidden", "lockedLabel"]) {
      editor.handleFrameMessage({
        kind: "transformElement",
        id,
        box: { x: 1, y: 2, width: 10, height: 8, rotation: 5 },
        ...(id === "lockedLabel" ? { size: 5 } : {}),
      });
    }
    editor.handleFrameMessage({
      kind: "transformElement",
      id: "gone",
      box: { x: 1, y: 2, width: 10, height: 8, rotation: 5 },
    });
    // The box the Shape already holds.
    const { editor: same } = openEditor([shapeLine()]);
    same.handleFrameMessage({
      kind: "transformElement",
      id: "shape",
      box: { x: 30, y: 20, width: 40, height: 20, rotation: 0 },
    });
    expect(same.getSnapshot().canUndo).toBe(false);

    expect(editor.getSnapshot().elements).toEqual(before);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("leaves a converted or freehand Map Line and a Fill alone", () => {
    const freehand = squareLine("ring", "Ring", 10, 10, 80);
    const cut = shapeLine({
      id: "cut",
      shape: undefined,
      convertedFrom: "rectangle",
      closed: false,
    });
    const fill: MapFillElement = {
      id: "fill",
      kind: "fill",
      name: "Fill 1",
      hidden: false,
      locked: false,
      anchor: [50, 50],
      content: { color: "land" },
    };
    const { editor } = openEditor([freehand, cut, fill]);

    for (const id of ["ring", "cut", "fill"]) {
      editor.handleFrameMessage({
        kind: "transformElement",
        id,
        box: { x: 40, y: 40, width: 20, height: 10, rotation: 0 },
      });
    }

    expect(editor.getSnapshot().elements).toEqual([freehand, cut, fill]);
    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("scaling and turning Shapes and Map Labels by keyboard (#796)", () => {
  function shapeLine(): MapLineElement {
    return {
      id: "shape",
      kind: "line",
      name: "Rectangle 1",
      hidden: false,
      locked: false,
      points: [
        [10, 10],
        [50, 10],
      ],
      style: "plain",
      enclosesFills: true,
      closed: true,
      curves: [false, false],
      roughened: false,
      shape: {
        kind: "rectangle",
        cx: 30,
        cy: 20,
        width: 40,
        height: 20,
        rotation: 0,
        sides: 6,
        cornerRadius: 0,
      },
    };
  }

  function shapeEditor(): { editor: MapEditor; id: string } {
    const { editor } = openEditor();
    editor.placeShape("rectangle");
    const [element] = editor.getSnapshot().elements as MapLineElement[];
    editor.select(element.id);
    return { editor, id: element.id };
  }

  function labelEditor(): { editor: MapEditor; id: string } {
    const { editor } = openEditor();
    editor.insertLabel();
    const [element] = editor.getSnapshot().elements as MapLabelElement[];
    editor.select(element.id);
    return { editor, id: element.id };
  }

  it("scales a Shape's width and height as one undo step", () => {
    const { editor } = shapeEditor();

    editor.scaleSelection(1.1);

    const [element] = editor.getSnapshot().elements as MapLineElement[];
    expect(element.shape?.width).toBeCloseTo(DEFAULT_SHAPE_SIZE_MM * 1.1);
    expect(element.shape?.height).toBeCloseTo(DEFAULT_SHAPE_SIZE_MM * 1.1);
    editor.undo();
    expect((editor.getSnapshot().elements[0] as MapLineElement).shape?.width).toBe(
      DEFAULT_SHAPE_SIZE_MM
    );
  });

  it("scales a Map Label's cap size and width together as one undo step", () => {
    const { editor } = labelEditor();

    editor.scaleSelection(1.1);

    const [element] = editor.getSnapshot().elements as MapLabelElement[];
    expect(element.width).toBeCloseTo(DEFAULT_LABEL_WIDTH_MM * 1.1);
    expect(element.size).toBeCloseTo(DEFAULT_LABEL_SIZE_MM * 1.1);
    editor.undo();
    const [restored] = editor.getSnapshot().elements as MapLabelElement[];
    expect(restored.width).toBe(DEFAULT_LABEL_WIDTH_MM);
    expect(restored.size).toBe(DEFAULT_LABEL_SIZE_MM);
  });

  it("turns a Shape and a Map Label, one undo step per press", () => {
    const { editor } = shapeEditor();
    editor.rotateSelection(15);
    expect((editor.getSnapshot().elements[0] as MapLineElement).shape?.rotation).toBe(15);
    editor.undo();
    expect((editor.getSnapshot().elements[0] as MapLineElement).shape?.rotation).toBe(0);

    const labelled = labelEditor();
    labelled.editor.rotateSelection(15);
    expect((labelled.editor.getSnapshot().elements[0] as MapLabelElement).rotation).toBe(15);
    labelled.editor.undo();
    expect((labelled.editor.getSnapshot().elements[0] as MapLabelElement).rotation).toBe(0);
  });

  it("does nothing on a locked Shape or with nothing selected", () => {
    const { editor } = openEditor([shapeLine()]);
    const before = editor.getSnapshot().elements;
    // No selection at all.
    editor.scaleSelection(1.1);
    editor.rotateSelection(15);
    expect(editor.getSnapshot().elements).toEqual(before);
    expect(editor.getSnapshot().canUndo).toBe(false);
    // A locked Shape keeps its numbers.
    editor.select("shape");
    editor.setLocked("shape", true);
    const afterLock = editor.getSnapshot().elements;
    editor.scaleSelection(1.1);
    editor.rotateSelection(15);
    expect(editor.getSnapshot().elements).toEqual(afterLock);
  });

  it("does nothing on a hidden selection", () => {
    const { editor } = openEditor([shapeLine()]);
    editor.select("shape");
    editor.setHidden("shape", true);
    const hidden = editor.getSnapshot().elements;
    editor.scaleSelection(1.1);
    editor.rotateSelection(15);
    expect(editor.getSnapshot().elements).toEqual(hidden);
  });
});

describe("the Shape and Map Label readout chips (#796)", () => {
  function openWatched(elements: MapElement[]) {
    const doc: MapDocument = {
      id: "map-1",
      bookId: null,
      name: "Map",
      page: { preset: "square", widthMm: 200, heightMm: 100 },
      styleId: "atlas",
      overrides: {},
      elements,
      createdAt: 0,
      updatedAt: 0,
      dataVersion: DATA_VERSION,
    };
    const editor = createMapEditor({
      store: {
        save: async () => {},
      },
      doc,
      language: () => "en",
    });
    const scenes: FrameSceneMessage[] = [];
    editor.attachFrame({
      postMessage: (message: FrameSceneMessage) => scenes.push(message),
    } as unknown as MessagePort);
    scenes.length = 0;
    return { editor, scenes };
  }

  it("carries the Shape and Map Label templates the Frame's chip reads", () => {
    const { scenes } = openWatched([]);
    expect(scenes).toHaveLength(0);
    const { editor, scenes: after } = openWatched([]);
    editor.zoomIn();
    expect(after.at(-1)?.readout.shape).toBe("{{width}} × {{height}} mm");
    expect(after.at(-1)?.readout.label).toBe("Cap {{size}} mm · {{width}} mm");
  });

  it("reads 64 × 34 mm and Cap 7 mm · 84 mm from those templates", () => {
    const { editor, scenes } = openWatched([]);
    editor.zoomIn();
    const readout = scenes.at(-1)?.readout;
    if (readout === undefined) throw new Error("no scene");
    expect(format(readout.shape, { width: 64, height: 34 })).toBe("64 × 34 mm");
    expect(format(readout.label, { size: 7, width: 84 })).toBe("Cap 7 mm · 84 mm");
  });
});

describe("Map Styles in the editor", () => {
  /** A marker Stamp in a colour of its own, which the clear tests start from. */
  function markerStamp(overrides: Partial<MapStampElement> = {}): MapStampElement {
    return {
      id: "marker",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 50, y: 50, size: 12, rotation: 0 },
      ...overrides,
    };
  }

  /** An editor over a fresh document, counting the saves it writes. */
  function watchedEditor(elements: MapElement[] = []) {
    const saved: MapDocument[] = [];
    const editor = createMapEditor({
      store: {
        save: async (doc) => {
          saved.push(doc);
        },
      },
      doc: {
        id: "map-1",
        bookId: null,
        name: "Map",
        page: { preset: "square", widthMm: 200, heightMm: 100 },
        styleId: "atlas",
        overrides: {},
        elements,
        createdAt: 0,
        updatedAt: 0,
        dataVersion: DATA_VERSION,
      },
      language: () => "en",
    });
    return { editor, saved };
  }

  it("switches the Map Style as one undo step and reports it in the snapshot", () => {
    const { editor } = openEditor();
    expect(editor.getSnapshot().styleId).toBe("atlas");

    editor.setMapStyle("night");
    expect(editor.getSnapshot().styleId).toBe("night");

    editor.undo();
    expect(editor.getSnapshot().styleId).toBe("atlas");
    editor.redo();
    expect(editor.getSnapshot().styleId).toBe("night");

    // A Style this build does not know, or the one already on, is no step:
    // one undo still lands on Atlas.
    editor.setMapStyle("dusk" as MapStyleId);
    editor.setMapStyle("night");
    editor.undo();
    expect(editor.getSnapshot().styleId).toBe("atlas");
  });

  it("autosaves the new Map Style like any other edit", async () => {
    const { editor, saved } = watchedEditor();
    editor.setMapStyle("ink");
    await editor.flush();

    expect(saved).toHaveLength(1);
    expect(saved[0].styleId).toBe("ink");
  });

  it("sets a Map Line's own colour, and stores a Style role for a role colour", () => {
    const { editor } = openEditor([squareLine("ring", "Ring", 10, 10, 80)]);

    editor.setLineColor("ring", "#123456");
    expect(onlyLine(editor).color).toBe("#123456");
    // The colour the line already has is not a step.
    editor.setLineColor("ring", "#123456");
    editor.undo();
    expect(onlyLine(editor).color).toBeUndefined();

    // A pick equal to one of the Style's own colours stores the role name, so
    // a Style switch recolours the line too.
    editor.setLineColor("ring", MAP_STYLES.atlas.forest.toUpperCase());
    expect(onlyLine(editor).color).toBe("forest");
    editor.setMapStyle("night");
    expect(resolveColor("night", onlyLine(editor).color, "ink")).toBe(MAP_STYLES.night.forest);

    // A locked Map Line keeps the colour it has.
    editor.setLocked("ring", true);
    editor.setLineColor("ring", "#abcdef");
    expect(onlyLine(editor).color).toBe("forest");
  });

  it("stores a role name whenever a pick equals one of the current Style's colours", () => {
    const [fill] = bucketFill({ color: "land" });
    const label = newLabel({
      id: "reach",
      name: "Map Label 1",
      text: "The Reach",
      point: [50, 50],
    });
    const { editor } = openEditor([
      squareLine("ring", "Ring", 10, 10, 80),
      fill,
      markerStamp(),
      label,
    ]);

    editor.setLineColor("ring", MAP_STYLES.atlas.desert);
    editor.setElementFillColor("fill", MAP_STYLES.atlas.forest);
    editor.setStampColor("marker", MAP_STYLES.atlas.river);
    editor.setLabelColor("reach", MAP_STYLES.atlas.water);

    const [line, styledFill, stamp, styledLabel] = editor.getSnapshot().elements as [
      MapLineElement,
      MapFillElement,
      MapStampElement,
      MapLabelElement,
    ];
    expect(line.color).toBe("desert");
    expect(styledFill.content.color).toBe("forest");
    expect(stamp.color).toBe("river");
    expect(styledLabel.color).toBe("water");
  });

  it("stores the land role for a Bucket colour that is one of the Style's own", () => {
    const { editor } = openEditor();
    editor.setFillColor(MAP_STYLES.atlas.land.toUpperCase());
    expect(editor.getSnapshot().currentFillColor).toBe("land");
    // Any other hex is an override the next Fill takes as it is.
    editor.setFillColor("#123456");
    expect(editor.getSnapshot().currentFillColor).toBe("#123456");
  });

  it("clears a Map Line's, Stamp's, or Map Label's override, and gives a Fill the land role", () => {
    const [fill] = bucketFill({ color: "#123456" });
    const label: MapLabelElement = {
      ...newLabel({ id: "reach", name: "Map Label 1", text: "The Reach", point: [50, 50] }),
      color: "#123456",
    };
    const { editor } = openEditor([
      { ...squareLine("ring", "Ring", 10, 10, 80), color: "#123456" },
      fill,
      markerStamp({ color: "#123456" }),
      label,
    ]);

    editor.clearElementColor("ring");
    editor.clearElementColor("marker");
    editor.clearElementColor("reach");
    editor.clearElementColor("fill");

    const [line, clearedFill, stamp, clearedLabel] = editor.getSnapshot().elements as [
      MapLineElement,
      MapFillElement,
      MapStampElement,
      MapLabelElement,
    ];
    expect(line.color).toBeUndefined();
    expect(clearedFill.content.color).toBe("land");
    expect(stamp.color).toBeUndefined();
    expect(clearedLabel.color).toBeUndefined();

    // Each clear is its own undo step: the Fill's colour comes back first.
    editor.undo();
    expect((editor.getSnapshot().elements[1] as MapFillElement).content.color).toBe("#123456");
  });

  it("takes no step for an Element that already follows the Style, or a locked one", () => {
    const [fill] = bucketFill({ color: "land" });
    const { editor } = openEditor([
      { ...squareLine("ring", "Ring", 10, 10, 80), color: "forest" },
      fill,
      markerStamp({ id: "locked", color: "#123456", locked: true }),
    ]);

    editor.clearElementColor("ring");
    editor.clearElementColor("fill");
    editor.clearElementColor("locked");
    editor.clearElementColor("ghost");

    expect(editor.getSnapshot().canUndo).toBe(false);
  });
});

describe("rasterizing the export SVG in the Frame", () => {
  /** A Frame port that records what the editor sends and answers nothing. */
  function framePort(): { port: MessagePort; messages: Array<Record<string, unknown>> } {
    const messages: Array<Record<string, unknown>> = [];
    const port = {
      onmessage: null,
      start: () => {},
      postMessage: (message: Record<string, unknown>) => messages.push(message),
    } as unknown as MessagePort;
    return { port, messages };
  }

  it("sends the rasterize request and resolves the reply by requestId", async () => {
    const { editor } = openEditor();
    const { port, messages } = framePort();
    editor.attachFrame(port);

    const pending = editor.rasterize("<svg/>", { widthPx: 900, heightPx: 1350 }, "png");
    const request = messages.find((message) => message.kind === "rasterize");
    expect(request).toMatchObject({
      kind: "rasterize",
      svg: "<svg/>",
      widthPx: 900,
      heightPx: 1350,
      format: "png",
    });
    if (request === undefined) throw new Error("no rasterize request");

    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    editor.handleFrameMessage({ kind: "rasterized", requestId: request.requestId, bytes });

    await expect(pending).resolves.toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("answers each of two pending requests by its own id", async () => {
    const { editor } = openEditor();
    const { port, messages } = framePort();
    editor.attachFrame(port);

    const first = editor.rasterize("<svg id='one'/>", { widthPx: 10, heightPx: 10 }, "png");
    const second = editor.rasterize(
      "<svg id='two'/>",
      { widthPx: 20, heightPx: 20 },
      {
        jpeg: 0.6,
      }
    );
    const requests = messages.filter((message) => message.kind === "rasterize");
    expect(requests).toHaveLength(2);

    // The second reply lands first; each promise still gets its own bytes.
    editor.handleFrameMessage({
      kind: "rasterized",
      requestId: requests[1].requestId,
      bytes: new Uint8Array([2]).buffer,
    });
    editor.handleFrameMessage({
      kind: "rasterized",
      requestId: requests[0].requestId,
      bytes: new Uint8Array([1]).buffer,
    });

    await expect(first).resolves.toEqual(new Uint8Array([1]));
    await expect(second).resolves.toEqual(new Uint8Array([2]));
  });

  it("rejects the request when the Frame reports an error", async () => {
    const { editor } = openEditor();
    const { port, messages } = framePort();
    editor.attachFrame(port);

    const pending = editor.rasterize("<svg/>", { widthPx: 10, heightPx: 10 }, "png");
    const request = messages.find((message) => message.kind === "rasterize");
    if (request === undefined) throw new Error("no rasterize request");
    editor.handleFrameMessage({ kind: "rasterized", requestId: request.requestId, error: "boom" });

    await expect(pending).rejects.toThrow("boom");
  });

  it("rejects at once when no Frame is mounted to draw in", async () => {
    const { editor } = openEditor();
    await expect(
      editor.rasterize("<svg/>", { widthPx: 10, heightPx: 10 }, "png")
    ).rejects.toThrow();
  });

  it("rejects a pending request when its Frame goes away", async () => {
    const { editor } = openEditor();
    const { port } = framePort();
    editor.attachFrame(port);

    const pending = editor.rasterize("<svg/>", { widthPx: 10, heightPx: 10 }, "png");
    editor.dispose();

    await expect(pending).rejects.toThrow();
  });
});

describe("the Library's pictures (#756)", () => {
  /** One index row for a picture `width` by `height` pixels. */
  function entry(id: string, width = 40, height = 20, recolorable = false): AssetIndexEntry {
    return { id, name: id, mime: "image/png", width, height, recolorable, use: "image" };
  }

  /** One Library picture: its index row and the base64 bytes the Library stores. */
  function asset(id: string, data = "AAAA"): AssetIndexEntry & MapAsset {
    return { ...entry(id), name: id, data };
  }

  /** A Map Image of the picture `id`, 80 mm wide at (40, 60). */
  function imageElement(id: string, overrides: Partial<MapImageElement> = {}): MapImageElement {
    return {
      id,
      kind: "image",
      name: id,
      hidden: false,
      locked: false,
      assetRef: "a1",
      transform: { x: 40, y: 60, size: 80, rotation: 0 },
      opacity: 1,
      exportable: true,
      ...overrides,
    };
  }

  /** A Custom Stamp drawing the picture `custom:a2`. */
  function customStamp(): MapStampElement {
    return {
      id: "portrait",
      kind: "stamp",
      name: "Portrait",
      hidden: false,
      locked: false,
      stampRef: "custom:a2",
      transform: { x: 100, y: 50, size: 12, rotation: 0 },
    };
  }

  /** A Frame port that records what the editor sends and answers nothing. */
  function framePort(): { port: MessagePort; messages: Array<Record<string, unknown>> } {
    const messages: Array<Record<string, unknown>> = [];
    const port = {
      onmessage: null,
      start: () => {},
      postMessage: (message: Record<string, unknown>) => messages.push(message),
    } as unknown as MessagePort;
    return { port, messages };
  }

  /** Where a Map's pictures come from, recording which ids were read. */
  function sourceOf(assets: Array<AssetIndexEntry & MapAsset>, customFills: CustomFill[] = []) {
    const loaded: string[] = [];
    const byId = new Map(assets.map((one) => [one.id, one]));
    return {
      loaded,
      source: {
        library: mapLibrary(assets, customFills),
        load: async (id: string) => {
          loaded.push(id);
          return byId.get(id) ?? null;
        },
      },
    };
  }

  const assetMessages = (messages: Array<Record<string, unknown>>) =>
    messages.filter((message) => message.kind === "asset");

  it("sends one asset message per picture the Map names, when the Frame connects", async () => {
    const { editor } = openEditor([imageElement("scan"), customStamp()]);
    editor.setAssetLibrary(sourceOf([asset("a1"), asset("a2")]).source);
    const { port, messages } = framePort();

    editor.attachFrame(port);

    await vi.waitFor(() =>
      expect(assetMessages(messages)).toEqual([
        { kind: "asset", id: "a1", mime: "image/png", data: "AAAA" },
        { kind: "asset", id: "a2", mime: "image/png", data: "AAAA" },
      ])
    );
  });

  it("sends a picture once, however many scenes name it", async () => {
    const { editor } = openEditor([imageElement("scan"), customStamp()]);
    const { source, loaded } = sourceOf([asset("a1"), asset("a2")]);
    editor.setAssetLibrary(source);
    const { port, messages } = framePort();
    editor.attachFrame(port);
    await vi.waitFor(() => expect(assetMessages(messages)).toHaveLength(2));

    editor.panLeft();
    editor.panLeft();

    await vi.waitFor(() =>
      expect(messages.filter((message) => message.kind === "scene")).toHaveLength(3)
    );
    expect(assetMessages(messages)).toHaveLength(2);
    expect(loaded).toEqual(["a1", "a2"]);
  });

  it("sends every picture again to a Frame that replaces the first", async () => {
    const { editor } = openEditor([imageElement("scan")]);
    editor.setAssetLibrary(sourceOf([asset("a1")]).source);
    const first = framePort();
    editor.attachFrame(first.port);
    await vi.waitFor(() => expect(assetMessages(first.messages)).toHaveLength(1));

    const second = framePort();
    editor.attachFrame(second.port);

    await vi.waitFor(() => expect(assetMessages(second.messages)).toHaveLength(1));
  });

  it("sends a picture a Custom Fill names once the Library holding it arrives", async () => {
    const [fill, ring] = bucketFill({ customFill: "meadow" });
    const { editor } = openEditor([fill, ring]);
    const { port, messages } = framePort();
    editor.attachFrame(port);

    editor.setAssetLibrary(
      sourceOf([asset("a3")], [{ id: "meadow", name: "Meadow", texture: "a3" }]).source
    );

    await vi.waitFor(() =>
      expect(assetMessages(messages)).toEqual([
        { kind: "asset", id: "a3", mime: "image/png", data: "AAAA" },
      ])
    );
  });

  it("sends nothing for a picture the Library no longer holds, and keeps drawing", async () => {
    const { editor } = openEditor([imageElement("scan")]);
    editor.setAssetLibrary(sourceOf([]).source);
    const { port, messages } = framePort();
    editor.attachFrame(port);

    // The scene still arrives, with the picture's primitive naming an id the
    // Frame has no bytes for, so it draws nothing there rather than nothing at all.
    await vi.waitFor(() =>
      expect(messages.filter((message) => message.kind === "scene")).toHaveLength(1)
    );
    expect(assetMessages(messages)).toEqual([]);
    expect(editor.getSnapshot().library.assets.size).toBe(0);
  });

  it("draws the Library's pictures in the scene it sends, never their bytes", async () => {
    const { editor } = openEditor([imageElement("scan")]);
    editor.setAssetLibrary(sourceOf([asset("a1")]).source);
    const { port, messages } = framePort();

    editor.attachFrame(port);

    const scene = messages.find((message) => message.kind === "scene");
    expect(scene).toMatchObject({
      elements: [
        { shapes: [{ kind: "image", assetId: "a1", x: 40, y: 60, width: 80, height: 40 }] },
      ],
    });
    expect(JSON.stringify(scene)).not.toContain("data:image");
  });

  it("names the data URIs an SVG export embeds, loading only the pictures the Map draws", async () => {
    const { editor } = openEditor([imageElement("scan"), customStamp()]);
    const { source, loaded } = sourceOf([asset("a1"), asset("a2"), asset("unused")], []);
    editor.setAssetLibrary(source);

    const uris = await editor.assetUris();

    expect([...uris]).toEqual([
      ["a1", "data:image/png;base64,AAAA"],
      ["a2", "data:image/png;base64,AAAA"],
    ]);
    expect(loaded).toEqual(["a1", "a2"]);
  });

  it("has no pictures to embed before the Library loads", async () => {
    const { editor } = openEditor([imageElement("scan")]);

    await expect(editor.assetUris()).resolves.toEqual(new Map());
  });
});

describe("an upload's ingest and the Elements it places (#756)", () => {
  /** One index row for a picture `width` by `height` pixels. */
  function entry(id: string, width = 40, height = 20, recolorable = false): AssetIndexEntry {
    return { id, name: id, mime: "image/png", width, height, recolorable, use: "stamp" };
  }

  /** One Library picture: its index row and the base64 bytes the Library stores. */
  function asset(id: string, width = 40, height = 20): AssetIndexEntry & MapAsset {
    return { ...entry(id, width, height), data: "AAAA" };
  }

  /** A Frame port that records what the editor sends and answers nothing. */
  function framePort(): { port: MessagePort; messages: Array<Record<string, unknown>> } {
    const messages: Array<Record<string, unknown>> = [];
    const port = {
      onmessage: null,
      start: () => {},
      postMessage: (message: Record<string, unknown>) => messages.push(message),
    } as unknown as MessagePort;
    return { port, messages };
  }

  /** Where a Map's pictures come from, listing these rows. */
  function libraryOf(assets: Array<AssetIndexEntry & MapAsset>, customFills: CustomFill[] = []) {
    const byId = new Map(assets.map((one) => [one.id, one]));
    return {
      library: mapLibrary(assets, customFills),
      load: async (id: string) => byId.get(id) ?? null,
    };
  }

  /** The one ingest request the editor posted. */
  function ingestRequest(messages: Array<Record<string, unknown>>) {
    const request = messages.find((message) => message.kind === "ingest-asset");
    if (request === undefined) throw new Error("no ingest request");
    return request as {
      requestId: number;
      mime: string;
      data: string;
    };
  }

  it("resolves an ingest with the size and bytes the Frame measured", async () => {
    const { editor } = openEditor();
    const { port, messages } = framePort();
    editor.attachFrame(port);

    const pending = editor.ingestAsset("image/svg+xml", "PHN2Zz4=");
    await vi.waitFor(() =>
      expect(messages.some((message) => message.kind === "ingest-asset")).toBe(true)
    );
    const request = ingestRequest(messages);
    expect(request).toMatchObject({ mime: "image/svg+xml", data: "PHN2Zz4=" });

    editor.handleFrameMessage({
      kind: "asset-ingested",
      requestId: request.requestId,
      data: "<svg/>",
      width: 40,
      height: 20,
      recolorable: true,
    });

    await expect(pending).resolves.toEqual({
      data: "<svg/>",
      width: 40,
      height: 20,
      recolorable: true,
    });
  });

  it("rejects an ingest the Frame refuses, and one no Frame can answer", async () => {
    const { editor } = openEditor();
    await expect(editor.ingestAsset("image/png", "AAAA")).rejects.toThrow("no Frame");

    const { port, messages } = framePort();
    editor.attachFrame(port);
    const pending = editor.ingestAsset("image/png", "AAAA");
    await vi.waitFor(() =>
      expect(messages.some((message) => message.kind === "ingest-asset")).toBe(true)
    );

    editor.handleFrameMessage({
      kind: "ingest-error",
      requestId: ingestRequest(messages).requestId,
      reason: "invalid-image",
    });

    await expect(pending).rejects.toThrow("invalid-image");
  });

  it("rejects a pending ingest when a new Frame replaces the one that held it", async () => {
    const { editor } = openEditor();
    const first = framePort();
    editor.attachFrame(first.port);
    const pending = editor.ingestAsset("image/png", "AAAA");
    await vi.waitFor(() => expect(ingestRequest(first.messages)).toBeDefined());

    editor.attachFrame(framePort().port);

    await expect(pending).rejects.toThrow("the Frame was replaced");
  });

  it("places a Custom Stamp of the Library picture at the view centre, selected and undoable", () => {
    const { editor } = openEditor();
    editor.setAssetLibrary(libraryOf([asset("a2")]));

    editor.insertCustomStamp("a2");

    const [element] = editor.getSnapshot().elements as MapStampElement[];
    expect(element).toMatchObject({
      kind: "stamp",
      name: "a2",
      stampRef: "custom:a2",
      transform: { x: 100, y: 50, size: DEFAULT_STAMP_SIZE_MM, rotation: 0 },
    });
    expect(editor.getSnapshot().selectedId).toBe(element.id);
    // The Insert tool keeps the picture as its pick, so a pointer drop places it too.
    expect(editor.getSnapshot().currentStampId).toBe("custom:a2");

    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("places a Map Image at half the page width, selected and undoable", () => {
    const { editor } = openEditor();
    editor.setAssetLibrary(libraryOf([{ ...asset("a1", 100, 50), use: "image" }]));

    editor.insertImage("a1");

    const [element] = editor.getSnapshot().elements as MapImageElement[];
    expect(element).toMatchObject({
      kind: "image",
      name: "a1",
      assetRef: "a1",
      transform: { x: 100, y: 50, size: 100, rotation: 0 },
      opacity: MAX_IMAGE_OPACITY,
      exportable: true,
    });
    expect(editor.getSnapshot().selectedId).toBe(element.id);

    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("fades, resizes, and keeps a Map Image out of exports, one undo step each", () => {
    const { editor } = openEditor();
    editor.setAssetLibrary(libraryOf([{ ...asset("a1", 100, 50), use: "image" }]));
    editor.insertImage("a1");
    const id = (editor.getSnapshot().elements[0] as MapImageElement).id;

    editor.setImageOpacity(id, 0.5);
    editor.setImageExportable(id, false);
    editor.setImageSize(id, 30);

    const image = editor.getSnapshot().elements[0] as MapImageElement;
    expect(image.opacity).toBe(0.5);
    expect(image.exportable).toBe(false);
    expect(image.transform.size).toBe(30);

    editor.undo();
    editor.undo();
    editor.undo();
    const restored = editor.getSnapshot().elements[0] as MapImageElement;
    expect(restored.opacity).toBe(MAX_IMAGE_OPACITY);
    expect(restored.exportable).toBe(true);
    expect(restored.transform.size).toBe(100);
  });
});

describe("zooming and panning by gesture (#777)", () => {
  /** A Frame port that records the scenes the editor sends it. */
  function recordedPort(): { port: MessagePort; scenes: Array<Record<string, unknown>> } {
    const scenes: Array<Record<string, unknown>> = [];
    const port = {
      onmessage: null,
      start: () => {},
      postMessage: (message: Record<string, unknown>) => scenes.push(message),
    } as unknown as MessagePort;
    return { port, scenes };
  }

  /**
   * The page rectangle a scene draws, in page millimetres, read the way the
   * Frame reads it: zoom crops around the page's centre and pan slides the
   * crop. Mirrors `viewRect` in `assets/ui/map.js`.
   */
  function viewRect(scene: Record<string, unknown>) {
    const widthMm = scene.widthMm as number;
    const heightMm = scene.heightMm as number;
    const zoom = scene.zoom as number;
    const width = widthMm / zoom;
    const height = heightMm / zoom;
    return {
      x: (widthMm - width) / 2 + (scene.panX as number),
      y: (heightMm - height) / 2 + (scene.panY as number),
      width,
      height,
    };
  }

  /** Where a page point sits across the view: 0 at its left or top edge, 1 at its right or bottom. */
  function across(point: number, edge: number, size: number): number {
    return (point - edge) / size;
  }

  it("keeps the page point under the pointer fixed as it zooms", () => {
    const { editor } = openEditor();
    const { port, scenes } = recordedPort();
    editor.attachFrame(port);
    const before = viewRect(scenes[0]);

    editor.handleFrameMessage({ kind: "zoom", point: [60, 25], factor: 2 });

    const after = viewRect(scenes[scenes.length - 1]);
    expect(scenes[scenes.length - 1].zoom).toBe(2);
    // Same place on screen at the new zoom: the page never slides out from
    // under the pointer that asked for it.
    expect(across(60, after.x, after.width)).toBeCloseTo(across(60, before.x, before.width), 10);
    expect(across(25, after.y, after.height)).toBeCloseTo(across(25, before.y, before.height), 10);
  });

  it("keeps the point fixed however many gestures zoom in a row", () => {
    const { editor } = openEditor();
    const { port, scenes } = recordedPort();
    editor.attachFrame(port);

    editor.handleFrameMessage({ kind: "zoom", point: [150, 80], factor: 1.25 });
    const middle = viewRect(scenes[scenes.length - 1]);
    editor.handleFrameMessage({ kind: "zoom", point: [150, 80], factor: 0.5 });

    const after = viewRect(scenes[scenes.length - 1]);
    expect(scenes[scenes.length - 1].zoom as number).toBeCloseTo(0.625);
    expect(across(150, after.x, after.width)).toBeCloseTo(across(150, middle.x, middle.width), 10);
    expect(across(80, after.y, after.height)).toBeCloseTo(across(80, middle.y, middle.height), 10);
  });

  it("clamps the gesture's zoom to the editor's own range", () => {
    const { editor } = openEditor();
    const { port, scenes } = recordedPort();
    editor.attachFrame(port);

    editor.handleFrameMessage({ kind: "zoom", point: [100, 50], factor: 100 });
    expect(scenes[scenes.length - 1].zoom).toBe(MAX_ZOOM);

    editor.handleFrameMessage({ kind: "zoom", point: [100, 50], factor: 0.0001 });
    expect(scenes[scenes.length - 1].zoom).toBe(MIN_ZOOM);
  });

  it("leaves the view alone when the zoom is already at its limit", () => {
    const { editor } = openEditor();
    const { port, scenes } = recordedPort();
    editor.attachFrame(port);
    editor.handleFrameMessage({ kind: "zoom", point: [100, 50], factor: 100 });
    const atLimit = scenes[scenes.length - 1];
    const sent = scenes.length;

    // A gesture the maximum refuses moves neither the zoom nor the crop, so
    // the point under the pointer cannot drift when nothing zooms.
    editor.handleFrameMessage({ kind: "zoom", point: [40, 20], factor: 2 });

    expect(scenes).toHaveLength(sent);
    expect(scenes[scenes.length - 1]).toEqual(atLimit);
  });

  it("slides the view by the millimetres a pan measured", () => {
    const { editor } = openEditor();
    const { port, scenes } = recordedPort();
    editor.attachFrame(port);

    editor.handleFrameMessage({ kind: "pan", dx: 8, dy: -3 });
    editor.handleFrameMessage({ kind: "pan", dx: 2, dy: -2 });

    expect(scenes[scenes.length - 1].panX).toBe(10);
    expect(scenes[scenes.length - 1].panY).toBe(-5);
  });

  it("takes no undo step for a zoom or a pan", () => {
    const { editor } = openEditor();
    editor.handleFrameMessage({
      kind: "shape",
      shape: "rectangle",
      start: [10, 10],
      end: [50, 30],
      constrain: false,
    });
    const { port } = recordedPort();
    editor.attachFrame(port);
    const elements = editor.getSnapshot().elements;

    editor.handleFrameMessage({ kind: "zoom", point: [60, 25], factor: 2 });
    editor.handleFrameMessage({ kind: "pan", dx: 8, dy: -3 });

    expect(editor.getSnapshot().elements).toEqual(elements);
    expect(editor.getSnapshot().canUndo).toBe(true);
    // The one undo step is still the Shape, which zooming never consumed.
    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });

  it("drops a malformed zoom or pan request", () => {
    const { editor } = openEditor();
    const { port, scenes } = recordedPort();
    editor.attachFrame(port);
    const sent = scenes.length;

    for (const message of [
      { kind: "zoom", point: [60, 25], factor: 0 },
      { kind: "zoom", point: [60], factor: 2 },
      { kind: "zoom", factor: 2 },
      { kind: "pan", dx: Number.NaN, dy: 0 },
      { kind: "pan", dx: 1 },
    ]) {
      editor.handleFrameMessage(message);
    }

    expect(scenes).toHaveLength(sent);
  });
});

describe("the view the zoom cluster reads (#778)", () => {
  it("reports the zoom every path that moves it leaves", () => {
    const { editor } = openEditor();
    expect(editor.getSnapshot().zoom).toBe(1);

    editor.zoomIn();
    expect(editor.getSnapshot().zoom).toBeCloseTo(1.25, 10);

    // A gesture moves the same value the cluster's readout reads, so the two
    // never disagree about how far in the view is.
    editor.handleFrameMessage({ kind: "zoom", point: [100, 50], factor: 2 });
    expect(editor.getSnapshot().zoom).toBeCloseTo(2.5, 10);

    editor.zoomReset();
    expect(editor.getSnapshot().zoom).toBe(1);
  });

  it("repaints the page when a gesture zooms or pans", () => {
    const { editor } = openEditor();
    let painted = 0;
    const stop = editor.subscribe(() => {
      painted += 1;
    });

    editor.handleFrameMessage({ kind: "zoom", point: [100, 50], factor: 2 });
    editor.handleFrameMessage({ kind: "pan", dx: 4, dy: 0 });

    stop();
    expect(painted).toBe(2);
  });
});

describe("the Stamp size the Insert card picks (#778)", () => {
  /** The one Stamp an editor holds. */
  function onlyStamp(editor: MapEditor): MapStampElement {
    const [element] = editor.getSnapshot().elements;
    if (element === undefined || element.kind !== "stamp") throw new Error("no Stamp");
    return element;
  }

  it("places the next Stamp at the size the author picked", () => {
    const { editor } = openEditor();
    expect(editor.getSnapshot().currentStampSize).toBe(DEFAULT_STAMP_SIZE_MM);

    editor.setStampSize(40);
    editor.insertStamp();

    expect(editor.getSnapshot().currentStampSize).toBe(40);
    expect(onlyStamp(editor).transform.size).toBe(40);
  });

  it("keeps the size above the model's minimum", () => {
    const { editor } = openEditor();
    editor.setStampSize(0);
    expect(editor.getSnapshot().currentStampSize).toBe(MIN_STAMP_SIZE_MM);
  });

  it("places an uploaded Custom Stamp at the same size, and takes no undo step to set it", () => {
    const { editor } = openEditor();
    const entry: AssetIndexEntry = {
      id: "a1",
      name: "Banner",
      mime: "image/svg+xml",
      width: 20,
      height: 10,
      recolorable: false,
      use: "stamp",
    };
    editor.setAssetLibrary({
      library: mapLibrary([entry], []),
      load: async () => null,
    });

    editor.setStampSize(30);
    editor.insertCustomStamp("a1");

    expect(onlyStamp(editor).transform.size).toBe(30);
    expect(editor.getSnapshot().canUndo).toBe(true);
    editor.undo();
    expect(editor.getSnapshot().elements).toEqual([]);
  });
});

describe("renaming the Map from its own name (#778)", () => {
  it("writes the trimmed name and saves the document once", async () => {
    let saves = 0;
    const saved: MapDocument[] = [];
    const editor = createMapEditor({
      store: {
        save: async (doc: MapDocument) => {
          saves += 1;
          saved.push(doc);
        },
      },
      doc: {
        id: "map-1",
        bookId: null,
        name: "Map",
        page: { preset: "square", widthMm: 200, heightMm: 100 },
        styleId: "atlas",
        overrides: {},
        elements: [],
        createdAt: 0,
        updatedAt: 0,
        dataVersion: DATA_VERSION,
      },
      language: () => "en",
    });

    editor.renameMap("  Coastline  ");
    expect(editor.getSnapshot().doc.name).toBe("Coastline");
    await editor.flush();

    expect(saves).toBe(1);
    expect(saved[0].name).toBe("Coastline");
    // The Map is not one of its Elements: renaming it is no undo step.
    expect(editor.getSnapshot().canUndo).toBe(false);
  });

  it("refuses a blank name and a name it already has", async () => {
    const { editor } = openEditor();
    let painted = 0;
    const stop = editor.subscribe(() => {
      painted += 1;
    });

    editor.renameMap("   ");
    editor.renameMap("Map");

    stop();
    expect(editor.getSnapshot().doc.name).toBe("Map");
    expect(painted).toBe(0);
  });
});

describe("switching tools", () => {
  it("drops the selection when the Select tool hands over to any other tool", () => {
    const { editor } = openEditor();
    editor.placeShape("rectangle");
    const id = onlyLine(editor).id;

    for (const tool of ["hand", "pencil", "bucket", "insert", "eraser"] as const) {
      editor.setTool("select");
      editor.select(id);
      editor.setTool(tool);
      expect(editor.getSnapshot().selectedId).toBeNull();
      expect(editor.getSnapshot().selectedShape).toBeNull();
    }
  });

  it("keeps the selection when the Select tool is picked again", () => {
    const { editor } = openEditor();
    editor.placeShape("rectangle");
    const id = onlyLine(editor).id;
    editor.setTool("pencil");
    editor.setTool("select");
    editor.select(id);

    editor.setTool("select");
    expect(editor.getSnapshot().selectedId).toBe(id);
  });
});
