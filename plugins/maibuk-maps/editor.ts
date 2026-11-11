/**
 * The open Map's editor state (#745, #746, #747): its Elements, selection, tool,
 * view, undo history, and autosave. The host renders the panels and the Frame
 * draws the scene, so this module owns everything that must outlive a page
 * render yet stay inside the Worker. One editor is created when a Map opens and
 * disposed when the author returns to the Maps list; nothing here is persisted
 * except through `MapStore.save`.
 *
 * Every edit goes through `history.commit` and schedules the whole Map document
 * for autosave. Zoom, pan, tool, selection, the current line style, the current
 * Fill colour, and the Roughen strength are view state: not saved and not
 * undoable. This module imports only its own files.
 */

import type {
  LineStyleId,
  MapDocument,
  MapElement,
  MapFillElement,
  MapLineElement,
  MapPoint,
  MapShape,
  MapStampElement,
  MapStampScale,
  MapStampTransform,
  MapStore,
  ShapeKind,
} from "./maps";
import {
  DEFAULT_FILL_COLOR,
  DEFAULT_POLYGON_SIDES,
  DEFAULT_SHAPE_SIZE_MM,
  LINE_STYLE_DEFAULT_ENCLOSES,
  MAX_NAME_LENGTH,
  MIN_STAMP_SIZE_MM,
  curvedSegments,
  isStampScaleUnit,
  newStamp,
  normalizeShape,
  randomMapId,
} from "./maps";
import { createAutosave } from "./autosave";
import { pourFill, reconcileFills } from "./fills";
import {
  parseFrameMessage,
  sceneMessage,
  type FrameSceneMessage,
  type FrameToWorkerMessage,
  type MapTool,
  type PenDraftLabel,
} from "./frame-protocol";
import {
  convertShapeLine,
  eraseLines,
  roughen as roughenPoints,
  seedFor,
  shapeFromCorners,
  shapeOutline,
} from "./geometry";
import { createHistory } from "./history";
import { format, translate, type MapsKey } from "./i18n";
import {
  addElement,
  moveElement,
  removeElement,
  renameElement,
  reorder,
  setHidden,
  setLocked,
  smoothStroke,
} from "./scene";
import { BASE_STAMP_IDS, baseStampRef, stampTakesColour } from "./stamps";

/** How much one zoom step changes the view. */
const ZOOM_STEP = 1.25;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
/** How far one pan Command moves the view, in page millimetres. */
export const PAN_STEP_MM = 20;

/** How hard Roughen pushes a line off its path, in page millimetres. */
export const DEFAULT_ROUGHEN_STRENGTH_MM = 1.5;
export const MIN_ROUGHEN_STRENGTH_MM = 0.5;
export const MAX_ROUGHEN_STRENGTH_MM = 5;

/** The catalog key of the line name each Shape kind takes (#747). */
const SHAPE_NAME_KEYS: Readonly<Record<ShapeKind, MapsKey>> = {
  ellipse: "element.ellipseName",
  rectangle: "element.rectangleName",
  polygon: "element.polygonName",
};

/** The base Stamp the Insert tool places until the author picks another. */
export const DEFAULT_STAMP_ID = "capital";

/**
 * The catalog key of a built-in Stamp's name, which every art carries a string
 * for in both shipped languages.
 */
export function stampNameKey(id: string): MapsKey {
  return `stamp.${id}` as MapsKey;
}

