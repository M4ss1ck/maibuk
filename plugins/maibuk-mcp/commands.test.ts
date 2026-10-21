/**
 * The MCP Server's page Commands (#594, part 1): opening the page and copying
 * each Agent snippet, run through the broker the way the Command Palette runs
 * them. Each copy Command puts the same text on the clipboard the page's own
 * Copy button does, with no page mounted.
 */

import { describe, expect, it } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { CONNECT_PAGE_ID } from "./page";
import { COPY_COMMAND_SNIPPETS, OPEN_CONNECT, startMcp } from "./plugin";
import { snippet } from "./snippets";
import { mcpManifest, waitForStoredKey } from "./test-support";

const PORT = 51_900;
const MCP_URL = `http://127.0.0.1:${PORT}/plugin/maibuk-mcp/mcp`;

/** A host with this Plugin started the way the Worker starts it, and its Key. */
async function start() {
  const storage = new Map<string, unknown>();
  const host = createTestHost({ manifest: mcpManifest(), storage });
  host.setEndpointAddress(PORT);
  startMcp(createPluginClient(host.port));
  const key = await waitForStoredKey(storage);
  return { host, key };
}

describe("MCP Server page Commands", () => {
  it("opens the page when the open Command runs", async () => {
    const { host } = await start();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_CONNECT });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-mcp", pageId: CONNECT_PAGE_ID }]);
    } finally {
      host.stop();
    }
  });

  it("copies each Agent snippet when its Command runs", async () => {
    const { host, key } = await start();
    try {
      for (const [id, kind] of Object.entries(COPY_COMMAND_SNIPPETS)) {
        host.setClipboard("");
        await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id });
        expect(host.clipboard, id).toBe(snippet(kind, { url: MCP_URL, key }));
      }
    } finally {
      host.stop();
    }
  });
});
