/**
 * Reader's Worker half (#653, #944) through the supported Plugin test kit: the
 * real broker and File Grant fakes. The Shelf now draws in the Frame, so these
 * tests drive the Commands and the drop handler and assert what the host
 * navigated to and what storage holds, never what a page drew. `index.tsx` (the
 * Worker bootstrap) is never imported.
 */

import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { PLUGIN_FRAME_MESSAGE, createPluginClient, type PluginMessagePort } from "@/plugin-sdk";
import {
  PLUGIN_CANVAS_REFERENCE_LIST_REQUEST,
  PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST,
  PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST,
  PLUGIN_COMMAND_RUN_REQUEST,
} from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { format } from "./i18n";
import en from "./locales/runtime/en.json";
import {
  DOCUMENT_PAGE_ID,
  OPEN_READER,
  SHELF_FRAME_SRC,
  SHELF_PAGE_ID,
  startReader,
} from "./runtime";
import {
  CURRENT_DOCUMENT_KEY,
  SHELF_KEY,
  SHELF_VIEW_KEY,
  fingerprint,
  positionKey,
  type ShelfEntry,
} from "./shelf";
import { epubBytes, pdfBytes, readerManifest, readerStorage, shelfEntry } from "./test-support";

/** A Plugin port the test can also hand a Frame, the way the host runtime does. */
function frameAwarePort(inner: MessagePort) {
  let listener: ((event: MessageEvent) => void) | null = null;
  inner.onmessage = (event) => listener?.(event);
  const port = {
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      if (transfer === undefined) inner.postMessage(message);
      else inner.postMessage(message, transfer);
    },
    get onmessage() {
      return listener;
    },
    set onmessage(next: ((event: MessageEvent) => void) | null) {
      listener = next;
    },
    /** Hands the Plugin one Frame and returns the test's end of its port. */
    frame(frameId: string, src: string): MessagePort {
      const channel = new MessageChannel();
      listener?.({
        data: { kind: PLUGIN_FRAME_MESSAGE.kind, frameId, src },
        ports: [channel.port1],
      } as unknown as MessageEvent);
      return channel.port2;
    },
  };
  return port;
}

function hostFor(
  options: { files?: { name: string; bytes: Uint8Array }[]; storage?: Map<string, unknown> } = {}
) {
  const storage = options.storage ?? readerStorage();
  const host = createTestHost({
    manifest: readerManifest(),
    storage,
    files: options.files,
  });
  const port = frameAwarePort(host.port);
  startReader(createPluginClient(port as PluginMessagePort), servePluginUi);
  return { host, storage, port };
}

/** A Shelf row whose Fingerprint matches the seeded file exactly. */
async function seededEntry(bytes: Uint8Array, id = "doc-1"): Promise<ShelfEntry> {
  const print = await fingerprint(bytes.length, bytes, bytes);
  return shelfEntry({
    id,
    grant: "grant-1",
    fingerprint: print,
    title: "Dune",
    progress: { page: 42, pageCount: 210 },
  });
}

describe("Reader Commands", () => {
  it("opens the Shelf from its navigating Command", async () => {
    const { host } = hostFor();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_READER });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: SHELF_PAGE_ID }]);
    } finally {
      await host.stop();
    }
  });

  it.each([
    "removeFromShelf",
    "locateDocument",
  ])("forwards %s to the mounted Shelf Frame", async (id) => {
    const { host, port } = hostFor();
    try {
      // The Frame is mounted and its session is listening by the time this
      // returns; the Worker must forward the Command to that same port.
      const frame = port.frame("frame-1", "assets/ui/shelf.html");
      const messages: Record<string, unknown>[] = [];
      frame.onmessage = (event) => messages.push(event.data as Record<string, unknown>);
      frame.start();

      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id });

      await waitFor(() => expect(messages).toContainEqual({ kind: "command", id }));
    } finally {
      await host.stop();
    }
  });
});

