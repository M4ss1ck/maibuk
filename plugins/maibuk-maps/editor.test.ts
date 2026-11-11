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
  DEFAULT_SCALE_BAR_SIZE_MM,
  DEFAULT_SHAPE_SIZE_MM,
  DEFAULT_STAMP_COLOR,
  DEFAULT_STAMP_SIZE_MM,
  MIN_STAMP_SIZE_MM,
  type MapDocument,
  type MapElement,
  type MapFillElement,
  type MapLineElement,
  type MapShape,
  type MapStampElement,
  type StampScaleUnit,
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
      color: DEFAULT_STAMP_COLOR,
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

  it("leaves a locked Stamp, and an Element with no centre of its own, where it is", () => {
    const { editor } = openEditor([
      stamp({ locked: true }),
      { id: "label", kind: "label", name: "The Reach", hidden: false, locked: false },
    ]);

    editor.select("marker");
    editor.move(1, 0);
    expect(editor.getSnapshot().elements[0]).toEqual(stamp({ locked: true }));

    editor.select("label");
    editor.move(1, 0);
    expect(editor.getSnapshot().elements[1]).toEqual({
      id: "label",
      kind: "label",
      name: "The Reach",
      hidden: false,
      locked: false,
    });
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
      color: DEFAULT_STAMP_COLOR,
    });
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
    expect((editor.getSnapshot().elements[0] as MapStampElement).color).toBe(DEFAULT_STAMP_COLOR);
  });

  it("leaves art that keeps its own colours, and a locked Stamp, alone", () => {
    const { editor } = openEditor();
    editor.setStamp("castle");
    editor.insertStamp();
    const [castle] = editor.getSnapshot().elements as MapStampElement[];

    editor.setStampColor(castle.id, "#8b1a1a");
    expect((editor.getSnapshot().elements[0] as MapStampElement).color).toBe(DEFAULT_STAMP_COLOR);

    editor.setStamp("marker");
    editor.insertStamp();
    const marker = editor.getSnapshot().elements[1] as MapStampElement;
    editor.setLocked(marker.id, true);
    editor.setStampColor(marker.id, "#8b1a1a");
    expect((editor.getSnapshot().elements[1] as MapStampElement).color).toBe(DEFAULT_STAMP_COLOR);
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
