/**
 * The Reader runtime (#653, #944): the Shelf and Document Frame handoff, and the
 * Command handlers. Kept apart from `index.tsx` (the Worker bootstrap) so a test
 * can drive the same logic over the polyfill-free Remote UI entry the test kit
 * uses, without loading the Worker's Remote DOM polyfill into jsdom.
 *
 * The Shelf is a Frame page of its own (#944), so this unit no longer draws it:
 * it creates one session per mounted Frame, chooses the view and the in-Frame
 * Shelf from the Frame's source, and hands every open to the sessions. Opening
 * a Document stores `currentDocumentId` in memory and shows it in the mounted
 * Frame; only a cold open, with no Frame to switch, navigates the host to the
 * Document page. Imports only `@/plugin-sdk` and this Plugin's files.
 */

import type { ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  type CanvasReferenceSourceRequests,
  type CanvasReferenceSourceResolution,
  type CanvasReferenceSourceRow,
  type HostRequestHandler,
  type PluginApiEvents,
  type PluginClient,
  type PluginFrame,
  canvasReferenceRequests,
} from "@/plugin-sdk";
import type { FrameCommandId } from "./frame-protocol";
import { format, translate } from "./i18n";
import { createShelfService, type ShelfService } from "./library";
import { createReaderSession, type ReaderSession } from "./session";
import { SHELF_KEY, type ShelfEntry, parseShelf, sortShelf } from "./shelf";

/** The Shelf page id, exactly as the manifest declares it. */
export const SHELF_PAGE_ID = "reader";

/** The whole-page Frame's id, exactly as the manifest declares it. */
export const DOCUMENT_PAGE_ID = "document";

/** The Shelf Frame source the manifest declares; the host hands it back with the mount. */
export const SHELF_FRAME_SRC = "assets/ui/shelf.html";

/** The Command-local ids the manifest declares. */
export const OPEN_READER = "openReader";
export const OPEN_FILE = "openFile";
export const OPEN_DOCUMENT = "openDocument";
export const NEXT_PAGE = "nextPage";
export const PREVIOUS_PAGE = "previousPage";
export const FIRST_PAGE = "firstPage";
export const LAST_PAGE = "lastPage";
export const FIND_IN_DOCUMENT = "findInDocument";
export const TOGGLE_CONTENTS = "toggleContents";
export const ZOOM_IN = "zoomIn";
export const ZOOM_OUT = "zoomOut";
export const FIT_WIDTH = "fitWidth";
export const FIT_PAGE = "fitPage";
export const INCREASE_FONT_SIZE = "increaseFontSize";
export const DECREASE_FONT_SIZE = "decreaseFontSize";
export const TOGGLE_CONTINUOUS_SCROLL = "toggleContinuousScroll";
export const BACK_TO_SHELF = "backToShelf";
export const REMOVE_FROM_SHELF = "removeFromShelf";
export const LOCATE_DOCUMENT = "locateDocument";
export const SEARCH_SHELF = "searchShelf";
export const SHOW_SHELF_OPTIONS = "showShelfOptions";
export const CLEAR_SHELF_FILTERS = "clearShelfFilters";
export const NEW_COLLECTION = "newCollection";
export const RENAME_COLLECTION = "renameCollection";
export const DELETE_COLLECTION = "deleteCollection";

/** The Commands the Frame handles itself, forwarded while it is open. */
const FRAME_COMMANDS: ReadonlySet<FrameCommandId> = new Set<FrameCommandId>([
  NEXT_PAGE,
  PREVIOUS_PAGE,
  FIRST_PAGE,
  LAST_PAGE,
  FIND_IN_DOCUMENT,
  TOGGLE_CONTENTS,
  ZOOM_IN,
  ZOOM_OUT,
  FIT_WIDTH,
  FIT_PAGE,
  INCREASE_FONT_SIZE,
  DECREASE_FONT_SIZE,
  TOGGLE_CONTINUOUS_SCROLL,
  BACK_TO_SHELF,
  REMOVE_FROM_SHELF,
  LOCATE_DOCUMENT,
  SEARCH_SHELF,
  SHOW_SHELF_OPTIONS,
  CLEAR_SHELF_FILTERS,
  NEW_COLLECTION,
  RENAME_COLLECTION,
  DELETE_COLLECTION,
]);

/**
 * The host's Remote UI and request entry (`servePluginUi`), Worker or test. The
 * two SDK entries share this shape, so the runtime takes whichever the caller
 * supplies.
 */
export type ReaderServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/** The runtime's own state; one per activation, so tests never share it. */
export interface ReaderRuntime {
  /** The Document whose Frame page is open, kept in memory only. */
  currentDocumentId: string | null;
  /** The row the open Frame draws its title from. */
  currentEntry: ShelfEntry | null;
  /** Every mounted Frame's session, by the host's frame id. */
  sessions: Map<string, ReaderSession>;
  /** The app language the Frame should draw its own chrome in. */
  language: string;
  /** The place the host's Back returns to, or null when nothing opened this page (#786). */
  returnLabel: string | null;
}

