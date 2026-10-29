/**
 * The Reader runtime (#653): the Shelf page, the document Frame handoff, and the
 * Command handlers. Kept apart from `index.tsx` (the Worker bootstrap) so a test
 * can drive the same logic over the polyfill-free Remote UI entry the test kit
 * uses, without loading the Worker's Remote DOM polyfill into jsdom.
 *
 * This unit builds the Shelf and owns the document Frame handoff: opening a
 * Document stores `currentDocumentId` in memory, opens the Frame page, and
 * creates one session per mounted Frame. The session answers the Frame's reads,
 * saves its Reading Position, and receives the reading Commands. Imports only
 * `@/plugin-sdk` and this Plugin's files.
 */

import type { ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  type HostRequestHandler,
  type PluginClient,
  type PluginFrame,
} from "@/plugin-sdk";
import type { FrameCommandId } from "./frame-protocol";
import { translate } from "./i18n";
import { createShelfService } from "./library";
import { createReaderSession, type ReaderSession } from "./session";
import { SHELF_PAGE_ID, createShelfPage } from "./shelf-page";
import type { ShelfEntry } from "./shelf";

/** The Shelf page id, exactly as the manifest declares it. */
export { SHELF_PAGE_ID };

/** The whole-page Frame's id, exactly as the manifest declares it. */
export const DOCUMENT_PAGE_ID = "document";

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
export const BACK_TO_SHELF = "backToShelf";

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
  BACK_TO_SHELF,
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
interface ReaderRuntime {
  /** The Document whose Frame page is open, kept in memory only. */
  currentDocumentId: string | null;
  /** The row the open Frame draws its title from. */
  currentEntry: ShelfEntry | null;
  /** Every mounted Frame's session, by the host's frame id. */
  sessions: Map<string, ReaderSession>;
  /** The app language the Frame should draw its own chrome in. */
  language: string;
}

/** Wires the client to the Shelf page, the document Frame, and the Commands. */
export function startReader(client: PluginClient, serve: ReaderServe): void {
  const library = createShelfService(client);
  const runtime: ReaderRuntime = {
    currentDocumentId: null,
    currentEntry: null,
    sessions: new Map(),
    language: "en",
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
      for (const session of runtime.sessions.values()) session.setLanguage(payload.language);
    })
    .catch(() => {});

  client.onFrame((frame: PluginFrame) => {
    const session = createReaderSession({
      client,
      library,
      entry: runtime.currentEntry,
      language: runtime.language,
      port: frame.port,
      navigateToShelf: async () => {
        await client.navigation.openPage({ pageId: SHELF_PAGE_ID });
      },
      onDispose: () => {
        runtime.sessions.delete(frame.id);
      },
    });
    runtime.sessions.set(frame.id, session);
    session.start();
  });

  function openDocument(entry: ShelfEntry): void {
    runtime.currentEntry = entry;
    runtime.currentDocumentId = entry.id;
    for (const session of runtime.sessions.values()) session.setEntry(entry);
    void client.navigation.openPage({ pageId: DOCUMENT_PAGE_ID });
  }

  const ShelfPage = createShelfPage({ client, library, onOpenDocument: openDocument });

  serve(client, {
    pages: { [SHELF_PAGE_ID]: ShelfPage },
    onHostRequest: (method, params) => handleHostRequest(client, library, runtime, method, params),
  });
}

/** Posts `message` to every mounted Frame. */
function broadcastCommand(runtime: ReaderRuntime, id: FrameCommandId): void {
  for (const session of runtime.sessions.values()) session.command(id);
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
      if (entry !== null) {
        runtime.currentEntry = entry;
        runtime.currentDocumentId = entry.id;
        for (const session of runtime.sessions.values()) session.setEntry(entry);
        await client.navigation.openPage({ pageId: DOCUMENT_PAGE_ID });
      }
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
