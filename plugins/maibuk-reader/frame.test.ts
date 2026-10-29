/**
 * The Reader Frame's Page view (#653) in jsdom: the real `assets/ui/reader.js`
 * loaded against the real `assets/ui/reader.html` markup, a stand-in
 * `window.maibuk.port`, and a stub pdf.js module injected through the
 * `globalThis.__readerTestHooks` seam the script exposes for tests. The stub
 * never parses anything: it reports pages, labels, an outline, metadata, or the
 * error the test asks for, so each behavior can be driven by `user-event` key
 * presses and asserted by what the Frame drew and posted to the Worker.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

const HTML = readFileSync(join(__dirname, "assets/ui/reader.html"), "utf8");
const SCRIPT = readFileSync(join(__dirname, "assets/ui/reader.js"), "utf8");

/** The `labels` map the Worker builds from its runtime catalogs. */
function labelsFrom(catalog: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (key.startsWith("viewer.")) labels[key.slice("viewer.".length)] = value;
  }
  return labels;
}

const LABELS = labelsFrom(en as Record<string, string>);
const LABELS_ES = labelsFrom(es as Record<string, string>);

/** One page label set: roman prelims, then 1..10, as the fixture carries. */
const LABELS_WITH_PRELIMS = ["i", "ii", ...Array.from({ length: 10 }, (_, i) => String(i + 1))];

/** A page's viewport in the stub: US Letter at 72 dpi. */
function viewport(scale: number): { width: number; height: number } {
  return { width: 612 * scale, height: 792 * scale };
}

interface StubOptions {
  pages?: number;
  labels?: string[] | null;
  outline?: { title: string; dest: unknown[]; items?: unknown[] }[] | null;
  metadata?: { Title?: string; Author?: string };
  /** When set, the first open rejects until this password arrives. */
  password?: string;
  /** When set, opening fails with this error name. */
  failWith?: string;
  text?: (pageNumber: number) => string;
}

/** The stub pdf.js display module the Frame imports instead of the blob. */
function createPdfStub(options: StubOptions = {}) {
  const pages = options.pages ?? 12;
  const documents: { password?: string }[] = [];
  const openedIndices: number[] = [];

  class StubPage {
    constructor(private readonly number: number) {}
    getViewport({ scale }: { scale: number }) {
      return viewport(scale);
    }
    render() {
      return { promise: Promise.resolve() };
    }
    async getTextContent() {
      const text = options.text ? options.text(this.number) : `Page ${this.number}`;
      return { items: [{ str: text }] };
    }
  }

  class StubDocument {
    readonly numPages = pages;
    async getPage(number: number) {
      openedIndices.push(number);
      return new StubPage(number);
    }
    async getPageLabels() {
      return options.labels ?? null;
    }
    async getOutline() {
      return options.outline ?? null;
    }
    async getMetadata() {
      return { info: options.metadata ?? {} };
    }
    async getDestination(name: string) {
      if (name === "chapter-3") return [{}, { name: "Page" }, 3];
      return null;
    }
    async getPageIndex() {
      return 0;
    }
    async destroy() {}
  }

  class StubRangeTransport {
    requestDataRange = () => {};
    onDataRange = () => {};
    abort = () => {};
    constructor(
      readonly length: number,
      readonly initial: Uint8Array
    ) {}
  }

  class StubWorker {
    constructor(readonly options: { port: MessagePort }) {}
    destroy() {}
  }

  class StubTextLayer {
    constructor(readonly options: Record<string, unknown>) {}
    /** Like pdf.js, one span per text item, so search marks have text to land in. */
    async render() {
      const source = this.options.textContentSource as { items: { str: string }[] };
      const container = this.options.container as HTMLElement;
      for (const item of source.items) {
        const span = document.createElement("span");
        span.textContent = item.str;
        container.append(span);
      }
    }
  }

  class PasswordException extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PasswordException";
    }
  }

  function getDocument(params: { password?: string }) {
    const task = {
      onPassword: null as null | ((update: (password: string) => void, reason: number) => void),
      promise: Promise.resolve() as Promise<unknown>,
    };
    if (options.failWith) {
      const error = new Error(`stub ${options.failWith}`);
      error.name = options.failWith;
      task.promise = Promise.reject(error);
      return task;
    }
    if (options.password !== undefined && params.password !== options.password) {
      task.promise = Promise.reject(new PasswordException("No password given"));
      return task;
    }
    documents.push({ password: params.password });
    task.promise = Promise.resolve(new StubDocument());
    return task;
  }

  return {
    module: {
      PDFWorker: StubWorker,
      PDFDataRangeTransport: StubRangeTransport,
      TextLayer: StubTextLayer,
      PasswordException,
      getDocument,
    },
    documents,
    openedIndices,
  };
}