/**
 * A relaunch that restores the Reading page has no Document in memory: reopen
 * the one it last had open in every mounted Frame. A Document opened in the
 * meantime wins.
 */
export async function restoreCurrentDocument(
  runtime: Pick<ReaderRuntime, "currentEntry" | "currentDocumentId" | "sessions">,
  library: Pick<ShelfService, "loadCurrent">
): Promise<void> {
  const entry = await library.loadCurrent();
  if (entry === null || runtime.currentEntry !== null) return;
  runtime.currentEntry = entry;
  runtime.currentDocumentId = entry.id;
  for (const session of runtime.sessions.values()) session.setEntry(entry);
}

/**
 * Follows the host's return target (#786): the place the Reading page's Back
 * returns to. The host replays the current label on subscription, so a Frame
 * mounted after the move still knows, and every live session relabels its own
 * Back.
 */
export function followReturnTarget(
  client: Pick<PluginClient, "on">,
  runtime: Pick<ReaderRuntime, "returnLabel" | "language" | "sessions">
): void {
  void client
    .on("navigation.returnTargetChanged", (payload) => {
      runtime.returnLabel = payload.label;
      for (const session of runtime.sessions.values()) session.setLanguage(runtime.language);
    })
    .catch(() => {});
}

/**
 * Leaves the reading surface for the place that opened it (#786), and only
 * falls back to the Shelf when the host has no return target to answer.
 */
export async function leaveReading(
  client: Pick<PluginClient, "navigation">,
  returnLabel: string | null
): Promise<void> {
  if (returnLabel !== null) {
    const answer = await client.navigation.return();
    if (answer.status === "returned") return;
  }
  await client.navigation.openPage({ pageId: SHELF_PAGE_ID });
}

/** Wires the client to the Shelf page, the document Frame, and the Commands. */
export function startReader(client: PluginClient, serve: ReaderServe): void {
  const library = createShelfService(client);
  const runtime: ReaderRuntime = {
    currentDocumentId: null,
    currentEntry: null,
    sessions: new Map(),
    language: "en",
    returnLabel: null,
  };
  /** Drops run one at a time: the next waits for the one being fingerprinted. */
  let pendingDrops: Promise<void> = Promise.resolve();

  void client.language
    .get()
    .then((value) => {
      runtime.language = value.language;
    })
    .catch(() => {});
  void client
    .on("language.changed", (payload) => {
      runtime.language = payload.language;
      for (const session of runtime.sessions.values()) session.setLanguage(payload.language);
    })
    .catch(() => {});
  void client
    .on("appearance.changed", (payload) => {
      for (const session of runtime.sessions.values()) session.setAppearance(payload);
    })
    .catch(() => {});
  followReturnTarget(client, runtime);
  void client
    .on("files.dropped", (payload) => {
      pendingDrops = pendingDrops
        .then(() => handleDrop(client, library, runtime, payload))
        .catch(() => {});
    })
    .catch(() => {});

  client.onFrame((frame: PluginFrame) => {
    const shelfInFrame = frame.src === SHELF_FRAME_SRC;
    const session = createReaderSession({
      client,
      library,
      entry: runtime.currentEntry,
      language: runtime.language,
      port: frame.port,
      returnLabel: () => runtime.returnLabel,
      navigateToShelf: () => leaveReading(client, runtime.returnLabel),
      view: shelfInFrame ? "shelf" : "document",
      shelfInFrame,
      openEntry: (entry) => openReaderEntry(client, library, runtime, entry),
      onViewChange: (view) => {
        // Back to the in-Frame Shelf means no Document is open, so a later
        // mount must not restore the one just left.
        if (view === "shelf") {
          runtime.currentEntry = null;
          runtime.currentDocumentId = null;
        }
      },
      onDispose: () => {
        runtime.sessions.delete(frame.id);
      },
    });
    runtime.sessions.set(frame.id, session);
    session.start();
    // A Shelf Frame shows the Shelf, never the Document storage says was open.
    if (!shelfInFrame && runtime.currentEntry === null)
      void restoreCurrentDocument(runtime, library);
  });

  /**
   * The `documents` Canvas Reference source (#838): every Document on the Shelf
   * in its own order, subtitled by its format, filtered by title, resolved
   * through one Shelf read, and opened onto the Reading page. A Document whose
   * file is lost is still on the Shelf, so it resolves present.
   */
  /**
   * The Shelf for the Canvas Reference source. Unlike `loadShelf`, a failed
   * read rejects, so the host keeps the stored labels instead of marking every
   * Document reference Missing.
   */
  async function readShelf(): Promise<ShelfEntry[]> {
    return sortShelf(parseShelf(await client.storage.get({ key: SHELF_KEY })));
  }

  const documentSource: CanvasReferenceSourceRequests = {
    async list(query) {
      const needle = query.trim().toLocaleLowerCase();
      const shelf = await readShelf();
      return shelf
        .filter((entry) => entry.title.toLocaleLowerCase().includes(needle))
        .map(
          (entry): CanvasReferenceSourceRow => ({
            id: entry.id,
            title: entry.title,
            subtitle: entry.format.toUpperCase(),
          })
        );
    },

    async resolve(ids) {
      const shelf = await readShelf();
      const answers: Record<string, CanvasReferenceSourceResolution> = {};
      for (const id of ids) {
        const entry = shelf.find((candidate) => candidate.id === id);
        answers[id] =
          entry === undefined
            ? { status: "missing" }
            : {
                status: "present",
                title: entry.title,
                subtitle: entry.format.toUpperCase(),
                ...(entry.coverDataUrl === undefined ? {} : { image: entry.coverDataUrl }),
              };
      }
      return answers;
    },

    async open(id) {
      const entry = (await readShelf()).find((candidate) => candidate.id === id);
      if (entry === undefined) return "missing";
      await openReaderEntry(client, library, runtime, entry);
      return "opened";
    },
  };

  serve(client, {
    pages: {},
    onHostRequest: canvasReferenceRequests({ documents: documentSource }, (method, params) =>
      handleHostRequest(client, library, runtime, method, params)
    ),
  });
}

