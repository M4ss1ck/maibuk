// @vitest-environment jsdom
/**
 * One Reader session (#653), the Worker half of the Frame wire protocol,
 * through the Plugin test kit's real broker and File Grant fakes. The test
 * speaks to the session over a MessageChannel exactly as a mounted Frame would:
 * it says `ready` to receive `open`, asks for byte ranges, reports where the
 * author is, sends the Document's own metadata and a `back`. The nested pdf.js
 * Worker is a stub, so nothing parses here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_READ_MAX_BYTES, createPluginClient } from "@/plugin-sdk";
import { createTestHost } from "@/features/plugins/test-kit";
import type { FrameShelfState } from "./frame-protocol";
import { createImporter, type ImportReport, type ImportState, type Importer } from "./import";
import { createShelfService } from "./library";
import { SHELF_PAGE_ID, followReturnTarget, leaveReading } from "./runtime";
import { createReaderSession, frameLabels, type ReaderSession } from "./session";
import {
  COLLECTIONS_KEY,
  DEFAULT_SHELF_VIEW,
  SHELF_KEY,
  SHELF_VIEW_KEY,
  bookmarksKey,
  clampShelfView,
  highlightsKey,
  positionKey,
  type DocumentFormat,
  type ShelfEntry,
  type ShelfViewSettings,
} from "./shelf";
import {
  deflatedArchive,
  epubBytes,
  inflateRaw,
  pdfBytes,
  readerManifest,
  shelfEntry,
} from "./test-support";

/** The Worker the session starts for pdf.js's core, recording what it was told. */
class RecordedWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  constructor(
    readonly url: string,
    readonly options?: WorkerOptions
  ) {
    workers.push(this);
  }
}

const workers: RecordedWorker[] = [];

/** A storage Map the test can make throw mid-session, so a failure path runs. */
class FailingStorage extends Map<string, unknown> {
  failing = false;
  /** Every value written to the Shelf key, so a test can prove none happened. */
  shelfWrites: unknown[] = [];

  get(key: string): unknown {
    if (this.failing) throw new Error("storage is down");
    return super.get(key);
  }

