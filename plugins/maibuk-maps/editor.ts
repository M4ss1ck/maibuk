/**
 * The open Map's editor state (#745): its Elements, selection, tool, view,
 * undo history, and autosave. The host renders the panels and the Frame draws
 * the scene, so this module owns everything that must outlive a page render yet
 * stay inside the Worker. One editor is created when a Map opens and disposed
 * when the author returns to the Maps list; nothing here is persisted except
 * through `MapStore.save`.
 *
 * Every edit goes through `history.commit` and schedules the whole Map document
 * for autosave. Zoom, pan, tool, and selection are view state: not saved and not
 * undoable. This module imports only its own files.
 */

import type { MapDocument, MapElement, MapPoint, MapStore } from "./maps";
import { MAX_NAME_LENGTH, randomMapId } from "./maps";
import { createAutosave } from "./autosave";
import {
  parseFrameMessage,
  sceneMessage,
  type FrameToWorkerMessage,
  type MapTool,
} from "./frame-protocol";
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

/** What the page draws: the document, its Elements, and the editor flags. */
export interface MapEditorSnapshot {
  doc: MapDocument;
  elements: readonly MapElement[];
  selectedId: string | null;
  tool: MapTool;
  canUndo: boolean;
  canRedo: boolean;
  saveFailed: boolean;
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
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let saveFailed = false;
  const frames = new Set<MessagePort>();
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
    return {
      doc,
      elements,
      selectedId,
      tool,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      saveFailed,
    };
  }

  function publish(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  function sendScene(): void {
    if (frames.size === 0) return;
    const message = sceneMessage(doc, { selectedId, tool, zoom, panX, panY });
    for (const port of frames) port.postMessage(message);
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

  function addStroke(raw: readonly MapPoint[]): void {
    const points = smoothStroke(raw);
    if (points.length < 2) return;
    const number = elements.filter((element) => element.kind === "line").length + 1;
    const element: MapElement = {
      id: randomMapId(),
      kind: "line",
      name: format(translate(options.language(), "element.lineName"), { number }),
      hidden: false,
      locked: false,
      points,
    };
    selectedId = element.id;
    edit(addElement(elements, element));
  }

  function applyMessage(message: FrameToWorkerMessage): void {
    if (message.kind === "stroke") addStroke(message.points);
    else selectElement(message.id);
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
      frames.add(port);
      port.postMessage(sceneMessage(doc, { selectedId, tool, zoom, panX, panY }));
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

    deleteElement(id) {
      if (elementById(id) === undefined) return;
      if (selectedId === id) selectedId = null;
      edit(removeElement(elements, id));
    },

    moveUp(id) {
      const index = elements.findIndex((element) => element.id === id);
      if (index === -1 || index === elements.length - 1) return;
      edit(reorder(elements, id, "down"));
    },

    moveDown(id) {
      const index = elements.findIndex((element) => element.id === id);
      if (index <= 0) return;
      edit(reorder(elements, id, "up"));
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

    dispose() {
      frames.clear();
      listeners.clear();
    },
  };
}