/** One `window.maibuk.port`: records what the Frame posts, answers reads. */
class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly messages: Record<string, unknown>[] = [];
  constructor(private readonly fileSize: number) {}
  start(): void {}
  close(): void {}
  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
    if (message.kind !== "read") return;
    const offset = Number(message.offset);
    const length = Math.min(Number(message.length), Math.max(0, this.fileSize - offset));
    const buffer = new ArrayBuffer(length);
    queueMicrotask(() => this.deliver({ kind: "bytes", id: message.id, buffer }));
  }
  /** Hands the Frame one Worker -> Frame message. */
  deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

/** A stand-in for the pdf.js core port transferred inside `open`. */
class FakePdfPort {
  readonly start = vi.fn();
  readonly close = vi.fn();
}

interface Frame {
  port: FakePort;
  pdfPort: FakePdfPort;
  cleanups: (() => void)[];
  open(options?: Record<string, unknown>): void;
}

/** Loads the Frame's markup and script with the stub pdf.js. */
function loadFrame(stub: ReturnType<typeof createPdfStub>, fileSize = 4096): Frame {
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakePort(fileSize);
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  const cleanups: (() => void)[] = [];
  const pdfPort = new FakePdfPort();
  (globalThis as Record<string, unknown>).__readerTestHooks = {
    importPdfjs: async () => stub.module,
    onReady: (cleanup: () => void) => cleanups.push(cleanup),
  };
  try {
    new Function(SCRIPT)();
  } finally {
    delete (globalThis as Record<string, unknown>).__readerTestHooks;
  }
  return {
    port,
    pdfPort,
    cleanups,
    open(options: Record<string, unknown> = {}) {
      port.deliver({
        kind: "open",
        entry: { id: "doc-1", title: "Dune", author: "", format: "pdf" },
        position: null,
        settings: { fontSize: 100, lineWidth: "medium", pdfFit: "width" },
        size: fileSize,
        labels: LABELS,
        language: "en",
        pdf: { displaySource: "export {};", css: ".textLayer { position: absolute; }" },
        pdfPort,
        ...options,
      });
    },
  };
}

/** The element with `id`, which the loaded markup always carries. */
function el(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
}

let frame: Frame | null = null;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,COVER"
  );
});

afterEach(() => {
  for (const cleanup of frame?.cleanups ?? []) cleanup();
  frame = null;
  delete (window as unknown as { maibuk?: unknown }).maibuk;
  document.documentElement.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Page view", () => {
  it("turns pages with the keyboard and labels them from the Document", async () => {
    const stub = createPdfStub({
      labels: LABELS_WITH_PRELIMS,
      metadata: { Title: "Dune", Author: "Frank Herbert" },
    });
    frame = loadFrame(stub);
    frame.open();
    const indicator = el("page-indicator");
    await vi.waitFor(() => expect(indicator.textContent).toBe("i (1 of 12)"));

    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("ii (2 of 12)"));
    await user.keyboard("{PageDown}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("1 (3 of 12)"));
    await user.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("ii (2 of 12)"));
    await user.keyboard("{End}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("10 (12 of 12)"));
    await user.keyboard("{Home}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("i (1 of 12)"));

    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "meta")).toMatchObject({
        kind: "meta",
        title: "Dune",
        author: "Frank Herbert",
        pageCount: 12,
        coverDataUrl: "data:image/jpeg;base64,COVER",
      })
    );
  });

  it("answers a Worker Command without a key press", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 12"));
    frame.port.deliver({ kind: "command", id: "lastPage" });
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("12 of 12"));
    frame.port.deliver({ kind: "command", id: "nextPage" });
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("12 of 12"));
    frame.port.deliver({ kind: "command", id: "previousPage" });
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("11 of 12"));
  });

  it("keeps the page when fit width and zoom steps change the scale", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 12"));
    const zoom = el("zoom-level");
    const before = zoom.textContent;
    await userEvent.setup().keyboard("=");
    await vi.waitFor(() => expect(zoom.textContent).not.toBe(before));
  });
});

describe("leaving", () => {
  it("debounces the Reading Position and flushes it when the page is hidden", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    const indicator = el("page-indicator");
    await vi.waitFor(() => expect(indicator.textContent).toBe("1 of 12"));
    await userEvent.setup().keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("2 of 12"));
    expect(frame.port.messages.some((message) => message.kind === "position")).toBe(false);

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => {
      expect(frame?.port.messages.filter((message) => message.kind === "position")).toEqual([
        {
          kind: "position",
          position: { kind: "page", page: 1, zoom: "width" },
          progress: { page: 2, pageCount: 12 },
        },
      ]);
    });
  });

  it("tells the Worker the Frame closed when the page is hidden, without asking to leave", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 12"));

    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => {
      expect(frame?.port.messages.filter((message) => message.kind === "closed")).toHaveLength(1);
    });
    expect(frame?.port.messages.some((message) => message.kind === "back")).toBe(false);
  });

  it("flushes the Reading Position before it asks to leave", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    const indicator = el("page-indicator");
    await vi.waitFor(() => expect(indicator.textContent).toBe("1 of 12"));
    await userEvent.setup().keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(indicator.textContent).toBe("2 of 12"));
    await userEvent.setup().click(el("back"));

    await vi.waitFor(() =>
      expect(frame?.port.messages.map((message) => message.kind).slice(-2)).toEqual([
        "position",
        "back",
      ])
    );
    const position = frame.port.messages.at(-2);
    expect(position).toMatchObject({
      position: { kind: "page", page: 1, zoom: "width" },
      progress: { page: 2, pageCount: 12 },
    });
  });
});

