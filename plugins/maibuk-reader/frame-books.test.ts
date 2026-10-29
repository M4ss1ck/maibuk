/**
 * Reader's Flowing view and Page view for books (#653) in jsdom: the real
 * `assets/ui/reader.js` and `assets/ui/sanitizer.js` against the real markup,
 * foliate's real bundled parsers, the real DOMPurify build, and a stand-in
 * Worker that answers `read`, `zip-list`, and `zip-entry` from a committed
 * fixture. Layout is the one seam: jsdom lays nothing out, so each test supplies
 * a section page count through `__readerTestHooks.measureFlow`. Every behavior
 * is driven by key presses or Commands and asserted on what the Frame drew or
 * posted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
import purify from "./vendor/dompurify/purify.es.mjs";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
import * as foliate from "./vendor/foliate/foliate-parsers.min.mjs";
import { ZipError, openZip } from "./zip";
import en from "./locales/runtime/en.json";

const HERE = __dirname;
const HTML = readFileSync(join(HERE, "assets/ui/reader.html"), "utf8");
const SCRIPT = readFileSync(join(HERE, "assets/ui/reader.js"), "utf8");
const SANITIZER = readFileSync(join(HERE, "assets/ui/sanitizer.js"), "utf8");

/** The `labels` map the Worker builds from its runtime catalogs. */
function labelsFrom(catalog: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (key.startsWith("viewer.")) labels[key.slice("viewer.".length)] = value;
  }
  return labels;
}

const LABELS = labelsFrom(en as Record<string, string>);

/** One committed fixture's bytes. */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(HERE, "fixtures", name)));
}

/** A ranged read over `bytes`, for opening the same archive in the test. */
function ranged(bytes: Uint8Array) {
  return async (offset: number, length: number) => bytes.subarray(offset, offset + length);
}

/** The fixture archive, opened by the test to build a real content CFI. */
async function archiveOf(bytes: Uint8Array) {
  return openZip(ranged(bytes), bytes.length);
}

/** Every non-empty text node under `root`, in document order. */
function textNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if ((node.nodeValue || "").trim() !== "") nodes.push(node);
  }
  return nodes;
}

/**
 * A CFI for the first character of `needle` in `entry` of `bytes`, the way the
 * Frame writes one after a page turn: the section's CFI joined to a range
 * inside that section's parsed document.
 */
async function savedCfi(bytes: Uint8Array, entry: string, needle: string): Promise<string> {
  const archive = await archiveOf(bytes);
  const markup = await archive.readText(entry);
  if (markup === null) throw new Error(`the fixture has no ${entry}`);
  const doc = new DOMParser().parseFromString(markup, "application/xhtml+xml");
  const node = textNodes(doc.body).find((candidate) =>
    (candidate.nodeValue || "").includes(needle)
  );
  if (!node) throw new Error(`the fixture has no ${needle}`);
  const offset = (node.nodeValue || "").indexOf(needle);
  const range = doc.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sectionIndex = entry.includes("chapter2") ? 1 : 0;
  return foliate.CFI.joinIndir(
    foliate.CFI.fake.fromIndex(sectionIndex),
    foliate.CFI.fromRange(range)
  );
}

interface OpenOptions {
  format?: string;
  position?: unknown;
  settings?: { fontSize: number; lineWidth: string; pdfFit: "width" | "page" };
  /** Extra `__readerTestHooks` seams, such as a search clock. */
  hooks?: Record<string, unknown>;
}

/** One `window.maibuk.port`: answers reads and archive requests from a fixture. */
class FakeBookPort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly messages: Record<string, unknown>[] = [];
  private opened: ReturnType<typeof openZip> | null = null;

  constructor(private readonly bytes: Uint8Array) {}

  start(): void {}
  close(): void {}

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
    if (message.kind === "read") {
      const offset = Math.max(0, Number(message.offset));
      const length = Math.max(0, Number(message.length));
      const slice = this.bytes.slice(offset, offset + length);
      queueMicrotask(() =>
        this.deliver({ kind: "bytes", id: message.id, buffer: slice.buffer.slice(0) })
      );
      return;
    }
    if (message.kind === "zip-list" || message.kind === "zip-entry") {
      void this.answerArchive(message);
    }
  }

  private archive() {
    if (this.opened === null) this.opened = openZip(ranged(this.bytes), this.bytes.length);
    return this.opened;
  }

  private async answerArchive(message: Record<string, unknown>): Promise<void> {
    const id = Number(message.id);
    try {
      const archive = await this.archive();
      if (message.kind === "zip-list") {
        this.deliver({
          kind: "zip-list",
          id,
          entries: archive.entries.map(({ name, size }) => ({ name, size })),
        });
        return;
      }
      const name = String(message.name);
      if (message.as === "text") {
        const text = await archive.readText(name);
        if (text === null) {
          this.deliver({ kind: "zip-error", id, code: "missing" });
          return;
        }
        this.deliver({ kind: "zip-data", id, text });
        return;
      }
      const bytes = await archive.read(name);
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      this.deliver({ kind: "zip-data", id, buffer });
    } catch (error) {
      const code = error instanceof ZipError ? error.code : "corrupt";
      this.deliver({ kind: "zip-error", id, code });
    }
  }

  /** Hands the Frame one Worker -> Frame message. */
  deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

