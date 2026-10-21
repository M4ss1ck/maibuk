/**
 * The MCP Server page (#594, part 1) through the supported Plugin test kit: the
 * four setup snippets, the Copy buttons, the Make a new Key button, the move
 * notice with its Done button, and the Plugin Endpoint's unavailable state.
 * Every action is driven by `user-event` key presses over the real Remote UI
 * renderer; nothing is a pointer press or an attribute check.
 */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { CONNECT_PAGE_ID, SHOWN_ADDRESS_STORAGE_KEY } from "./page";
import { startMcp } from "./plugin";
import { claudeCodeSnippet, codexSnippet, snippet, SNIPPET_KINDS } from "./snippets";
import { mcpManifest, mcpRequest, tabTo } from "./test-support";

const PORT = 51_789;
const ADDRESS = `http://127.0.0.1:${PORT}/plugin/maibuk-mcp/`;
const MCP_URL = `${ADDRESS}mcp`;

/** The snippets the page must show for one Key, in block order. */
function snippetsFor(key: string): [string, string][] {
  return SNIPPET_KINDS.map((kind) => [kind, snippet(kind, { url: MCP_URL, key })]);
}

/** A host with this Plugin, serving a page over the polyfill-free Remote UI entry. */
function pageHost(
  options: { storage?: Map<string, unknown>; language?: string; port?: number | null } = {}
) {
  const storage = options.storage ?? new Map<string, unknown>();
  const host = createTestHost({
    manifest: mcpManifest(),
    storage,
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  host.setEndpointAddress(options.port === undefined ? PORT : options.port);
  startMcp(createPluginClient(host.port), servePluginUi);
  return { host, storage };
}

/** Waits for the Key the Plugin stores, then returns it. */
async function storedKey(storage: Map<string, unknown>): Promise<string> {
  await waitFor(() => expect(typeof storage.get("key")).toBe("string"));
  return storage.get("key") as string;
}

/** The Agent's legacy `initialize` body, so a request proves its Key is accepted. */
function initializeBody(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "page-test", version: "0.0.0" },
    },
  };
}

/**
 * Finds the code block showing exactly `text`. A string matcher compares the
 * raw expected text with the block's collapsed one, which differs for a
 * multi-line snippet, so the block's own text content is the comparison.
 */
function findSnippet(text: string): Promise<HTMLElement> {
  return screen.findByText(
    (_content, element) => element?.tagName === "CODE" && element.textContent === text
  );
}

/** The code block showing exactly `text`, or null when no block does. */
function querySnippet(text: string): HTMLElement | null {
  return screen.queryByText(
    (_content, element) => element?.tagName === "CODE" && element.textContent === text
  );
}

describe("MCP Server page", () => {
  it("shows a labeled snippet per Agent and copies each exact text with the keyboard", async () => {
    const { host, storage } = pageHost();
    try {
      const key = await storedKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);
      const user = userEvent.setup();

      expect(await screen.findByRole("heading", { name: en.heading })).toBeInTheDocument();
      for (const [, text] of snippetsFor(key)) {
        expect(await findSnippet(text)).toBeInTheDocument();
      }

      const copies = screen.getAllByRole("button", { name: en.copy });
      expect(copies).toHaveLength(4);
      for (const [index, [, text]] of snippetsFor(key).entries()) {
        host.setClipboard("");
        await tabTo(user, copies[index]);
        expect(copies[index]).toHaveFocus();
        await user.keyboard("{Enter}");
        await waitFor(() => expect(host.clipboard).toBe(text));
        expect(await screen.findByText(en.copied)).toBeInTheDocument();
      }

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("makes a new Key with the keyboard, refreshes the snippets, and refuses the old Key", async () => {
    const { host, storage } = pageHost();
    try {
      const oldKey = await storedKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);
      const user = userEvent.setup();

      expect(await findSnippet(claudeCodeSnippet({ url: MCP_URL, key: oldKey }))).toBeInTheDocument();

      const make = screen.getByRole("button", { name: en.newKey });
      await tabTo(user, make);
      expect(make).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(storage.get("key")).not.toBe(oldKey));
      const freshKey = storage.get("key") as string;
      expect(await findSnippet(claudeCodeSnippet({ url: MCP_URL, key: freshKey }))).toBeInTheDocument();
      expect(querySnippet(claudeCodeSnippet({ url: MCP_URL, key: oldKey }))).toBeNull();

      const refused = await mcpRequest(host, oldKey, initializeBody(1));
      expect(refused.status).toBe(401);
      const accepted = await mcpRequest(host, freshKey, initializeBody(2));
      expect(accepted.status).toBe(200);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("refreshes the snippets on a move and dismisses the reconnect notice with Done", async () => {
    const { host, storage } = pageHost();
    try {
      const key = await storedKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);
      const user = userEvent.setup();

      expect(await findSnippet(claudeCodeSnippet({ url: MCP_URL, key }))).toBeInTheDocument();
      // The first address is stored silently, so no notice shows.
      await waitFor(() => expect(storage.get(SHOWN_ADDRESS_STORAGE_KEY)).toBe(ADDRESS));
      expect(screen.queryByText(en.reconnect)).toBeNull();

      const movedPort = PORT + 1;
      const movedAddress = `http://127.0.0.1:${movedPort}/plugin/maibuk-mcp/`;
      await waitFor(() => host.setEndpointAddress(movedPort));

      expect(await screen.findByText(en.reconnect)).toBeInTheDocument();
      expect(
        await findSnippet(claudeCodeSnippet({ url: `${movedAddress}mcp`, key }))
      ).toBeInTheDocument();
      expect(querySnippet(claudeCodeSnippet({ url: MCP_URL, key }))).toBeNull();

      const done = screen.getByRole("button", { name: en.done });
      await tabTo(user, done);
      expect(done).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(screen.queryByText(en.reconnect)).toBeNull());
      expect(storage.get(SHOWN_ADDRESS_STORAGE_KEY)).toBe(movedAddress);

      // Another render leaves it dismissed: Done stored the address.
      const copy = screen.getAllByRole("button", { name: en.copy })[0];
      await tabTo(user, copy);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(host.clipboard).toBe(claudeCodeSnippet({ url: `${movedAddress}mcp`, key })));
      expect(screen.queryByText(en.reconnect)).toBeNull();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("says the Plugin Endpoint is not available when there is no address", async () => {
    const { host } = pageHost({ port: null });
    try {
      const page = await host.renderPage(CONNECT_PAGE_ID);

      expect(await screen.findByText(en.unavailable)).toBeInTheDocument();
      expect(screen.queryAllByRole("button", { name: en.copy })).toHaveLength(0);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("renders every string in Spanish when the app language is Spanish", async () => {
    const { host, storage } = pageHost({ language: "es" });
    try {
      const key = await storedKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);

      expect(await screen.findByRole("heading", { name: es.heading })).toBeInTheDocument();
      expect(await findSnippet(codexSnippet({ url: MCP_URL, key }))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es.newKey })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: es.copy })).toHaveLength(4);

      page.unmount();
    } finally {
      host.stop();
    }
  });
});
