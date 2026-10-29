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
import { createShelfService } from "./library";
import { createReaderSession, type ReaderSession } from "./session";
import { SHELF_KEY, positionKey, type DocumentFormat, type ShelfEntry } from "./shelf";
import { readerManifest, shelfEntry } from "./test-support";

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
  navigateToShelf: ReturnType<typeof vi.fn>;
  stop(): void;
}

function setup(
  options: {
    entry?: ShelfEntry | null;
    language?: string;
    storage?: Map<string, unknown>;
    navigateToShelf?: () => Promise<void> | void;
    onDispose?: () => void;
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
  const session = createReaderSession({
    client,
    library,
    entry: options.entry ?? null,
    language: options.language ?? "en",
    port: channel.port1,
    navigateToShelf,
    onDispose: options.onDispose,
  });
  session.start();
  return {
    host,
    storage,
    client,
    library,
    session,
    messages,
    send(message: unknown) {
      channel.port2.postMessage(message);
    },
    navigateToShelf,
    stop() {
      session.dispose();
      channel.port2.close();
      host.stop();
    },
  };
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
    }
  });
});

describe("archive", () => {
  /** A live File Grant over a committed fixture, and a Shelf row that names it. */
  async function pickFixture(
    harness: Harness,
    fixture: string,
    format: DocumentFormat = "epub"
  ): Promise<ShelfEntry> {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", fixture)));
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
      harness.stop();
    }
  });

  it("inflates a text entry and transfers a binary entry", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "flowing.epub");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({
        kind: "zip-entry",
        id: 2,
        name: "OEBPS/chapter1.xhtml",
        as: "text",
      });
      const text = await messageOf(harness, "zip-data");
      expect(text.id).toBe(2);
      expect(text.text).toContain("The spice must flow");
      expect(text.buffer).toBeUndefined();

      harness.send({ kind: "zip-entry", id: 3, name: "OEBPS/images/cover.png", as: "bytes" });
      await vi.waitFor(() =>
        expect(harness.messages.filter((message) => message.kind === "zip-data")).toHaveLength(2)
      );
      const image = harness.messages.filter((message) => message.kind === "zip-data")[1];
      expect(image.id).toBe(3);
      expect((image.buffer as ArrayBuffer).byteLength).toBe(83);
    } finally {
      harness.stop();
    }
  });

  it("answers an entry the archive does not hold with a missing zip-error", async () => {
    const harness = setup();
    try {
      const entry = await pickFixture(harness, "flowing.epub");
      harness.session.setEntry(entry);
      await opened(harness);
      harness.send({ kind: "zip-entry", id: 4, name: "OEBPS/nothing.xhtml", as: "text" });
      const error = await messageOf(harness, "zip-error");
      expect(error).toMatchObject({ kind: "zip-error", id: 4, code: "missing" });
    } finally {
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
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
      harness.stop();
    }
  });
});