// The author drops files from their device onto the Shelf or an open Document
// (#828): each supported file lands on the Shelf like a pick, the first opens,
// and the files Reader cannot open are reported once with the count. The Shelf
// draws in the Frame, so these drive the Worker directly and read storage.
describe("Reader file drop", () => {
  type Host = ReturnType<typeof hostFor>["host"];

  /**
   * Waits until Reader's activation subscription for drops reaches the broker.
   * `startReader` subscribes on activation, so no page needs to render first.
   */
  async function subscribed(host: Host): Promise<void> {
    await waitFor(() => expect(host.broker.accepts("files.dropped")).toBe(true));
  }

  it("adds a dropped file to the Shelf and opens its Document", async () => {
    const { host, storage } = hostFor();
    try {
      await subscribed(host);

      await expect(
        host.files.drop(SHELF_PAGE_ID, [{ name: "Dune.pdf", bytes: pdfBytes("a dropped PDF") }])
      ).resolves.toBe(true);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ title: "Dune", format: "pdf", state: "ok" });
      expect(await host.files.grants()).toHaveLength(1);
      expect(host.notifications).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("opens the existing Document for a file already on the Shelf, with no duplicate", async () => {
    const bytes = pdfBytes("already on the shelf");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [await seededEntry(bytes)]);
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      await subscribed(host);

      await host.files.drop(SHELF_PAGE_ID, [{ name: "Dune.pdf", bytes }]);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ id: "doc-1", grant: "grant-1", state: "ok" });
      expect(host.notifications).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("adds every file in a multi-file drop and opens the first", async () => {
    const { host, storage } = hostFor();
    try {
      await subscribed(host);

      await host.files.drop(SHELF_PAGE_ID, [
        { name: "Dune.pdf", bytes: pdfBytes("the first file") },
        { name: "Emma.epub", bytes: epubBytes("the second file") },
      ]);

      await waitFor(() => expect(host.pageNavigations).toHaveLength(1));
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((entry) => entry.title).sort()).toEqual(["Dune", "Emma"]);
      const first = shelf.find((entry) => entry.title === "Dune");
      expect(storage.get(CURRENT_DOCUMENT_KEY)).toBe(first?.id);
      expect(host.notifications).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("releases an unsupported file, reports it once, and opens nothing", async () => {
    const { host, storage } = hostFor();
    try {
      await subscribed(host);

      await host.files.drop(SHELF_PAGE_ID, [
        { name: "notes.docx", bytes: new TextEncoder().encode("notes, not a book") },
      ]);

      await waitFor(() => expect(host.notifications).toHaveLength(1));
      expect(host.notifications).toEqual([
        { variant: "error", message: en["shelf.dropSkipped.one"] },
      ]);
      expect(host.pageNavigations).toEqual([]);
      expect(await host.files.grants()).toEqual([]);
      expect(storage.get(SHELF_KEY) ?? []).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("counts every unsupported file in one notification and opens nothing", async () => {
    const { host } = hostFor();
    try {
      await subscribed(host);

      await host.files.drop(SHELF_PAGE_ID, [
        { name: "notes.docx", bytes: new TextEncoder().encode("notes") },
        { name: "photo.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) },
      ]);

      await waitFor(() => expect(host.notifications).toHaveLength(1));
      expect(host.notifications).toEqual([
        {
          variant: "error",
          message: format(en["shelf.dropSkipped.other"], { count: 2 }),
        },
      ]);
      expect(host.pageNavigations).toEqual([]);
      expect(await host.files.grants()).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("reattaches a Missing Document and keeps its Reading Position", async () => {
    const bytes = pdfBytes("the file that moved");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [await seededEntry(bytes)]);
    storage.set(positionKey("doc-1"), { page: 42, pageCount: 210 });
    const { host } = hostFor({ files: [{ name: "Dune.pdf", bytes }], storage });
    try {
      host.files.setMissing("grant-1");
      await subscribed(host);

      await host.files.drop(SHELF_PAGE_ID, [{ name: "Dune.pdf", bytes }]);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf).toHaveLength(1);
      expect(shelf[0]).toMatchObject({ id: "doc-1", state: "ok", grant: "grant-1" });
      expect(storage.get(positionKey("doc-1"))).toEqual({ page: 42, pageCount: 210 });
      expect(host.notifications).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("opens a Document dropped on the Document page", async () => {
    const { host, storage } = hostFor();
    try {
      await subscribed(host);

      await host.files.drop(DOCUMENT_PAGE_ID, [{ name: "Emma.epub", bytes: epubBytes() }]);

      await waitFor(() =>
        expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-reader", pageId: "document" }])
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((entry) => entry.title)).toEqual(["Emma"]);
    } finally {
      await host.stop();
    }
  });

  it("handles two quick drops in order, leaving the second Document open", async () => {
    const { host, storage } = hostFor();
    try {
      await subscribed(host);

      const first = host.files.drop(SHELF_PAGE_ID, [
        { name: "Dune.pdf", bytes: pdfBytes("the first drop") },
      ]);
      const second = host.files.drop(SHELF_PAGE_ID, [
        { name: "Emma.epub", bytes: epubBytes("the second drop") },
      ]);
      await Promise.all([first, second]);

      await waitFor(() => expect(host.pageNavigations).toHaveLength(2));
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((entry) => entry.title).sort()).toEqual(["Dune", "Emma"]);
      const last = shelf.find((entry) => entry.title === "Emma");
      expect(storage.get(CURRENT_DOCUMENT_KEY)).toBe(last?.id);
      expect(host.notifications).toEqual([]);
    } finally {
      await host.stop();
    }
  });
});

// The writer points a Canvas Reference at a Document on the Shelf (#838): the
// Shelf is the `documents` source, subtitled by each Document's format, and a
// Document the author forgot is reported missing.
describe("Reader Canvas Reference source", () => {
  /** The cover the Shelf made when doc-1 first opened. */
  const COVER = "data:image/jpeg;base64,COVER";

  /** A Shelf of two Documents, newest first; only doc-1 has a cover. */
  async function seededShelf(): Promise<Map<string, unknown>> {
    const dune = pdfBytes("a PDF on the shelf");
    const emma = epubBytes("an EPUB on the shelf");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [
      { ...(await seededEntry(dune)), coverDataUrl: COVER },
      shelfEntry({
        id: "doc-2",
        grant: "grant-2",
        fingerprint: await fingerprint(emma.length, emma, emma),
        title: "Emma",
        format: "epub",
        lastReadAt: 2_000,
      }),
    ]);
    return storage;
  }

  it("lists every Document on the Shelf, subtitled by its format", async () => {
    const { host } = hostFor({ storage: await seededShelf() });
    try {
      const result = await host.broker.request(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, {
        source: "documents",
        query: "",
      });
      expect(result).toEqual({
        rows: [
          { id: "doc-2", title: "Emma", subtitle: "EPUB" },
          { id: "doc-1", title: "Dune", subtitle: "PDF" },
        ],
      });
    } finally {
      await host.stop();
    }
  });

  it("filters rows by title, trimmed and case-insensitive", async () => {
    const { host } = hostFor({ storage: await seededShelf() });
    try {
      const result = await host.broker.request(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, {
        source: "documents",
        query: "  duNe ",
      });
      expect(result).toEqual({ rows: [{ id: "doc-1", title: "Dune", subtitle: "PDF" }] });
    } finally {
      await host.stop();
    }
  });

  it("resolves a present Document and reports one removed from the Shelf missing", async () => {
    const storage = await seededShelf();
    const { host } = hostFor({ storage });
    try {
      const request = async (ids: string[]) =>
        host.broker.request(PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST, { source: "documents", ids });

      await expect(request(["doc-1", "doc-2"])).resolves.toEqual({
        "doc-1": { status: "present", title: "Dune", subtitle: "PDF", image: COVER },
        "doc-2": { status: "present", title: "Emma", subtitle: "EPUB" },
      });

      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      storage.set(
        SHELF_KEY,
        shelf.filter((entry) => entry.id !== "doc-1")
      );
      await expect(request(["doc-1", "doc-2"])).resolves.toEqual({
        "doc-1": { status: "missing" },
        "doc-2": { status: "present", title: "Emma", subtitle: "EPUB" },
      });
    } finally {
      await host.stop();
    }
  });

  it("resolves a lost file present and opens it onto the Reading page", async () => {
    const bytes = pdfBytes("the file that moved");
    const storage = readerStorage();
    storage.set(SHELF_KEY, [{ ...(await seededEntry(bytes)), state: "missing" }]);
    const { host } = hostFor({ storage });
    try {
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST, {
          source: "documents",
          ids: ["doc-1"],
        })
      ).resolves.toEqual({ "doc-1": { status: "present", title: "Dune", subtitle: "PDF" } });

      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST, {
          source: "documents",
          id: "doc-1",
        })
      ).resolves.toBe("opened");
      expect(host.pageNavigations).toEqual([
        { pluginId: "maibuk-reader", pageId: DOCUMENT_PAGE_ID },
      ]);
    } finally {
      await host.stop();
    }
  });

  it("answers missing for an id not on the Shelf, opening nothing", async () => {
    const { host } = hostFor({ storage: await seededShelf() });
    try {
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST, {
          source: "documents",
          id: "gone",
        })
      ).resolves.toBe("missing");
      expect(host.pageNavigations).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it("fails every request when the Shelf cannot be read, rather than calling Documents missing", async () => {
    // A blocked storage read must not read as an empty Shelf: the host keeps the
    // stored labels for a failed request, but marks a `missing` answer Missing.
    class BlockedShelf extends Map<string, unknown> {
      override get(key: string): unknown {
        if (key === SHELF_KEY) throw new Error("storage blocked");
        return super.get(key);
      }
    }
    const { host } = hostFor({ storage: new BlockedShelf() });
    try {
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, {
          source: "documents",
          query: "",
        })
      ).rejects.toThrow();
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST, {
          source: "documents",
          ids: ["doc-1"],
        })
      ).rejects.toThrow();
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST, {
          source: "documents",
          id: "doc-1",
        })
      ).rejects.toThrow();
    } finally {
      await host.stop();
    }
  });
});

