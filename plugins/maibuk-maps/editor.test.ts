/**
 * The Map editor's exact Shapes (#747): the lines a draw or a keyboard places
 * make, the number fields that resize, turn, and reshape one, and what the
 * Eraser and Roughen leave of it. Every test drives the editor the way the Frame
 * and the host do, through Frame messages and its own methods, and reads the
 * snapshot the page draws.
 */

import { describe, expect, it } from "vitest";
import { createMapEditor, type MapEditor } from "./editor";
import { parseFrameMessage } from "./frame-protocol";
import { shapeOutline } from "./geometry";
import {
  DATA_VERSION,
  DEFAULT_FILL_COLOR,
  DEFAULT_POLYGON_SIDES,
  DEFAULT_SHAPE_SIZE_MM,
  type MapDocument,
  type MapElement,
  type MapFillElement,
  type MapLineElement,
  type MapShape,
} from "./maps";

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
      content: { color: DEFAULT_FILL_COLOR },
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
    expect(editor.getSnapshot().selectedFillColor).toBe(DEFAULT_FILL_COLOR);
    expect(editor.getSnapshot().currentFillColor).toBe(DEFAULT_FILL_COLOR);
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
    expect(fills(editor)[0].content.color).toBe(DEFAULT_FILL_COLOR);

    editor.setLocked(fill.id, true);
    editor.setElementFillColor(fill.id, "#000000");
    expect(fills(editor)[0].content.color).toBe(DEFAULT_FILL_COLOR);
    // The refused change is not a step either: undo unlocks the Fill.
    editor.undo();
    expect(fills(editor)[0].locked).toBe(false);
    expect(fills(editor)[0].content.color).toBe(DEFAULT_FILL_COLOR);
  });
});
