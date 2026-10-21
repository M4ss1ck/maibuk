/**
 * The MCP Server page's live half (#594, part 2) through the supported Plugin
 * test kit: the connected count beside the heading, the Connections list, and
 * the Activity log. A Connection is opened by a real `initialize` from a named
 * Agent and ended by the idle timeout under fake timers; every entry comes from
 * a real tool call, so what the page shows is what the server answered.
 */

import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { ACTIVITY_LIMIT, recordActivity } from "./activity";
import { RELATIVE_TICK_MS } from "./connections-panel";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { CONNECT_PAGE_ID } from "./page";
import { CONNECTION_IDLE_MS, startMcp } from "./plugin";
import {
  makeNote,
  mcpManifest,
  mcpRequest,
  modernHeaders,
  modernParams,
  waitForStoredKey,
} from "./test-support";

const PORT = 51_790;

/** The fake clock the timed suite starts at. */
const START = Date.UTC(2026, 9, 20, 9, 0, 0);

/** A Book, its Chapter, and its Note, as the Agent finds them. */
function liveLibrary() {
  const books = [
    {
      id: "bookalpha1",
      title: "The Book",
      subtitle: null,
      authorName: "Author",
      genre: null,
      language: "en",
      wordCount: 100,
      targetWordCount: null,
      status: "draft" as const,
      updatedAt: 1000,
    },
  ];
  const chapters = [
    {
      id: "chapteralpha",
      bookId: "bookalpha1",
      title: "Chapter One",
      order: 1,
      parentId: null,
      chapterType: "chapter" as const,
      wordCount: 10,
      status: "draft" as const,
      updatedAt: Date.UTC(2026, 0, 1),
      content: { html: "<p>Alpha body.</p>", text: "Alpha body." },
    },
  ];
  const notes = [makeNote("notealpha1", "bookalpha1", "The Note")];
  return { books, chapters, notes } as any;
}

/** A host with this Plugin, serving the page over the Remote UI entry. */
function pageHost(options: { language?: string; library?: unknown } = {}) {
  const storage = new Map<string, unknown>();
  const host = createTestHost({
    manifest: mcpManifest(),
    storage,
    ...(options.language === undefined ? {} : { language: options.language }),
    ...(options.library === undefined ? {} : { library: options.library as any }),
  });
  host.setEndpointAddress(PORT);
  startMcp(createPluginClient(host.port), servePluginUi);
  return { host, storage };
}

/** The Agent's legacy `initialize` handshake, self-reporting `name`. */
function initializeFrom(name: string, id: unknown = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name, version: "0.0.0" },
    },
  };
}

/** The Agent's legacy `tools/list` body. */
function toolsListBody(id: unknown = 1) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