  set(key: string, value: unknown): this {
    // The Map constructor calls set() before this class's fields initialize,
    // so the log is created lazily; the field then resets it to empty, which
    // keeps the seeded entries out of it.
    if (key === SHELF_KEY) {
      this.shelfWrites ??= [];
      this.shelfWrites.push(value);
    }
    return super.set(key, value);
  }
}

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal("Worker", RecordedWorker);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => `blob:reader-${workers.length}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

interface Harness {
  host: ReturnType<typeof createTestHost>;
  storage: Map<string, unknown>;
  client: ReturnType<typeof createPluginClient>;
  library: ReturnType<typeof createShelfService>;
  session: ReaderSession;
  /** Every message the Frame end received, in order. */
  messages: Record<string, unknown>[];
  /** Sends one Frame -> Worker message. */
  send(message: unknown): void;
  /**
   * Every Frame -> Worker message the session's handler has been handed, in
   * order: recorded by a listener added after the session's own, so it runs
   * after the session's on each delivery.
   */
  delivered: Record<string, unknown>[];
  navigateToShelf: ReturnType<typeof vi.fn>;
  /** Handed the Document the author opens or picks from the Shelf. */
  openEntry: ReturnType<typeof vi.fn>;
  /** Told which view the session switched to. */
  onViewChange: ReturnType<typeof vi.fn>;
  stop(): Promise<void>;
}

function setup(
  options: {
    entry?: ShelfEntry | null;
    language?: string;
    storage?: Map<string, unknown>;
    navigateToShelf?: () => Promise<void> | void;
    onDispose?: () => void;
    /** The place the host's Back returns to; null while the page has none. */
    returnLabel?: () => string | null;
    /** The view the Frame mounted on. */
    view?: "shelf" | "document";
    /** Whether Back returns to the Shelf inside the Frame. */
    shelfInFrame?: boolean;
    /** Handed a Document the author opens or picks from the Shelf. */
    openEntry?: (entry: ShelfEntry) => Promise<void> | void;
    /** Told which view the session switched to. */
    onViewChange?: (view: "shelf" | "document") => void;
    /** The Worker's background Import; built from the harness's client when "real". */
    importer?: Importer | "real";
    importThrottleMs?: number;
    coverJobTimeoutMs?: number;
  } = {}
): Harness {
  const storage = options.storage ?? new Map<string, unknown>();
  const host = createTestHost({ manifest: readerManifest(), storage });
  const client = createPluginClient(host.port);
  const library = createShelfService(client);
  const channel = new MessageChannel();
  /** @type {Record<string, unknown>[]} */
  const messages: Record<string, unknown>[] = [];
  channel.port2.onmessage = (event: MessageEvent) => {
    messages.push(event.data as Record<string, unknown>);
  };
  const navigateToShelf = vi.fn(options.navigateToShelf ?? (async () => {}));
  const openEntry = vi.fn(options.openEntry ?? (async () => {}));
  const onViewChange = vi.fn(options.onViewChange ?? (() => {}));
  const session = createReaderSession({
    client,
    library,
    entry: options.entry ?? null,
    language: options.language ?? "en",
    port: channel.port1,
    navigateToShelf,
    onDispose: options.onDispose,
    returnLabel: options.returnLabel ?? (() => null),
    view: options.view,
    shelfInFrame: options.shelfInFrame,
    openEntry,
    onViewChange,
    importer: options.importer === "real" ? createImporter({ client, library }) : options.importer,
    importThrottleMs: options.importThrottleMs,
    coverJobTimeoutMs: options.coverJobTimeoutMs,
  });
  session.start();
  const delivered: Record<string, unknown>[] = [];
  channel.port1.addEventListener("message", (event: MessageEvent) => {
    delivered.push(event.data as Record<string, unknown>);
  });
  return {
    host,
    storage,
    client,
    library,
    session,
    messages,
    delivered,
    send(message: unknown) {
      channel.port2.postMessage(message);
    },
    navigateToShelf,
    openEntry,
    onViewChange,
    async stop() {
      session.dispose();
      channel.port2.close();
      await host.stop();
    },
  };
}

/** An Importer the test drives by hand: `emit` changes its state and tells the session. */
function stubImporter(initial: ImportState | null = null) {
  let state = initial;
  const listeners = new Set<(state: ImportState | null) => void>();
  return {
    get state() {
      return state;
    },
    start: vi.fn(() => true),
    cancel: vi.fn(),
    dismiss: vi.fn(),
    resolve: vi.fn(async () => true),
    idle: async () => {},
    subscribe(listener: (state: ImportState | null) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(next: ImportState | null) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    listeners,
  };
}

/** A folder Import's report with `processed` of `found` files sorted, all added. */
function importReport(processed: number, found = 10): ImportReport {
  return {
    source: { kind: "folder", name: "Library" },
    found,
    processed,
    added: Array.from({ length: processed }, (_, index) => `book-${index}.epub`),
    alreadyOnShelf: [],
    relinked: [],
    unreadable: [],
    collisions: [],
    duplicates: 0,
    cancelled: false,
  };
}

/** Every `import` message the Frame received, in order. */
function importMessages(harness: Harness): Record<string, unknown>[] {
  return harness.messages.filter((message) => message.kind === "import");
}

/** The first message of `kind`, waiting until it arrives. */
async function messageOf(harness: Harness, kind: string): Promise<Record<string, unknown>> {
  await vi.waitFor(() => {
    expect(harness.messages.some((message) => message.kind === kind)).toBe(true);
  });
  return harness.messages.find((message) => message.kind === kind) as Record<string, unknown>;
}

/** Waits until the session has opened the Frame (so later sends are handled). */
async function opened(harness: Harness): Promise<Record<string, unknown>> {
  harness.send({ kind: "ready" });
  return messageOf(harness, "open");
}

/** A Shelf row whose File Grant the host holds, so a state refresh finds it readable. */
async function liveShelfEntry(
  harness: Harness,
  overrides: Partial<ShelfEntry> & Pick<ShelfEntry, "id">
): Promise<ShelfEntry> {
  harness.host.files.queuePick({
    name: `${overrides.title ?? overrides.id}.pdf`,
    bytes: pdfBytes(overrides.id),
  });
  const picked = await harness.client.files.pick({ extensions: ["pdf"], multiple: false });
  if (picked === null) throw new Error("the pick was refused");
  return shelfEntry({ ...overrides, grant: picked.grant });
}

describe("frameLabels", () => {
  it("names the Shelf when the host has no return target", () => {
    expect(frameLabels("en").back).toBe("Back to Shelf");
    expect(frameLabels("en", null).back).toBe("Back to Shelf");
    expect(frameLabels("es", null).back).toBe("Volver al estante");
  });

  it("names the place the host's Back returns to when there is one", () => {
    expect(frameLabels("en", "Plot").back).toBe("Back to Plot");
    expect(frameLabels("es", "Trama").back).toBe("Volver a Trama");
  });
});

describe("open", () => {
  it("sends the Document, its Reading Position, the settings, and localized labels", async () => {
    const entry = shelfEntry({
      id: "doc-1",
      grant: "grant-1",
      fingerprint: "1234:abcdef",
      title: "Dune",
      author: "Frank Herbert",
    });
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [entry]],
      [positionKey("doc-1"), { kind: "page", page: 3, zoom: "page" }],
    ]);
    const harness = setup({ entry, language: "es", storage });
    try {
      const open = await opened(harness);
      expect(open).toMatchObject({
        kind: "open",
        position: { kind: "page", page: 3, zoom: "page" },
        settings: { fontSize: 100, lineWidth: "medium", pdfFit: "width" },
        size: 1234,
        language: "es",
      });
      expect(open.entry).toEqual({
        id: "doc-1",
        title: "Dune",
        author: "Frank Herbert",
        format: "pdf",
      });
      expect(open.entry).not.toHaveProperty("grant");
      expect(open.entry).not.toHaveProperty("fingerprint");
      const labels = open.labels as Record<string, string>;
      expect(labels.back).toBe("Volver al estante");
      expect(labels.errorCorrupt).toContain("PDF");
      const pdf = open.pdf as { displaySource: string; css: string };
      expect(pdf.displaySource.length).toBeGreaterThan(100_000);
      expect(pdf.css).toContain(".textLayer");
      expect(open.pdfPort).toBeInstanceOf(MessagePort);
    } finally {
      await harness.stop();
    }
  });

  it("sends no pdf resources for a Document that is not a PDF", async () => {
    const entry = shelfEntry({ id: "doc-2", grant: "grant-2", format: "epub" });
    const harness = setup({ entry });
    try {
      const open = await opened(harness);
      expect(open.pdf).toBeUndefined();
      expect(open.pdfPort).toBeUndefined();
      expect(workers).toHaveLength(0);
    } finally {
      await harness.stop();
    }
  });

  it("opens with nothing when no Document is selected", async () => {
    const harness = setup();
    try {
      const open = await opened(harness);
      expect(open.entry).toBeNull();
      expect(open.position).toBeNull();
      expect(open.size).toBe(0);
    } finally {
      await harness.stop();
    }
  });

  it("carries a wire-safe Shelf state and labels with every open", async () => {
    const entry = shelfEntry({
      id: "doc-1",
      grant: "grant-1",
      fingerprint: "1234:abcdef",
      title: "Dune",
    });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, language: "es", storage });
    try {
      const open = await opened(harness);
      expect(open.view).toBe("document");
      const shelf = open.shelf as { status: string; entries: Record<string, unknown>[] };
      expect(shelf.status).toBe("ready");
      expect(shelf.entries).toHaveLength(1);
      expect(shelf.entries[0]).toMatchObject({ id: "doc-1", title: "Dune", format: "pdf" });
      const wire = JSON.stringify(open.shelf);
      expect(wire).not.toContain("grant-1");
      expect(wire).not.toContain("1234:abcdef");
      expect((open.shelfLabels as Record<string, string>).shelf).toBe("Estante");
      expect((open.shelfLabels as Record<string, string>).emptyTitle).toBe("Tu estante está vacío");
    } finally {
      await harness.stop();
    }
  });

  it("opens on the Shelf with a loading state, then refreshes every File Grant", async () => {
    const storage = new Map<string, unknown>();
    const harness = setup({ view: "shelf", storage });
    const readable = await liveShelfEntry(harness, { id: "doc-1", title: "Dune" });
    const lost = await liveShelfEntry(harness, { id: "doc-2", title: "Emma" });
    storage.set(SHELF_KEY, [readable, lost]);
    harness.host.files.setMissing(lost.grant);
    try {
      const open = await opened(harness);
      expect(open.view).toBe("shelf");
      expect(open.entry).toBeNull();
      expect(open.shelf).toEqual({ status: "loading", entries: [] });

      const shelf = await messageOf(harness, "shelf");
      const state = shelf.state as { status: string; entries: Record<string, unknown>[] };
      expect(state.status).toBe("ready");
      expect(state.entries.find((row) => row.id === "doc-2")).toMatchObject({
        state: "missing",
        statusText: "Missing",
      });
      expect(state.entries.find((row) => row.id === "doc-1")).toMatchObject({ state: "ok" });
    } finally {
      await harness.stop();
    }
  });
});

describe("shelf", () => {
  it("opens the Document the Shelf selected", async () => {
    const storage = new Map<string, unknown>();
    const harness = setup({ view: "shelf", storage });
    const entry = await liveShelfEntry(harness, { id: "doc-1", title: "Dune" });
    storage.set(SHELF_KEY, [entry]);
    try {
      await opened(harness);
      harness.send({ kind: "shelf-select", documentId: "doc-1" });
      harness.send({ kind: "shelf-command", id: "openDocument" });
      await vi.waitFor(() => expect(harness.openEntry).toHaveBeenCalledTimes(1));
      expect(harness.openEntry.mock.calls[0][0]).toMatchObject({
        id: "doc-1",
        title: "Dune",
        format: "pdf",
      });
    } finally {
      await harness.stop();
    }
  });

  it("opens the Document a Shelf command names", async () => {
    const storage = new Map<string, unknown>();
    const harness = setup({ view: "shelf", storage });
    const first = await liveShelfEntry(harness, { id: "doc-1" });
    const second = await liveShelfEntry(harness, { id: "doc-2", title: "Emma" });
    storage.set(SHELF_KEY, [first, second]);
    try {
      await opened(harness);
      harness.send({ kind: "shelf-command", id: "openDocument", documentId: "doc-2" });
      await vi.waitFor(() => expect(harness.openEntry).toHaveBeenCalledTimes(1));
      expect(harness.openEntry.mock.calls[0][0]).toMatchObject({ id: "doc-2", title: "Emma" });
    } finally {
      await harness.stop();
    }
  });

  it("sends the real counts with the Remove from Shelf copy", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", title: "Dune" });
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [entry]],
      [bookmarksKey("doc-1"), [{ id: "b1" }, { id: "b2" }]],
      [highlightsKey("doc-1"), [{ id: "h1", note: "A thought" }, { id: "h2" }]],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      harness.send({ kind: "shelf-command", id: "removeFromShelf", documentId: "doc-1" });
      const message = await messageOf(harness, "remove-counts");
      expect(message).toEqual({
        kind: "remove-counts",
        documentId: "doc-1",
        title: 'Remove "Dune" from the Shelf?',
        body: "Its 2 Bookmarks and 2 Highlights (1 with note) are deleted too.",
        stats: "Reading Stats are kept. The file stays on your device.",
      });
    } finally {
      await harness.stop();
    }
  });

  it("removes the Document, its own keys, and republishes the Shelf", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [entry]],
      [positionKey("doc-1"), { kind: "page", page: 2, zoom: 1 }],
      [bookmarksKey("doc-1"), [{ id: "b1" }]],
      [highlightsKey("doc-1"), [{ id: "h1" }]],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      harness.send({ kind: "shelf-remove", documentId: "doc-1" });
      await vi.waitFor(() => expect(storage.get(SHELF_KEY)).toEqual([]));
      expect(storage.get(positionKey("doc-1"))).toBeUndefined();
      expect(storage.get(bookmarksKey("doc-1"))).toBeUndefined();
      expect(storage.get(highlightsKey("doc-1"))).toBeUndefined();
      await vi.waitFor(() => {
        const states = harness.messages.filter((message) => message.kind === "shelf");
        expect(states).toHaveLength(2);
        expect(states[1].state).toEqual({ status: "ready", entries: [], collections: [] });
      });
    } finally {
      await harness.stop();
    }
  });

  it("keeps a Missing Document when Locate picks a different file", async () => {
    const entry = shelfEntry({
      id: "doc-1",
      grant: "grant-1",
      fingerprint: "original:fingerprint",
      state: "missing",
    });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      harness.host.files.queuePick({ name: "Other.pdf", bytes: pdfBytes("Another Document") });
      harness.send({ kind: "shelf-command", id: "locateDocument", documentId: "doc-1" });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe(
        "That file is a different Document. Reader kept the Missing Document on your Shelf."
      );
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0]).toMatchObject({
        id: "doc-1",
        grant: "grant-1",
        fingerprint: "original:fingerprint",
        state: "missing",
      });
    } finally {
      await harness.stop();
    }
  });

  it("stays quiet when the author cancels Locate", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", state: "missing" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      harness.send({ kind: "shelf-command", id: "locateDocument", documentId: "doc-1" });
      await vi.waitFor(() =>
        expect(harness.messages.filter((message) => message.kind === "shelf")).toHaveLength(2)
      );
      expect(harness.messages.some((message) => message.kind === "shelf-result")).toBe(false);
    } finally {
      await harness.stop();
    }
  });

  it("names a Document Locate can no longer find", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", state: "missing" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      storage.set(SHELF_KEY, []);
      harness.host.files.queuePick({ name: "Other.pdf", bytes: pdfBytes("Another Document") });
      harness.send({ kind: "shelf-command", id: "locateDocument", documentId: "doc-1" });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe("Reader couldn't find that Document on your Shelf.");
    } finally {
      await harness.stop();
    }
  });

  it("reports a failed Locate as a Locate failure, not an open failure", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", state: "missing" });
    const storage = new FailingStorage([[SHELF_KEY, [entry]]]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      storage.failing = true;
      harness.send({ kind: "shelf-command", id: "locateDocument", documentId: "doc-1" });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe("Reader couldn't reattach that Document.");
    } finally {
      await harness.stop();
    }
  });

  it("shows the Shelf's error state when a failed read precedes the Remove", async () => {
    const storage = new FailingStorage([
      [SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]],
    ]);
    storage.failing = true;
    const harness = setup({ view: "shelf", storage });
    try {
      const open = await opened(harness);
      expect(open.shelf).toEqual({ status: "loading", entries: [] });
      // The refresh that follows the open is what could not read the shelf.
      await vi.waitFor(() => {
        const states = harness.messages.filter((message) => message.kind === "shelf");
        expect(states.at(-1)?.state).toEqual({ status: "error", entries: [] });
      });
      harness.send({ kind: "shelf-remove", documentId: "doc-1" });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe("Reader couldn't remove that Document.");
      // A removal that could not read the shelf never writes over it.
      expect(storage.shelfWrites).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("reports a failed removal as a removal failure, not an open failure", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const storage = new FailingStorage([[SHELF_KEY, [entry]]]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      storage.failing = true;
      harness.send({ kind: "shelf-remove", documentId: "doc-1" });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe("Reader couldn't remove that Document.");
    } finally {
      await harness.stop();
    }
  });

  it("shelves a picked file and opens it", async () => {
    const harness = setup({ view: "shelf" });
    try {
      await opened(harness);
      harness.host.files.queuePick({ name: "New.pdf", bytes: pdfBytes("New") });
      harness.send({ kind: "shelf-command", id: "openFile" });
      await vi.waitFor(() => expect(harness.openEntry).toHaveBeenCalledTimes(1));
      expect(harness.openEntry.mock.calls[0][0]).toMatchObject({
        title: "New",
        format: "pdf",
      });
    } finally {
      await harness.stop();
    }
  });
});

describe("Collections (#946)", () => {
  /** The last Shelf state the Frame was sent. */
  function lastShelf(harness: ReturnType<typeof setup>): FrameShelfState {
    const states = harness.messages.filter((message) => message.kind === "shelf");
    return states[states.length - 1]?.state as FrameShelfState;
  }

  it("publishes the Collections with the Shelf, and each row's Collection ids", async () => {
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]],
      [COLLECTIONS_KEY, [{ id: "col-1", name: "Research", documentIds: ["doc-1"] }]],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      const state = lastShelf(harness);
      expect(state.collections).toEqual([{ id: "col-1", name: "Research" }]);
      expect(state.entries[0].collections).toEqual(["col-1"]);
    } finally {
      await harness.stop();
    }
  });

  it("creates a Collection, files the Document, and republishes the Shelf", async () => {
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      harness.send({
        kind: "shelf-collection",
        action: "create",
        name: "  To read ",
        documentId: "doc-1",
      });
      await vi.waitFor(() =>
        expect(lastShelf(harness).collections).toEqual([
          { id: expect.any(String), name: "To read" },
        ])
      );
      const [stored] = storage.get(COLLECTIONS_KEY) as { id: string; documentIds: string[] }[];
      expect(stored.documentIds).toEqual(["doc-1"]);
      expect(lastShelf(harness).entries[0].collections).toEqual([stored.id]);
    } finally {
      await harness.stop();
    }
  });

  it("renames, unfiles, and deletes a Collection, republishing after each", async () => {
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]],
      [COLLECTIONS_KEY, [{ id: "col-1", name: "Research", documentIds: ["doc-1"] }]],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      harness.send({
        kind: "shelf-collection",
        action: "rename",
        collectionId: "col-1",
        name: "Notes",
      });
      await vi.waitFor(() =>
        expect(lastShelf(harness).collections).toEqual([{ id: "col-1", name: "Notes" }])
      );
      harness.send({
        kind: "shelf-collection",
        action: "file",
        collectionId: "col-1",
        documentId: "doc-1",
        member: false,
      });
      await vi.waitFor(() => expect(lastShelf(harness).entries[0].collections).toBeUndefined());
      harness.send({
        kind: "shelf-collection",
        action: "file",
        collectionId: "col-1",
        documentId: "doc-1",
        member: true,
      });
      await vi.waitFor(() => expect(lastShelf(harness).entries[0].collections).toEqual(["col-1"]));
      harness.send({ kind: "shelf-collection", action: "delete", collectionId: "col-1" });
      await vi.waitFor(() => expect(lastShelf(harness).collections).toEqual([]));
      expect(storage.get(COLLECTIONS_KEY)).toEqual([]);
      expect(lastShelf(harness).entries).toHaveLength(1);
    } finally {
      await harness.stop();
    }
  });

  it("reports a refused Collection write and leaves the Collections as they were", async () => {
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]],
      [
        COLLECTIONS_KEY,
        [
          { id: "col-1", name: "Research", documentIds: [] },
          { id: "col-2", name: "Notes", documentIds: [] },
        ],
      ],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      harness.send({
        kind: "shelf-collection",
        action: "rename",
        collectionId: "col-2",
        name: "research",
      });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe("Reader couldn't save that Collection.");
      expect((storage.get(COLLECTIONS_KEY) as { name: string }[]).map((c) => c.name)).toEqual([
        "Research",
        "Notes",
      ]);
    } finally {
      await harness.stop();
    }
  });

  it("still draws the Shelf when the Collections can't be read", async () => {
    class CollectionsDown extends Map<string, unknown> {
      get(key: string): unknown {
        if (key === COLLECTIONS_KEY) throw new Error("storage is down");
        return super.get(key);
      }
    }
    const storage = new CollectionsDown([
      [SHELF_KEY, [shelfEntry({ id: "doc-1", grant: "grant-1" })]],
    ]);
    const harness = setup({ view: "shelf", storage });
    try {
      await opened(harness);
      await messageOf(harness, "shelf");
      await vi.waitFor(() => expect(lastShelf(harness).status).toBe("ready"));
      expect(lastShelf(harness).collections).toEqual([]);
      expect(lastShelf(harness).entries).toHaveLength(1);
    } finally {
      await harness.stop();
    }
  });
});

describe("read", () => {
  /** A live File Grant over `bytes`, and a Shelf row that names it. */
  async function pickFile(harness: Harness, bytes: Uint8Array): Promise<ShelfEntry> {
    harness.host.files.queuePick({ name: "Big.pdf", bytes });
    const picked = await harness.client.files.pick({ extensions: ["pdf"], multiple: false });
    if (picked === null) throw new Error("the pick was refused");
    return shelfEntry({
      id: "doc-1",
      grant: picked.grant,
      fingerprint: `${bytes.length}:test`,
      title: "Big",
    });
  }

  it("answers a read in chunks no larger than the API allows", async () => {
    const bytes = new Uint8Array(FILE_READ_MAX_BYTES + 10);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const harness = setup();
    try {
      const entry = await pickFile(harness, bytes);
      const read = vi.spyOn(harness.client.files, "read");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "read", id: 1, offset: 0, length: bytes.length });
      const answer = await messageOf(harness, "bytes");
      expect(answer.id).toBe(1);
      const buffer = new Uint8Array(answer.buffer as ArrayBuffer);
      expect(buffer.byteLength).toBe(bytes.length);
      expect(Array.from(buffer.slice(0, 4))).toEqual(Array.from(bytes.slice(0, 4)));
      expect(Array.from(buffer.slice(-4))).toEqual(Array.from(bytes.slice(-4)));
      expect(read).toHaveBeenCalledTimes(2);
      for (const call of read.mock.calls) {
        const args = call[0] as { length: number };
        expect(args.length).toBeLessThanOrEqual(FILE_READ_MAX_BYTES);
      }
    } finally {
      await harness.stop();
    }
  });

  it("maps a refused read to file-missing", async () => {
    const harness = setup();
    try {
      const entry = await pickFile(harness, new Uint8Array([1, 2, 3, 4]));
      harness.session.setEntry(entry);
      await opened(harness);
      harness.host.files.setMissing(entry.grant);
      harness.send({ kind: "read", id: 7, offset: 0, length: 4 });
      const answer = await messageOf(harness, "read-error");
      expect(answer).toMatchObject({ kind: "read-error", id: 7, code: "file-missing" });
    } finally {
      await harness.stop();
    }
  });
});

describe("archive", () => {
  /** A live File Grant over a committed fixture, and a Shelf row that names it. */
  async function pickFixture(
    harness: Harness,
    fixture: string,
    format: DocumentFormat = "epub",
    { deflated = false }: { deflated?: boolean } = {}
  ): Promise<ShelfEntry> {
    const stored = new Uint8Array(readFileSync(join(__dirname, "fixtures", fixture)));
    const bytes = deflated ? deflatedArchive(stored) : stored;
    harness.host.files.queuePick({ name: fixture, bytes });
    const picked = await harness.client.files.pick({
      extensions: [format],
      multiple: false,
    });
    if (picked === null) throw new Error("the pick was refused");
    return shelfEntry({
      id: "doc-1",
      grant: picked.grant,
      fingerprint: `${bytes.length}:test`,
      title: "Fixture",
      format,
    });
  }

  it("lists the archive's entries after opening it once", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "flowing.epub");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "zip-list", id: 1 });
      const list = await messageOf(harness, "zip-list");
      expect(list.id).toBe(1);
      const entries = list.entries as { name: string; size: number }[];
      expect(entries.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "META-INF/container.xml",
          "OEBPS/chapter1.xhtml",
          "OEBPS/images/cover.png",
        ])
      );
      const container = entries.find(({ name }) => name === "META-INF/container.xml");
      expect(container?.size).toBeGreaterThan(0);
    } finally {
      await harness.stop();
    }
  });

  // The Worker passes the bytes on as stored, so a large image or a long
  // chapter never holds it past the heartbeat; the Frame inflates and decodes
  // them natively.
  it("transfers an entry as the archive stores it and leaves inflating to the Frame", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "flowing.epub", "epub", { deflated: true });
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "zip-entry", id: 2, name: "OEBPS/chapter1.xhtml" });
      const chapter = await messageOf(harness, "zip-data");
      expect(chapter.id).toBe(2);
      expect(chapter.deflated).toBe(true);
      expect(chapter.text).toBeUndefined();
      const stored = new Uint8Array(chapter.buffer as ArrayBuffer);
      expect(new TextDecoder().decode(stored)).not.toContain("The spice must flow");
      expect(new TextDecoder().decode(await inflateRaw(stored))).toContain("The spice must flow");

      harness.send({ kind: "zip-entry", id: 3, name: "OEBPS/images/cover.png" });
      await vi.waitFor(() =>
        expect(harness.messages.filter((message) => message.kind === "zip-data")).toHaveLength(2)
      );
      const image = harness.messages.filter((message) => message.kind === "zip-data")[1];
      expect(image.id).toBe(3);
      const bytes = new Uint8Array(image.buffer as ArrayBuffer);
      expect(image.deflated).toBe(true);
      expect((await inflateRaw(bytes)).byteLength).toBe(83);
    } finally {
      await harness.stop();
    }
  });

  it("answers an entry the archive does not hold with a missing zip-error", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "flowing.epub");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "zip-entry", id: 4, name: "OEBPS/nothing.xhtml" });
      const error = await messageOf(harness, "zip-error");
      expect(error).toMatchObject({ kind: "zip-error", id: 4, code: "missing" });
    } finally {
      await harness.stop();
    }
  });

  it("answers a damaged archive with a corrupt zip-error", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "corrupt.epub");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "zip-list", id: 5 });
      const error = await messageOf(harness, "zip-error");
      expect(error).toMatchObject({ kind: "zip-error", id: 5, code: "corrupt" });
    } finally {
      await harness.stop();
    }
  });

  it("answers an archive whose content is encrypted with a drm zip-error", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "encrypted.epub");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "zip-list", id: 6 });
      const error = await messageOf(harness, "zip-error");
      expect(error).toMatchObject({ kind: "zip-error", id: 6, code: "drm" });
    } finally {
      await harness.stop();
    }
  });
});

describe("position", () => {
  it("stores the Reading Position and folds progress and lastReadAt into the Shelf", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", lastReadAt: 1_000 });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      harness.send({
        kind: "position",
        position: { kind: "page", page: 5, zoom: 1.25 },
        progress: { page: 6, pageCount: 12 },
      });
      await vi.waitFor(() => {
        expect(storage.get(positionKey("doc-1"))).toEqual({
          kind: "page",
          page: 5,
          zoom: 1.25,
        });
      });
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0].progress).toEqual({ page: 6, pageCount: 12 });
      expect(shelf[0].lastReadAt).toBeGreaterThan(1_000);
      expect(harness.messages.some((message) => message.kind === "position")).toBe(false);
    } finally {
      await harness.stop();
    }
  });
  it("saves a Reading Position queued before a switch under the Document it was read in", async () => {
    const first = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const second = shelfEntry({ id: "doc-2", grant: "grant-2", title: "Emma" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [first, second]]]);
    const harness = setup({ entry: first, storage });
    try {
      await opened(harness);
      // The save stalls, so a drop switches the Frame to another Document while
      // the old Document's position is still being written.
      const set = harness.client.storage.set.bind(harness.client.storage);
      let release: () => void = () => {};
      const stalled = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = vi.spyOn(harness.client.storage, "set").mockImplementationOnce(async (params) => {
        await stalled;
        return set(params);
      });
      harness.send({
        kind: "position",
        position: { kind: "page", page: 7, zoom: 1 },
        progress: { page: 8, pageCount: 12 },
      });
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      harness.session.setEntry(second);
      release();
      await vi.waitFor(() =>
        expect(storage.get(positionKey("doc-1"))).toEqual({ kind: "page", page: 7, zoom: 1 })
      );
      expect(storage.get(positionKey("doc-2"))).toBeUndefined();
      // The Frame now reads the new Document, and its position stays with it.
      harness.send({
        kind: "position",
        position: { kind: "page", page: 2, zoom: 1 },
        progress: { page: 3, pageCount: 12 },
      });
      await vi.waitFor(() =>
        expect(storage.get(positionKey("doc-2"))).toEqual({ kind: "page", page: 2, zoom: 1 })
      );
      expect(storage.get(positionKey("doc-1"))).toEqual({ kind: "page", page: 7, zoom: 1 });
    } finally {
      await harness.stop();
    }
  });

  it("stamps finishedAt at the first save that reaches the last page, and keeps that stamp", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", lastReadAt: 1_000 });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000);
    try {
      await opened(harness);
      harness.send({
        kind: "position",
        position: { kind: "page", page: 12, zoom: 1 },
        progress: { fraction: 0.995 },
      });
      await vi.waitFor(() => {
        expect((storage.get(SHELF_KEY) as ShelfEntry[])[0].finishedAt).toBe(5_000);
      });
      now.mockReturnValue(9_000);
      harness.send({
        kind: "position",
        position: { kind: "page", page: 3, zoom: 1 },
        progress: { page: 3, pageCount: 12 },
      });
      await vi.waitFor(() => {
        expect((storage.get(SHELF_KEY) as ShelfEntry[])[0].progress).toEqual({
          page: 3,
          pageCount: 12,
        });
      });
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0].finishedAt).toBe(5_000);
      expect(shelf[0].lastReadAt).toBe(9_000);
    } finally {
      now.mockRestore();
      await harness.stop();
    }
  });
});

describe("shelf view", () => {
  /** A Shelf view that differs from the default only by its search, so each write is told apart. */
  function view(search: string): ShelfViewSettings {
    return { ...DEFAULT_SHELF_VIEW, search };
  }

  /** Waits until the session has been handed `count` shelf-view messages. */
  async function viewsDelivered(harness: Harness, count: number): Promise<void> {
    await vi.waitFor(() =>
      expect(harness.delivered.filter((message) => message.kind === "shelf-view")).toHaveLength(
        count
      )
    );
  }

  it("opens the Shelf with the view the author left it in", async () => {
    const stored = {
      layout: "list",
      coverSize: "small",
      sort: "title",
      descending: false,
      formats: ["epub"],
      statuses: ["finished"],
      search: "Dune",
    };
    const storage = new Map<string, unknown>([[SHELF_VIEW_KEY, stored]]);
    const harness = setup({ view: "shelf", storage });
    try {
      const open = await opened(harness);
      expect(open.shelfView).toEqual(clampShelfView(stored));
    } finally {
      await harness.stop();
    }
  });

  it("leaves the Shelf view out of a Document open", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const storage = new Map<string, unknown>([
      [SHELF_KEY, [entry]],
      [SHELF_VIEW_KEY, view("Dune")],
    ]);
    const harness = setup({ entry, storage });
    try {
      const open = await opened(harness);
      expect(open.view).toBe("document");
      expect(open).not.toHaveProperty("shelfView");
    } finally {
      await harness.stop();
    }
  });

  it("writes the newest view once the held write settles, at most two writes for a burst", async () => {
    const storage = new Map<string, unknown>();
    const harness = setup({ view: "shelf", storage });
    const set = harness.client.storage.set.bind(harness.client.storage);
    let viewWrites = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(harness.client.storage, "set").mockImplementation(async (params) => {
      if (params.key === SHELF_VIEW_KEY) {
        viewWrites += 1;
        // Only the first view write is held; the rest run straight through.
        if (viewWrites === 1) await gate;
      }
      return set(params);
    });
    try {
      await opened(harness);
      harness.send({ kind: "shelf-view", settings: view("first") });
      await vi.waitFor(() => expect(viewWrites).toBe(1));
      for (const search of ["second", "third", "fourth", "fifth"]) {
        harness.send({ kind: "shelf-view", settings: view(search) });
      }
      // All four reach the session while the first write is held, so they
      // coalesce into the one write that follows it.
      await viewsDelivered(harness, 5);
      release();
      await vi.waitFor(() => expect(storage.get(SHELF_VIEW_KEY)).toEqual(view("fifth")));
      expect(viewWrites).toBe(2);
      expect(storage.get(SHELF_VIEW_KEY)).toEqual(view("fifth"));
    } finally {
      spy.mockRestore();
      await harness.stop();
    }
  });

  it("swallows a failed write without a message to the Frame, and still writes the next view", async () => {
    const storage = new Map<string, unknown>();
    const harness = setup({ view: "shelf", storage });
    const set = harness.client.storage.set.bind(harness.client.storage);
    let failNext = true;
    const spy = vi.spyOn(harness.client.storage, "set").mockImplementation(async (params) => {
      if (params.key === SHELF_VIEW_KEY && failNext) {
        failNext = false;
        throw new Error("storage is down");
      }
      return set(params);
    });
    try {
      await opened(harness);
      harness.send({ kind: "shelf-view", settings: view("first") });
      await vi.waitFor(() => expect(failNext).toBe(false));
      expect(storage.has(SHELF_VIEW_KEY)).toBe(false);
      harness.send({ kind: "shelf-view", settings: view("second") });
      await vi.waitFor(() => expect(storage.get(SHELF_VIEW_KEY)).toEqual(view("second")));
      expect(harness.messages.some((message) => message.kind === "shelf-result")).toBe(false);
    } finally {
      spy.mockRestore();
      await harness.stop();
    }
  });
});

describe("meta", () => {
  it("fills the Document's own title, author, cover, and page count once", async () => {
    const entry = shelfEntry({
      id: "doc-1",
      grant: "grant-1",
      title: "Dune",
      progress: { page: 1, pageCount: 1 },
    });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      harness.send({
        kind: "meta",
        title: "Dune (1965)",
        author: "Frank Herbert",
        pageCount: 12,
        coverDataUrl: "data:image/jpeg;base64,AAAA",
      });
      await vi.waitFor(() => {
        const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
        expect(shelf[0].coverDataUrl).toBe("data:image/jpeg;base64,AAAA");
      });
      let shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0]).toMatchObject({
        title: "Dune (1965)",
        author: "Frank Herbert",
        progress: { page: 1, pageCount: 12 },
      });
      harness.send({ kind: "meta", title: "Another title" });
      // Messages are handled in order: once the later position lands, the
      // ignored meta before it has been handled too.
      harness.send({
        kind: "position",
        position: { kind: "page", page: 2, zoom: 1 },
        progress: { page: 3, pageCount: 12 },
      });
      await vi.waitFor(() => expect(storage.get(positionKey("doc-1"))).toBeDefined());
      shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0].title).toBe("Dune (1965)");
    } finally {
      await harness.stop();
    }
  });

  it("keeps a cover the Shelf already has", async () => {
    const entry = shelfEntry({
      id: "doc-1",
      grant: "grant-1",
      coverDataUrl: "data:image/jpeg;base64,OLD",
    });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      harness.send({ kind: "meta", coverDataUrl: "data:image/jpeg;base64,NEW" });
      // Messages are handled in order: once the later position lands, the
      // ignored meta before it has been handled too.
      harness.send({
        kind: "position",
        position: { kind: "page", page: 2, zoom: 1 },
        progress: { page: 3, pageCount: 12 },
      });
      await vi.waitFor(() => expect(storage.get(positionKey("doc-1"))).toBeDefined());
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0].coverDataUrl).toBe("data:image/jpeg;base64,OLD");
    } finally {
      await harness.stop();
    }
  });
});

describe("load-error", () => {
  it("marks the Shelf row unreadable with the Frame's reason", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", state: "ok" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      harness.send({ kind: "load-error", code: "corrupt", reason: "This PDF is damaged." });
      await vi.waitFor(() => {
        const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
        expect(shelf[0]).toMatchObject({ state: "unreadable", reason: "This PDF is damaged." });
      });
    } finally {
      await harness.stop();
    }
  });

  it("leaves a timed-out Document openable, so the author can retry", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", state: "ok" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      harness.send({
        kind: "load-error",
        code: "timeout",
        reason: "This file took too long to open. Try again.",
      });
      // A later message lands after the timeout was handled, so this proves the
      // timeout wrote nothing.
      harness.send({
        kind: "position",
        position: { kind: "page", page: 2, zoom: 1 },
        progress: { page: 3, pageCount: 12 },
      });
      await vi.waitFor(() => expect(storage.get(positionKey("doc-1"))).toBeDefined());
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf[0]).toMatchObject({ state: "ok" });
      expect(shelf[0].reason).toBeUndefined();
    } finally {
      await harness.stop();
    }
  });
});

describe("commands", () => {
  it("forwards a reading Command to the Frame", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ entry });
    try {
      await opened(harness);
      harness.session.command("nextPage");
      const command = await messageOf(harness, "command");
      expect(command).toEqual({ kind: "command", id: "nextPage" });
    } finally {
      await harness.stop();
    }
  });
});

describe("view switch", () => {
  it("does not post a Document open that a later switch overtook", async () => {
    const first = shelfEntry({ id: "doc-1", grant: "grant-1", title: "Dune" });
    const second = shelfEntry({ id: "doc-2", grant: "grant-2", title: "Emma" });
    const harness = setup({ entry: first });
    let release: () => void = () => {};
    try {
      const stalled = new Promise<void>((resolve) => {
        release = resolve;
      });
      const get = harness.client.appearance.get.bind(harness.client.appearance);
      let firstRead: ReturnType<typeof get> | undefined;
      const spy = vi.spyOn(harness.client.appearance, "get").mockImplementationOnce(() => {
        firstRead = (async () => {
          await stalled;
          return get({});
        })();
        return firstRead;
      });

      harness.send({ kind: "ready" });
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      harness.session.setEntry(second);
      await vi.waitFor(() => {
        const opens = harness.messages.filter((message) => message.kind === "open");
        expect(opens).toHaveLength(1);
      });
      release();
      // The stale read's own promise, with one reaction wrapped around it, settles
      // after the continuation that checks the open generation.
      await firstRead?.then(() => {});
      const opens = harness.messages.filter((message) => message.kind === "open");
      expect(opens).toHaveLength(1);
      expect(opens[0].entry).toMatchObject({ id: "doc-2", title: "Emma" });
    } finally {
      release();
      await harness.stop();
    }
  });
});

describe("appearance", () => {
  it("opens with Maibuk's appearance and forwards a change to the Frame", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ entry });
    // The runtime hands every mounted Frame the appearance the host serves.
    const off = await harness.client.on("appearance.changed", (payload) =>
      harness.session.setAppearance(payload)
    );
    try {
      const open = await opened(harness);
      expect(open.appearance).toEqual({ colorScheme: "light", eink: false });

      harness.host.setAppearance({ colorScheme: "dark", eink: true });
      await vi.waitFor(() => {
        const [last] = harness.messages
          .filter((message) => message.kind === "appearance")
          .slice(-1);
        expect(last).toEqual({
          kind: "appearance",
          appearance: { colorScheme: "dark", eink: true },
        });
      });
    } finally {
      off();
      await harness.stop();
    }
  });
});

describe("language", () => {
  it("sends refreshed Shelf labels when the app language changes", async () => {
    const harness = setup({ view: "shelf" });
    try {
      await opened(harness);
      harness.session.setLanguage("es");
      const message = await messageOf(harness, "language");
      expect((message.labels as Record<string, string>).back).toBe("Volver al estante");
      expect((message.shelfLabels as Record<string, string>).shelf).toBe("Estante");
      expect((message.shelfLabels as Record<string, string>).documentsCountOther).toBe(
        "{{count}} documentos"
      );
    } finally {
      await harness.stop();
    }
  });
});

describe("in-app back", () => {
  it("returns to the Shelf inside the Frame and keeps the session alive", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage, shelfInFrame: true });
    try {
      await opened(harness);
      expect(workers).toHaveLength(1);
      harness.send({ kind: "back" });
      await vi.waitFor(() =>
        expect(harness.messages.filter((message) => message.kind === "open")).toHaveLength(2)
      );
      const opens = harness.messages.filter((message) => message.kind === "open");
      expect(opens[1]).toMatchObject({
        kind: "open",
        view: "shelf",
        entry: null,
        position: null,
        size: 0,
      });
      expect(harness.session.disposed).toBe(false);
      expect(harness.navigateToShelf).not.toHaveBeenCalled();
      expect(harness.onViewChange).toHaveBeenCalledWith("shelf");
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    } finally {
      await harness.stop();
    }
  });

  it("switches to the Document view when a Document opens", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ view: "shelf" });
    try {
      await opened(harness);
      harness.session.setEntry(entry);
      await vi.waitFor(() => expect(harness.onViewChange).toHaveBeenCalledWith("document"));
      await vi.waitFor(() =>
        expect(harness.messages.filter((message) => message.kind === "open")).toHaveLength(2)
      );
      const opens = harness.messages.filter((message) => message.kind === "open");
      expect(opens[1]).toMatchObject({
        view: "document",
        entry: { id: "doc-1", format: "pdf" },
      });
    } finally {
      await harness.stop();
    }
  });
});

describe("back", () => {
  it("saves a pending Reading Position before leaving for the Shelf", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", lastReadAt: 1_000 });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({
      entry,
      storage,
      // The Shelf draws whatever storage holds when the session navigates.
      navigateToShelf: () => {
        expect(storage.get(positionKey("doc-1"))).toEqual({ kind: "page", page: 4, zoom: 1 });
        expect((storage.get(SHELF_KEY) as ShelfEntry[])[0].progress).toEqual({
          page: 4,
          pageCount: 12,
        });
      },
    });
    try {
      await opened(harness);
      harness.send({
        kind: "position",
        position: { kind: "page", page: 4, zoom: 1 },
        progress: { page: 4, pageCount: 12 },
      });
      harness.send({ kind: "back" });
      await vi.waitFor(() => expect(harness.navigateToShelf).toHaveBeenCalledTimes(1));
    } finally {
      await harness.stop();
    }
  });

  it("leaves for the Shelf and stops the nested pdf.js Worker", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ entry });
    try {
      await opened(harness);
      expect(workers).toHaveLength(1);
      harness.send({ kind: "back" });
      await vi.waitFor(() => expect(harness.navigateToShelf).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(harness.session.disposed).toBe(true));
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
      harness.session.command("nextPage");
      expect(harness.messages.some((message) => message.kind === "command")).toBe(false);
    } finally {
      await harness.stop();
    }
  });

  it("releases the Frame's pdf.js core and tells the runtime when the Frame closes", async () => {
    // Leaving by the sidebar removes the Frame without a Back: the Worker never
    // hears from it, so the Frame's own "closed" message must release the core.
    const onDispose = vi.fn();
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ entry, onDispose });
    try {
      await opened(harness);
      expect(workers).toHaveLength(1);
      harness.send({ kind: "closed" });
      await vi.waitFor(() => expect(harness.session.disposed).toBe(true));
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
      expect(onDispose).toHaveBeenCalledTimes(1);
      expect(harness.navigateToShelf).not.toHaveBeenCalled();
    } finally {
      await harness.stop();
    }
  });

  it("releases once when Back and then the Frame's close both arrive", async () => {
    const onDispose = vi.fn();
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ entry, onDispose });
    try {
      await opened(harness);
      harness.send({ kind: "back" });
      await vi.waitFor(() => expect(harness.session.disposed).toBe(true));
      harness.send({ kind: "closed" });
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
      expect(onDispose).toHaveBeenCalledTimes(1);
    } finally {
      await harness.stop();
    }
  });

  it("starts a fresh pdf.js core when a new Document opens in the same Frame", async () => {
    const first = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const second = shelfEntry({ id: "doc-2", grant: "grant-2", title: "Emma" });
    const harness = setup({ entry: first });
    try {
      await opened(harness);
      expect(workers).toHaveLength(1);
      harness.session.setEntry(second);
      await vi.waitFor(() => expect(workers).toHaveLength(2));
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
      await vi.waitFor(() =>
        expect(harness.messages.filter((message) => message.kind === "open")).toHaveLength(2)
      );
    } finally {
      await harness.stop();
    }
  });
});

// A Document opened from somewhere else returns there (#786): the Frame's own
// Back reads Back to {place} and asks the host for the return, and the Shelf
// only opens when the host has no place to return to.
describe("return target", () => {
  /** A runtime the session joins, the way `startReader` holds one per activation. */
  function readingRuntime() {
    return {
      returnLabel: null as string | null,
      language: "en",
      sessions: new Map<string, ReaderSession>(),
    };
  }

  it("sends the Frame's Back label with the place the host returns to", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const harness = setup({ entry, returnLabel: () => "Plot" });
    try {
      const open = await opened(harness);
      expect((open.labels as Record<string, string>).back).toBe("Back to Plot");
    } finally {
      await harness.stop();
    }
  });

  it("relabels Back when the host names a return target, then returns there on Back", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const runtime = readingRuntime();
    const harness = setup({ entry, returnLabel: () => runtime.returnLabel });
    harness.navigateToShelf.mockImplementation(() =>
      leaveReading(harness.client, runtime.returnLabel)
    );
    runtime.sessions.set("frame-1", harness.session);
    followReturnTarget(harness.client, runtime);
    try {
      const open = await opened(harness);
      // Nothing opened this page, so the Frame's own Back still names the Shelf.
      expect((open.labels as Record<string, string>).back).toBe("Back to Shelf");

      harness.host.setReturnTarget("Plot");
      await vi.waitFor(() => {
        const [last] = harness.messages.filter((message) => message.kind === "language").slice(-1);
        expect((last?.labels as Record<string, string>).back).toBe("Back to Plot");
      });

      harness.send({ kind: "back" });
      await vi.waitFor(() =>
        expect(harness.host.returns).toEqual([{ pluginId: "maibuk-reader", status: "returned" }])
      );
      expect(harness.host.pageNavigations).toEqual([]);
    } finally {
      await harness.stop();
    }
  });

  it("opens the Shelf on Back while the page has no return target", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1" });
    const runtime = readingRuntime();
    const harness = setup({ entry, returnLabel: () => runtime.returnLabel });
    harness.navigateToShelf.mockImplementation(() =>
      leaveReading(harness.client, runtime.returnLabel)
    );
    try {
      await opened(harness);
      harness.send({ kind: "back" });
      await vi.waitFor(() =>
        expect(harness.host.pageNavigations).toEqual([
          { pluginId: "maibuk-reader", pageId: SHELF_PAGE_ID },
        ])
      );
      expect(harness.host.returns).toEqual([]);
    } finally {
      await harness.stop();
    }
  });
});

describe("import (#948)", () => {
  it("imports a picked folder in the background, drawing its card, its rows, and its report", async () => {
    const harness = setup({ view: "shelf", importer: "real", importThrottleMs: 0 });
    try {
      await opened(harness);
      harness.host.files.queueFolderPick({
        name: "Library",
        files: [
          { name: "dune.pdf", bytes: pdfBytes("dune") },
          { name: "emma.pdf", bytes: pdfBytes("emma") },
        ],
      });
      harness.send({ kind: "shelf-command", id: "importFolder" });
      await vi.waitFor(() => {
        const last = importMessages(harness).at(-1)?.state as { status?: string } | null;
        expect(last?.status).toBe("done");
      });
      const done = importMessages(harness).at(-1)?.state as Record<string, unknown>;
      expect(done).toMatchObject({
        source: "folder",
        title: 'Imported "Library"',
        progressText: "2 of 2 files",
        countsText: "2 added",
      });
      expect((done.report as { added: string[] }).added.sort()).toEqual(["dune.pdf", "emma.pdf"]);
      // The first file drew the card at once, as "running", before the finish.
      expect((importMessages(harness)[0].state as { status: string }).status).toBe("running");
      await vi.waitFor(() => {
        const shelves = harness.messages.filter((message) => message.kind === "shelf");
        const rows = (shelves.at(-1)?.state as FrameShelfState | undefined)?.entries ?? [];
        expect(rows.map((row) => row.title).sort()).toEqual(["dune", "emma"]);
        expect(rows.every((row) => row.coverPending === true)).toBe(true);
      });
    } finally {
      await harness.stop();
    }
  });

  it("draws a running Import at most once per throttle, and a status change at once", async () => {
    vi.useFakeTimers();
    const importer = stubImporter();
    const harness = setup({ view: "shelf", importer, importThrottleMs: 400 });
    try {
      harness.send({ kind: "ready" });
      await vi.waitFor(() => expect(harness.messages.some((m) => m.kind === "open")).toBe(true));
      importer.emit({ status: "running", report: importReport(0) });
      for (let processed = 1; processed <= 5; processed += 1) {
        importer.emit({ status: "running", report: importReport(processed) });
      }
      await vi.waitFor(() => expect(importMessages(harness)).toHaveLength(1));
      expect((importMessages(harness)[0].state as { processed: number }).processed).toBe(0);

      await vi.advanceTimersByTimeAsync(400);
      await vi.waitFor(() => expect(importMessages(harness)).toHaveLength(2));
      // The trailing draw reads the latest state, not the one that set the timer.
      expect((importMessages(harness)[1].state as { processed: number }).processed).toBe(5);

      importer.emit({ status: "done", report: { ...importReport(10), finishedAt: 0 } });
      await vi.waitFor(() => expect(importMessages(harness)).toHaveLength(3));
      expect((importMessages(harness)[2].state as { status: string }).status).toBe("done");

      importer.emit(null);
      await vi.waitFor(() => expect(importMessages(harness)).toHaveLength(4));
      expect(importMessages(harness)[3].state).toBeNull();
    } finally {
      await harness.stop();
      vi.useRealTimers();
    }
  });

  it("draws an Import already running when a Frame opens, so a Shelf mounted mid-Import shows it", async () => {
    const importer = stubImporter({ status: "running", report: importReport(3) });
    const harness = setup({ view: "shelf", importer });
    try {
      await opened(harness);
      const message = await messageOf(harness, "import");
      expect(message.state).toMatchObject({ status: "running", progressText: "3 of 10 files" });
      const openIndex = harness.messages.findIndex((m) => m.kind === "open");
      expect(harness.messages.indexOf(message)).toBeGreaterThan(openIndex);
    } finally {
      await harness.stop();
    }
  });

  it("sends nothing about Import before the Frame opened, and nothing when none ran", async () => {
    const importer = stubImporter();
    const harness = setup({ view: "shelf", importer });
    try {
      importer.emit({ status: "running", report: importReport(1) });
      await opened(harness);
      await messageOf(harness, "shelf");
      // The open drew the running Import once; the emit before it drew nothing.
      expect(importMessages(harness)).toHaveLength(1);
      importer.emit(null);
      await vi.waitFor(() => expect(importMessages(harness)).toHaveLength(2));
    } finally {
      await harness.stop();
    }
    const quiet = setup({ view: "shelf", importer: stubImporter() });
    try {
      await opened(quiet);
      await messageOf(quiet, "shelf");
      expect(importMessages(quiet)).toEqual([]);
    } finally {
      await quiet.stop();
    }
  });

  it("cancels and dismisses the Import from the Shelf's commands", async () => {
    const importer = stubImporter();
    const harness = setup({ view: "shelf", importer });
    try {
      await opened(harness);
      harness.send({ kind: "shelf-command", id: "cancelImport" });
      harness.send({ kind: "shelf-command", id: "dismissImport" });
      await vi.waitFor(() => expect(importer.dismiss).toHaveBeenCalledTimes(1));
      expect(importer.cancel).toHaveBeenCalledTimes(1);
    } finally {
      await harness.stop();
    }
  });

  it("starts nothing when the author cancels the pick, and names a failed Import", async () => {
    const importer = stubImporter();
    const harness = setup({ view: "shelf", importer });
    try {
      await opened(harness);
      harness.host.files.queueFilesPick([]);
      harness.send({ kind: "shelf-command", id: "importFiles" });
      importer.start.mockImplementationOnce(() => {
        throw new Error("storage is down");
      });
      harness.host.files.queueFilesPick([{ name: "dune.epub", bytes: epubBytes("dune") }]);
      harness.send({ kind: "shelf-command", id: "importFiles" });
      const result = await messageOf(harness, "shelf-result");
      expect(result.message).toBe("Reader couldn't import those files.");
      expect(importer.start).toHaveBeenCalledTimes(1);
    } finally {
      await harness.stop();
    }
  });

  it("redraws the Import in the new language", async () => {
    const importer = stubImporter({ status: "running", report: importReport(2) });
    const harness = setup({ view: "shelf", importer });
    try {
      await opened(harness);
      await messageOf(harness, "import");
      harness.session.setLanguage("es");
      await vi.waitFor(() => expect(importMessages(harness)).toHaveLength(2));
      expect(importMessages(harness)[1].state).toMatchObject({
        title: "Importando «Library»",
        progressText: "2 de 10 archivos",
      });
    } finally {
      await harness.stop();
    }
  });

  it("stops listening to the Importer once the Frame closes", async () => {
    const importer = stubImporter();
    const harness = setup({ view: "shelf", importer });
    await opened(harness);
    expect(importer.listeners.size).toBe(1);
    await harness.stop();
    expect(importer.listeners.size).toBe(0);
  });
});

describe("Shelf writes during an Import (#948)", () => {
  it("keeps an imported row and a Reading Position saved at the same time", async () => {
    const entry = shelfEntry({ id: "doc-1", grant: "grant-1", title: "Dune" });
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      const imported = shelfEntry({ id: "doc-2", grant: "grant-2", title: "Emma" });
      // Both writes start together: the Import's goes through the same queue.
      const importing = harness.library.updateShelf((shelf) => [...shelf, imported]);
      harness.send({
        kind: "position",
        position: { kind: "page", page: 2, zoom: 1 },
        progress: { page: 2, pageCount: 10 },
      });
      await importing;
      await vi.waitFor(() => {
        const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
        expect(shelf.find((row) => row.id === "doc-1")?.progress).toMatchObject({ page: 2 });
      });
      const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
      expect(shelf.map((row) => row.id).sort()).toEqual(["doc-1", "doc-2"]);
    } finally {
      await harness.stop();
    }
  });

  it("clears a pending cover once the Document opened and reported its metadata", async () => {
    const entry = {
      ...shelfEntry({ id: "doc-1", grant: "grant-1", title: "dune" }),
      coverPending: true as const,
    };
    const storage = new Map<string, unknown>([[SHELF_KEY, [entry]]]);
    const harness = setup({ entry, storage });
    try {
      await opened(harness);
      harness.send({ kind: "meta", title: "Dune" });
      await vi.waitFor(() => {
        const shelf = storage.get(SHELF_KEY) as ShelfEntry[];
        expect(shelf[0].title).toBe("Dune");
      });
      expect((storage.get(SHELF_KEY) as ShelfEntry[])[0].coverPending).toBeUndefined();
    } finally {
      await harness.stop();
    }
  });
});

describe("covers after an Import (#948)", () => {
  const COVER = "data:image/jpeg;base64,AAAA";

  /** A pending-cover Shelf row over a live File Grant holding `fixture`. */
  async function pendingRow(
    harness: Harness,
    id: string,
    fixture = "flowing.epub",
    format: DocumentFormat = "epub"
  ): Promise<ShelfEntry> {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", fixture)));
    harness.host.files.queuePick({ name: fixture, bytes });
    const picked = await harness.client.files.pick({ extensions: [format], multiple: false });
    if (picked === null) throw new Error("the pick was refused");
    return {
      ...shelfEntry({
        id,
        grant: picked.grant,
        fingerprint: `${bytes.length}:${id}`,
        title: id,
        format,
      }),
      coverPending: true as const,
    };
  }

  /** Opens a Shelf Frame over `rows`, sharing the harness's host so the grants stay live. */
  async function shelfWith(
    build: (harness: Harness) => Promise<ShelfEntry[]>,
    options: { coverJobTimeoutMs?: number } = {}
  ): Promise<Harness> {
    const storage = new Map<string, unknown>();
    const harness = setup({ view: "shelf", shelfInFrame: true, storage, ...options });
    storage.set(SHELF_KEY, await build(harness));
    await opened(harness);
    return harness;
  }

  function coverJobs(harness: Harness): Record<string, unknown>[] {
    return harness.messages.filter((message) => message.kind === "cover-job");
  }

  function row(harness: Harness, id: string): ShelfEntry | undefined {
    return (harness.storage.get(SHELF_KEY) as ShelfEntry[]).find(
      (candidate) => candidate.id === id
    );
  }

  it("asks the Shelf Frame for a pending cover, reads that Document, and stores the cover", async () => {
    const harness = await shelfWith(async (h) => [await pendingRow(h, "doc-1")]);
    try {
      const job = await messageOf(harness, "cover-job");
      expect(job).toMatchObject({ documentId: "doc-1", format: "epub" });
      expect(typeof job.foliate).toBe("string");
      harness.send({ kind: "zip-list", id: 7, documentId: "doc-1" });
      const list = await messageOf(harness, "zip-list");
      expect((list.entries as { name: string }[]).map(({ name }) => name)).toContain(
        "OEBPS/images/cover.png"
      );
      const shelfDraws = harness.messages.filter((message) => message.kind === "shelf").length;
      harness.send({ kind: "cover", documentId: "doc-1", coverDataUrl: COVER });
      await vi.waitFor(() => expect(row(harness, "doc-1")?.coverDataUrl).toBe(COVER));
      expect(row(harness, "doc-1")?.coverPending).toBeUndefined();
      // The Shelf redraws, so the real cover fades in over the generated one.
      await vi.waitFor(() => {
        expect(harness.messages.filter((message) => message.kind === "shelf").length).toBe(
          shelfDraws + 1
        );
      });
    } finally {
      await harness.stop();
    }
  });

  it("asks for one cover at a time and moves on once the Frame answers", async () => {
    const harness = await shelfWith(async (h) => [
      await pendingRow(h, "doc-1"),
      await pendingRow(h, "doc-2"),
    ]);
    try {
      await messageOf(harness, "cover-job");
      expect(coverJobs(harness).map((job) => job.documentId)).toEqual(["doc-1"]);
      // No cover in the file: the row stops waiting and keeps its generated cover.
      harness.send({ kind: "cover", documentId: "doc-1" });
      await vi.waitFor(() => expect(coverJobs(harness)).toHaveLength(2));
      expect(coverJobs(harness)[1].documentId).toBe("doc-2");
      expect(row(harness, "doc-1")?.coverPending).toBeUndefined();
      expect(row(harness, "doc-1")?.coverDataUrl).toBeUndefined();
    } finally {
      await harness.stop();
    }
  });

  it("stores only a small JPEG data URL as a cover", async () => {
    const harness = await shelfWith(async (h) => [await pendingRow(h, "doc-1")]);
    try {
      await messageOf(harness, "cover-job");
      harness.send({ kind: "cover", documentId: "doc-1", coverDataUrl: "javascript:alert(1)" });
      await vi.waitFor(() => expect(row(harness, "doc-1")?.coverPending).toBeUndefined());
      expect(row(harness, "doc-1")?.coverDataUrl).toBeUndefined();
    } finally {
      await harness.stop();
    }
  });

  it("skips a Document whose cover job the Frame never answers", async () => {
    const harness = await shelfWith(
      async (h) => [await pendingRow(h, "doc-1"), await pendingRow(h, "doc-2")],
      { coverJobTimeoutMs: 20 }
    );
    try {
      await vi.waitFor(() => expect(coverJobs(harness)).toHaveLength(2));
      expect(coverJobs(harness).map((job) => job.documentId)).toEqual(["doc-1", "doc-2"]);
      expect(row(harness, "doc-1")?.coverPending).toBeUndefined();
    } finally {
      await harness.stop();
    }
  });

  it("reads nothing for a Document no cover job holds", async () => {
    const harness = await shelfWith(async (h) => [await pendingRow(h, "doc-1")]);
    try {
      await messageOf(harness, "cover-job");
      harness.send({ kind: "read", id: 3, offset: 0, length: 16, documentId: "doc-9" });
      const bytes = await messageOf(harness, "bytes");
      expect((bytes.buffer as ArrayBuffer).byteLength).toBe(0);
      harness.send({ kind: "read", id: 4, offset: 0, length: 16, documentId: "doc-1" });
      await vi.waitFor(() => {
        const answer = harness.messages.find(
          (message) => message.kind === "bytes" && message.id === 4
        );
        expect((answer?.buffer as ArrayBuffer | undefined)?.byteLength).toBe(16);
      });
    } finally {
      await harness.stop();
    }
  });

  it("drops the job when a Document opens and asks again back on the Shelf", async () => {
    let reading: ShelfEntry | null = null;
    const harness = await shelfWith(async (h) => {
      const pending = await pendingRow(h, "doc-1");
      reading = { ...(await pendingRow(h, "doc-2")) };
      delete reading.coverPending;
      return [pending, reading];
    });
    try {
      await messageOf(harness, "cover-job");
      harness.session.setEntry(reading);
      await vi.waitFor(() => {
        expect(harness.messages.filter((message) => message.kind === "open")).toHaveLength(2);
      });
      // A late answer for the dropped job changes nothing.
      harness.send({ kind: "cover", documentId: "doc-1", coverDataUrl: COVER });
      harness.send({ kind: "zip-list", id: 9, documentId: "doc-1" });
      const error = await messageOf(harness, "zip-error");
      expect(error).toMatchObject({ id: 9, code: "corrupt" });
      expect(row(harness, "doc-1")?.coverPending).toBe(true);
      await harness.session.showShelf();
      await vi.waitFor(() => expect(coverJobs(harness)).toHaveLength(2));
      expect(coverJobs(harness)[1].documentId).toBe("doc-1");
    } finally {
      await harness.stop();
    }
  });

  it("hands a PDF's cover job its own pdf.js core and stops it after the answer", async () => {
    const harness = await shelfWith(async (h) => [
      await pendingRow(h, "doc-1", "twelve-pages.pdf", "pdf"),
    ]);
    try {
      const job = await messageOf(harness, "cover-job");
      expect(job.pdfPort).toBeInstanceOf(MessagePort);
      expect((job.pdf as { displaySource: string }).displaySource.length).toBeGreaterThan(0);
      expect(workers).toHaveLength(1);
      harness.send({ kind: "cover", documentId: "doc-1", coverDataUrl: COVER });
      await vi.waitFor(() => expect(row(harness, "doc-1")?.coverDataUrl).toBe(COVER));
      expect(workers[0].terminate).toHaveBeenCalled();
    } finally {
      await harness.stop();
    }
  });
});