interface Frame {
  port: FakeBookPort;
  cleanups: (() => void)[];
  open(options?: OpenOptions): void;
  shadowText(): string;
  shadowHits(): HTMLElement[];
}

/** Loads the Frame's markup, sanitizer, script, and stubs, with a fixture port. */
function loadFrame(name: string, options: OpenOptions = {}): Frame {
  const bytes = fixture(name);
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakeBookPort(bytes);
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  const cleanups: (() => void)[] = [];
  (globalThis as Record<string, unknown>).__readerTestHooks = {
    importFoliate: async () => foliate,
    importPurify: async () => ({ default: purify }),
    viewportWidth: 800,
    viewportHeight: 600,
    // jsdom has no layout: give each fixture section a stable page count.
    measureFlow: ({ sectionIndex }: { sectionIndex: number }) => (sectionIndex === 0 ? 3 : 2),
    positionDebounceMs: 20,
    onReady: (cleanup: () => void) => cleanups.push(cleanup),
    ...(options.hooks ?? {}),
  };
  try {
    new Function(SANITIZER)();
    new Function(SCRIPT)();
  } finally {
    delete (globalThis as Record<string, unknown>).__readerTestHooks;
  }
  const format = options.format ?? "epub";
  const frame: Frame = {
    port,
    cleanups,
    open(openOptions: OpenOptions = {}) {
      port.deliver({
        kind: "open",
        entry: { id: "doc-1", title: "Fixture", author: "", format: openOptions.format ?? format },
        position: openOptions.position ?? options.position ?? null,
        settings: openOptions.settings ??
          options.settings ?? { fontSize: 100, lineWidth: "medium", pdfFit: "width" },
        size: bytes.length,
        labels: LABELS,
        language: "en",
        foliate: { source: "export {};", purify: "export default {};" },
      });
    },
    shadowText() {
      const host = document.getElementById("stage")?.firstElementChild;
      const shadow = host && (host as HTMLElement).shadowRoot;
      return shadow ? shadow.textContent || "" : "";
    },
    shadowHits() {
      const host = document.getElementById("stage")?.firstElementChild as HTMLElement | null;
      const shadow = host?.shadowRoot;
      return shadow ? Array.from(shadow.querySelectorAll<HTMLElement>(".reader-search-hit")) : [];
    },
  };
  return frame;
}

/** The element with `id`, which the loaded markup always carries. */
function el(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
}

/** The indexes of the marks the Frame has flagged as the current match. */
function currentHitIndexes(current: Frame): number[] {
  return current
    .shadowHits()
    .flatMap((hit, index) => (hit.classList.contains("is-current") ? [index] : []));
}

let frame: Frame | null = null;
let objectUrls = 0;