/** The Agent's legacy `tools/call` body. */
function toolsCall(name: string, args: unknown, id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

/** Takes over the clock and the Plugin's own timers for one test. */
function freezeClock(at: number): void {
  vi.useFakeTimers({
    now: at,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

/**
 * How the page's last-activity label writes one distance, in the app's English
 * locale: the same formatter the panel reads.
 */
function relativeLabel(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
}

/**
 * Polls the host's tree until the page shows what the test asserts, instead of
 * guessing how many event-loop turns the Remote UI mount needs.
 */
async function untilVisible(check: () => void): Promise<void> {
  // time-budget: the Remote UI mount paints slower than vi.waitFor's one-second default.
  await vi.waitFor(check, { timeout: 5_000 });
}

describe("MCP Server live page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a named Agent while its Connection is live and none after the idle timeout", async () => {
    const { host, storage } = pageHost({ library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);

      expect(await screen.findByText(en.noConnections)).toBeInTheDocument();
      expect(screen.getByText(en.connectionsEmpty)).toBeInTheDocument();

      freezeClock(START);
      await mcpRequest(host, key, initializeFrom("Claude Code"));

      await untilVisible(() => {
        const connections = screen.getByRole("table", { name: en.connectionsLabel });
        expect(within(connections).getByText("Claude Code")).toBeInTheDocument();
        expect(screen.getByText(en.connectedOne)).toBeInTheDocument();
      });
      expect(screen.queryByText(en.connectionsEmpty)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONNECTION_IDLE_MS + 1_000);
      });
      await untilVisible(() => {
        expect(screen.queryByRole("table", { name: en.connectionsLabel })).toBeNull();
        expect(screen.getByText(en.noConnections)).toBeInTheDocument();
      });
      expect(screen.getByText(en.connectionsEmpty)).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("repaints the last-activity duration while the panel stays mounted", async () => {
    const { host, storage } = pageHost({ library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      // The fake clock owns the panel's repaint interval, so it goes first.
      freezeClock(START);
      const page = await host.renderPage(CONNECT_PAGE_ID);
      await mcpRequest(host, key, initializeFrom("Claude Code"));

      await untilVisible(() => {
        const connections = screen.getByRole("table", { name: en.connectionsLabel });
        expect(within(connections).getByText(relativeLabel(0, "second"))).toBeInTheDocument();
      });

      // No request moves the Connection: only the panel's own repaint can.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RELATIVE_TICK_MS * 2);
      });
      const connections = screen.getByRole("table", { name: en.connectionsLabel });
      expect(within(connections).getByText(relativeLabel(-1, "minute"))).toBeInTheDocument();
      expect(within(connections).queryByText(relativeLabel(0, "second"))).toBeNull();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("never puts an Agent's last activity in the future when it connects between repaints", async () => {
    const { host, storage } = pageHost({ library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      freezeClock(START);
      const page = await host.renderPage(CONNECT_PAGE_ID);
      await untilVisible(() => {
        expect(screen.getByText(en.noConnections)).toBeInTheDocument();
      });

      // The clock moves on inside one repaint window, then the Agent calls.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      await mcpRequest(host, key, initializeFrom("Claude Code"));

      await untilVisible(() => {
        const connections = screen.getByRole("table", { name: en.connectionsLabel });
        expect(within(connections).getByText(relativeLabel(0, "second"))).toBeInTheDocument();
      });
      expect(screen.queryByText(relativeLabel(5, "second"))).toBeNull();

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("lists a tool call with its tool, item, and result, under the Agent that made it", async () => {
    const { host, storage } = pageHost({ library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);

      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(host, key, toolsCall("read_note", { note: "notealpha1" }, 2));

      const log = await screen.findByRole("table", { name: en.activityLabel });
      expect(await within(log).findByText("read_note")).toBeInTheDocument();
      expect(within(log).getByText("notealpha1")).toBeInTheDocument();
      expect(within(log).getByText(en.resultOk)).toBeInTheDocument();
      expect(within(log).getByText("Claude Code")).toBeInTheDocument();

      // A second Agent's call opens its own Connection and lands on its own row.
      const second = await mcpRequest(host, key, initializeFrom("Codex", 3));
      expect(second.status).toBe(200);
      await mcpRequest(host, key, toolsCall("list_books", {}, 4));
      await untilVisible(() => {
        const fresh = screen.getByRole("table", { name: en.activityLabel });
        expect(within(fresh).getByText("Codex")).toBeInTheDocument();
        expect(screen.getByText(en.connectedMany.replace("{count}", "2"))).toBeInTheDocument();
      });

      // A failing call reads as Error, and the newest row heads the table.
      await mcpRequest(host, key, toolsCall("read_note", { note: "missingnote" }, 5));
      const fresh = screen.getByRole("table", { name: en.activityLabel });
      expect(await within(fresh).findByText(en.resultError)).toBeInTheDocument();
      expect(within(fresh).getAllByText("missingnote")).toHaveLength(1);
      const rows = within(fresh).getAllByRole("row");
      expect(rows[1]?.textContent).toContain("missingnote");
      expect(rows[rows.length - 1]?.textContent).toContain("read_note");

      // A request that names no Agent reads Unnamed Agent, and a call that names
      // no item reads the dash placeholder.
      await mcpRequest(
        host,
        key,
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: modernParams({ name: "list_books", arguments: {} }),
        },
        modernHeaders("tools/call", { "mcp-name": "list_books" })
      );
      const unnamed = await within(fresh).findByText(en.unnamedAgent);
      expect(unnamed.closest("tr")?.textContent).toContain(en.emptyValue);

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("renders the full five-hundred-entry log within the host's node limit", async () => {
    const { host, storage } = pageHost({ library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      // A request waits for the start's stored log, so this drives the live log
      // directly instead of racing the load.
      await mcpRequest(host, key, toolsListBody());
      for (let index = 0; index < ACTIVITY_LIMIT; index += 1) {
        recordActivity({
          at: START + index,
          agent: "Claude Code",
          tool: `tool_${index}`,
          item: null,
          result: index % 2 === 0 ? "ok" : "error",
        });
      }

      const page = await host.renderPage(CONNECT_PAGE_ID);
      await untilVisible(() => {
        expect(page.container.querySelectorAll("tbody tr")).toHaveLength(ACTIVITY_LIMIT);
      });
      const tables = page.container.querySelectorAll("table");
      expect(tables).toHaveLength(1);
      const rows = tables[0]?.querySelectorAll("tbody tr") ?? [];
      expect(rows).toHaveLength(ACTIVITY_LIMIT);
      // Newest first: the last recorded call heads the table, not the first.
      expect(rows[0]?.textContent).toContain(`tool_${ACTIVITY_LIMIT - 1}`);
      expect(rows[ACTIVITY_LIMIT - 1]?.textContent).toContain("tool_0");
      expect(page.violations.filter((violation) => violation.code === "too-many-nodes")).toEqual(
        []
      );

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("never renders the Chapter text an Agent wrote", async () => {
    const { host, storage } = pageHost({ library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);

      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(
        host,
        key,
        toolsCall(
          "write_chapter",
          {
            book: "bookalpha1",
            title: "ZEBRA-TITLE-SENTINEL",
            text: "ZEBRA-SENTINEL-TEXT",
          },
          2
        )
      );

      const log = await screen.findByRole("table", { name: en.activityLabel });
      expect(await within(log).findByText("write_chapter")).toBeInTheDocument();
      expect(page.container.textContent).not.toContain("ZEBRA-SENTINEL-TEXT");
      expect(page.container.textContent).not.toContain("ZEBRA-TITLE-SENTINEL");

      page.unmount();
    } finally {
      host.stop();
    }
  });

  it("renders the new strings in Spanish", async () => {
    const { host, storage } = pageHost({ language: "es", library: liveLibrary() });
    try {
      const key = await waitForStoredKey(storage);
      const page = await host.renderPage(CONNECT_PAGE_ID);

      expect(await screen.findByText(es.noConnections)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: es.connectionsHeading })).toBeInTheDocument();
      expect(screen.getByText(es.connectionsEmpty)).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: es.activityHeading })).toBeInTheDocument();
      expect(screen.getByText(es.activityEmpty)).toBeInTheDocument();

      await mcpRequest(host, key, initializeFrom("Claude Code"));
      await mcpRequest(host, key, toolsCall("read_note", { note: "notealpha1" }, 2));

      expect(await screen.findByText(es.connectedOne)).toBeInTheDocument();
      const log = await screen.findByRole("table", { name: es.activityLabel });
      expect(within(log).getByText(es.toolColumn)).toBeInTheDocument();
      expect(within(log).getByText(es.agentColumn)).toBeInTheDocument();
      expect(within(log).getByText(es.resultColumn)).toBeInTheDocument();
      expect(within(log).getByText(es.resultOk)).toBeInTheDocument();

      page.unmount();
    } finally {
      host.stop();
    }
  });
});