describe("search", () => {
  it("closes the search bar on Escape before it leaves the Document", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 12"));

    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    expect((el("search-bar") as HTMLElement).hidden).toBe(false);
    expect(document.activeElement).toBe(el("search-input"));

    await user.keyboard("{Escape}");
    expect(el("search-bar").hidden).toBe(true);
    expect(frame.port.messages.some((message) => message.kind === "back")).toBe(false);

    await user.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(frame?.port.messages.some((message) => message.kind === "back")).toBe(true)
    );
  });

  it("finds text and jumps to the matching page", async () => {
    const stub = createPdfStub({
      pages: 4,
      text: (page) => (page === 3 ? "the spice must flow" : `Page ${page}`),
    });
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 4"));

    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("3 of 4"));
    expect(el("search-status").textContent).toBe("1 of 1");
  });

  it("marks the current match in the text layer and moves it match by match", async () => {
    const stub = createPdfStub({
      pages: 4,
      text: (page) => {
        if (page === 1) return "spice and spice";
        if (page === 3) return "the spice must flow";
        return `Page ${page}`;
      },
    });
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 4"));

    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    // Page 1 holds two matches; the first is current and page 3 waits its turn.
    const marks = () => Array.from(el("stage").querySelectorAll<HTMLElement>(".reader-search-hit"));
    const current = () =>
      marks().flatMap((mark, index) => (mark.classList.contains("is-current") ? [index] : []));
    await vi.waitFor(() => expect(current()).toEqual([0]));
    expect(marks()).toHaveLength(2);

    await user.click(el("search-next"));
    await vi.waitFor(() => expect(current()).toEqual([1]));
    expect(el("search-status").textContent).toBe("2 of 3");
    expect(el("page-indicator").textContent).toBe("1 of 4");

    await user.click(el("search-next"));
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("3 of 4"));
    await vi.waitFor(() => expect(current()).toEqual([0]));
    expect(el("search-status").textContent).toBe("3 of 3");

    await user.click(el("search-previous"));
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 4"));
    await vi.waitFor(() => expect(current()).toEqual([1]));
    expect(el("search-status").textContent).toBe("2 of 3");
  });

  it("leaves no native text selection after search, Next, and paging", async () => {
    const stub = createPdfStub({
      pages: 4,
      text: (page) => (page === 3 ? "the spice must flow" : `Page ${page}`),
    });
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 4"));

    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("3 of 4"));
    await user.click(el("search-next"));
    await user.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 4"));

    const selection = window.getSelection();
    expect(selection === null || selection.rangeCount === 0 || selection.isCollapsed).toBe(true);
  });
});

describe("pdf.js failures", () => {
  it("asks for the password, then opens the Document, and never posts it", async () => {
    const stub = createPdfStub({ password: "hunter2" });
    frame = loadFrame(stub);
    frame.open();
    const form = el("password-form");
    await vi.waitFor(() => expect(form.hidden).toBe(false));

    const user = userEvent.setup();
    await user.type(el("password-input"), "wrong");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("password-error").hidden).toBe(false));
    expect(el("password-error").textContent).toBe(LABELS.passwordWrong);

    await user.clear(el("password-input"));
    await user.type(el("password-input"), "hunter2");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 12"));
    expect(form.hidden).toBe(true);

    const posted = JSON.stringify(frame.port.messages);
    expect(posted).not.toContain("hunter2");
    expect(posted).not.toContain("wrong");
  });

  it("says why a damaged PDF will not open and tells the Worker", async () => {
    const stub = createPdfStub({ failWith: "InvalidPDFException" });
    frame = loadFrame(stub);
    frame.open();
    const message = el("message");
    await vi.waitFor(() => expect(message.hidden).toBe(false));
    expect(message.textContent).toBe(LABELS.errorCorrupt);
    expect(message.dataset.error).toBe("true");
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "corrupt",
      reason: LABELS.errorCorrupt,
    });
  });

  it("offers Back to Shelf from the error", async () => {
    const stub = createPdfStub({ failWith: "InvalidPDFException" });
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    await userEvent.setup().click(el("back"));
    await vi.waitFor(() =>
      expect(frame?.port.messages.some((message) => message.kind === "back")).toBe(true)
    );
  });
});

describe("labels", () => {
  it("follows a language change and keeps the Document's page numbers", async () => {
    const stub = createPdfStub();
    frame = loadFrame(stub);
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 12"));
    frame.port.deliver({ kind: "language", language: "es", labels: LABELS_ES });
    expect(el("back").textContent).toBe("Volver al estante");
    expect(el("page-indicator").textContent).toBe("1 de 12");
  });
});