// The Shelf remembers its view, sort, filters, and search (#945): the Frame
// sends each change through the Worker into Plugin storage, and the next Shelf
// Frame opens with what was stored.
describe("Reader Shelf view memory", () => {
  /** Mounts a Shelf Frame, says it is ready, and collects what its session posts. */
  function mountShelf(port: ReturnType<typeof frameAwarePort>, frameId: string) {
    const frame = port.frame(frameId, SHELF_FRAME_SRC);
    const messages: Record<string, unknown>[] = [];
    frame.onmessage = (event) => messages.push(event.data as Record<string, unknown>);
    frame.start();
    frame.postMessage({ kind: "ready" });
    return { frame, messages };
  }

  /** The `open` message the session posted to this Frame, once it has posted one. */
  function openOf(messages: Record<string, unknown>[]): Record<string, unknown> | undefined {
    return messages.find((message) => message.kind === "open");
  }

  it("remembers the Shelf's view, sort, filters, and search across a Frame reload (#945)", async () => {
    const { host, storage, port } = hostFor();
    const settings = {
      layout: "compact",
      coverSize: "large",
      sort: "author",
      descending: true,
      formats: ["pdf"],
      statuses: ["reading"],
      search: "austen",
    };
    try {
      const first = mountShelf(port, "frame-1");
      await waitFor(() => expect(openOf(first.messages)).toBeDefined());

      first.frame.postMessage({ kind: "shelf-view", settings });
      await waitFor(() => expect(storage.get(SHELF_VIEW_KEY)).toEqual(settings));
      first.frame.postMessage({ kind: "closed" });

      const reloaded = mountShelf(port, "frame-2");
      await waitFor(() => expect(openOf(reloaded.messages)).toBeDefined());
      expect(openOf(reloaded.messages)?.shelfView).toEqual(settings);
    } finally {
      await host.stop();
    }
  });

  it("opens the Shelf with the clamped view when the stored value is malformed (#945)", async () => {
    const storage = readerStorage();
    storage.set(SHELF_VIEW_KEY, {
      layout: "tiles",
      coverSize: "large",
      sort: "title",
      descending: false,
      formats: "pdf",
      statuses: ["finished"],
      search: "Dune",
    });
    const { host, port } = hostFor({ storage });
    try {
      const shelf = mountShelf(port, "frame-1");
      await waitFor(() => expect(openOf(shelf.messages)).toBeDefined());
      expect(openOf(shelf.messages)?.shelfView).toEqual({
        layout: "grid",
        coverSize: "large",
        sort: "title",
        descending: false,
        formats: [],
        statuses: ["finished"],
        search: "Dune",
      });
    } finally {
      await host.stop();
    }
  });
});
