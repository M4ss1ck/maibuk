/**
 * The Maps runtime (#744): the Maps page, the Commands, and the host requests.
 * Kept apart from `index.tsx` (the Worker bootstrap) so a test drives the same
 * logic over the polyfill-free Remote UI entry the test kit uses.
 *
 * `Open Maps` opens the page with whatever filter it last had. `Maps`, the
 * Book Item Menu entry (and the Book editor's palette Command), sets the filter
 * to the Book it was run on, then opens the page. Imports only `@/plugin-sdk`
 * and this Plugin's files.
 */

import type { ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  PLUGIN_MIGRATE_DATA_REQUEST,
  type HostRequestHandler,
  type PluginClient,
} from "@/plugin-sdk";
import { createMapStore, migrateMapsData } from "./maps";
import { MAPS_PAGE_ID, createBookFilter, createMapsPage } from "./maps-page";

export { MAPS_PAGE_ID };

/** The Command-local ids the manifest declares. */
export const OPEN_MAPS = "openMaps";
export const BOOK_MAPS = "bookMaps";

/** The host's Remote UI and request entry (`servePluginUi`), Worker or test. */
export type MapsServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/** Wires the client to the Maps page, the Commands, and `migrateData`. */
export function startMaps(client: PluginClient, serve: MapsServe): void {
  const store = createMapStore(client.storage);
  const filter = createBookFilter();

  async function runCommand(params: unknown): Promise<null> {
    const { id, target } = (params ?? {}) as {
      id?: unknown;
      target?: { kind?: unknown; id?: unknown };
    };
    if (id === BOOK_MAPS && target?.kind === "book" && typeof target.id === "string") {
      filter.set(target.id);
    }
    if (id === BOOK_MAPS || id === OPEN_MAPS) {
      await client.navigation.openPage({ pageId: MAPS_PAGE_ID });
    }
    return null;
  }

  serve(client, {
    pages: { [MAPS_PAGE_ID]: createMapsPage({ client, store, filter }) },
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
}