/** What the page draws: the document, its Elements, and the editor flags. */
export interface MapEditorSnapshot {
  doc: MapDocument;
  elements: readonly MapElement[];
  selectedId: string | null;
  tool: MapTool;
  canUndo: boolean;
  canRedo: boolean;
  saveFailed: boolean;
  /** The line style a new Pen line takes, and the style the select shows with no Map Line selected. */
  currentLineStyle: LineStyleId;
  /** The colour a new Fill takes, which the Bucket pours. */
  currentFillColor: string;
  /** How hard Roughen pushes the selected line, in page millimetres. */
  roughenStrength: number;
  /** Whether the selected Element is a Map Line. */
  selectedIsLine: boolean;
  /** Whether the selected Element is a Fill. */
  selectedIsFill: boolean;
  /** The selected Fill's colour, or null when the selection is not a Fill. */
  selectedFillColor: string | null;
  /** The selected Map Line's style, or null when the selection is not a Map Line. */
  selectedLineStyle: LineStyleId | null;
  /** Whether the selected Map Line encloses Fills, or null when it is not a Map Line. */
  selectedEnclosesFills: boolean | null;
  /** The selected Map Line's exact Shape, or null when it carries none. */
  selectedShape: MapShape | null;
  /** The Shape kind the selected line was converted from, or null when it never was a Shape. */
  selectedConvertedFrom: ShapeKind | null;
  /** The base Stamp the Insert tool places next. */
  currentStampId: string;
  /** The selected Stamp, or null when the selection is not a Stamp. */
  selectedStamp: MapStampElement | null;
}

export interface MapEditorOptions {
  store: Pick<MapStore, "save">;
  doc: MapDocument;
  /** The app language at call time, for the names a new Map Line takes. */
  language: () => string;
}

