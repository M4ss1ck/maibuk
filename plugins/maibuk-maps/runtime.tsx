/**
 * The Maps runtime (#744, #745): the Maps page, the Map editor page, the
 * Commands, the Frame handoff, and the host requests. Kept apart from
 * `index.tsx` (the Worker bootstrap) so a test drives the same logic over the
 * polyfill-free Remote UI entry the test kit uses.
 *
 * `Open Maps` opens the list with whatever filter it last had. `Maps`, the Book
 * Item Menu entry (and the Book editor's palette Command), sets the filter to
 * the Book it was run on, then opens the list. Which Map is open lives here in
 * memory, like Reader's current document: it survives a page render but not a
 * Worker restart. Imports only `@/plugin-sdk` and this Plugin's files.
 */

import type { ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  PLUGIN_MIGRATE_DATA_REQUEST,
  type HostRequestHandler,
  type PluginClient,
  type PluginFrame,
} from "@/plugin-sdk";
import { createMapEditor, type MapEditor } from "./editor";
import { MAP_PAGE_ID, createMapPage } from "./map-page";
import { createMapStore, migrateMapsData } from "./maps";
import { MAPS_PAGE_ID, createBookFilter, createMapsPage } from "./maps-page";

export { MAPS_PAGE_ID, MAP_PAGE_ID };

/** The Command-local ids the manifest declares. */
export const OPEN_MAPS = "openMaps";
export const BOOK_MAPS = "bookMaps";
export const OPEN_MAP = "openMap";
export const UNDO = "undo";
export const REDO = "redo";
export const ZOOM_IN = "zoomIn";
export const ZOOM_OUT = "zoomOut";
export const ZOOM_RESET = "zoomReset";
export const PAN_LEFT = "panLeft";
export const PAN_RIGHT = "panRight";
export const PAN_UP = "panUp";
export const PAN_DOWN = "panDown";
export const MOVE_LEFT = "moveLeft";
export const MOVE_RIGHT = "moveRight";
export const MOVE_UP = "moveUp";
export const MOVE_DOWN = "moveDown";
export const MOVE_LEFT_FAR = "moveLeftFar";
export const MOVE_RIGHT_FAR = "moveRightFar";
export const MOVE_UP_FAR = "moveUpFar";
export const MOVE_DOWN_FAR = "moveDownFar";
export const SELECT_TOOL = "selectTool";
export const PENCIL_TOOL = "pencilTool";
export const PEN_TOOL = "penTool";
export const BUCKET_TOOL = "bucketTool";
export const AREA_TOOL = "areaTool";
export const INSERT_TOOL = "insertTool";
export const ELLIPSE_TOOL = "ellipseTool";
export const RECTANGLE_TOOL = "rectangleTool";
export const POLYGON_TOOL = "polygonTool";
export const ERASER_TOOL = "eraserTool";
export const ROUGHEN = "roughen";
export const DELETE_ELEMENT = "deleteElement";

/** One step of an arrow-key move, in page millimetres; Shift moves ten. */
const MOVE_STEP_MM = 1;
const MOVE_FAR_STEP_MM = 10;

/** The host's Remote UI and request entry (`servePluginUi`), Worker or test. */
export type MapsServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/** The runtime's own state; one per activation, so tests never share it. */
export interface MapsRuntime {
  /** The Map whose editor is open, kept in memory only. */
  currentMapId: string | null;
  /** The open Map's editor, or null when the editor page shows its EmptyState. */
  editor: MapEditor | null;
  /** The app language the editor names new Elements in. */
  language: string;
  /** Loads one Map, opens its editor, and navigates; false when it cannot load. */
  openMap(id: string): Promise<boolean>;
  /** Flushes autosave, closes the open Map, and opens the Maps list. */
  backToMaps(): Promise<void>;
}

