/**
 * The open Map's editor state (#745, #746): its Elements, selection, tool,
 * view, undo history, and autosave. The host renders the panels and the Frame
 * draws the scene, so this module owns everything that must outlive a page
 * render yet stay inside the Worker. One editor is created when a Map opens and
 * disposed when the author returns to the Maps list; nothing here is persisted
 * except through `MapStore.save`.
 *
 * Every edit goes through `history.commit` and schedules the whole Map document
 * for autosave. Zoom, pan, tool, selection, the current line style, and the
 * Roughen strength are view state: not saved and not undoable. This module
 * imports only its own files.
 */

import type {
  LineStyleId,
  MapDocument,
  MapElement,
  MapLineElement,
  MapPoint,
  MapStore,
} from "./maps";
import { LINE_STYLE_DEFAULT_ENCLOSES, MAX_NAME_LENGTH, curvedSegments, randomMapId } from "./maps";
import { createAutosave } from "./autosave";
import {
  parseFrameMessage,
  sceneMessage,
  type FrameToWorkerMessage,
  type MapTool,
} from "./frame-protocol";
import { eraseLines, roughen as roughenPoints, seedFor } from "./geometry";
import { createHistory } from "./history";
import { format, translate } from "./i18n";
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
  /** How hard Roughen pushes the selected line, in page millimetres. */
  roughenStrength: number;
  /** The selected Map Line's style, or null when the selection is not a Map Line. */
  selectedLineStyle: LineStyleId | null;
  /** Whether the selected Map Line encloses Fills, or null when it is not a Map Line. */
  selectedEnclosesFills: boolean | null;
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
  /** Picks a line style for new Pen lines, and for the selected Map Line when it has one. */
  setLineStyle(style: LineStyleId): void;
  /** Sets whether one Map Line encloses Fills. */
  setEnclosesFills(id: string, enclosesFills: boolean): void;
  /** Sets how hard Roughen pushes the selected line, in page millimetres. */
  setRoughenStrength(strengthMm: number): void;
  /** Roughens the selected unlocked Map Line as one undo step. */
  roughen(): void;
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

export function createMapEditor(options: MapEditorOptions): MapEditor {
  let doc = options.doc;
  let elements: MapElement[] = doc.elements;
  const history = createHistory<MapElement[]>(elements);
  let selectedId: string | null = null;
  let tool: MapTool = "select";
  let currentLineStyle: LineStyleId = "plain";
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
    return {
      doc,
      elements,
      selectedId,
      tool,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      saveFailed,
      currentLineStyle,
      roughenStrength,
      selectedLineStyle: selectedLine === null ? null : selectedLine.style,
      selectedEnclosesFills: selectedLine === null ? null : selectedLine.enclosesFills,
    };
  }

  function publish(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  /** The Pen draft label the Frame puts on its surface, in the app language. */
  function penDraftLabel(): string {
    return translate(options.language(), "map.penPoints");
  }

  function sendScene(): void {
    if (frame === null) return;
    frame.postMessage(
      sceneMessage(doc, {
        selectedId,
        tool,
        zoom,
        panX,
        panY,
        penLabel: penDraftLabel(),
      })
    );
  }

  function schedule(): void {
    autosave.schedule(doc);
  }

  /** Commits a new Elements list as one undo step, then saves and redraws. */
  function edit(next: MapElement[]): void {
    history.commit(next);
    elements = history.current;
    doc = { ...doc, elements };
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

  function addStroke(raw: readonly MapPoint[]): void {
    const points = smoothStroke(raw);
    if (points.length < 2) return;
    const element: MapLineElement = {
      id: randomMapId(),
      kind: "line",
      name: newLineName(),
      hidden: false,
      locked: false,
      points,
      style: currentLineStyle,
      enclosesFills: LINE_STYLE_DEFAULT_ENCLOSES[currentLineStyle],
      closed: false,
      curves: curvedSegments(points.length, false),
      roughened: false,
    };
    selectedId = element.id;
    edit(addElement(elements, element));
  }

  /** Keeps a finished Pen line: its points, its segment curves, and whether it closes. */
  function addLine(raw: readonly MapPoint[], curves: readonly boolean[], closed: boolean): void {
    if (raw.length < 2) return;
    const points = raw.map(([x, y]): MapPoint => [x, y]);
    const segments = points.length - 1 + (closed ? 1 : 0);
    const element: MapLineElement = {
      id: randomMapId(),
      kind: "line",
      name: newLineName(),
      hidden: false,
      locked: false,
      points,
      style: currentLineStyle,
      enclosesFills: LINE_STYLE_DEFAULT_ENCLOSES[currentLineStyle],
      closed,
      curves: Array.from({ length: segments }, (_flag, index) => curves[index] === true),
      roughened: false,
    };
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
        next.push({
          ...element,
          id: index === 0 ? element.id : randomMapId(),
          name: index === 0 ? element.name : `${element.name} ${index + 1}`,
          points: piece.points,
          curves: piece.curves,
          closed: false,
        });
      });
    }
    if (!touched) return;
    if (selectedId !== null && !next.some((element) => element.id === selectedId))
      selectedId = null;
    edit(next);
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
      port.postMessage(
        sceneMessage(doc, {
          selectedId,
          tool,
          zoom,
          panX,
          panY,
          penLabel: penDraftLabel(),
        })
      );
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
      currentLineStyle = style;
      const target = elementById(selectedId);
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

    setEnclosesFills(id, enclosesFills) {
      const target = elementById(id);
      if (
        target === undefined ||
        target.kind !== "line" ||
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
      const points = roughenPoints(
        target.points,
        target.closed,
        roughenStrength,
        seedFor(target.id)
      );
      const segments = points.length - 1 + (target.closed ? 1 : 0);
      edit(
        elements.map((element) =>
          element.id === target.id && element.kind === "line"
            ? {
                ...element,
                points,
                curves: Array.from({ length: segments }, () => false),
                roughened: true,
              }
            : element
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
      if (target === undefined || target.locked || target.kind !== "line") return;
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