beforeEach(() => {
  objectUrls = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => `blob:reader-${++objectUrls}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  // jsdom never decodes an image; a rejected bitmap skips the optional cover.
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    writable: true,
    value: vi.fn(async () => {
      throw new Error("no bitmap in jsdom");
    }),
  });
});

afterEach(() => {
  for (const cleanup of frame?.cleanups ?? []) cleanup();
  frame = null;
  delete (window as unknown as { maibuk?: unknown }).maibuk;
  delete (globalThis as Record<string, unknown>).ReaderSanitizer;
  document.documentElement.innerHTML = "";
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
  Reflect.deleteProperty(globalThis, "createImageBitmap");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Flowing view", () => {
  it("opens a reflowable EPUB at its saved CFI", async () => {
    const bytes = fixture("flowing.epub");
    const cfi = await savedCfi(bytes, "OEBPS/chapter2.xhtml", "The journey");
    frame = loadFrame("flowing.epub", { position: { kind: "cfi", cfi } });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2 in this section"));
    expect(frame.shadowText()).toContain("The journey continues past the desert.");
    expect(frame.shadowText()).not.toContain("The spice must flow");
  });

  it("crosses into the next section when the last page turns", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 3 in this section"));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2 in this section"));
    expect(frame.shadowText()).toContain("The journey continues past the desert.");
  });

  it("keeps the Reading Position when the font size changes", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const positions = () =>
      frame?.port.messages.filter((message) => message.kind === "position") ?? [];
    // Let the debounced opening position land, so the page turn's position is
    // not folded into it before the key press.
    await vi.waitFor(() => expect(positions().length).toBeGreaterThanOrEqual(1));
    await userEvent.setup().keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 3 in this section"));
    await vi.waitFor(() => expect(positions().length).toBeGreaterThanOrEqual(2));
    const before = positions().at(-1) as { position: unknown };
    const beforeCount = positions().length;

    frame.port.deliver({ kind: "command", id: "increaseFontSize" });
    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "settings")).toEqual({
        kind: "settings",
        settings: { fontSize: 110, lineWidth: "medium", pdfFit: "width" },
      })
    );
    await vi.waitFor(() => expect(positions().length).toBeGreaterThan(beforeCount));
    expect(el("page-indicator").textContent).toBe("2 of 3 in this section");
    const after = positions().at(-1) as { position: unknown };
    expect(after.position).toEqual(before.position);
  });

  it("searches across sections in time slices and counts every match", async () => {
    const slices: number[] = [];
    let clock = 0;
    frame = loadFrame("flowing.epub", {
      hooks: {
        now: () => (clock += 100),
        onSearchSlice: () => slices.push(clock),
      },
    });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    await userEvent.setup().keyboard("{Control>}f{/Control}");

    // The search yields with `setTimeout(0)` once a slice runs over 16 ms; the
    // injected clock crosses that on the first section.
    const input = el("search-input") as HTMLInputElement;
    input.value = "spice";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    expect(slices.length).toBeGreaterThan(0);
    expect(frame.shadowText()).toContain("The spice must flow");
  });

  it("marks the current match and moves it with Next and Previous", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    // Section one reads "The spice must flow", "Spice is life ... The spice is
    // the desert.": three marks, and only the first is current.
    expect(frame.shadowHits().map((hit) => hit.textContent)).toEqual(["spice", "Spice", "spice"]);
    expect(currentHitIndexes(frame)).toEqual([0]);

    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("2 of 3"));
    expect(currentHitIndexes(frame)).toEqual([1]);
    expect(frame.shadowHits()[1]?.textContent).toBe("Spice");

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    expect(currentHitIndexes(frame)).toEqual([0]);

    await user.click(el("search-next"));
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("2 of 3"));
    expect(currentHitIndexes(frame)).toEqual([1]);

    await user.click(el("search-previous"));
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    expect(currentHitIndexes(frame)).toEqual([0]);
  });

  it("leaves no native text selection after search, Next, and paging", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    await user.type(el("search-input"), "spice");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("1 of 3"));
    await user.click(el("search-next"));
    await vi.waitFor(() => expect(el("search-status").textContent).toBe("2 of 3"));
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 3 in this section"));

    const selection = window.getSelection();
    expect(selection === null || selection.rangeCount === 0 || selection.isCollapsed).toBe(true);
  });
});

describe("Document markup", () => {
  it("never runs an inline script or handler from a section", async () => {
    delete (globalThis as Record<string, unknown>).__readerScriptRan;
    delete (globalThis as Record<string, unknown>).__readerHandlerRan;
    delete (globalThis as Record<string, unknown>).__readerLinkRan;
    frame = loadFrame("flowing.epub", { position: { kind: "section", index: 1, fraction: 0 } });
    frame.open();
    await vi.waitFor(() =>
      expect(frame?.shadowText()).toContain("The journey continues past the desert.")
    );
    expect((globalThis as Record<string, unknown>).__readerScriptRan).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__readerHandlerRan).toBeUndefined();
    expect((globalThis as Record<string, unknown>).__readerLinkRan).toBeUndefined();
  });

  it("drops external images and turns archive images into blob urls", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const host = document.getElementById("stage")?.firstElementChild as HTMLElement;
    const shadow = host.shadowRoot as ShadowRoot;
    const images = Array.from(shadow.querySelectorAll("img"));
    expect(images).toHaveLength(3);
    const sources = images.map((image) => image.getAttribute("src"));
    expect(sources.filter((src) => src?.startsWith("blob:"))).toHaveLength(1);
    expect(sources.some((src) => src?.includes("example.com"))).toBe(false);
    expect(sources.filter((src) => src === null)).toHaveLength(2);
  });
});

describe("Escape order", () => {
  it("closes search, then Contents, then leaves for the Shelf", async () => {
    frame = loadFrame("flowing.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 3 in this section"));
    const user = userEvent.setup();
    await user.keyboard("{Control>}f{/Control}");
    expect(el("search-bar").hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(el("search-bar").hidden).toBe(true);
    expect(frame.port.messages.some((message) => message.kind === "back")).toBe(false);

    await user.click(el("contents-toggle"));
    expect(el("contents").hidden).toBe(false);
    await user.keyboard("{Escape}");
    expect(el("contents").hidden).toBe(true);
    expect(frame.port.messages.some((message) => message.kind === "back")).toBe(false);

    await user.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(frame?.port.messages.some((message) => message.kind === "back")).toBe(true)
    );
  });
});

describe("Page view", () => {
  it("turns the pages of a CBZ in natural file-name order", async () => {
    frame = loadFrame("pages.cbz", { format: "cbz" });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 8"));
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 8"));
    const image = el("stage").querySelector("img");
    expect(image?.getAttribute("src")).toMatch(/^blob:/);
    expect(image?.getAttribute("alt")).toBe("page-2.png");
    await user.keyboard("{End}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("8 of 8"));
    await user.keyboard("{Home}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 8"));
  });

  it("pages a fixed-layout EPUB and reports its page count", async () => {
    frame = loadFrame("fixed-layout.epub");
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2"));
    await userEvent.setup().keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("2 of 2"));
    const host = el("stage").firstElementChild as HTMLElement;
    expect(host.style.transform).toContain("scale(");
    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "meta")).toMatchObject({
        kind: "meta",
        title: "Plates",
        pageCount: 2,
      })
    );
  });
});

describe("the other reflowable formats", () => {
  it("opens a MOBI and draws its single text section", async () => {
    frame = loadFrame("story.mobi", { format: "mobi" });
    frame.open();
    await vi.waitFor(() =>
      expect(frame?.shadowText()).toContain("The desert keeps its own record of the journey.")
    );
    await vi.waitFor(() =>
      expect(frame?.port.messages.find((message) => message.kind === "meta")).toMatchObject({
        kind: "meta",
        title: "Notes",
      })
    );
  });

  it("opens an FB2 and its second section", async () => {
    frame = loadFrame("story.fb2", {
      format: "fb2",
      position: { kind: "section", index: 1, fraction: 0 },
    });
    frame.open();
    await vi.waitFor(() => expect(el("page-indicator").textContent).toBe("1 of 2 in this section"));
    expect(frame.shadowText()).toContain("The archive keeps every draft.");
    frame.port.deliver({ kind: "command", id: "nextPage" });
    frame.port.deliver({ kind: "command", id: "nextPage" });
    await vi.waitFor(() =>
      expect(frame?.shadowText()).toContain("A second section follows the first.")
    );
  });
});

describe("refusing an unreadable Document", () => {
  it("reports a corrupt EPUB as damaged", async () => {
    frame = loadFrame("corrupt.epub");
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDamaged);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "corrupt",
      reason: LABELS.errorDamaged,
    });
  });

  it("reports an EPUB whose content is encrypted as DRM", async () => {
    frame = loadFrame("encrypted.epub");
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDrm);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "encrypted",
      reason: LABELS.errorDrm,
    });
  });

  it("reports a MOBI with the DRM flag before reading its text", async () => {
    frame = loadFrame("drm.mobi", { format: "mobi" });
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDrm);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "encrypted",
      reason: LABELS.errorDrm,
    });
  });

  it("reports an AZW3 without readable KF8 tables as damaged", async () => {
    frame = loadFrame("story.azw3", { format: "azw3" });
    frame.open();
    await vi.waitFor(() => expect(el("message").hidden).toBe(false));
    expect(el("message").textContent).toBe(LABELS.errorDamaged);
    expect(frame.port.messages).toContainEqual({
      kind: "load-error",
      code: "corrupt",
      reason: LABELS.errorDamaged,
    });
  });
});
