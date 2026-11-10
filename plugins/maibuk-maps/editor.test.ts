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
  DEFAULT_POLYGON_SIDES,
  DEFAULT_SHAPE_SIZE_MM,
  type MapDocument,
  type MapElement,
  type MapLineElement,
  type MapShape,
} from "./maps";

/** An editor over a square 200 by 100 mm Map, with a store that keeps what it saves. */
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
  const saved: MapDocument[] = [];
  const editor = createMapEditor({
    store: {
      save: async (next) => {
        saved.push(next);
      },
    },
    doc,
    language: () => "en",
  });
  return { editor, saved };
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