/** Posts `message` to every mounted Frame. */
function broadcastCommand(runtime: ReaderRuntime, id: FrameCommandId): void {
  for (const session of runtime.sessions.values()) session.command(id);
}

/**
 * Shows `entry` in every mounted Frame, remembers it as the Document to reopen,
 * and opens the Document page only when no Frame is mounted to switch. Every
 * way in (the in-Frame Shelf, Open file…, a drop, a Canvas Reference) ends here,
 * so switching saves the current Reading Position the same way.
 */
export async function openReaderEntry(
  client: Pick<PluginClient, "navigation">,
  library: Pick<ShelfService, "rememberCurrent">,
  runtime: Pick<ReaderRuntime, "currentDocumentId" | "currentEntry" | "sessions">,
  entry: ShelfEntry
): Promise<void> {
  runtime.currentEntry = entry;
  runtime.currentDocumentId = entry.id;
  void library.rememberCurrent(entry.id);
  for (const session of runtime.sessions.values()) session.setEntry(entry);
  if (runtime.sessions.size === 0) {
    await client.navigation.openPage({ pageId: DOCUMENT_PAGE_ID });
  }
}

/**
 * Handles one `files.dropped` event the way a drop should read: each grant is
 * shelved in the order it was dropped, a grant Reader cannot shelve counts as
 * skipped, and the first shelved Document opens. One notification reports the
 * skipped files, so a `.docx` in a set of books is never silently ignored.
 */
async function handleDrop(
  client: PluginClient,
  library: Pick<ShelfService, "shelveGrant" | "rememberCurrent">,
  runtime: Pick<ReaderRuntime, "currentDocumentId" | "currentEntry" | "sessions" | "language">,
  payload: PluginApiEvents["files.dropped"]
): Promise<void> {
  let first: ShelfEntry | null = null;
  let skipped = 0;
  for (const grant of payload.grants) {
    try {
      const entry = await library.shelveGrant(grant);
      if (first === null) first = entry;
    } catch {
      skipped += 1;
    }
  }
  if (first !== null) await openReaderEntry(client, library, runtime, first);
  if (skipped > 0) {
    const key = skipped === 1 ? "shelf.dropSkipped.one" : "shelf.dropSkipped.other";
    await client.notifications.show({
      variant: "error",
      message: format(translate(runtime.language, key), { count: skipped }),
    });
  }
}

function isFrameCommand(id: string): id is FrameCommandId {
  return (FRAME_COMMANDS as ReadonlySet<string>).has(id);
}

function handleHostRequest(
  client: PluginClient,
  library: ReturnType<typeof createShelfService>,
  runtime: ReaderRuntime,
  method: string,
  params: unknown
): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST)
    return runReaderCommand(client, library, runtime, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Open Reader` and `Open Document` are page Commands,
 * so the host normally navigates without a `command.run`; answering them here
 * keeps both pages reachable the other way. The reading Commands go to the open
 * Frame, which owns the reading surface.
 */
async function runReaderCommand(
  client: PluginClient,
  library: ReturnType<typeof createShelfService>,
  runtime: ReaderRuntime,
  params: unknown
): Promise<null> {
  const { id } = (params ?? {}) as { id?: unknown };
  if (typeof id !== "string") return null;

  if (id === OPEN_READER) {
    await client.navigation.openPage({ pageId: SHELF_PAGE_ID });
    return null;
  }
  if (id === OPEN_DOCUMENT) {
    await client.navigation.openPage({ pageId: DOCUMENT_PAGE_ID });
    return null;
  }
  if (id === OPEN_FILE) {
    try {
      const entry = await library.openFileFlow();
      if (entry !== null) await openReaderEntry(client, library, runtime, entry);
    } catch {
      await client.notifications.show({
        variant: "error",
        message: translate(runtime.language, "shelf.openFailed"),
      });
    }
    return null;
  }
  if (isFrameCommand(id)) {
    if (runtime.sessions.size === 0 && id === BACK_TO_SHELF) {
      await client.navigation.openPage({ pageId: SHELF_PAGE_ID });
      return null;
    }
    broadcastCommand(runtime, id);
  }
  return null;
}