/** Wires the client to both pages, the Commands, the Frame handoff, and `migrateData`. */
export function startMaps(client: PluginClient, serve: MapsServe): MapsRuntime {
  const store = createMapStore(client.storage);
  const filter = createBookFilter();
  /**
   * The Map page's embedded Frame port. The page draws one Frame at a time, so
   * a remount replaces the old port instead of keeping both: the detached one
   * stops receiving scenes (#745).
   */
  let framePort: MessagePort | null = null;

  const runtime: MapsRuntime = {
    currentMapId: null,
    editor: null,
    language: "en",
    openMap,
    backToMaps,
  };

  void client.language
    .get()
    .then((value) => {
      runtime.language = value.language;
    })
    .catch(() => {});
  void client
    .on("language.changed", (payload) => {
      runtime.language = payload.language;
    })
    .catch(() => {});

  client.onFrame(handoff);

  async function openMap(id: string): Promise<boolean> {
    if (runtime.editor !== null) {
      await runtime.editor.flush();
      runtime.editor.dispose();
      runtime.editor = null;
    }
    runtime.currentMapId = null;
    const doc = await store.load(id);
    if (doc === null) return false;
    runtime.currentMapId = id;
    const editor = createMapEditor({ store, doc, language: () => runtime.language });
    runtime.editor = editor;
    if (framePort !== null) editor.attachFrame(framePort);
    await client.navigation.openPage({ pageId: MAP_PAGE_ID });
    return true;
  }

  async function backToMaps(): Promise<void> {
    const editor = runtime.editor;
    if (editor !== null) {
      await editor.flush();
      // A failed save leaves the document pending. Stay on the Map so the page
      // shows its saveFailed Status and the next Back retries the write rather
      // than silently losing the last edit (#745).
      if (editor.hasPendingSave()) return;
      editor.dispose();
    }
    runtime.editor = null;
    runtime.currentMapId = null;
    await client.navigation.openPage({ pageId: MAPS_PAGE_ID });
  }

  /** One mounted Frame: keep its port, and route its messages to the open editor. */
  function handoff(frame: PluginFrame): void {
    framePort = frame.port;
    frame.port.onmessage = (event: MessageEvent) => runtime.editor?.handleFrameMessage(event.data);
    frame.port.start();
    runtime.editor?.attachFrame(frame.port);
  }

  async function runCommand(params: unknown): Promise<null> {
    const { id, target } = (params ?? {}) as {
      id?: unknown;
      target?: { kind?: unknown; id?: unknown };
    };
    if (typeof id !== "string") return null;
    if (id === BOOK_MAPS && target?.kind === "book" && typeof target.id === "string") {
      filter.set(target.id);
    }
    if (id === BOOK_MAPS || id === OPEN_MAPS) {
      await client.navigation.openPage({ pageId: MAPS_PAGE_ID });
      return null;
    }
    if (id === OPEN_MAP) {
      await client.navigation.openPage({ pageId: MAP_PAGE_ID });
      return null;
    }
    runEditorCommand(runtime.editor, id);
    return null;
  }

  serve(client, {
    pages: {
      [MAPS_PAGE_ID]: createMapsPage({ client, store, filter, openMap }),
      [MAP_PAGE_ID]: createMapPage({ client, runtime, backToMaps }),
    },
    onHostRequest: async (method, params) => {
      if (method === "health.check") return "pong";
      if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(params);
      if (method === PLUGIN_MIGRATE_DATA_REQUEST) {
        await migrateMapsData(client.storage, (params as { from: number }).from);
        return null;
      }
      throw new Error(`No handler for ${method}`);
    },
  });

  return runtime;
}

/** Runs one Map editor Command against the open editor, if there is one. */
function runEditorCommand(editor: MapEditor | null, id: string): void {
  if (editor === null) return;
  switch (id) {
    case UNDO:
      editor.undo();
      break;
    case REDO:
      editor.redo();
      break;
    case ZOOM_IN:
      editor.zoomIn();
      break;
    case ZOOM_OUT:
      editor.zoomOut();
      break;
    case ZOOM_RESET:
      editor.zoomReset();
      break;
    case PAN_LEFT:
      editor.panLeft();
      break;
    case PAN_RIGHT:
      editor.panRight();
      break;
    case PAN_UP:
      editor.panUp();
      break;
    case PAN_DOWN:
      editor.panDown();
      break;
    case MOVE_LEFT:
      editor.move(-MOVE_STEP_MM, 0);
      break;
    case MOVE_RIGHT:
      editor.move(MOVE_STEP_MM, 0);
      break;
    case MOVE_UP:
      editor.move(0, -MOVE_STEP_MM);
      break;
    case MOVE_DOWN:
      editor.move(0, MOVE_STEP_MM);
      break;
    case MOVE_LEFT_FAR:
      editor.move(-MOVE_FAR_STEP_MM, 0);
      break;
    case MOVE_RIGHT_FAR:
      editor.move(MOVE_FAR_STEP_MM, 0);
      break;
    case MOVE_UP_FAR:
      editor.move(0, -MOVE_FAR_STEP_MM);
      break;
    case MOVE_DOWN_FAR:
      editor.move(0, MOVE_FAR_STEP_MM);
      break;
    case SELECT_TOOL:
      editor.setTool("select");
      break;
    case PENCIL_TOOL:
      editor.setTool("pencil");
      break;
    case PEN_TOOL:
      editor.setTool("pen");
      break;
    case BUCKET_TOOL:
      editor.setTool("bucket");
      break;
    case AREA_TOOL:
      editor.setTool("area");
      break;
    case INSERT_TOOL:
      editor.setTool("insert");
      break;
    case ELLIPSE_TOOL:
      editor.setTool("ellipse");
      break;
    case RECTANGLE_TOOL:
      editor.setTool("rectangle");
      break;
    case POLYGON_TOOL:
      editor.setTool("polygon");
      break;
    case ERASER_TOOL:
      editor.setTool("eraser");
      break;
    case ROUGHEN:
      editor.roughen();
      break;
    case DELETE_ELEMENT: {
      const selected = editor.getSnapshot().selectedId;
      if (selected !== null) editor.deleteElement(selected);
      break;
    }
  }
}