export interface MapEditor {
  getSnapshot(): MapEditorSnapshot;
  subscribe(listener: () => void): () => void;
  /** Keeps the Frame drawing the current scene. */
  attachFrame(port: MessagePort): void;
  /** Handles one validated Frame message; a malformed one is dropped. */
  handleFrameMessage(data: unknown): void;
  select(id: string | null): void;
  setTool(tool: MapTool): void;
  rename(id: string, name: string): void;
  setHidden(id: string, hidden: boolean): void;
  setLocked(id: string, locked: boolean): void;
  /** Picks a line style for new Pen lines; a selected unlocked Map Line takes it too. */
  setLineStyle(style: LineStyleId): void;
  /** Picks the colour the Bucket pours. */
  setFillColor(color: string): void;
  /** Sets one unlocked Fill's colour; a refused or equal colour is not an undo step. */
  setElementFillColor(id: string, color: string): void;
  /** Sets whether one unlocked Map Line encloses Fills. */
  setEnclosesFills(id: string, enclosesFills: boolean): void;
  /** Sets how hard Roughen pushes the selected line, in page millimetres. */
  setRoughenStrength(strengthMm: number): void;
  /** Roughens the selected unlocked Map Line as one undo step. */
  roughen(): void;
  /** Adds a Shape of `kind` at the view centre, at the default size, as one undo step. */
  placeShape(kind: ShapeKind): void;
  /** Reshapes one unlocked exact Shape line from its number fields, as one undo step. */
  setShapeGeometry(id: string, patch: Partial<Omit<MapShape, "kind">>): void;
  /** Picks the base Stamp the Insert tool places next. */
  setStamp(id: string): void;
  /** Drops the picked Stamp at `point`, or at the view centre, selected, as one undo step. */
  insertStamp(point?: MapPoint): void;
  /** Moves, sizes, or turns one unlocked Stamp from its number fields, as one undo step. */
  setStampTransform(id: string, patch: Partial<MapStampTransform>): void;
  /** Sets the scale bar's unit or the distance its page width stands for, as one undo step. */
  setStampScale(id: string, patch: Partial<MapStampScale>): void;
  /** Recolours one unlocked one-colour Stamp, as one undo step. */
  setStampColor(id: string, color: string): void;
  deleteElement(id: string): void;
  /** Moves one Element one place towards the top of the Elements list. */
  moveUp(id: string): void;
  /** Moves one Element one place towards the bottom of the Elements list. */
  moveDown(id: string): void;
  /** Moves the selection by page millimetres; a locked Element stays put. */
  move(dx: number, dy: number): void;
  undo(): void;
  redo(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  panLeft(): void;
  panRight(): void;
  panUp(): void;
  panDown(): void;
  /** Writes a pending autosave now. */
  flush(): Promise<void>;
  /** Whether a failed or scheduled save still holds an unwritten document. */
  hasPendingSave(): boolean;
  /** Drops every Frame and listener; the runtime does this when the Map closes. */
  dispose(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Whether two Shapes draw the same outline, so a repeated edit is not an undo step. */
function sameShape(one: MapShape, two: MapShape): boolean {
  return (
    one.kind === two.kind &&
    one.cx === two.cx &&
    one.cy === two.cy &&
    one.width === two.width &&
    one.height === two.height &&
    one.rotation === two.rotation &&
    one.sides === two.sides &&
    one.cornerRadius === two.cornerRadius
  );
}

/** A Stamp's turn brought into one full circle: -90 degrees reads 270. */
function normalizeRotation(rotation: number): number {
  const turned = rotation % 360;
  return turned < 0 ? turned + 360 : turned;
}

export function createMapEditor(options: MapEditorOptions): MapEditor {
  let doc = options.doc;
  let elements: MapElement[] = doc.elements;
  const history = createHistory<MapElement[]>(elements);
  let selectedId: string | null = null;
  let tool: MapTool = "select";
  let currentLineStyle: LineStyleId = "plain";
  let currentFillColor = DEFAULT_FILL_COLOR;
  let currentStampId = DEFAULT_STAMP_ID;
  let roughenStrength = DEFAULT_ROUGHEN_STRENGTH_MM;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let saveFailed = false;
  // The Map page embeds one Frame at a time. A remount hands a new port, which
  // replaces the old one, so a detached Frame stops receiving scenes (#745).
  let frame: MessagePort | null = null;
  const listeners = new Set<() => void>();

  let snapshot = buildSnapshot();

  const autosave = createAutosave<MapDocument>({
    save: (next) => options.store.save(next),
    onError: () => {
      saveFailed = true;
      publish();
    },
  });

  function buildSnapshot(): MapEditorSnapshot {
    const selected = elementById(selectedId);
    const selectedLine = selected !== undefined && selected.kind === "line" ? selected : null;
    const selectedFill = selected !== undefined && selected.kind === "fill" ? selected : null;
    const selectedStamp = selected !== undefined && selected.kind === "stamp" ? selected : null;
    return {
      doc,
      elements,
      selectedId,
      tool,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      saveFailed,
      currentLineStyle,
      currentFillColor,
      roughenStrength,
      selectedIsLine: selectedLine !== null,
      selectedIsFill: selectedFill !== null,
      selectedFillColor: selectedFill === null ? null : selectedFill.content.color,
      selectedLineStyle: selectedLine === null ? null : selectedLine.style,
      selectedEnclosesFills: selectedLine === null ? null : selectedLine.enclosesFills,
      selectedShape: selectedLine === null ? null : (selectedLine.shape ?? null),
      selectedConvertedFrom: selectedLine === null ? null : (selectedLine.convertedFrom ?? null),
      currentStampId,
      selectedStamp,
    };
  }

  function publish(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  /**
   * The Pen draft label the Frame puts on its surface, in the app language:
   * both plural forms, because the Frame counts its own draft. A count of 1
   * reads the singular and a larger count the plural, as both languages count.
   */
  function penDraftLabel(): PenDraftLabel {
    const language = options.language();
    return {
      one: translate(language, "map.penPoints", 1),
      other: translate(language, "map.penPoints", 2),
    };
  }

  /** The scene message the Frame draws, from the editor's current state. */
  function sceneForFrame(): FrameSceneMessage {
    return sceneMessage(doc, {
      selectedId,
      tool,
      zoom,
      panX,
      panY,
      penLabel: penDraftLabel(),
    });
  }

  function sendScene(): void {
    if (frame === null) return;
    frame.postMessage(sceneForFrame());
  }

  function schedule(): void {
    autosave.schedule(doc);
  }

  /**
   * Commits a new Elements list as one undo step, then saves and redraws. Every
   * committed edit goes through the live-Fill rule first, so moving, erasing,
   * roughening, deleting, or adding a Map Line reshapes, merges, or splits the
   * Fills in the same undo step the lines changed in (#748). Undo and redo
   * restore whole history states as they are and never reconcile.
   */
  function edit(next: MapElement[]): void {
    history.commit(reconcileFills(elements, next));
    elements = history.current;
    doc = { ...doc, elements };
    // A Fill the edit merged away, or one whose face went with a deleted line,
    // leaves the selection pointing at a ghost.
    if (selectedId !== null && elementById(selectedId) === undefined) selectedId = null;
    publish();
    schedule();
    sendScene();
  }

  /** Undo and redo share the same follow-up: redraw, resave, repaint panels. */
  function afterHistory(): void {
    elements = history.current;
    doc = { ...doc, elements };
    // Undo can bring back a document without the selected Element (undoing a
    // stroke, or a delete): the selection must not point at a ghost.
    if (selectedId !== null && elementById(selectedId) === undefined) selectedId = null;
    publish();
    schedule();
    sendScene();
  }

  function elementById(id: string | null): MapElement | undefined {
    return id === null ? undefined : elements.find((element) => element.id === id);
  }

  function selectElement(id: string | null): void {
    selectedId = elementById(id) === undefined ? null : id;
    publish();
    sendScene();
  }

  /** The name a newly drawn Map Line takes: the next free "Map Line N". */
  function newLineName(): string {
    const number = elements.filter((element) => element.kind === "line").length + 1;
    return format(translate(options.language(), "element.lineName"), { number });
  }

  /**
   * A new Map Line in the current style: what both the Pencil and the Pen make,
   * from the points they gather and the segments those points draw.
   */
  function newLine(points: MapPoint[], curves: boolean[], closed: boolean): MapLineElement {
    return {
      id: randomMapId(),
      kind: "line",
      name: newLineName(),
      hidden: false,
      locked: false,
      points,
      style: currentLineStyle,
      enclosesFills: LINE_STYLE_DEFAULT_ENCLOSES[currentLineStyle],
      closed,
      curves,
      roughened: false,
    };
  }

  function addStroke(raw: readonly MapPoint[]): void {
    const points = smoothStroke(raw);
    if (points.length < 2) return;
    const element = newLine(points, curvedSegments(points.length, false), false);
    selectedId = element.id;
    edit(addElement(elements, element));
  }

  /** Keeps a finished Pen line: its points, its segment curves, and whether it closes. */
  function addLine(raw: readonly MapPoint[], curves: readonly boolean[], closed: boolean): void {
    if (raw.length < 2) return;
    const points = raw.map(([x, y]): MapPoint => [x, y]);
    const segments = points.length - 1 + (closed ? 1 : 0);
    const segmentCurves = Array.from(
      { length: segments },
      (_flag, index) => curves[index] === true
    );
    const element = newLine(points, segmentCurves, closed);
    selectedId = element.id;
    edit(addElement(elements, element));
  }

  /** The name a newly drawn Shape takes: the next free "Ellipse N" for its kind. */
  function newShapeName(kind: ShapeKind): string {
    const sameKind = elements.filter(
      (element) => element.kind === "line" && element.shape?.kind === kind
    ).length;
    return format(translate(options.language(), SHAPE_NAME_KEYS[kind]), { number: sameKind + 1 });
  }

  /**
   * A new exact Shape line (#747): plain, closed, enclosing Fills, and holding
   * the outline its numbers draw, which the Frame, the preview, the Eraser, and
   * fills all read as the line's points.
   */
  function newShapeLine(shape: MapShape): MapLineElement {
    const outline = shapeOutline(shape);
    return {
      id: randomMapId(),
      kind: "line",
      name: newShapeName(shape.kind),
      hidden: false,
      locked: false,
      points: outline.points,
      style: "plain",
      enclosesFills: LINE_STYLE_DEFAULT_ENCLOSES.plain,
      closed: true,
      curves: outline.curves,
      roughened: false,
      shape,
    };
  }

  /** Adds the Shape a drag between two corners drew, as one undo step. */
  function addShape(kind: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean): void {
    const shape = shapeFromCorners(kind, start, end, constrain);
    if (shape === null) return;
    const element = newShapeLine(shape);
    selectedId = element.id;
    edit(addElement(elements, element));
  }

  /**
   * Applies one Eraser drag to every visible, unlocked Map Line as one undo
   * step. A cut line's first piece keeps its id and name; each further piece
   * takes a new id and the name plus its number, and sits right after the
   * original in z-order.
   */
  function erase(raw: readonly MapPoint[], radiusMm: number): void {
    if (raw.length === 0) return;
    const language = options.language();
    const next: MapElement[] = [];
    let touched = false;
    for (const element of elements) {
      if (element.kind !== "line" || element.hidden || element.locked) {
        next.push(element);
        continue;
      }
      const pieces = eraseLines(element, raw, radiusMm);
      if (pieces === null) {
        next.push(element);
        continue;
      }
      touched = true;
      pieces.forEach((piece, index) => {
        // A cut Shape is no longer exact, so every piece remembers what it was.
        next.push(
          convertShapeLine({
            ...element,
            id: index === 0 ? element.id : randomMapId(),
            name:
              index === 0
                ? element.name
                : format(translate(language, "element.lineSplitName"), {
                    name: element.name,
                    number: index + 1,
                  }),
            points: piece.points,
            curves: piece.curves,
            closed: false,
          })
        );
      });
    }
    if (!touched) return;
    if (selectedId !== null && !next.some((element) => element.id === selectedId))
      selectedId = null;
    edit(next);
  }

  /** The name a newly poured Fill takes: "Fill N", counting the Fills the Map holds. */
  function newFillName(): string {
    const number = elements.filter((element) => element.kind === "fill").length + 1;
    return format(translate(options.language(), "element.fillName"), { number });
  }

  /** A new Fill in `color`, which `pourFill` puts at the deepest point of its face. */
  function makeFill(anchor: MapPoint, color: string): MapFillElement {
    return {
      id: randomMapId(),
      kind: "fill",
      name: newFillName(),
      hidden: false,
      locked: false,
      anchor,
      content: { color },
    };
  }

  /**
   * Pours the current Fill colour into the face `point` falls in (#748): a face
   * with no Fill takes a new one behind every Map Line, and a face already
   * filled takes the new colour instead and keeps its place. The Fill the pour
   * changed becomes the selection, and a point outside every face is not an
   * edit at all, so it leaves the undo history as it was.
   */
  function pour(point: MapPoint): void {
    const next = pourFill(elements, point, currentFillColor, makeFill);
    if (next === elements) return;
    // Every other Element comes back as it was, so the one object the before
    // list does not hold is the Fill the pour added or recoloured.
    const poured = next.find((element) => !elements.includes(element));
    if (poured !== undefined) selectedId = poured.id;
    edit(next);
  }

  /**
   * Drops the picked Stamp at `point` (#749), or at the view centre with no
   * point: the art's own default size, in the map ink, named after the art in
   * the app language. The new Stamp becomes the selection, and the whole
   * placement is one undo step.
   */
  function placeStamp(point?: MapPoint): void {
    const at: MapPoint = point ?? [doc.page.widthMm / 2 + panX, doc.page.heightMm / 2 + panY];
    const element = newStamp({
      id: randomMapId(),
      name: translate(options.language(), stampNameKey(currentStampId)),
      stampRef: baseStampRef(currentStampId),
      point: at,
    });
    selectedId = element.id;
    edit(addElement(elements, element));
  }

  function applyMessage(message: FrameToWorkerMessage): void {
    switch (message.kind) {
      case "stroke":
        addStroke(message.points);
        break;
      case "line":
        addLine(message.points, message.curves, message.closed);
        break;
      case "erase":
        erase(message.points, message.radiusMm);
        break;
      case "shape":
        addShape(message.shape, message.start, message.end, message.constrain);
        break;
      case "pour":
        pour(message.point);
        break;
      case "insert":
        placeStamp(message.point);
        break;
      case "select":
        selectElement(message.id);
        break;
    }
  }

  function setZoom(next: number): void {
    zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
    publish();
    sendScene();
  }

  function pan(dx: number, dy: number): void {
    panX += dx;
    panY += dy;
    publish();
    sendScene();
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    attachFrame(port) {
      frame = port;
      port.postMessage(sceneForFrame());
    },

    handleFrameMessage(data) {
      const message = parseFrameMessage(data);
      if (message !== null) applyMessage(message);
    },

    select(id) {
      selectElement(id);
    },

    setTool(next) {
      if (next === tool) return;
      tool = next;
      publish();
      sendScene();
    },

    rename(id, name) {
      const target = elementById(id);
      const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
      if (target === undefined || trimmed === "" || target.name === trimmed) return;
      edit(renameElement(elements, id, trimmed));
    },

    setHidden(id, hidden) {
      const target = elementById(id);
      if (target === undefined || target.hidden === hidden) return;
      edit(setHidden(elements, id, hidden));
    },

    setLocked(id, locked) {
      const target = elementById(id);
      if (target === undefined || target.locked === locked) return;
      edit(setLocked(elements, id, locked));
    },

    setLineStyle(style) {
      const target = elementById(selectedId);
      // A locked Map Line keeps its look, as it keeps its place and its
      // Roughen, and a refused change is not an undo step.
      if (target !== undefined && target.kind === "line" && target.locked) return;
      currentLineStyle = style;
      if (target === undefined || target.kind !== "line") {
        publish();
        return;
      }
      const enclosesFills = LINE_STYLE_DEFAULT_ENCLOSES[style];
      if (target.style === style && target.enclosesFills === enclosesFills) {
        publish();
        return;
      }
      edit(
        elements.map((element) =>
          element.id === target.id && element.kind === "line"
            ? { ...element, style, enclosesFills }
            : element
        )
      );
    },

    setFillColor(color) {
      if (color === currentFillColor) return;
      currentFillColor = color;
      publish();
    },

    setElementFillColor(id, color) {
      const target = elementById(id);
      // A locked Fill keeps its colour, as a locked Map Line keeps its look, and
      // a colour the Fill already has is not an undo step.
      if (
        target === undefined ||
        target.kind !== "fill" ||
        target.locked ||
        target.content.color === color
      ) {
        return;
      }
      edit(
        elements.map((element) =>
          element.id === id && element.kind === "fill"
            ? { ...element, content: { ...element.content, color } }
            : element
        )
      );
    },

    setEnclosesFills(id, enclosesFills) {
      const target = elementById(id);
      if (
        target === undefined ||
        target.kind !== "line" ||
        target.locked ||
        target.enclosesFills === enclosesFills
      ) {
        return;
      }
      edit(
        elements.map((element) =>
          element.id === id && element.kind === "line" ? { ...element, enclosesFills } : element
        )
      );
    },

    setRoughenStrength(strengthMm) {
      if (!Number.isFinite(strengthMm)) return;
      const next = clamp(strengthMm, MIN_ROUGHEN_STRENGTH_MM, MAX_ROUGHEN_STRENGTH_MM);
      if (next === roughenStrength) return;
      roughenStrength = next;
      publish();
    },

    roughen() {
      const target = elementById(selectedId);
      if (target === undefined || target.kind !== "line" || target.locked) return;
      // Roughen resamples the points, so an exact Shape stops being one.
      const base = convertShapeLine(target);
      const points = roughenPoints(base.points, base.closed, roughenStrength, seedFor(base.id));
      const segments = points.length - 1 + (base.closed ? 1 : 0);
      edit(
        elements.map((element) =>
          element.id === target.id && element.kind === "line"
            ? {
                ...base,
                points,
                curves: Array.from({ length: segments }, () => false),
                roughened: true,
              }
            : element
        )
      );
    },

    placeShape(kind) {
      const element = newShapeLine({
        kind,
        cx: doc.page.widthMm / 2 + panX,
        cy: doc.page.heightMm / 2 + panY,
        width: DEFAULT_SHAPE_SIZE_MM,
        height: DEFAULT_SHAPE_SIZE_MM,
        rotation: 0,
        sides: DEFAULT_POLYGON_SIDES,
        cornerRadius: 0,
      });
      selectedId = element.id;
      edit(addElement(elements, element));
    },

    setShapeGeometry(id, patch) {
      const target = elementById(id);
      if (
        target === undefined ||
        target.kind !== "line" ||
        target.locked ||
        target.shape === undefined
      ) {
        return;
      }
      const shape = normalizeShape({ ...target.shape, ...patch });
      if (shape === null || sameShape(shape, target.shape)) return;
      const outline = shapeOutline(shape);
      edit(
        elements.map((element) =>
          element.id === id && element.kind === "line"
            ? { ...element, shape, points: outline.points, curves: outline.curves, closed: true }
            : element
        )
      );
    },

    setStamp(id) {
      // A pick this build has no art for would place a Stamp that draws
      // nothing, so only the built-in Stamps are picks.
      if (!BASE_STAMP_IDS.includes(id) || id === currentStampId) return;
      currentStampId = id;
      publish();
    },

    insertStamp(point) {
      placeStamp(point);
    },

    setStampTransform(id, patch) {
      const target = elementById(id);
      if (target === undefined || target.kind !== "stamp" || target.locked) return;
      const before = target.transform;
      const x = patch.x ?? before.x;
      const y = patch.y ?? before.y;
      const size = patch.size ?? before.size;
      const rotation = patch.rotation ?? before.rotation;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (!Number.isFinite(size) || !Number.isFinite(rotation)) return;
      const transform: MapStampTransform = {
        x,
        y,
        // A Stamp with no art box draws nothing, so the size keeps some room.
        size: Math.max(MIN_STAMP_SIZE_MM, size),
        // The turn reads in one circle, so a whole turn is no turn at all.
        rotation: normalizeRotation(rotation),
      };
      if (
        transform.x === before.x &&
        transform.y === before.y &&
        transform.size === before.size &&
        transform.rotation === before.rotation
      ) {
        return;
      }
      edit(
        elements.map((element) =>
          element.id === id && element.kind === "stamp" ? { ...element, transform } : element
        )
      );
    },

    setStampScale(id, patch) {
      const target = elementById(id);
      if (target === undefined || target.kind !== "stamp" || target.locked) return;
      const before = target.scale;
      // Only the scale bar carries a reading to change.
      if (before === undefined) return;
      const unit = patch.unit ?? before.unit;
      const span = patch.span ?? before.span;
      if (!isStampScaleUnit(unit)) return;
      // A page width standing for no distance reads no scale bar.
      if (!Number.isFinite(span) || span <= 0) return;
      if (unit === before.unit && span === before.span) return;
      edit(
        elements.map((element) =>
          element.id === id && element.kind === "stamp"
            ? { ...element, scale: { unit, span } }
            : element
        )
      );
    },

    setStampColor(id, color) {
      const target = elementById(id);
      // Art that keeps its own colours has none to take, and a locked Stamp
      // keeps the colour it has.
      if (
        target === undefined ||
        target.kind !== "stamp" ||
        target.locked ||
        !stampTakesColour(target.stampRef) ||
        target.color === color
      ) {
        return;
      }
      edit(
        elements.map((element) =>
          element.id === id && element.kind === "stamp" ? { ...element, color } : element
        )
      );
    },

    deleteElement(id) {
      if (elementById(id) === undefined) return;
      if (selectedId === id) selectedId = null;
      edit(removeElement(elements, id));
    },

    moveUp(id) {
      const index = elements.findIndex((element) => element.id === id);
      if (index === -1 || index === elements.length - 1) return;
      edit(reorder(elements, id, "forward"));
    },

    moveDown(id) {
      const index = elements.findIndex((element) => element.id === id);
      if (index <= 0) return;
      edit(reorder(elements, id, "backward"));
    },

    move(dx, dy) {
      const target = elementById(selectedId);
      if (target === undefined || target.locked) return;
      if (target.kind !== "line" && target.kind !== "stamp") return;
      edit(moveElement(elements, target.id, dx, dy));
    },

    undo() {
      if (!history.canUndo) return;
      history.undo();
      afterHistory();
    },

    redo() {
      if (!history.canRedo) return;
      history.redo();
      afterHistory();
    },

    zoomIn() {
      setZoom(zoom * ZOOM_STEP);
    },

    zoomOut() {
      setZoom(zoom / ZOOM_STEP);
    },

    zoomReset() {
      setZoom(1);
      panX = 0;
      panY = 0;
      publish();
      sendScene();
    },

    panLeft() {
      pan(-PAN_STEP_MM, 0);
    },

    panRight() {
      pan(PAN_STEP_MM, 0);
    },

    panUp() {
      pan(0, -PAN_STEP_MM);
    },

    panDown() {
      pan(0, PAN_STEP_MM);
    },

    flush() {
      return autosave.flush();
    },

    hasPendingSave() {
      return autosave.hasPending;
    },

    dispose() {
      frame = null;
      listeners.clear();
    },
  };
}
