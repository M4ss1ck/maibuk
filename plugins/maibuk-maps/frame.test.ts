/**
 * The Map Frame's drawing surface (#745) in jsdom: the real `assets/ui/map.html`
 * and `assets/ui/map.js`, the vendored Preact+htm library, a stand-in
 * `window.maibuk.port`, and the `globalThis.__mapTestHooks` seam the script
 * exposes for tests (a point converter, because jsdom has no layout, and a
 * cleanup). Each behavior is asserted by what the Frame drew and what it posted
 * to the Worker.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_FRAME_SRC } from "./map-page";
import { parseFrameMessage, sceneMessage } from "./frame-protocol";
import {
  transformBox as geometryTransformBox,
  type TransformBox,
  type TransformGesture,
} from "./geometry";
import {
  MAP_LABEL_FONT_FAMILIES,
  MAP_LABEL_FONTS,
  bendFromPoint,
  labelBaselinePath,
  type MapLabelElement,
} from "./maps";
import { TEXT_FONT_FAMILY, sceneToSvg } from "./scene";

const HTML = readFileSync(join(__dirname, "assets/ui/map.html"), "utf8");
const CSS = readFileSync(join(__dirname, "assets/ui/fonts.css"), "utf8");
const LIBRARY = readFileSync(join(__dirname, "assets/ui/lib/htm-preact-standalone.umd.js"), "utf8");
const PURIFY = readFileSync(join(__dirname, "assets/ui/lib/purify.min.js"), "utf8");
const INGEST = readFileSync(join(__dirname, "assets/ui/svg-ingest.js"), "utf8");
const SCRIPT = readFileSync(join(__dirname, "assets/ui/map.js"), "utf8");

/** One `window.maibuk.port`: records what the Frame posts, delivers scenes. */
class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly messages: Record<string, unknown>[] = [];
  start(): void {}
  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
  }
  /** Hands the Frame one Worker -> Frame message. */
  deliver(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

interface Frame {
  port: FakePort;
  cleanups: (() => void)[];
  /**
   * Where page point 0,0 sits on screen. The fake screen matrix maps a client
   * point to page millimetres by subtracting it, so moving it mid-gesture is a
   * host layout shift that moves the Frame under a still pointer.
   */
  origin: [number, number];
  /**
   * How many screen pixels one page millimetre spans (#795), which the Frame
   * asks for to keep a transform handle the same size on screen at every zoom.
   * A browser answers from the surface's own pixel size; jsdom has no layout,
   * so a test says it, and `null` stands for a document that cannot.
   */
  scale: number | null;
  /** Sends one scene, with the defaults a Select-tool, unzoomed view has. */
  scene(overrides?: Record<string, unknown>): void;
  /**
   * The SVG the Frame would rasterize, with each picture placeholder swapped for
   * the blob URL it keeps: jsdom has no canvas, so a test reads the swap here.
   */
  assetSvg(svg: string): string;
  /**
   * The Frame's mirrored copy of the handle maths (#795), which the parity test
   * holds to `geometry.ts`'s results.
   */
  transformBox(gesture: TransformGesture): TransformBox;
}

/** Loads the Frame's markup, the vendored libraries, and its scripts. */
function loadFrame(): Frame {
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakePort();
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  const cleanups: (() => void)[] = [];
  const origin: [number, number] = [0, 0];
  const sizes: { scale: number | null } = { scale: 4 };
  let assetSvg: (svg: string) => string = (svg) => svg;
  let resolveTransformBox: ((gesture: TransformGesture) => TransformBox) | null = null;
  (globalThis as Record<string, unknown>).__mapTestHooks = {
    pagePoint: (event: MouseEvent) => [event.clientX - origin[0], event.clientY - origin[1]],
    pxPerMm: () => sizes.scale,
    onReady: (cleanup: () => void) => cleanups.push(cleanup),
    onAssetSvg: (resolve: (svg: string) => string) => {
      assetSvg = resolve;
    },
    onTransformBox: (resolve: (gesture: TransformGesture) => TransformBox) => {
      resolveTransformBox = resolve;
    },
  };
  try {
    // The page's own order: the drawing library, then the sanitizer and the
    // ingest rules an uploaded picture needs, then the Frame's script.
    new Function(LIBRARY)();
    new Function(PURIFY)();
    new Function(INGEST)();
    new Function(SCRIPT)();
  } finally {
    delete (globalThis as Record<string, unknown>).__mapTestHooks;
  }
  return {
    port,
    cleanups,
    origin,
    get scale() {
      return sizes.scale;
    },
    set scale(value: number | null) {
      sizes.scale = value;
    },
    scene(overrides = {}) {
      port.deliver({
        kind: "scene",
        widthMm: 200,
        heightMm: 100,
        background: "#d7e6ec",
        elements: [],
        tool: "select",
        zoom: 1,
        panX: 0,
        panY: 0,
        penLabel: PEN_LABEL,
        readout: READOUT,
        ...overrides,
      });
    },
    assetSvg: (svg) => assetSvg(svg),
    transformBox(gesture) {
      if (resolveTransformBox === null) throw new Error("the Frame registered no handle maths");
      return resolveTransformBox(gesture);
    },
  };
}

/** One pointer event; jsdom has no PointerEvent, and the script reads no more. */
function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  init: MouseEventInit = {}
): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, ...init })
  );
}

/** One keydown on the Frame's document, which answers whether the Frame kept it. */
function key(name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

/** The Pen draft label the Worker sends: both plural forms, `{{count}}` to fill. */
const PEN_LABEL = { one: "Pen line, {{count}} point", other: "Pen line, {{count}} points" };

/** The readout chip's text the Worker sends: `{{value}}` for the millimetres or degrees. */
const READOUT = {
  size: "{{value}} mm",
  angle: "{{value}}°",
  shape: "{{width}} × {{height}} mm",
  label: "Cap {{size}} mm · {{width}} mm",
};

const shape = (overrides: Record<string, unknown> = {}) => ({
  d: "M 10 10 L 20 20",
  stroke: "#1f2933",
  strokeWidth: 0.6,
  dash: null,
  fill: null,
  opacity: 1,
  ...overrides,
});

const sceneElement = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  shapes: [shape()],
  hidden: false,
  locked: false,
  selected: false,
  ...overrides,
});

const svg = (): SVGSVGElement => {
  const element = document.querySelector("svg");
  if (element === null) throw new Error("the Frame drew no svg");
  return element;
};

let frame: Frame | null = null;

afterEach(() => {
  for (const cleanup of frame?.cleanups ?? []) cleanup();
  frame = null;
  delete (window as unknown as { maibuk?: unknown }).maibuk;
  delete (globalThis as Record<string, unknown>).DOMPurify;
  delete (globalThis as Record<string, unknown>).maibukSvgIngest;
  delete (globalThis as Record<string, unknown>).FontFace;
  delete (document as unknown as { fonts?: unknown }).fonts;
  document.documentElement.innerHTML = "";
});

describe("the Map Frame page", () => {
  it("mounts a document that exists in the Plugin folder", () => {
    expect(MAP_FRAME_SRC).toBe("assets/ui/map.html");
    expect(existsSync(join(__dirname, MAP_FRAME_SRC))).toBe(true);
    // An uploaded picture is cleaned in the Frame (#756), so the sanitizer and
    // the ingest rules load before map.js, which reaches them only when asked.
    const page = new DOMParser().parseFromString(HTML, "text/html");
    const scripts = Array.from(page.querySelectorAll("script")).map((script) =>
      script.getAttribute("src")
    );
    expect(scripts).toEqual([
      "lib/htm-preact-standalone.umd.js",
      "lib/purify.min.js",
      "svg-ingest.js",
      "map.js",
    ]);
  });
});

describe("the Map Label fonts", () => {
  it("declares one bundled face per shipped file, under the family the scene asks for", () => {
    // The whole point of bundling the faces is that the Frame draws a Map Label
    // in the same letterforms an export does, with nothing loaded from the
    // network: a family the scene names but the page never declares would
    // silently draw the browser's fallback.
    const files = readdirSync(join(__dirname, "assets/ui/fonts"))
      .filter((file) => file.endsWith(".ttf"))
      .sort();
    expect(files).toEqual([
      "Cinzel-wght.ttf",
      "IMFeENrm28P.ttf",
      "MedievalSharp.ttf",
      "UncialAntiqua-Regular.ttf",
    ]);
    // The faces live in a linked stylesheet: the Frame shim rewrites a
    // stylesheet's relative url() to the file's blob URL, while an inline
    // style's url() is never rewritten, so an inline @font-face would not load.
    expect(HTML).toContain('href="fonts.css"');
    for (const file of files) expect(CSS).toContain(`url("fonts/${file}")`);

    expect(CSS.match(/@font-face/g)).toHaveLength(MAP_LABEL_FONTS.length);
    expect(CSS.match(/font-display: block;/g)).toHaveLength(MAP_LABEL_FONTS.length);
    for (const font of MAP_LABEL_FONTS) {
      expect(CSS).toContain(`font-family: "${MAP_LABEL_FONT_FAMILIES[font]}"`);
    }

    // The PDF Font is the author's own installed face: the Worker sends its
    // bytes over the Frame's port and map.js registers the face, so the page
    // itself declares no family for it.
    expect(CSS).not.toContain(`"${MAP_LABEL_FONT_FAMILIES.pdf}"`);
  });
});

/**
 * jsdom implements neither FontFace nor document.fonts, so the registration is
 * proven against a stub that records what the Frame handed it.
 */
function stubFontFace(): { family: string; source: unknown }[] {
  const registered: { family: string; source: unknown }[] = [];
  (globalThis as Record<string, unknown>).FontFace = class {
    family: string;
    source: unknown;
    constructor(family: string, source: unknown) {
      this.family = family;
      this.source = source;
    }
  };
  (document as unknown as { fonts: unknown }).fonts = {
    add: (face: { family: string; source: unknown }) => registered.push(face),
  };
  return registered;
}

describe("the author's PDF Font", () => {
  const BYTES = new ArrayBuffer(8);

  it("registers the bytes the Worker sends as the family a pdf label asks for", () => {
    const registered = stubFontFace();
    frame = loadFrame();

    frame.port.deliver({
      kind: "font",
      family: MAP_LABEL_FONT_FAMILIES.pdf,
      bytes: BYTES,
    });

    expect(registered.map((face) => face.family)).toEqual([MAP_LABEL_FONT_FAMILIES.pdf]);
    expect(registered[0].source).toBe(BYTES);
  });

  it("registers it without disturbing the scene already drawn", () => {
    const registered = stubFontFace();
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ id: "e1" })] });

    frame.port.deliver({
      kind: "font",
      family: MAP_LABEL_FONT_FAMILIES.pdf,
      bytes: BYTES,
    });

    // A font message is not a scene: the face arrives and the picture stays.
    expect(registered).toHaveLength(1);
    expect(document.querySelectorAll("[data-element-id]")).toHaveLength(1);
  });

  it("registers nothing for a malformed font message", () => {
    const registered = stubFontFace();
    frame = loadFrame();

    for (const message of [
      { kind: "font", family: "", bytes: BYTES },
      { kind: "font", family: MAP_LABEL_FONT_FAMILIES.pdf },
      { kind: "font", family: MAP_LABEL_FONT_FAMILIES.pdf, bytes: "not bytes" },
      { kind: "font", bytes: BYTES },
    ]) {
      frame.port.deliver(message);
    }

    expect(registered).toEqual([]);
  });

  it("keeps drawing where the engine has no FontFace at all", () => {
    frame = loadFrame();

    // No stub: document.fonts is undefined, what an engine without the
    // FontFace API looks like. The label keeps its serif fallback.
    frame.port.deliver({
      kind: "font",
      family: MAP_LABEL_FONT_FAMILIES.pdf,
      bytes: BYTES,
    });
    frame.scene({ elements: [sceneElement()] });

    expect(document.querySelector("svg")).not.toBeNull();
  });
});

/** One picture's bytes, base64, as they cross the port (#756). */
const base64 = (text: string): string => btoa(text);
const textOf = (data: string): string => atob(data);

/** Waits for one reply the Frame posts a turn later, since an ingest is async. */
async function reply(port: FakePort, index = 0): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(port.messages.length).toBeGreaterThan(index));
  const message = port.messages[index];
  if (message === undefined) throw new Error(`the Frame posted no reply at ${index}`);
  return message;
}

/** One uploaded picture, in the namespace a real SVG file declares. */
function picture(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

describe("ingesting an uploaded SVG", () => {
  it("sanitizes it, measures it, and says whether it draws in one paint", async () => {
    frame = loadFrame();
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36"><script>alert(1)</script><path d="M 0 0 L 24 0 L 24 36 Z" fill="#1f2933"/></svg>`;
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 9,
      mime: "image/svg+xml",
      data: base64(markup),
    });

    const answer = await reply(frame.port);
    expect(answer).toMatchObject({
      kind: "asset-ingested",
      requestId: 9,
      width: 24,
      height: 36,
      recolorable: true,
    });
    // The Library keeps the cleaned markup, never the bytes the file arrived with.
    const kept = textOf(String(answer.data));
    expect(kept).not.toContain("script");
    expect(kept).toContain("<path");
  });

  it("calls a two-colour picture not recolorable", async () => {
    frame = loadFrame();
    const markup = picture(
      `<path d="M 0 0 L 4 0 L 4 4 Z" fill="#8b1a1a"/><path d="M 6 0 L 8 0" fill="none" stroke="#3b6e8f"/>`
    );
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 1,
      mime: "image/svg+xml",
      data: base64(markup),
    });

    expect(await reply(frame.port)).toMatchObject({ recolorable: false });
  });

  it("measures by the declared size when no viewBox says it, and 100 by 100 as a last resort", async () => {
    frame = loadFrame();
    const declared = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="1" height="1"/></svg>`;
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 1,
      mime: "image/svg+xml",
      data: base64(declared),
    });
    expect(await reply(frame.port)).toMatchObject({ width: 240, height: 360 });

    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 2,
      mime: "image/svg+xml",
      data: base64(picture(`<rect width="1" height="1"/>`)),
    });
    expect(await reply(frame.port, 1)).toMatchObject({
      requestId: 2,
      width: 100,
      height: 100,
    });
  });

  it("refuses an upload that is not a picture", async () => {
    frame = loadFrame();
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 5,
      mime: "image/svg+xml",
      data: base64("<div>not a picture</div>"),
    });

    expect(await reply(frame.port)).toEqual({
      kind: "ingest-error",
      requestId: 5,
      reason: "invalid-image",
    });
  });
});

describe("ingesting an uploaded raster", () => {
  /** jsdom has no decoder, so the Frame is given one that reports a size. */
  function stubBitmap(size: { width: number; height: number }): {
    blobs: Blob[];
    closed: number;
  } {
    const blobs: Blob[] = [];
    const state = { blobs, closed: 0 };
    (globalThis as Record<string, unknown>).createImageBitmap = async (blob: Blob) => {
      blobs.push(blob);
      return {
        width: size.width,
        height: size.height,
        close: () => {
          state.closed += 1;
        },
      };
    };
    return state;
  }

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).createImageBitmap;
  });

  it("measures it from the decoded bitmap, and never calls it recolorable", async () => {
    const bitmap = stubBitmap({ width: 640, height: 480 });
    frame = loadFrame();
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 2,
      mime: "image/png",
      data: "iVBORw0KGgo=",
    });

    expect(await reply(frame.port)).toEqual({
      kind: "asset-ingested",
      requestId: 2,
      // A raster is stored exactly as uploaded: its paints are pixels.
      data: "iVBORw0KGgo=",
      width: 640,
      height: 480,
      recolorable: false,
    });
    expect(bitmap.blobs[0]?.type).toBe("image/png");
    expect(bitmap.closed).toBe(1);
  });

  it("refuses a picture the decoder rejects, or that this engine cannot decode", async () => {
    (globalThis as Record<string, unknown>).createImageBitmap = async () => {
      throw new Error("broken bytes");
    };
    frame = loadFrame();
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 3,
      mime: "image/jpeg",
      data: "/9j/4AAQ",
    });
    expect(await reply(frame.port)).toEqual({
      kind: "ingest-error",
      requestId: 3,
      reason: "invalid-image",
    });

    // jsdom has no createImageBitmap at all, which is what an engine without
    // the API looks like: the upload is refused rather than stored unmeasured.
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 4,
      mime: "image/png",
      data: "AAAA",
    });
    expect(await reply(frame.port, 1)).toEqual({
      kind: "ingest-error",
      requestId: 4,
      reason: "invalid-image",
    });
  });
});

describe("an ingest request", () => {
  it("drops one with no id, no picture type, or no bytes, and answers the next valid one", async () => {
    frame = loadFrame();
    for (const message of [
      { kind: "ingest-asset" },
      { kind: "ingest-asset", requestId: 1, mime: "", data: "AA" },
      { kind: "ingest-asset", requestId: 1, mime: "image/svg+xml", data: "" },
      { kind: "ingest-asset", requestId: "1", mime: "image/svg+xml", data: "AA" },
      "nonsense",
    ]) {
      frame.port.deliver(message);
    }

    frame.port.deliver({
      kind: "ingest-asset",
      requestId: 7,
      mime: "image/svg+xml",
      data: base64(picture(`<rect width="4" height="4"/>`)),
    });

    // A malformed request is dropped, not answered: the one after it is the
    // only reply the Worker gets, and it keeps the id it asked with.
    expect(await reply(frame.port)).toMatchObject({ kind: "asset-ingested", requestId: 7 });
    expect(frame.port.messages).toHaveLength(1);
  });
});

describe("an uploaded picture's bytes", () => {
  it("keeps one blob URL per asset and revokes the one it replaces", () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      const url = `blob:mock/${created.length + 1}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    try {
      frame = loadFrame();
      const asset = (id: string, data: string) => ({ kind: "asset", id, mime: "image/png", data });

      frame.port.deliver(asset("a1", "AAAA"));
      expect(created).toEqual(["blob:mock/1"]);

      // The same picture uploaded again replaces its URL, and the old one is
      // freed rather than leaked for the life of the Frame.
      frame.port.deliver(asset("a1", "BBBB"));
      expect(created).toEqual(["blob:mock/1", "blob:mock/2"]);
      expect(revoked).toEqual(["blob:mock/1"]);

      frame.port.deliver(asset("a2", "CCCC"));
      expect(created).toHaveLength(3);
      expect(revoked).toEqual(["blob:mock/1"]);

      // A message with no id, type, or bytes keeps nothing.
      for (const message of [
        { kind: "asset" },
        { kind: "asset", id: "", mime: "image/png", data: "AAAA" },
        { kind: "asset", id: "a3", mime: "", data: "AAAA" },
        { kind: "asset", id: "a3", mime: "image/png", data: "" },
      ]) {
        frame.port.deliver(message);
      }
      expect(created).toHaveLength(3);

      // A Frame that goes away frees every picture it kept.
      for (const cleanup of frame.cleanups) cleanup();
      frame = null;
      expect(revoked).toEqual(["blob:mock/1", "blob:mock/2", "blob:mock/3"]);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe("drawing the scene", () => {
  it("draws the page, every visible Element, and the selection", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({ id: "e1", selected: true }),
        sceneElement({ id: "e2", hidden: true, shapes: [shape({ d: "M 30 30 L 40 40" })] }),
        sceneElement({ id: "e3", locked: true, shapes: [] }),
      ],
    });

    const page = svg();
    expect(page.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(page.getAttribute("data-tool")).toBe("select");
    expect(document.querySelector("rect")?.getAttribute("fill")).toBe("#d7e6ec");

    // A hidden Element and one with no shape yet are not drawn; a locked one is.
    const groups = Array.from(document.querySelectorAll("[data-element-id]"));
    expect(groups.map((group) => group.getAttribute("data-element-id"))).toEqual(["e1"]);
    const line = groups[0].querySelector("path.map-line");
    expect(line?.getAttribute("d")).toBe("M 10 10 L 20 20");
    expect(line?.getAttribute("stroke")).toBe("#1f2933");
    expect(groups[0].getAttribute("data-selected")).toBe("true");
    expect(groups[0].querySelector("path.map-selection")).not.toBeNull();
  });

  it("draws each shape's stroke, width, dash, fill, and opacity", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            shape({ d: "M 1 1 L 2 2", stroke: "#8b1a1a", strokeWidth: 0.9, opacity: 0.6 }),
            shape({ d: "M 3 3 L 4 4", stroke: null, strokeWidth: 0, fill: "#3b6e8f" }),
            shape({ d: "M 5 5 L 6 6", strokeWidth: 0.5, dash: "2 1.2" }),
          ],
        }),
      ],
    });

    const lines = Array.from(document.querySelectorAll("path.map-line"));
    expect(lines).toHaveLength(3);
    expect(lines[0].getAttribute("stroke")).toBe("#8b1a1a");
    expect(lines[0].getAttribute("stroke-width")).toBe("0.9");
    expect(lines[0].getAttribute("opacity")).toBe("0.6");
    expect(lines[1].getAttribute("stroke")).toBe("none");
    expect(lines[1].getAttribute("fill")).toBe("#3b6e8f");
    expect(lines[1].getAttribute("stroke-width")).toBeNull();
    expect(lines[2].getAttribute("stroke-dasharray")).toBe("2 1.2");
    expect(lines[2].getAttribute("opacity")).toBeNull();
  });

  it("draws no shape the Worker sent without a usable stroke width", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            shape({ d: "M 1 1 L 2 2", strokeWidth: undefined }),
            shape({ d: "M 3 3 L 4 4", strokeWidth: -1 }),
            shape({ d: "M 5 5 L 6 6", stroke: null, strokeWidth: 0, fill: "#3b6e8f" }),
          ],
        }),
      ],
    });

    // Every shape the Worker sends carries its width, so a missing one is a
    // malformed primitive and not a guess at 0.6 mm.
    const lines = Array.from(document.querySelectorAll("path.map-line"));
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute("d")).toBe("M 5 5 L 6 6");
    expect(lines[0].getAttribute("fill")).toBe("#3b6e8f");
  });

  it("hit-tests a filled river by its area, and a stroke by its line", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            shape({ d: "M 3 3 L 4 4", stroke: null, strokeWidth: 0, fill: "#3b6e8f" }),
            shape({ d: "M 5 5 L 6 6" }),
          ],
        }),
      ],
    });

    const hits = Array.from(document.querySelectorAll("path.map-hit"));
    expect(hits).toHaveLength(2);
    expect(hits[0].getAttribute("data-fill")).toBe("true");
    expect(hits[1].getAttribute("data-fill")).toBeNull();
  });

  it("draws a selected Element without an outline once the Worker clears it", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ selected: true })] });
    expect(document.querySelector("path.map-selection")).not.toBeNull();

    frame.scene({ elements: [sceneElement()] });
    expect(document.querySelector("path.map-selection")).toBeNull();
  });

  it("marks a selected Fill's area outline only, not its paint or the Stamps it scatters", () => {
    frame = loadFrame();
    const area = "M 0 0 L 10 0 L 10 10 Z";
    frame.scene({
      defs: ['<clipPath id="fill-clip-a1"><path d="M 0 0 L 10 0 L 10 10 Z"/></clipPath>'],
      elements: [
        sceneElement({
          selected: true,
          shapes: [
            // The Fill's colour and the texture laid over it draw one area.
            shape({ d: area, stroke: null, strokeWidth: 0, fill: "#cbd59f", fillRule: "evenodd" }),
            shape({
              d: area,
              stroke: null,
              strokeWidth: 0,
              fill: "url(#texture-grass)",
              fillRule: "evenodd",
            }),
            // Two scattered Stamps, each clipped to the area it sits in.
            shape({
              d: "M -2 -2 L 2 -2 L 2 2 Z",
              transform: "translate(2 2)",
              clip: "fill-clip-a1",
            }),
            shape({
              d: "M -2 -2 L 2 -2 L 2 2 Z",
              transform: "translate(8 8)",
              clip: "fill-clip-a1",
            }),
          ],
        }),
      ],
    });

    // One outline marks the Fill's area, whatever paint or scatter it holds; a
    // Stamp is content inside the area, never a separate outline of its own.
    const highlights = Array.from(document.querySelectorAll("path.map-selection"));
    expect(highlights).toHaveLength(1);
    expect(highlights[0].getAttribute("d")).toBe(area);
    expect(highlights[0].getAttribute("transform")).toBeNull();
  });

  it("crops and slides the viewBox with zoom and pan", () => {
    frame = loadFrame();
    frame.scene({ zoom: 2, panX: 10, panY: -5 });
    expect(svg().getAttribute("viewBox")).toBe("60 20 100 50");
  });

  it("drops a malformed scene and keeps drawing nothing", () => {
    frame = loadFrame();
    frame.port.deliver({ kind: "scene" });
    frame.port.deliver({ kind: "scene", widthMm: 0, heightMm: 100 });
    frame.port.deliver("nonsense");
    expect(document.querySelector("svg")).toBeNull();
  });
});

describe("the scene's definitions", () => {
  it("draws the texture patterns, scatter Clip Paths, and Soft Edge filters the Worker sends", () => {
    frame = loadFrame();
    frame.scene({
      defs: [
        '<pattern id="texture-grass" patternUnits="userSpaceOnUse" width="4" height="4"><path d="M 0.6 3.6 L 1.2 1.7"/></pattern>',
        '<clipPath id="fill-clip-a1"><path d="M 0 0 L 10 0 L 10 10 Z" clip-rule="evenodd"/></clipPath>',
        '<filter id="soft-edge-b2" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB" x="-5" y="-5" width="30" height="30"><feGaussianBlur stdDeviation="2"/></filter>',
      ],
      elements: [
        sceneElement({
          filter: "soft-edge-b2",
          shapes: [
            shape({
              d: "M 0 0 L 10 0 L 10 10 Z",
              stroke: null,
              strokeWidth: 0,
              fill: "url(#texture-grass)",
            }),
          ],
        }),
      ],
    });

    const defs = document.querySelector("defs");
    expect(defs?.querySelector("pattern#texture-grass")).not.toBeNull();
    expect(defs?.querySelector("clipPath#fill-clip-a1 path")?.getAttribute("clip-rule")).toBe(
      "evenodd"
    );
    const blur = defs?.querySelector("filter#soft-edge-b2 feGaussianBlur");
    expect(blur?.getAttribute("stdDeviation")).toBe("2");
    expect(
      defs?.querySelector("filter#soft-edge-b2")?.getAttribute("color-interpolation-filters")
    ).toBe("sRGB");

    // The Element's art draws through its filter, in the texture it references.
    const group = document.querySelector('g[data-element-id="e1"]');
    const filtered = group?.querySelector('g[filter="url(#soft-edge-b2)"]');
    expect(filtered?.querySelector("path.map-line")?.getAttribute("fill")).toBe(
      "url(#texture-grass)"
    );
  });

  it("draws no definitions for a scene that references none", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement()] });

    expect(document.querySelector("defs")).toBeNull();
    expect(document.querySelector("[filter]")).toBeNull();
  });

  it("drops a filter id a scene could write an attribute of its own into", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ filter: 'x" onload="alert(1)' })],
    });

    expect(document.querySelector("[filter]")).toBeNull();
  });

  it("draws a scattered Stamp's Clip Path on a group, where its transform cannot move the clip", () => {
    frame = loadFrame();
    const area = "M 0 0 L 10 0 L 10 10 Z";
    frame.scene({
      defs: ['<clipPath id="fill-clip-a1"><path d="M 0 0 L 10 0 L 10 10 Z"/></clipPath>'],
      elements: [
        sceneElement({
          shapes: [
            shape({ d: area, stroke: null, strokeWidth: 0, fill: "#cbd59f" }),
            shape({
              d: "M -2 -2 L 2 -2 L 2 2 Z",
              transform: "translate(5 5) scale(0.5)",
              clip: "fill-clip-a1",
            }),
          ],
        }),
      ],
    });

    const group = document.querySelector('g[data-element-id="e1"]');
    // The Fill's own paint draws in page space, so it takes no clip and sits
    // outside every clip group.
    expect(group?.querySelector(":scope > path.map-line")?.getAttribute("d")).toBe(area);

    // The Stamp's art and its hit target both draw inside a group that carries
    // the Clip Path: SVG applies a clip in the user space of the element that
    // references it, so a clip on the transformed path itself would move the
    // clip with the art and cut the Stamp away.
    const clipGroups = group?.querySelectorAll('g[clip-path="url(#fill-clip-a1)"]') ?? [];
    expect(clipGroups).toHaveLength(2);
    const clipped = Array.from(clipGroups).flatMap((clipGroup) =>
      Array.from(clipGroup.querySelectorAll("path"))
    );
    expect(clipped).toHaveLength(2);
    for (const path of clipped) {
      expect(path.getAttribute("clip-path")).toBeNull();
      expect(path.getAttribute("transform")).toBe("translate(5 5) scale(0.5)");
    }
  });

  it("drops a clip id a scene could write an attribute of its own into", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ shapes: [shape({ clip: 'x" onload="alert(1)' })] })],
    });

    expect(document.querySelector("[clip-path]")).toBeNull();
  });
});

describe("Stamp shapes", () => {
  it("draws a text shape as SVG text and honours a shape's own transform", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            shape({ transform: "translate(100 50) scale(1.2)" }),
            {
              text: "200 km",
              x: 40,
              y: 60,
              size: 3,
              fill: "#1f2933",
              font: TEXT_FONT_FAMILY,
              anchor: "end",
              transform: "translate(100 50)",
            },
          ],
        }),
      ],
    });

    const line = document.querySelector("path.map-line");
    expect(line?.getAttribute("transform")).toBe("translate(100 50) scale(1.2)");

    const text = document.querySelector("text");
    expect(text?.textContent).toBe("200 km");
    expect(text?.getAttribute("x")).toBe("40");
    expect(text?.getAttribute("y")).toBe("60");
    expect(text?.getAttribute("font-size")).toBe("3");
    expect(text?.getAttribute("font-family")).toBe(TEXT_FONT_FAMILY);
    expect(text?.getAttribute("fill")).toBe("#1f2933");
    expect(text?.getAttribute("text-anchor")).toBe("end");
    expect(text?.getAttribute("transform")).toBe("translate(100 50)");
  });

  it("drops a text shape with no place, no size, or no colour", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            { text: "0", y: 10, size: 2, fill: "#1f2933", anchor: "start" },
            { text: "0", x: 1, y: 10, size: 0, fill: "#1f2933", anchor: "start" },
            { text: "0", x: 1, y: 10, size: 2, anchor: "start" },
          ],
        }),
      ],
    });

    expect(document.querySelector("text")).toBeNull();
    expect(document.querySelector("[data-element-id]")).toBeNull();
  });
});

describe("Map Label shapes", () => {
  /** The baseline the test's label follows: 40 mm wide, its middle lifted 8 mm. */
  const BASELINE = "M 0 30 Q 20 14 40 30";

  /** The label's selectable area, which paints no ink of its own. */
  const labelHit = () =>
    shape({ d: BASELINE, stroke: null, strokeWidth: 0, fill: null, hitOnly: true });

  /** The label's text, following `BASELINE`, with the halo it is drawn over. */
  const labelText = (overrides: Record<string, unknown> = {}) => ({
    text: "The Reach",
    x: 20,
    y: 30,
    size: 6,
    fill: "#1f2933",
    font: "IM Fell English",
    anchor: "middle",
    letterSpacing: 0.4,
    halo: { color: "#d7e6ec", width: 0.8 },
    path: { id: "label-path-a1", d: BASELINE },
    ...overrides,
  });

  it("draws a label's text along its baseline, which the defs define", () => {
    frame = loadFrame();
    frame.scene({
      defs: [`<path id="label-path-a1" d="${BASELINE}"/>`],
      elements: [sceneElement({ shapes: [labelHit(), labelText()] })],
    });

    expect(document.querySelector("defs path#label-path-a1")?.getAttribute("d")).toBe(BASELINE);
    const text = document.querySelector("text.map-line");
    expect(text?.getAttribute("text-anchor")).toBe("middle");
    expect(text?.getAttribute("font-family")).toBe("IM Fell English");
    expect(text?.getAttribute("letter-spacing")).toBe("0.4");
    expect(text?.querySelector("textPath")?.getAttribute("href")).toBe("#label-path-a1");
    expect(text?.querySelector("textPath")?.getAttribute("startOffset")).toBe("50%");
    expect(text?.textContent).toBe("The Reach");
    // A text on a path starts from its startOffset. Chromium drops the textPath
    // when the same <text> also carries an x, laying the run out at the origin
    // with nothing painted (#751), so neither copy writes x or y.
    expect(text?.hasAttribute("x")).toBe(false);
    expect(text?.hasAttribute("y")).toBe(false);
  });

  it("draws the halo first, a stroked copy of the same text with no fill", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ shapes: [labelHit(), labelText()] })] });

    const texts = Array.from(document.querySelectorAll("text.map-line"));
    expect(texts).toHaveLength(2);
    expect(texts[0].getAttribute("stroke")).toBe("#d7e6ec");
    expect(texts[0].getAttribute("fill")).toBe("none");
    expect(texts[0].getAttribute("stroke-width")).toBe("0.8");
    expect(texts[0].querySelector("textPath")).not.toBeNull();
    expect(texts[1].getAttribute("stroke")).toBeNull();
    expect(texts[1].getAttribute("fill")).toBe("#1f2933");
  });

  it("hit-tests a label by its baseline, which the selection outlines", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, shapes: [labelHit(), labelText()] })],
    });

    expect(document.querySelector("path.map-hit")?.getAttribute("d")).toBe(BASELINE);
    // The hit path is a pointer target, not ink: the label's art is its text.
    expect(document.querySelectorAll("path.map-line")).toHaveLength(0);
    expect(document.querySelector("path.map-selection")?.getAttribute("d")).toBe(BASELINE);
  });

  it("draws an empty label's placeholder italic and muted, still picked by its baseline (#798)", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            labelHit(),
            labelText({
              text: "Write your text here",
              placeholder: true,
              opacity: 0.5,
            }),
          ],
        }),
      ],
    });

    // Halo and ink alike are italic and faded, in the label's own font, so the
    // prompt previews how the text will look.
    const texts = Array.from(document.querySelectorAll("text.map-line"));
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text.textContent?.trim()).toBe("Write your text here");
      expect(text.getAttribute("font-style")).toBe("italic");
      expect(text.getAttribute("opacity")).toBe("0.5");
      expect(text.getAttribute("font-family")).toBe("IM Fell English");
    }

    const hit = document.querySelector('g[data-element-id="e1"] path.map-hit');
    if (hit === null) throw new Error("the label drew no hit path");
    pointer(hit, "pointerdown", 20, 30);
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);

    // A label with text carries neither mark.
    frame.scene({ elements: [sceneElement({ shapes: [labelHit(), labelText()] })] });
    for (const text of document.querySelectorAll("text.map-line")) {
      expect(text.getAttribute("font-style")).toBeNull();
      expect(text.getAttribute("opacity")).toBeNull();
    }
  });

  it("draws a label without its baseline when the scene names an id it could write into", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [labelText({ path: { id: 'x" onload="alert(1)', d: BASELINE } })],
        }),
      ],
    });

    expect(document.querySelector("textPath")).toBeNull();
    expect(document.querySelector("text.map-line")?.textContent).toBe("The Reach");
  });
});

describe("the Map Label bend handle", () => {
  /** The baseline a label at (100, 50), 40 mm wide, arching 8 mm draws. */
  const bendLabel = (overrides: Record<string, unknown> = {}) => ({
    x: 100,
    y: 50,
    rotation: 0,
    width: 40,
    bend: 8,
    ...overrides,
  });

  /** The one bend handle the Frame drew. */
  const handle = (): Element => {
    const circle = document.querySelector("circle.map-bend-handle");
    if (circle === null) throw new Error("the Frame drew no bend handle");
    return circle;
  };

  /** Where the handle sits, in page millimetres. */
  const apex = (): [string | null, string | null] => [
    handle().getAttribute("cx"),
    handle().getAttribute("cy"),
  ];

  it("draws one handle at the apex of the selected label's curve", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ selected: true, label: bendLabel() })] });

    // The label sits at (100, 50) and arches 8 mm toward the top of the page,
    // so its apex, which the quadratic reaches at its middle, is (100, 42).
    expect(handle().getAttribute("data-bend-handle")).toBe("e1");
    expect(apex()).toEqual(["100", "42"]);
  });

  it("places the handle on the turned curve, and hides it on a locked or hidden label", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, label: bendLabel({ rotation: 90 }) })],
    });
    // A quarter turn clockwise makes the label's arch lift toward page +x.
    expect(apex()).toEqual(["108", "50"]);

    for (const overrides of [{ locked: true }, { hidden: true }]) {
      frame.scene({
        elements: [sceneElement({ selected: true, label: bendLabel(), ...overrides })],
      });
      expect(document.querySelector("circle.map-bend-handle")).toBeNull();
    }

    frame.scene({ elements: [sceneElement({ label: bendLabel() })] });
    expect(document.querySelector("circle.map-bend-handle")).toBeNull();
  });

  it("drags the handle into a new bend, previews it, and posts one bendLabel", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, movable: true, label: bendLabel() })],
    });

    pointer(handle(), "pointerdown", 100, 42);
    pointer(svg(), "pointermove", 100, 36);
    // The drag previews live: the handle and the curve follow the pointer.
    expect(apex()).toEqual(["100", "36"]);
    expect(document.querySelector("path.map-bend-preview")?.getAttribute("d")).toBe(
      "M 80 50 Q 100 22 120 50"
    );
    pointer(svg(), "pointerup", 100, 36);

    // The press shaped the curve: it never picked or moved the label, and the
    // whole drag is one message, so the Worker can make it one undo step.
    expect(frame.port.messages).toEqual([{ kind: "bendLabel", id: "e1", bend: 14 }]);
    // The preview holds until the Worker answers, so the curve never jumps back.
    expect(apex()).toEqual(["100", "36"]);
    frame.scene({
      elements: [sceneElement({ selected: true, movable: true, label: bendLabel() })],
    });
    expect(apex()).toEqual(["100", "42"]);
  });

  it("straightens the label when the handle is dragged back to the chord", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, movable: true, label: bendLabel() })],
    });

    pointer(handle(), "pointerdown", 100, 42);
    // A third of a millimetre off the chord is too small to see: it snaps to 0.
    pointer(svg(), "pointermove", 100, 50.3);
    pointer(svg(), "pointerup", 100, 50.3);

    expect(frame.port.messages).toEqual([{ kind: "bendLabel", id: "e1", bend: 0 }]);
  });

  it("still picks and moves the label when the press lands off the handle", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, movable: true, label: bendLabel() })],
    });
    const label = document.querySelector('g[data-element-id="e1"] path.map-line');
    if (label === null) throw new Error("the Element drew no line");

    pointer(label, "pointerdown", 100, 50);
    pointer(svg(), "pointermove", 110, 50);
    pointer(svg(), "pointerup", 110, 50);

    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      { kind: "move", id: "e1", dx: 10, dy: 0 },
    ]);
  });

  it("drops a bend drag the pointer cancels without posting it", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, movable: true, label: bendLabel() })],
    });

    pointer(handle(), "pointerdown", 100, 42);
    pointer(svg(), "pointermove", 100, 36);
    pointer(svg(), "pointercancel", 100, 36);

    expect(frame.port.messages).toEqual([]);
  });

  it("posts nothing when the handle is pressed and released without moving", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ selected: true, movable: true, label: bendLabel() })],
    });

    // A press on the handle's edge is not a drag: the pointer never travelled
    // past the same threshold a Select drag uses, so the bend stays as it was.
    pointer(handle(), "pointerdown", 100, 44);
    pointer(svg(), "pointerup", 100, 44);

    expect(frame.port.messages).toEqual([]);
  });
});

describe("the Map Label bend arithmetic", () => {
  /** One label writing on a page centred baseline; only its layout varies. */
  const label = (overrides: Partial<MapLabelElement>): MapLabelElement => ({
    id: "label",
    kind: "label",
    name: "Label",
    hidden: false,
    locked: false,
    text: "Label",
    x: 100,
    y: 50,
    rotation: 0,
    width: 40,
    bend: 8,
    font: "im-fell-english",
    size: 6,
    letterSpacing: 0,
    halo: 0.8,
    ...overrides,
  });

  /** The middle of a quadratic baseline's three points, in page millimetres. */
  function midpoint(d: string): [number, number] {
    const match = /^M (-?[\d.]+) (-?[\d.]+) Q (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(d);
    if (match === null) throw new Error(`unexpected baseline: ${d}`);
    const [sx, sy, cx, cy, ex, ey] = match.slice(1).map(Number);
    return [(sx + 2 * cx + ex) / 4, (sy + 2 * cy + ey) / 4];
  }

  /** The handle's place, in page millimetres. */
  function apex(): [string | null, string | null] {
    const circle = document.querySelector("circle.map-bend-handle");
    if (circle === null) throw new Error("the Frame drew no bend handle");
    return [circle.getAttribute("cx"), circle.getAttribute("cy")];
  }

  /** The one bend handle the Frame drew. */
  function handle(): Element {
    const circle = document.querySelector("circle.map-bend-handle");
    if (circle === null) throw new Error("the Frame drew no bend handle");
    return circle;
  }

  it("puts the handle at maps.ts's apex and posts the bend maps.ts computes from a point", () => {
    const cases = [
      label({}),
      label({ id: "turned", x: 60, y: 80, rotation: 37, width: 55, bend: -4.5 }),
      label({ id: "leaned", x: 20, y: 20, rotation: -120, width: 30, bend: 12 }),
    ];

    for (const one of cases) {
      frame = loadFrame();
      frame.scene({
        elements: [sceneElement({ id: one.id, selected: true, movable: true, label: one })],
      });

      // The handle sits on the midpoint of the baseline `maps.ts` draws.
      const [mx, my] = midpoint(labelBaselinePath(one));
      expect(Number(apex()[0])).toBeCloseTo(mx, 1);
      expect(Number(apex()[1])).toBeCloseTo(my, 1);

      // Dragging to a point posts the bend `bendFromPoint` computes for it.
      const point: [number, number] = [one.x + 13, one.y - 6];
      pointer(handle(), "pointerdown", Number(apex()[0]), Number(apex()[1]));
      pointer(svg(), "pointermove", point[0], point[1]);
      pointer(svg(), "pointerup", point[0], point[1]);
      expect(frame.port.messages).toEqual([
        { kind: "bendLabel", id: one.id, bend: bendFromPoint(one, point) },
      ]);

      for (const cleanup of frame.cleanups) cleanup();
      frame = null;
    }
  });
});

describe("the scene message", () => {
  it("sends the shapes the list preview draws a Map Line from", () => {
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        {
          id: "e1",
          kind: "line" as const,
          name: "Coast",
          hidden: false,
          locked: false,
          points: [
            [0, 0],
            [10, 10],
          ] as [number, number][],
          style: "plain" as const,
          enclosesFills: true,
          closed: false,
          curves: [true],
          roughened: false,
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });
    expect(message.elements[0].shapes).toEqual([
      {
        d: "M 0 0 L 10 10",
        stroke: "#1f2933",
        strokeWidth: 0.6,
        dash: null,
        fill: null,
        opacity: 1,
      },
    ]);
    expect(sceneToSvg(map)).toContain('stroke="#1f2933"');
  });

  it("carries a river's filled polygon, which has no single path to send", () => {
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        {
          id: "river",
          kind: "line" as const,
          name: "River",
          hidden: false,
          locked: false,
          points: [
            [0, 0],
            [10, 0],
          ] as [number, number][],
          style: "river" as const,
          enclosesFills: false,
          closed: false,
          curves: [false],
          roughened: false,
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });
    expect(message.elements[0].shapes).toEqual([
      {
        d: "M 0 0.1 L 10 0.7 L 10 -0.7 L 0 -0.1 Z",
        stroke: null,
        strokeWidth: 0,
        dash: null,
        fill: "#3b6e8f",
        opacity: 1,
      },
    ]);
  });

  it("sends a Fill's face path as one filled, evenodd shape", () => {
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        {
          id: "ring",
          kind: "line" as const,
          name: "Coast",
          hidden: false,
          locked: false,
          points: [
            [0, 0],
            [40, 0],
            [40, 40],
            [0, 40],
          ] as [number, number][],
          style: "plain" as const,
          enclosesFills: true,
          closed: true,
          curves: [false, false, false, false],
          roughened: false,
        },
        {
          id: "land",
          kind: "fill" as const,
          name: "Land",
          hidden: false,
          locked: false,
          anchor: [20, 20] as [number, number],
          content: { color: "#c8d5a3" },
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });

    const shape = message.elements[1].shapes[0];
    if (!("d" in shape)) throw new Error("the Fill drew no path");
    expect(message.elements[1].shapes).toHaveLength(1);
    expect(shape).toMatchObject({
      stroke: null,
      strokeWidth: 0,
      dash: null,
      fill: "#c8d5a3",
      fillRule: "evenodd",
      opacity: 1,
    });
    expect(shape.d).toMatch(/^M .+ Z$/);
  });

  it("carries a Stamp's art and its scale bar's labels", () => {
    const map = {
      page: { preset: "portrait" as const, widthMm: 152.4, heightMm: 228.6 },
      elements: [
        {
          id: "marker",
          kind: "stamp" as const,
          name: "City",
          hidden: false,
          locked: false,
          stampRef: "base:marker",
          transform: { x: 100, y: 50, size: 12, rotation: 0 },
          color: "#1f2933",
        },
        {
          id: "bar",
          kind: "stamp" as const,
          name: "Scale",
          hidden: false,
          locked: false,
          stampRef: "base:scale-bar",
          transform: { x: 100, y: 200, size: 40, rotation: 0 },
          color: "#1f2933",
          scale: { unit: "km" as const, span: 1000 },
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });

    expect(message.elements[0].shapes).toEqual([
      expect.objectContaining({
        stroke: null,
        fill: "#1f2933",
        transform: "translate(100 50) scale(1.111) translate(0 0)",
      }),
      expect.objectContaining({
        stroke: null,
        fill: "#1f2933",
        transform: "translate(100 50) scale(1.111) translate(0 0)",
      }),
    ]);
    const labels = message.elements[1].shapes.filter((shape) => "text" in shape);
    expect(labels.map((shape) => ("text" in shape ? shape.text : ""))).toEqual(["0", "200 km"]);
    // The font travels with the label, so the Frame and an export agree.
    for (const label of labels) expect(label).toMatchObject({ font: TEXT_FONT_FAMILY });
  });

  it("carries an Area Fill's texture and Soft Edge as the definitions the Frame draws", () => {
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        {
          id: "meadow",
          kind: "fill" as const,
          name: "Meadow",
          hidden: false,
          locked: false,
          anchor: [10, 10] as [number, number],
          outline: {
            points: [
              [0, 0],
              [20, 0],
              [20, 20],
              [0, 20],
            ] as [number, number][],
            curves: [false, false, false, false],
            roughened: false,
          },
          content: { color: "#c8d5a3", texture: "grass" as const },
          softEdge: 2,
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });

    const defs = message.defs.join("");
    expect(defs).toContain('id="texture-grass"');
    expect(defs).toContain("<feGaussianBlur");
    // The Element names its own Soft Edge filter, which the defs define.
    expect(message.elements[0].filter).toMatch(/^soft-edge-[0-9a-f]+$/);
    expect(defs).toContain(`id="${message.elements[0].filter}"`);
  });

  it("carries a scatter Fill's Clip Path, so the Frame cuts its Stamps to the area", () => {
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        {
          id: "forest",
          kind: "fill" as const,
          name: "Forest",
          hidden: false,
          locked: false,
          anchor: [10, 10] as [number, number],
          outline: {
            points: [
              [0, 0],
              [20, 0],
              [20, 20],
              [0, 20],
            ] as [number, number][],
            curves: [false, false, false, false],
            roughened: false,
          },
          content: { scatter: { stamp: "base:tree", spacing: 8, seed: 5 } },
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });

    expect(message.defs.join("")).toMatch(/<clipPath id="fill-clip-[0-9a-f]+">/);
    const paths = message.elements[0].shapes.filter((shape) => "d" in shape);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.clip).toMatch(/^fill-clip-[0-9a-f]+$/);
  });
});

describe("the area message", () => {
  it("reads a freehand outline, which carries no curves", () => {
    expect(
      parseFrameMessage({
        kind: "area",
        points: [
          [10, 10],
          [40, 10],
          [40, 40],
        ],
        curves: [],
        freehand: true,
      })
    ).toEqual({
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
      ],
      curves: [],
      freehand: true,
    });
  });

  it("reads a point-by-point outline with one flag per segment, the closing one too", () => {
    expect(
      parseFrameMessage({
        kind: "area",
        points: [
          [10, 10],
          [40, 10],
          [40, 40],
        ],
        curves: [false, true, false],
        freehand: false,
      })
    ).toEqual({
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
      ],
      curves: [false, true, false],
      freehand: false,
    });
  });

  it("drops an area message with a missing flag or the wrong curve count", () => {
    const valid = {
      kind: "area",
      points: [
        [10, 10],
        [40, 10],
        [40, 40],
      ],
      curves: [false, false, false],
      freehand: false,
    };
    for (const message of [
      { ...valid, freehand: undefined },
      { ...valid, freehand: "no" },
      { ...valid, curves: undefined },
      { ...valid, curves: [false, false] },
      { ...valid, curves: [false, false, false, false] },
      {
        ...valid,
        points: [
          [10, 10],
          [40, 10],
        ],
      },
      {
        ...valid,
        points: [
          [10, 10],
          [40, 10],
          [40, "40"],
        ],
      },
      // A freehand outline is smoothed by the Worker, so it carries no curves.
      { ...valid, freehand: true },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });
});

describe("the shape message", () => {
  it("reads a Shape drawn between two drag corners", () => {
    expect(
      parseFrameMessage({
        kind: "shape",
        shape: "ellipse",
        start: [10, 10],
        end: [50, 30],
        constrain: false,
      })
    ).toEqual({
      kind: "shape",
      shape: "ellipse",
      start: [10, 10],
      end: [50, 30],
      constrain: false,
    });
  });

  it("drops a Shape message with an unknown kind or a malformed corner", () => {
    const valid = {
      kind: "shape",
      shape: "polygon",
      start: [10, 10],
      end: [50, 30],
      constrain: true,
    };
    for (const message of [
      { ...valid, shape: "circle" },
      { ...valid, shape: undefined },
      { ...valid, start: [10] },
      { ...valid, end: [10, "30"] },
      { ...valid, constrain: "yes" },
      { ...valid, constrain: undefined },
      { kind: "shape", shape: "ellipse" },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });
});

describe("the pour message", () => {
  it("reads a pour at one page point", () => {
    expect(parseFrameMessage({ kind: "pour", point: [10, 20] })).toEqual({
      kind: "pour",
      point: [10, 20],
    });
  });

  it("drops a pour without a finite point", () => {
    for (const message of [
      { kind: "pour" },
      { kind: "pour", point: [Number.NaN, 20] },
      { kind: "pour", point: [10] },
      { kind: "pour", point: [10, "20"] },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });
});

describe("the insert message", () => {
  it("reads a Stamp dropped at one page point", () => {
    expect(parseFrameMessage({ kind: "insert", point: [10, 20] })).toEqual({
      kind: "insert",
      point: [10, 20],
    });
  });

  it("drops an insert without a finite point", () => {
    for (const message of [
      { kind: "insert" },
      { kind: "insert", point: [Number.NaN, 20] },
      { kind: "insert", point: [10] },
      { kind: "insert", point: [10, "20"] },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });
});

describe("the move message", () => {
  it("reads a Select drag of one Element by a page-millimetre offset", () => {
    expect(parseFrameMessage({ kind: "move", id: "e1", dx: 12.5, dy: -3 })).toEqual({
      kind: "move",
      id: "e1",
      dx: 12.5,
      dy: -3,
    });
  });

  it("drops a move without an Element id or a finite offset", () => {
    for (const message of [
      { kind: "move", dx: 1, dy: 1 },
      { kind: "move", id: "", dx: 1, dy: 1 },
      { kind: "move", id: 7, dx: 1, dy: 1 },
      { kind: "move", id: "e1", dx: Number.NaN, dy: 1 },
      { kind: "move", id: "e1", dx: 1, dy: Number.POSITIVE_INFINITY },
      { kind: "move", id: "e1", dx: "1", dy: 1 },
      { kind: "move", id: "e1", dx: 1 },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("marks only a shown, unlocked Map Line or Stamp as movable in the scene", () => {
    const line = {
      kind: "line" as const,
      hidden: false,
      locked: false,
      points: [
        [0, 0],
        [10, 10],
      ] as [number, number][],
      style: "plain" as const,
      enclosesFills: true,
      closed: false,
      curves: [false],
      roughened: false,
    };
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        { ...line, id: "free", name: "Free" },
        { ...line, id: "pinned", name: "Pinned", locked: true },
        { ...line, id: "veiled", name: "Veiled", hidden: true },
        {
          id: "stamp",
          kind: "stamp" as const,
          name: "City",
          hidden: false,
          locked: false,
          stampRef: "base:marker",
          transform: { x: 50, y: 50, size: 12, rotation: 0 },
          color: "#1f2933",
        },
        {
          id: "fill",
          kind: "fill" as const,
          name: "Fill 1",
          hidden: false,
          locked: false,
          anchor: [5, 5] as [number, number],
          content: { color: "#88aa66" },
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: null,
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });
    expect(message.elements.map((element) => [element.id, element.movable])).toEqual([
      ["free", true],
      ["pinned", false],
      ["veiled", false],
      ["stamp", true],
      ["fill", false],
    ]);
  });
});

describe("the bendLabel message", () => {
  it("reads the bend a drag on a Map Label's curve asks for", () => {
    expect(parseFrameMessage({ kind: "bendLabel", id: "e1", bend: 6.4 })).toEqual({
      kind: "bendLabel",
      id: "e1",
      bend: 6.4,
    });
  });

  it("drops a bend without an Element id or a finite bend", () => {
    for (const message of [
      { kind: "bendLabel", bend: 6 },
      { kind: "bendLabel", id: "", bend: 6 },
      { kind: "bendLabel", id: 7, bend: 6 },
      { kind: "bendLabel", id: "e1" },
      { kind: "bendLabel", id: "e1", bend: Number.NaN },
      { kind: "bendLabel", id: "e1", bend: Number.POSITIVE_INFINITY },
      { kind: "bendLabel", id: "e1", bend: "6" },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("carries a Map Label's baseline fields, and no other Element's", () => {
    const map = {
      page: { preset: "square" as const, widthMm: 200, heightMm: 100 },
      elements: [
        {
          id: "reach",
          kind: "label" as const,
          name: "The Reach",
          hidden: false,
          locked: false,
          text: "The Reach",
          x: 100,
          y: 50,
          rotation: 90,
          width: 40,
          bend: 8,
          font: "im-fell-english" as const,
          size: 6,
          letterSpacing: 0,
          halo: 0.8,
        },
        {
          id: "coast",
          kind: "line" as const,
          name: "Coast",
          hidden: false,
          locked: false,
          points: [
            [0, 0],
            [10, 10],
          ] as [number, number][],
          style: "plain" as const,
          enclosesFills: true,
          closed: false,
          curves: [false],
          roughened: false,
        },
      ],
    };
    const message = sceneMessage(map, {
      selectedId: "reach",
      tool: "select",
      zoom: 1,
      panX: 0,
      panY: 0,
      penLabel: PEN_LABEL,
      readout: READOUT,
    });

    expect(message.elements[0].label).toEqual({
      x: 100,
      y: 50,
      rotation: 90,
      width: 40,
      bend: 8,
    });
    expect(message.elements[1].label).toBeUndefined();
  });
});

describe("the Insert tool", () => {
  it("posts the page point of a click as one insert message", () => {
    frame = loadFrame();
    frame.scene({ tool: "insert" });
    expect(svg().getAttribute("data-tool")).toBe("insert");

    pointer(svg(), "pointerdown", 40, 30);
    expect(frame.port.messages).toEqual([{ kind: "insert", point: [40, 30] }]);
  });

  it("posts the page point of a Text tool click as the same insert message", () => {
    frame = loadFrame();
    frame.scene({ tool: "text" });
    // The Frame keeps the tool the Worker named, and knows no Map Label: it
    // reports the spot, and the Worker's tool decides what lands there.
    expect(svg().getAttribute("data-tool")).toBe("text");

    pointer(svg(), "pointerdown", 40, 30);
    expect(frame.port.messages).toEqual([{ kind: "insert", point: [40, 30] }]);
  });

  it("keeps the tool's keys out of the Frame, so the host still moves the selection", () => {
    frame = loadFrame();
    frame.scene({ tool: "insert" });

    // Insert places with a pointer only; the arrows stay the host's Commands.
    expect(key("ArrowRight").defaultPrevented).toBe(false);
    expect(key("Enter").defaultPrevented).toBe(false);
    expect(frame.port.messages).toEqual([]);
  });

  it("shows the crosshair every placing tool shows, and only Select shows the pointer", () => {
    frame = loadFrame();
    const placing = [
      "pencil",
      "pen",
      "bucket",
      "insert",
      "text",
      "ellipse",
      "rectangle",
      "polygon",
    ];
    for (const tool of placing) {
      frame.scene({ tool });
      expect(getComputedStyle(svg()).cursor, tool).toBe("crosshair");
    }

    frame.scene({ tool: "select" });
    expect(getComputedStyle(svg()).cursor).toBe("default");
  });
});

describe("the Pencil", () => {
  it("reports a finished stroke in page millimetres and shows it live", () => {
    frame = loadFrame();
    frame.scene({ tool: "pencil", elements: [sceneElement()] });
    expect(svg().getAttribute("data-tool")).toBe("pencil");

    pointer(svg(), "pointerdown", 10, 20);
    pointer(svg(), "pointermove", 30, 40);
    expect(document.querySelector("path.map-live")?.getAttribute("d")).toBe("M 10 20 L 30 40");

    pointer(svg(), "pointerup", 30, 40);
    expect(document.querySelector("path.map-live")).toBeNull();
    expect(frame.port.messages).toEqual([
      {
        kind: "stroke",
        points: [
          [10, 20],
          [30, 40],
        ],
      },
    ]);
  });

  it("drops a tap that never moved", () => {
    frame = loadFrame();
    frame.scene({ tool: "pencil" });
    pointer(svg(), "pointerdown", 10, 20);
    pointer(svg(), "pointerup", 10, 20);
    expect(frame.port.messages).toEqual([]);
  });

  it("drops a cancelled stroke", () => {
    frame = loadFrame();
    frame.scene({ tool: "pencil" });
    pointer(svg(), "pointerdown", 10, 20);
    pointer(svg(), "pointermove", 30, 40);
    pointer(svg(), "pointercancel", 30, 40);
    expect(frame.port.messages).toEqual([]);
    expect(document.querySelector("path.map-live")).toBeNull();
  });
});

describe("the Area tool", () => {
  it("posts a freehand drag as one closed Area Fill outline and draws it live", () => {
    frame = loadFrame();
    frame.scene({ tool: "area" });
    expect(svg().getAttribute("data-tool")).toBe("area");
    expect(getComputedStyle(svg()).cursor).toBe("crosshair");

    pointer(svg(), "pointerdown", 10, 20);
    pointer(svg(), "pointermove", 30, 20);
    pointer(svg(), "pointermove", 30, 40);
    expect(document.querySelector("path.map-live")?.getAttribute("d")).toBe(
      "M 10 20 L 30 20 L 30 40"
    );

    pointer(svg(), "pointerup", 30, 40);
    expect(document.querySelector("path.map-live")).toBeNull();
    // The Worker smooths and closes it exactly as it smooths a Pencil stroke.
    expect(frame.port.messages).toEqual([
      {
        kind: "area",
        points: [
          [10, 20],
          [30, 20],
          [30, 40],
        ],
        curves: [],
        freehand: true,
      },
    ]);
  });

  it("drops a tap that never moved", () => {
    frame = loadFrame();
    frame.scene({ tool: "area" });
    pointer(svg(), "pointerdown", 10, 20);
    pointer(svg(), "pointerup", 10, 20);
    expect(frame.port.messages).toEqual([]);
  });

  it("draws an outline with the keyboard and closes it on the first point", () => {
    frame = loadFrame();
    frame.scene({ tool: "area" });

    // The crosshair starts at the page centre, 100 by 50 mm.
    expect(document.querySelector("path.map-crosshair")?.getAttribute("d")).toBe(
      "M 98.5 50 L 101.5 50 M 100 48.5 L 100 51.5"
    );

    // The Area tool keeps every key it handles, so the host's Commands never see it.
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    key("ArrowRight");
    key("Enter");
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(document.querySelector("path.map-crosshair")?.getAttribute("d")).toBe(
      "M 100.5 52 L 103.5 52 M 102 50.5 L 102 53.5"
    );

    // Back on the first point, Enter closes the outline.
    key("ArrowLeft");
    key("ArrowLeft");
    key("ArrowUp");
    key("ArrowUp");
    expect(key("Enter").defaultPrevented).toBe(true);

    expect(frame.port.messages).toEqual([
      {
        kind: "area",
        points: [
          [100, 50],
          [102, 50],
          [102, 52],
        ],
        curves: [false, false, false],
        freehand: false,
      },
    ]);
    expect(document.querySelector("path.map-crosshair")).not.toBeNull();
  });

  it("finishes the outline closed with Escape, and drops one that encloses nothing", () => {
    frame = loadFrame();
    frame.scene({ tool: "area" });

    key("Enter");
    key("ArrowRight");
    key("ArrowRight");
    key("Enter");
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");
    expect(key("Backspace").defaultPrevented).toBe(true);
    key("Enter");
    expect(key("Escape").defaultPrevented).toBe(true);

    expect(frame.port.messages).toEqual([
      {
        kind: "area",
        points: [
          [100, 50],
          [102, 50],
          [102, 52],
        ],
        curves: [false, false, false],
        freehand: false,
      },
    ]);

    // One or two points enclose nothing, so Escape keeps no outline at all.
    key("Enter");
    key("ArrowRight");
    key("Enter");
    key("Escape");
    expect(frame.port.messages).toHaveLength(1);
    expect(document.querySelector("path.map-live")).toBeNull();
  });

  it("leaves the host its own keys, as the Pen does", () => {
    frame = loadFrame();
    frame.scene({ tool: "area" });
    expect(key("p").defaultPrevented).toBe(false);
    expect(key("z", { ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

describe("the Pen", () => {
  it("draws an outline with the keyboard and closes it on the first point", () => {
    frame = loadFrame();
    frame.scene({ tool: "pen" });
    expect(svg().getAttribute("data-tool")).toBe("pen");

    // The crosshair starts at the page centre, 100 by 50 mm.
    expect(document.querySelector("path.map-crosshair")?.getAttribute("d")).toBe(
      "M 98.5 50 L 101.5 50 M 100 48.5 L 100 51.5"
    );

    // The Pen keeps every key it handles, so the host's Commands never see it.
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(key("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.querySelector("path.map-crosshair")?.getAttribute("d")).toBe(
      "M 109.5 50 L 112.5 50 M 111 48.5 L 111 51.5"
    );
    key("Enter");
    key("ArrowDown");
    key("Enter");

    // Back on the first point, Enter closes the line.
    key("ArrowLeft", { shiftKey: true });
    key("ArrowLeft");
    key("ArrowUp");
    expect(key("Enter").defaultPrevented).toBe(true);

    expect(frame.port.messages).toEqual([
      {
        kind: "line",
        points: [
          [100, 50],
          [111, 50],
          [111, 51],
        ],
        curves: [false, false, false],
        closed: true,
      },
    ]);
    expect(document.querySelector("path.map-crosshair")).not.toBeNull();
  });

  it("names the surface from the label the Worker sends, not from English in the Frame", () => {
    frame = loadFrame();
    frame.scene({
      tool: "pen",
      penLabel: {
        one: "Línea de pluma: {{count}} punto",
        other: "Línea de pluma: {{count}} puntos",
      },
    });
    const surface = document.getElementById("surface");
    if (surface === null) throw new Error("the Frame has no surface");

    // The Worker sends both plural forms; the Frame picks by the count it holds.
    key("Enter");
    expect(surface.getAttribute("aria-label")).toBe("Línea de pluma: 1 punto");
    key("ArrowRight");
    key("Enter");
    expect(surface.getAttribute("aria-label")).toBe("Línea de pluma: 2 puntos");
    key("Escape");
    expect(surface.hasAttribute("aria-label")).toBe(false);

    // A scene with no label leaves the surface unnamed rather than in English.
    frame.scene({ tool: "pen", penLabel: { one: "", other: "" } });
    key("Enter");
    expect(surface.hasAttribute("aria-label")).toBe(false);
  });

  it("keeps the arrow keys out of the host and forwards the rest", () => {
    frame = loadFrame();
    frame.scene({ tool: "pen" });
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    // A key the Pen does not handle still forwards as before (#760).
    expect(key("p").defaultPrevented).toBe(false);
    expect(key("z", { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it("removes the last point with Backspace and finishes open with Escape", () => {
    frame = loadFrame();
    frame.scene({ tool: "pen" });
    key("Enter");
    key("ArrowRight");
    key("Enter");
    key("ArrowRight");
    key("Enter");
    expect(key("Backspace").defaultPrevented).toBe(true);
    key("Escape");

    expect(frame.port.messages).toEqual([
      {
        kind: "line",
        points: [
          [100, 50],
          [101, 50],
        ],
        curves: [false],
        closed: false,
      },
    ]);
  });

  it("drops a draft of one point when Escape finishes it", () => {
    frame = loadFrame();
    frame.scene({ tool: "pen" });
    key("Enter");
    key("Escape");
    expect(frame.port.messages).toEqual([]);
    expect(document.querySelector("path.map-live")).toBeNull();
  });

  it("draws straight points, curves a Shift+click, and finishes on a double click", () => {
    frame = loadFrame();
    frame.scene({ tool: "pen" });

    pointer(svg(), "pointerdown", 10, 20);
    pointer(svg(), "pointermove", 20, 30);
    expect(document.querySelector("path.map-live")?.getAttribute("d")).toBe("M 10 20 L 20 30");

    pointer(svg(), "pointerdown", 30, 40, { shiftKey: true });
    pointer(svg(), "pointerdown", 50, 20);
    pointer(svg(), "dblclick", 50, 20);

    expect(frame.port.messages).toEqual([
      {
        kind: "line",
        points: [
          [10, 20],
          [30, 40],
          [50, 20],
        ],
        curves: [true, false],
        closed: false,
      },
    ]);
    expect(document.querySelector("path.map-live")).toBeNull();
  });

  it("closes a pointer line on its first point and drops the double click's repeat", () => {
    frame = loadFrame();
    frame.scene({ tool: "pen" });

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointerdown", 40, 10);
    pointer(svg(), "pointerdown", 40, 40);
    pointer(svg(), "pointerdown", 11, 11);

    expect(frame.port.messages).toEqual([
      {
        kind: "line",
        points: [
          [10, 10],
          [40, 10],
          [40, 40],
        ],
        curves: [false, false, false],
        closed: true,
      },
    ]);

    // A double click lands its second point on the first; only one is kept.
    pointer(svg(), "pointerdown", 60, 60);
    pointer(svg(), "pointerdown", 70, 70);
    pointer(svg(), "pointerdown", 70, 70);
    pointer(svg(), "dblclick", 70, 70);
    expect(frame.port.messages[1]).toEqual({
      kind: "line",
      points: [
        [60, 60],
        [70, 70],
      ],
      curves: [false],
      closed: false,
    });
  });
});

describe("the Eraser", () => {
  it("sends one erase message for the whole drag, its reach scaled by zoom", () => {
    frame = loadFrame();
    frame.scene({ tool: "eraser", zoom: 2 });
    expect(svg().getAttribute("data-tool")).toBe("eraser");

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 20, 20);
    expect(document.querySelector("path.map-live")?.getAttribute("d")).toBe("M 10 10 L 20 20");
    pointer(svg(), "pointerup", 20, 20);

    expect(frame.port.messages).toEqual([
      {
        kind: "erase",
        points: [
          [10, 10],
          [20, 20],
        ],
        radiusMm: 1,
      },
    ]);
    expect(document.querySelector("path.map-live")).toBeNull();
  });

  it("drops a cancelled drag", () => {
    frame = loadFrame();
    frame.scene({ tool: "eraser" });
    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 20, 20);
    pointer(svg(), "pointercancel", 20, 20);
    expect(frame.port.messages).toEqual([]);
  });
});

describe("the Shape tools", () => {
  for (const tool of ["ellipse", "rectangle", "polygon"] as const) {
    it(`previews a ${tool} drag and posts it between its two corners`, () => {
      frame = loadFrame();
      frame.scene({ tool });
      expect(svg().getAttribute("data-tool")).toBe(tool);

      pointer(svg(), "pointerdown", 10, 20);
      pointer(svg(), "pointermove", 50, 40);
      const preview = document.querySelector("path.map-shape-preview");
      // The outline the Worker would draw, closed: a 40 by 20 mm box around (30, 30).
      expect(preview?.getAttribute("d")).toMatch(/^M /);
      expect(preview?.getAttribute("d")).toMatch(/ Z$/);

      pointer(svg(), "pointerup", 50, 40);
      expect(document.querySelector("path.map-shape-preview")).toBeNull();
      expect(frame.port.messages).toEqual([
        { kind: "shape", shape: tool, start: [10, 20], end: [50, 40], constrain: false },
      ]);
    });
  }

  it("squares the box from the start corner while Shift is held", () => {
    frame = loadFrame();
    frame.scene({ tool: "rectangle" });

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 50, 30, { shiftKey: true });
    // The drag is 40 mm wide and 20 mm tall, so Shift makes a 40 mm square
    // growing the way the drag went, exactly as `shapeFromCorners` does.
    expect(document.querySelector("path.map-shape-preview")?.getAttribute("d")).toBe(
      "M 10 10 L 50 10 L 50 50 L 10 50 Z"
    );

    pointer(svg(), "pointerup", 50, 30, { shiftKey: true });
    expect(frame.port.messages).toEqual([
      { kind: "shape", shape: "rectangle", start: [10, 10], end: [50, 30], constrain: true },
    ]);
  });

  it("posts the Shift the preview used, even when it lifts before the pointerup", () => {
    frame = loadFrame();
    frame.scene({ tool: "ellipse" });

    // Shift is down for the move, which squares the preview, and up again
    // before the button lifts: the stored Shape follows the draft's Shift.
    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 50, 30, { shiftKey: true });
    pointer(svg(), "pointerup", 50, 30);

    expect(frame.port.messages).toEqual([
      { kind: "shape", shape: "ellipse", start: [10, 10], end: [50, 30], constrain: true },
    ]);
  });

  it("draws no Shape for a drag shorter than a millimetre on either side", () => {
    frame = loadFrame();
    frame.scene({ tool: "ellipse" });

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 50, 10.5);
    pointer(svg(), "pointerup", 50, 10.5);

    // A drag a little short on both sides draws nothing either.
    pointer(svg(), "pointerdown", 60, 10);
    pointer(svg(), "pointermove", 60.5, 10.5);
    pointer(svg(), "pointerup", 60.5, 10.5);

    expect(frame.port.messages).toEqual([]);
  });

  it("drops the draft on pointer cancel and on Escape", () => {
    frame = loadFrame();
    frame.scene({ tool: "polygon" });

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 50, 40);
    pointer(svg(), "pointercancel", 50, 40);
    expect(document.querySelector("path.map-shape-preview")).toBeNull();
    pointer(svg(), "pointerup", 50, 40);

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 50, 40);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(document.querySelector("path.map-shape-preview")).toBeNull();
    pointer(svg(), "pointerup", 50, 40);

    expect(frame.port.messages).toEqual([]);
  });
});

describe("the Bucket", () => {
  it("posts a pour at the page point of a click or tap", () => {
    frame = loadFrame();
    frame.scene({ tool: "bucket" });
    expect(svg().getAttribute("data-tool")).toBe("bucket");

    pointer(svg(), "pointerdown", 40, 30);
    expect(frame.port.messages).toEqual([{ kind: "pour", point: [40, 30] }]);
  });

  it("moves the keyboard crosshair and pours at it with Enter", () => {
    frame = loadFrame();
    frame.scene({ tool: "bucket" });

    // The crosshair starts where the Pen's does: the page centre, 100 by 50 mm.
    expect(document.querySelector("path.map-crosshair")?.getAttribute("d")).toBe(
      "M 98.5 50 L 101.5 50 M 100 48.5 L 100 51.5"
    );

    // The Bucket keeps the keys it handles, so the host's Commands never see them.
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(document.querySelector("path.map-crosshair")?.getAttribute("d")).toBe(
      "M 99.5 50 L 102.5 50 M 101 48.5 L 101 51.5"
    );
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(frame.port.messages).toEqual([{ kind: "pour", point: [101, 50] }]);

    // A key the Bucket does not handle still forwards as before (#760).
    expect(key("Backspace").defaultPrevented).toBe(false);
    expect(key("p").defaultPrevented).toBe(false);
  });

  it("draws a shape's fill-rule, so a face with a hole shows the hole", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          shapes: [
            shape({
              d: "M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 30 10 L 30 30 L 10 30 Z",
              stroke: null,
              strokeWidth: 0,
              fill: "#c8d5a3",
              fillRule: "evenodd",
            }),
          ],
        }),
      ],
    });

    expect(document.querySelector("path.map-line")?.getAttribute("fill-rule")).toBe("evenodd");
    expect(document.querySelector("path.map-hit")?.getAttribute("fill-rule")).toBe("evenodd");

    // A shape without one carries no attribute at all.
    frame.scene({ elements: [sceneElement()] });
    expect(document.querySelector("path.map-line")?.getAttribute("fill-rule")).toBeNull();
  });
});

describe("the Select tool", () => {
  it("reports the Element under the pointer, locked ones included", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ locked: true })] });
    const line = document.querySelector('g[data-element-id="e1"] path.map-line');
    if (line === null) throw new Error("the Element drew no line");
    pointer(line, "pointerdown", 12, 12);
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
  });

  it("drags a Map Image by its box and posts one move on release", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          id: "scan",
          movable: true,
          shapes: [
            {
              kind: "image",
              assetId: "a1",
              x: 100,
              y: 50,
              width: 80,
              height: 40,
              rotation: 0,
              opacity: 1,
            },
          ],
        }),
      ],
    });
    const box = document.querySelector('g[data-element-id="scan"] path.map-hit');
    if (box === null) throw new Error("the picture drew no hit box");

    // The box is the picture's own, centred on its point: a press inside it
    // picks the Element, exactly as a Stamp's art does.
    pointer(box, "pointerdown", 100, 50);
    pointer(svg(), "pointermove", 110, 55);
    pointer(svg(), "pointerup", 110, 55);

    expect(frame.port.messages).toEqual([
      { kind: "select", id: "scan" },
      { kind: "move", id: "scan", dx: 10, dy: 5 },
    ]);
  });

  it("reports an empty pick for the page around the Elements", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement()] });
    pointer(svg(), "pointerdown", 150, 80);
    expect(frame.port.messages).toEqual([{ kind: "select", id: null }]);
  });

  /** The drawn group of one Element, whose transform carries the live drag. */
  const group = (id = "e1"): Element => {
    const element = document.querySelector(`g[data-element-id="${id}"]`);
    if (element === null) throw new Error(`the Frame drew no ${id}`);
    return element;
  };
  const lineOf = (id = "e1"): Element => {
    const line = group(id).querySelector("path.map-line");
    if (line === null) throw new Error(`${id} drew no line`);
    return line;
  };

  it("drags a movable Element live and posts one move on release", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 20, 15);
    expect(group().getAttribute("transform")).toBe("translate(8 3)");
    expect(group().getAttribute("data-dragging")).toBe("true");
    pointer(svg(), "pointermove", 30, 10);
    expect(group().getAttribute("transform")).toBe("translate(18 -2)");
    pointer(svg(), "pointerup", 30, 10);

    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      { kind: "move", id: "e1", dx: 18, dy: -2 },
    ]);
    // The preview holds until the Worker's answer, so the line never jumps back.
    expect(group().getAttribute("transform")).toBe("translate(18 -2)");
    frame.scene({ elements: [sceneElement({ movable: true })] });
    expect(group().getAttribute("transform")).toBeNull();
    expect(group().getAttribute("data-dragging")).toBeNull();
  });

  it("follows the pointer's travel when the host moves the Frame mid-drag", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 20, 15);
    expect(group().getAttribute("transform")).toBe("translate(8 3)");
    // The press selected the Element, the host's Properties panel grew, and
    // the Frame now sits 23 px lower under the same pointer: the Element must
    // keep following the pointer, not jump by the shift.
    frame.origin[1] = 23;
    pointer(svg(), "pointermove", 30, 10);
    expect(group().getAttribute("transform")).toBe("translate(18 -2)");
    pointer(svg(), "pointerup", 30, 10);

    expect(frame.port.messages.at(-1)).toEqual({ kind: "move", id: "e1", dx: 18, dy: -2 });
  });

  it("only selects on a press that never passes the drag threshold", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 12.5, 12.5);
    expect(group().getAttribute("transform")).toBeNull();
    pointer(svg(), "pointerup", 12.5, 12.5);

    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
  });

  it("measures the drag threshold in screen pixels, whatever the zoom", () => {
    for (const zoom of [1, 4]) {
      for (const cleanup of frame?.cleanups ?? []) cleanup();
      frame = loadFrame();
      frame.scene({ elements: [sceneElement({ movable: true })], zoom });

      // Three pixels is a shaky press; five is a drag, and the Element jumps
      // to the pointer's whole travel so it stays under the pointer.
      pointer(lineOf(), "pointerdown", 12, 12);
      pointer(svg(), "pointermove", 15, 12);
      expect(group().getAttribute("transform")).toBeNull();
      pointer(svg(), "pointermove", 17, 12);
      expect(group().getAttribute("transform")).toBe("translate(5 0)");
      pointer(svg(), "pointerup", 17, 12);

      expect(frame.port.messages).toEqual([
        { kind: "select", id: "e1" },
        { kind: "move", id: "e1", dx: 5, dy: 0 },
      ]);
    }
  });

  it("ignores a second pointer, and drops the drag when its capture is lost", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });
    const withId = (type: string, x: number, y: number, pointerId: number, target: Element) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      target.dispatchEvent(event);
    };

    withId("pointerdown", 12, 12, 1, lineOf());
    withId("pointermove", 30, 30, 1, svg());
    // A second finger neither picks nor drags, nor moves the first one's drag.
    withId("pointerdown", 40, 40, 2, lineOf());
    withId("pointermove", 60, 60, 2, svg());
    expect(group().getAttribute("transform")).toBe("translate(18 18)");

    // The engine took the capture away with no pointerup: the drag ends, and
    // the next press drags again instead of being ignored.
    withId("lostpointercapture", 30, 30, 1, svg());
    expect(group().getAttribute("transform")).toBeNull();
    withId("pointerdown", 12, 12, 3, lineOf());
    withId("pointermove", 20, 12, 3, svg());
    withId("pointerup", 20, 12, 3, svg());

    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      { kind: "select", id: "e1" },
      { kind: "move", id: "e1", dx: 8, dy: 0 },
    ]);
  });

  it("constrains the drag to its longer axis while Shift is held, even mid-drag", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 20, 15, { shiftKey: true });
    expect(group().getAttribute("transform")).toBe("translate(8 0)");
    pointer(svg(), "pointermove", 14, 25, { shiftKey: true });
    expect(group().getAttribute("transform")).toBe("translate(0 13)");

    // Letting go of Shift with the pointer still frees the drag at once.
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    expect(group().getAttribute("transform")).toBe("translate(2 13)");
    // Pressing it again constrains it again, before the pointer moves.
    const shift = key("Shift", { shiftKey: true });
    expect(shift.defaultPrevented).toBe(false);
    expect(group().getAttribute("transform")).toBe("translate(0 13)");

    pointer(svg(), "pointerup", 14, 25, { shiftKey: true });
    expect(frame.port.messages.at(-1)).toEqual({ kind: "move", id: "e1", dx: 0, dy: 13 });
  });

  it("cancels the drag on Escape, restoring the start position and posting no move", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 30, 30);
    const cancel = key("Escape");
    expect(cancel.defaultPrevented).toBe(true);
    expect(group().getAttribute("transform")).toBeNull();
    pointer(svg(), "pointermove", 40, 40);
    pointer(svg(), "pointerup", 40, 40);

    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
    // With no drag in progress, Escape is the host's again.
    expect(key("Escape").defaultPrevented).toBe(false);
  });

  it("drops the drag on pointer cancel", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 30, 30);
    pointer(svg(), "pointercancel", 30, 30);

    expect(group().getAttribute("transform")).toBeNull();
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
  });

  it("never drags a locked or unmovable Element, though a press still selects it", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({ locked: true, movable: true }),
        sceneElement({ id: "fill", movable: false }),
      ],
    });

    for (const id of ["e1", "fill"]) {
      pointer(lineOf(id), "pointerdown", 12, 12);
      pointer(svg(), "pointermove", 30, 30);
      expect(group(id).getAttribute("transform")).toBeNull();
      pointer(svg(), "pointerup", 30, 30);
    }

    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      { kind: "select", id: "fill" },
    ]);
  });

  it("drops a drag whose Element a new scene no longer offers to move", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ movable: true })] });

    pointer(lineOf(), "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 30, 30);
    frame.scene({ elements: [sceneElement({ locked: true, movable: false })] });
    expect(group().getAttribute("transform")).toBeNull();
    pointer(svg(), "pointerup", 30, 30);

    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
  });

  it("needs a scene before it answers a pointer", () => {
    frame = loadFrame();
    const surface = document.getElementById("surface");
    if (surface === null) throw new Error("the Frame has no surface");
    pointer(surface, "pointerdown", 5, 5);
    expect(frame.port.messages).toEqual([]);
  });
});

describe("the transform handles (#795)", () => {
  /** The box a selected Stamp's handles sit on: 40 by 20 mm about (100, 50). */
  const handleBox = (overrides: Record<string, unknown> = {}) => ({
    box: { x: 100, y: 50, width: 40, height: 20, rotation: 0, ...overrides },
    handles: "corners",
  });

  /** One Element carrying that box, selected. */
  const selected = (overrides: Record<string, unknown> = {}) =>
    sceneElement({ selected: true, transform: handleBox(), ...overrides });

  /** The overlay the Frame drew for the selection. */
  const overlay = (): Element => {
    const group = document.querySelector("g.map-transform");
    if (group === null) throw new Error("the Frame drew no transform handles");
    return group;
  };

  /** One grip the Frame drew, under `data-transform-handle`. */
  const grip = (id: string): Element => {
    const element = document.querySelector(`[data-transform-handle="${id}"]`);
    if (element === null) throw new Error(`the Frame drew no ${id} grip`);
    return element;
  };

  /** The invisible shape that catches a press on one grip. */
  const target = (id: string): Element => {
    const element = document.querySelector(`[data-transform-handle-hit="${id}"]`);
    if (element === null) throw new Error(`the Frame drew no ${id} target`);
    return element;
  };

  /** The middle of a drawn rectangle, in the box's own millimetres. */
  const centre = (element: Element): [number, number] => [
    Number(element.getAttribute("x")) + Number(element.getAttribute("width")) / 2,
    Number(element.getAttribute("y")) + Number(element.getAttribute("height")) / 2,
  ];

  /** Where a `translate(x y)` transform puts an element, in page millimetres. */
  const translated = (element: Element): [number, number] => {
    const match = /^translate\(\s*(-?[\d.]+)\s+(-?[\d.]+)/.exec(
      element.getAttribute("transform") ?? ""
    );
    if (match === null) throw new Error("the element carries no translate");
    return [Number(match[1]), Number(match[2])];
  };

  /** The box the overlay draws around the selection. */
  const outline = (): Element => {
    const element = overlay().querySelector("rect.map-transform-box");
    if (element === null) throw new Error("the selection drew no box");
    return element;
  };

  /** The selected Element's own group, where a drag previews the art. */
  const elementGroup = (): Element => {
    const group = document.querySelector('g[data-element-id="e1"]');
    if (group === null) throw new Error("the Element drew no group");
    return group;
  };

  /** How many screen pixels wide a drawn rectangle is, at `scale` px per mm. */
  const pixels = (element: Element, scale: number): number =>
    Number(element.getAttribute("width")) * scale;

  /** The cursor a grip shows. */
  const cursor = (id: string): string =>
    (target(id) as unknown as SVGElement & { style: CSSStyleDeclaration }).style.cursor;

  /** Makes the document report a finger's pointer, for the length of the call. */
  function withCoarsePointer<T>(run: () => T): T {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      return run();
    } finally {
      window.matchMedia = original;
    }
  }

  it("draws the selected Stamp's box, a grip on each corner, and the turn grip above it", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    // The box arrives from the Worker, so the Frame never guesses it from the
    // art: it draws the box as given, in the Element's own turned frame.
    const group = overlay();
    expect(group.getAttribute("data-transform")).toBe("e1");
    expect(group.getAttribute("transform")).toBe("translate(100 50)");
    const outline = group.querySelector("rect.map-transform-box");
    expect(outline?.getAttribute("x")).toBe("-20");
    expect(outline?.getAttribute("y")).toBe("-10");
    expect(outline?.getAttribute("width")).toBe("40");
    expect(outline?.getAttribute("height")).toBe("20");

    // A grip sits on each corner of the box, not on the art it marks.
    expect(
      document.querySelectorAll(
        "[data-transform-handle='nw'], [data-transform-handle='ne'], [data-transform-handle='se'], [data-transform-handle='sw']"
      )
    ).toHaveLength(4);
    expect(centre(grip("nw"))).toEqual([expect.closeTo(-20, 1), expect.closeTo(-10, 1)]);
    expect(centre(grip("se"))).toEqual([expect.closeTo(20, 1), expect.closeTo(10, 1)]);

    // The turn grip is a circle on a stalk above the top edge's middle.
    const turn = grip("rotate");
    expect(turn.tagName.toLowerCase()).toBe("circle");
    expect(Number(turn.getAttribute("cx"))).toBe(0);
    expect(Number(turn.getAttribute("cy"))).toBeLessThan(-10);
    expect(group.querySelector("path.map-transform-stalk")).not.toBeNull();
  });

  it("turns the box and its grips with the Element", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected({ transform: handleBox({ rotation: 30 }) })] });

    expect(overlay().getAttribute("transform")).toBe("translate(100 50) rotate(30)");
    // The grips keep their corners of the box: the frame turns them, not the maths.
    expect(centre(grip("nw"))).toEqual([expect.closeTo(-20, 1), expect.closeTo(-10, 1)]);
  });

  it("keeps each grip the same size on screen at every zoom", () => {
    frame = loadFrame();
    frame.scale = 4;
    frame.scene({ elements: [selected()], zoom: 1 });
    const atOne = pixels(grip("nw"), 4);

    // Zooming in doubles every page millimetre on screen, so the grip is drawn
    // in half as many of them: 9 px at either zoom, as the issue asks.
    frame.scale = 8;
    frame.scene({ elements: [selected()], zoom: 2 });
    const atTwo = pixels(grip("nw"), 8);

    expect(atOne).toBeCloseTo(9, 1);
    expect(atTwo).toBeCloseTo(9, 1);
  });

  it("hits a wider target than it draws, and a finger's on a coarse pointer", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    // 24 px of slack around a 9 px square, so a mouse need not be precise.
    expect(pixels(target("nw"), 4)).toBeCloseTo(24, 1);
    expect(pixels(grip("nw"), 4)).toBeCloseTo(9, 1);

    withCoarsePointer(() => {
      frame = loadFrame();
      frame.scene({ elements: [selected()] });

      // A finger has no fine aim: larger grips and a 44 px target.
      expect(pixels(target("nw"), 4)).toBeCloseTo(44, 1);
      expect(pixels(grip("nw"), 4)).toBeGreaterThan(9);
    });
  });

  it("picks the resize cursor from the corner's direction on screen, and a turn cursor", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    expect(cursor("nw")).toBe("nwse-resize");
    expect(cursor("ne")).toBe("nesw-resize");
    expect(cursor("se")).toBe("nwse-resize");
    expect(cursor("sw")).toBe("nesw-resize");
    expect(cursor("rotate")).toBe("grab");

    // A quarter turn carries each corner's arrow round with it, so the cursor
    // still shows the way a drag would go.
    frame.scene({ elements: [selected({ transform: handleBox({ rotation: 90 }) })] });
    expect(cursor("nw")).toBe("nesw-resize");
    expect(cursor("ne")).toBe("nwse-resize");
  });

  it("fills and grows the grip under the pointer, and lets it rest when the pointer moves off", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });
    const resting = pixels(grip("nw"), 4);
    expect(grip("nw").getAttribute("data-hovered")).toBeNull();

    // A grip under the pointer is the one a press would take, so it stands out.
    pointer(target("nw"), "pointermove", 20, 20);
    expect(grip("nw").getAttribute("data-hovered")).toBe("true");
    expect(pixels(grip("nw"), 4)).toBeGreaterThan(resting);
    // Filled solid by the stylesheet; the growth is drawn in page millimetres.
    expect(HTML).toMatch(/\[data-hovered="true"\][\s\S]*?fill-opacity:\s*1/);

    // The turn grip answers the pointer the same way.
    pointer(target("rotate"), "pointermove", 100, 35);
    expect(grip("rotate").getAttribute("data-hovered")).toBe("true");
    expect(grip("nw").getAttribute("data-hovered")).toBeNull();

    // Moving off the grips lets them rest again.
    pointer(svg(), "pointermove", 300, 300);
    expect(grip("nw").getAttribute("data-hovered")).toBeNull();
    expect(grip("rotate").getAttribute("data-hovered")).toBeNull();
    expect(pixels(grip("nw"), 4)).toBeCloseTo(resting, 1);
  });

  it("marks a locked Element with a dashed box, a lock badge, and no grips", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected({ locked: true })] });

    expect(overlay().getAttribute("data-locked")).toBe("true");
    expect(overlay().querySelector("rect.map-transform-box")).not.toBeNull();
    expect(document.querySelector("[data-transform-handle]")).toBeNull();
    expect(document.querySelector("[data-transform-handle-hit]")).toBeNull();
    // The dash is the stylesheet's, on the box of a locked Element.
    expect(HTML).toMatch(/\[data-locked="true"\]\s+\.map-transform-box[\s\S]*?stroke-dasharray/);

    // A small padlock at the box's corner says why it cannot be sized.
    const badge = overlay().querySelector("[data-transform-lock]");
    expect(badge).not.toBeNull();
    const body = overlay().querySelector("rect.map-transform-lock-body");
    expect(body).not.toBeNull();
    expect(overlay().querySelector("path.map-transform-lock-shackle")).not.toBeNull();
    // Sized from the screen scale, so it stays legible at every zoom.
    const atOne = pixels(body as Element, 4);
    expect(atOne).toBeGreaterThan(0);
    frame.scale = 8;
    frame.scene({ elements: [selected({ locked: true })], zoom: 2 });
    expect(
      pixels(overlay().querySelector("rect.map-transform-lock-body") as Element, 8)
    ).toBeCloseTo(atOne, 1);

    // An unlocked Element carries grips instead, and no badge.
    frame.scale = 4;
    frame.scene({ elements: [selected()] });
    expect(document.querySelector("[data-transform-lock]")).toBeNull();
  });

  it("draws no grips for a hidden Element, even when it is selected", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected({ hidden: true })] });

    expect(document.querySelector("g.map-transform")).toBeNull();
    expect(document.querySelector("[data-transform-handle]")).toBeNull();
    expect(document.querySelector("[data-transform-handle-hit]")).toBeNull();
    expect(document.querySelector("[data-transform-lock]")).toBeNull();
  });

  it("replaces the traced outline with the box, above the Element's own hit target", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected({ movable: true })] });

    // One outline marks a selected Element: the box the grips sit on, not a
    // second trace of the art under it.
    expect(document.querySelector("path.map-selection")).toBeNull();
    // The overlay is drawn last, so a press reaches a grip before the art.
    const drawn = Array.from(svg().querySelectorAll("g[data-element-id], g.map-transform"));
    expect(drawn.at(-1)).toBe(overlay());
  });

  it("never picks or moves the Element when the press lands on a grip", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected({ movable: true })] });

    pointer(target("se"), "pointerdown", 120, 60);
    pointer(svg(), "pointermove", 130, 70);
    pointer(svg(), "pointerup", 130, 70);
    // The grip's own drag is the only edit it makes: no select and no move.
    expect(frame.port.messages).not.toContainEqual(expect.objectContaining({ kind: "select" }));
    expect(frame.port.messages).not.toContainEqual(expect.objectContaining({ kind: "move" }));
    frame.port.messages.length = 0;

    // The Element's body still moves as it always did.
    const line = document.querySelector('g[data-element-id="e1"] path.map-line');
    if (line === null) throw new Error("the Element drew no line");
    pointer(line, "pointerdown", 12, 12);
    pointer(svg(), "pointermove", 20, 12);
    pointer(svg(), "pointerup", 20, 12);
    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      { kind: "move", id: "e1", dx: 8, dy: 0 },
    ]);
  });

  it("resizes from a corner, previews the box live, and sends one transform on release", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected({ movable: true })] });

    pointer(target("se"), "pointerdown", 120, 60);
    pointer(svg(), "pointermove", 130, 65);

    // Nothing travels to the Worker until release: the box, its handles, and
    // the art itself follow the pointer inside this Frame.
    expect(frame.port.messages).toEqual([]);
    expect(outline().getAttribute("width")).toBe("50");
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(105 52.5) scale(1.25) translate(-100 -50)"
    );

    pointer(svg(), "pointerup", 130, 65);
    expect(frame.port.messages).toEqual([
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 105, y: 52.5, width: 50, height: 25, rotation: 0 },
      },
    ]);
  });

  it("resizes about the centre while Alt holds", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("se"), "pointerdown", 120, 60);
    pointer(svg(), "pointermove", 130, 65, { altKey: true });
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(100 50) scale(1.5) translate(-100 -50)"
    );
    pointer(svg(), "pointerup", 130, 65);

    // Both sides grow away from the centre, which stays where it was.
    expect(frame.port.messages).toEqual([
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 100, y: 50, width: 60, height: 30, rotation: 0 },
      },
    ]);
  });

  it("turns about the centre from the rotate handle, Shift snapping to 15° steps", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("rotate"), "pointerdown", 100, 35);
    pointer(svg(), "pointermove", 110, 50);
    expect(overlay().getAttribute("transform")).toBe("translate(100 50) rotate(90)");
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(100 50) rotate(90) translate(-100 -50)"
    );

    // 44° round from the grip's start is 134° from the box's own upright, and
    // Shift lands it on 135°.
    const aim = (degrees: number): [number, number] => [
      100 + 15 * Math.cos((degrees * Math.PI) / 180),
      50 + 15 * Math.sin((degrees * Math.PI) / 180),
    ];
    const [x, y] = aim(44);
    pointer(svg(), "pointermove", x, y, { shiftKey: true });
    expect(overlay().getAttribute("transform")).toBe("translate(100 50) rotate(135)");
    pointer(svg(), "pointerup", x, y);

    expect(frame.port.messages).toEqual([
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 100, y: 50, width: 40, height: 20, rotation: 135 },
      },
    ]);
  });

  it("sticks a turn to a right angle within 2°", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("rotate"), "pointerdown", 100, 35);
    // 89° round from the grip's start is 179° from the box's own upright, a
    // degree short of a half turn, which the drag treats as straight down.
    const [x, y] = [
      100 + 15 * Math.cos((89 * Math.PI) / 180),
      50 + 15 * Math.sin((89 * Math.PI) / 180),
    ];
    pointer(svg(), "pointermove", x, y);
    expect(overlay().getAttribute("transform")).toBe("translate(100 50) rotate(180)");
  });

  it("keeps the preview after release until the next scene arrives", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("se"), "pointerdown", 120, 60);
    pointer(svg(), "pointermove", 130, 65);
    pointer(svg(), "pointerup", 130, 65);

    // The Worker has not answered, so the Element keeps the size the drag gave it.
    expect(outline().getAttribute("width")).toBe("50");
    expect(elementGroup().getAttribute("transform")).toContain("scale(1.25)");

    // A scene that still holds the start box ends the preview, as a refused drag does.
    frame.scene({ elements: [selected()] });
    expect(outline().getAttribute("width")).toBe("40");
    expect(elementGroup().getAttribute("transform")).toBeNull();
  });

  it("cancels the drag on Escape, restoring the box and sending nothing", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("se"), "pointerdown", 120, 60);
    pointer(svg(), "pointermove", 130, 65);
    expect(outline().getAttribute("width")).toBe("50");
    expect(document.querySelector("g.map-readout")).not.toBeNull();
    expect(document.querySelector("rect.map-transform-ghost")).not.toBeNull();

    // Escape takes the start box back and the Worker never hears of the drag.
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(outline().getAttribute("width")).toBe("40");
    expect(elementGroup().getAttribute("transform")).toBeNull();
    // The chip and the ghost go with the drag, as the preview does.
    expect(document.querySelector("g.map-readout")).toBeNull();
    expect(document.querySelector("rect.map-transform-ghost")).toBeNull();

    pointer(svg(), "pointerup", 130, 65);
    expect(frame.port.messages).toEqual([]);
  });

  it("reads the size in page millimetres on a chip beside the pointer while resizing", () => {
    frame = loadFrame();
    // The Worker's own readout text, so the chip reads in the app's language.
    frame.scene({
      elements: [selected()],
      readout: { size: "Tamaño {{value}} mm", angle: "{{value}}°" },
    });

    pointer(target("se"), "pointerdown", 120, 60);
    // The press alone has not moved the box yet, so there is nothing to read.
    expect(document.querySelector("g.map-readout")).toBeNull();
    pointer(svg(), "pointermove", 130, 65);

    const chip = document.querySelector("g.map-readout");
    if (chip === null) throw new Error("the Frame drew no readout chip");
    expect(chip.querySelector("text")?.textContent).toBe("Tamaño 50 mm");
    // Beside the pointer the drag follows, not at the box's own middle.
    const [x, y] = translated(chip);
    expect(Math.hypot(x - 130, y - 65)).toBeLessThan(10);

    // The chip goes with the drag; a turn reads its angle instead (below).
    pointer(svg(), "pointerup", 130, 65);
    expect(document.querySelector("g.map-readout")).toBeNull();
  });

  it("reads the angle in degrees on the chip while turning", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("rotate"), "pointerdown", 100, 35);
    pointer(svg(), "pointermove", 110, 50);

    const chip = document.querySelector("g.map-readout");
    if (chip === null) throw new Error("the Frame drew no readout chip");
    expect(chip.querySelector("text")?.textContent).toBe("90°");
  });

  it("keeps a dashed ghost of the start box while resizing, and only then", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("se"), "pointerdown", 120, 60);
    pointer(svg(), "pointermove", 130, 65);

    // The ghost stays where the drag began, so the author compares old and new.
    const ghost = document.querySelector("rect.map-transform-ghost");
    if (ghost === null) throw new Error("the Frame drew no start-box ghost");
    expect(ghost.getAttribute("width")).toBe("40");
    expect(ghost.getAttribute("height")).toBe("20");
    expect(ghost.getAttribute("transform")).toBe("translate(100 50)");
    // Dashed by the stylesheet, so it reads as a guide rather than the live box.
    expect(HTML).toMatch(/\.map-transform-ghost[\s\S]*?stroke-dasharray/);

    pointer(svg(), "pointerup", 130, 65);
    expect(document.querySelector("rect.map-transform-ghost")).toBeNull();

    // A turn keeps the size it started with, so only a resize needs comparing.
    pointer(target("rotate"), "pointerdown", 100, 35);
    pointer(svg(), "pointermove", 110, 50);
    expect(document.querySelector("rect.map-transform-ghost")).toBeNull();
  });

  it("marks each 15° step around the box while Shift turns", () => {
    frame = loadFrame();
    frame.scene({ elements: [selected()] });

    pointer(target("rotate"), "pointerdown", 100, 35);
    pointer(svg(), "pointermove", 110, 50);
    expect(document.querySelectorAll("line.map-transform-tick")).toHaveLength(0);

    pointer(svg(), "pointermove", 110, 50, { shiftKey: true });
    const ticks = Array.from(document.querySelectorAll("line.map-transform-tick"));
    expect(ticks).toHaveLength(24);
    // One tick per step, the first due up, which is a turn of 0°.
    const angles = ticks
      .map((tick) => {
        const dx = (Number(tick.getAttribute("x1")) + Number(tick.getAttribute("x2"))) / 2 - 100;
        const dy = (Number(tick.getAttribute("y1")) + Number(tick.getAttribute("y2"))) / 2 - 50;
        return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      })
      .sort((one, two) => one - two);
    expect(angles.map((angle) => Math.round(angle) % 15)).toEqual(Array(24).fill(0));
    // Written to two decimals, so a tick's own angle is within a rounding step.
    expect(angles[0]).toBeCloseTo(0, 1);
    expect(angles[1]).toBeCloseTo(15, 1);

    pointer(svg(), "pointerup", 110, 50);
    expect(document.querySelectorAll("line.map-transform-tick")).toHaveLength(0);
  });

  it("previews the minimum size the Worker keeps when a drag passes the opposite corner", () => {
    frame = loadFrame();
    // The Worker clamps a Stamp's or Map Image's size to 1 mm, and says so
    // through the handle data, so the preview stops where the Worker will.
    frame.scene({ elements: [selected({ transform: { ...handleBox(), minSize: 1 } })] });

    pointer(target("se"), "pointerdown", 120, 60);
    // Well past the anchored corner at (80, 40): the box must not flip.
    pointer(svg(), "pointermove", 0, 0);

    expect(outline().getAttribute("width")).toBe("1");
    expect(outline().getAttribute("height")).toBe("0.5");
    pointer(svg(), "pointerup", 0, 0);
    expect(frame.port.messages).toEqual([
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 80.5, y: 40.25, width: 1, height: 0.5, rotation: 0 },
      },
    ]);
  });

  it("draws every grip at every zoom, however small the box is on screen", () => {
    frame = loadFrame();
    frame.scale = 4;
    const grips = () => document.querySelectorAll("[data-transform-handle-hit]");
    // 4 mm is 16 px, and 40 by 3 mm a long thin scale bar: all four corners
    // and the turn grip still draw.
    for (const [width, height] of [
      [4, 4],
      [40, 3],
    ]) {
      frame.scene({ elements: [selected({ transform: handleBox({ width, height }) })] });
      expect(grips()).toHaveLength(5);
    }
  });

  it("draws no grips for an Element with no box, no other tool, and no selection", () => {
    frame = loadFrame();
    // A Map Line keeps today's outline: nothing for a handle to resize.
    frame.scene({ elements: [sceneElement({ selected: true })] });
    expect(document.querySelector("g.map-transform")).toBeNull();
    expect(document.querySelector("path.map-selection")).not.toBeNull();

    // Every other tool's press draws or picks, so it shows no grips.
    frame.scene({ tool: "pencil", elements: [selected()] });
    expect(document.querySelector("g.map-transform")).toBeNull();

    frame.scene({ elements: [sceneElement({ transform: handleBox() })] });
    expect(document.querySelector("g.map-transform")).toBeNull();
  });

  it("draws the box without grips when the document cannot measure its screen", () => {
    frame = loadFrame();
    frame.scale = null;
    frame.scene({ elements: [selected()] });

    // The box's stroke needs no scale, but a grip's size does: a Frame that
    // cannot say how large a pixel is draws no grip at all.
    expect(overlay().querySelector("rect.map-transform-box")).not.toBeNull();
    expect(document.querySelector("[data-transform-handle]")).toBeNull();
  });

  it("drops a box with no size or a handle set it does not know", () => {
    frame = loadFrame();
    for (const transform of [
      { box: { x: 100, y: 50, width: 0, height: 20, rotation: 0 }, handles: "corners" },
      { box: { x: 100, y: 50, width: 40, height: 20, rotation: 0 }, handles: "sides" },
      { box: { x: 100, y: 50, width: 40, rotation: 0 }, handles: "corners" },
      { handles: "corners" },
    ]) {
      frame.scene({ elements: [sceneElement({ selected: true, transform })] });
      expect(document.querySelector("g.map-transform")).toBeNull();
    }
  });

  describe("handle set all: a selected Shape (#796)", () => {
    /** The box a selected Shape's handles sit on: 64 by 34 mm about (100, 50). */
    const allBox = (overrides: Record<string, unknown> = {}) => ({
      box: { x: 100, y: 50, width: 64, height: 34, rotation: 0, ...overrides },
      handles: "all",
    });

    /** The selected Shape carrying that box. */
    const shaped = (overrides: Record<string, unknown> = {}) =>
      selected({ transform: allBox(), ...overrides });

    it("stacks the corner hit areas above the sides', so an overlapping press takes the corner", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });
      const order = [...document.querySelectorAll("[data-transform-handle-hit]")].map((hit) =>
        hit.getAttribute("data-transform-handle-hit")
      );
      const lastSide = Math.max(...["n", "e", "s", "w"].map((id) => order.indexOf(id)));
      const firstCorner = Math.min(...["nw", "ne", "se", "sw"].map((id) => order.indexOf(id)));
      expect(lastSide).toBeGreaterThanOrEqual(0);
      expect(firstCorner).toBeGreaterThan(lastSide);
    });

    it("draws eight handles plus the turn grip, hover growing the one under the pointer", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });

      expect(overlay().getAttribute("transform")).toBe("translate(100 50)");
      expect(document.querySelectorAll("[data-transform-handle-hit]")).toHaveLength(9);
      for (const id of ["nw", "ne", "se", "sw", "n", "e", "s", "w", "rotate"]) {
        expect(document.querySelector(`[data-transform-handle="${id}"]`)).not.toBeNull();
      }
      // The sides sit on the middle of each edge, in the box's own millimetres.
      expect(centre(grip("e"))).toEqual([expect.closeTo(32, 1), expect.closeTo(0, 1)]);
      expect(centre(grip("n"))).toEqual([expect.closeTo(0, 1), expect.closeTo(-17, 1)]);

      // A side grip answers the pointer the way a corner does.
      const resting = pixels(grip("e"), 4);
      pointer(target("e"), "pointermove", 132, 50);
      expect(grip("e").getAttribute("data-hovered")).toBe("true");
      expect(pixels(grip("e"), 4)).toBeGreaterThan(resting);
      pointer(svg(), "pointermove", 300, 300);
      expect(grip("e").getAttribute("data-hovered")).toBeNull();
    });

    it("marks a locked Shape with a dashed box, a lock badge, and no grips", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped({ locked: true })] });

      expect(overlay().getAttribute("data-locked")).toBe("true");
      expect(document.querySelector("[data-transform-handle]")).toBeNull();
      expect(document.querySelector("[data-transform-handle-hit]")).toBeNull();
      expect(overlay().querySelector("[data-transform-lock]")).not.toBeNull();
    });

    it("resizes width and height freely from a corner, previews each axis, posts one transform", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped({ movable: true })] });

      pointer(target("se"), "pointerdown", 132, 67);
      pointer(svg(), "pointermove", 142, 77);

      expect(frame.port.messages).toEqual([]);
      expect(outline().getAttribute("width")).toBe("74");
      expect(outline().getAttribute("height")).toBe("44");
      // The art follows on each axis, not by one uniform scale.
      expect(elementGroup().getAttribute("transform")).toBe(
        "translate(105 55) scale(1.156 1.294) translate(-100 -50)"
      );

      pointer(svg(), "pointerup", 142, 77);
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: { x: 105, y: 55, width: 74, height: 44, rotation: 0 },
        },
      ]);
    });

    it("keeps a corner's aspect while Shift holds, and grows about the centre with Alt", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });

      pointer(target("se"), "pointerdown", 132, 67);
      pointer(svg(), "pointermove", 142, 77, { shiftKey: true });
      // The taller side rules: 44 mm keeps 64:34, so the width follows it.
      expect(outline().getAttribute("height")).toBe("44");
      expect(Number(outline().getAttribute("width"))).toBeCloseTo((64 * 44) / 34, 1);
      pointer(svg(), "pointerup", 142, 77);
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: {
            x: expect.closeTo(109.41, 1),
            y: 55,
            width: expect.closeTo(82.82, 1),
            height: 44,
            rotation: 0,
          },
        },
      ]);
      frame.port.messages.length = 0;

      pointer(target("se"), "pointerdown", 132, 67);
      pointer(svg(), "pointermove", 142, 77, { altKey: true });
      pointer(svg(), "pointerup", 142, 77);
      // Both sides grow away from the centre, which stays where it was.
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: { x: 100, y: 50, width: 84, height: 54, rotation: 0 },
        },
      ]);
    });

    it("stretches one axis from a side handle, along the Shape's own turned side", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });

      // Straight on: ten right and ten down still only widens, by ten.
      pointer(target("e"), "pointerdown", 132, 50);
      pointer(svg(), "pointermove", 142, 60);
      pointer(svg(), "pointerup", 142, 60);
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: { x: 105, y: 50, width: 74, height: 34, rotation: 0 },
        },
      ]);

      // Turned 18°: a pull along the side stretches the side, not a screen axis.
      const angle = (18 * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      frame.scene({ elements: [shaped({ transform: allBox({ rotation: 18 }) })] });
      const start: [number, number] = [100 + 32 * cos, 50 + 32 * sin];
      const end: [number, number] = [start[0] + 10 * cos, start[1] + 10 * sin];
      pointer(target("e"), "pointerdown", start[0], start[1]);
      pointer(svg(), "pointermove", end[0], end[1]);
      pointer(svg(), "pointerup", end[0], end[1]);
      expect(frame.port.messages[1]).toEqual({
        kind: "transformElement",
        id: "e1",
        box: {
          x: expect.closeTo(100 + 5 * cos, 5),
          y: expect.closeTo(50 + 5 * sin, 5),
          width: expect.closeTo(74, 5),
          height: expect.closeTo(34, 5),
          rotation: 18,
        },
      });
    });

    it("reads width by height on the chip while resizing a Shape", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });

      pointer(target("se"), "pointerdown", 132, 67);
      expect(document.querySelector("g.map-readout")).toBeNull();
      pointer(svg(), "pointermove", 142, 77);

      const chip = document.querySelector("g.map-readout");
      if (chip === null) throw new Error("the Frame drew no readout chip");
      expect(chip.querySelector("text")?.textContent).toBe("74 × 44 mm");

      pointer(svg(), "pointerup", 142, 77);
      expect(document.querySelector("g.map-readout")).toBeNull();
    });

    it("picks side cursors from the side's direction on screen, turning with the box", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });

      expect(cursor("n")).toBe("n-resize");
      expect(cursor("e")).toBe("e-resize");
      expect(cursor("s")).toBe("s-resize");
      expect(cursor("w")).toBe("w-resize");

      // A quarter turn carries each side's arrow round with it.
      frame.scene({ elements: [shaped({ transform: allBox({ rotation: 90 }) })] });
      expect(cursor("e")).toBe("s-resize");
      expect(cursor("n")).toBe("e-resize");
    });

    it("cancels a side drag on Escape, restoring the box and sending nothing", () => {
      frame = loadFrame();
      frame.scene({ elements: [shaped()] });

      pointer(target("e"), "pointerdown", 132, 50);
      pointer(svg(), "pointermove", 142, 60);
      expect(outline().getAttribute("width")).toBe("74");
      expect(document.querySelector("rect.map-transform-ghost")).not.toBeNull();

      expect(key("Escape").defaultPrevented).toBe(true);
      expect(outline().getAttribute("width")).toBe("64");
      expect(outline().getAttribute("height")).toBe("34");
      expect(document.querySelector("g.map-readout")).toBeNull();
      expect(document.querySelector("rect.map-transform-ghost")).toBeNull();

      pointer(svg(), "pointerup", 142, 60);
      expect(frame.port.messages).toEqual([]);
    });
  });

  describe("handle set label: a selected Map Label (#796)", () => {
    /** The box a selected Map Label's handles sit on: 84 mm wide, a 7 mm cap, about (100, 50). */
    const labelBox = (overrides: Record<string, unknown> = {}) => ({
      box: { x: 100, y: 50, width: 84, height: 7, rotation: 0, ...overrides },
      handles: "label",
    });

    /** The selected Map Label carrying that box. */
    const labelled = (overrides: Record<string, unknown> = {}) =>
      selected({ transform: labelBox(), ...overrides });

    /** The label's baseline fields, so its bend handle draws beside its transform box. */
    const labelLayout = (overrides: Record<string, unknown> = {}) => ({
      x: 100,
      y: 50,
      rotation: 0,
      width: 84,
      bend: 0,
      ...overrides,
    });

    /** The one bend handle the Frame drew. */
    const bendHandle = (): Element => {
      const circle = document.querySelector("circle.map-bend-handle");
      if (circle === null) throw new Error("the Frame drew no bend handle");
      return circle;
    };

    it("shows its sides at the default cap size, 28 px tall at the test zoom", () => {
      frame = loadFrame();
      frame.scene({ elements: [labelled()] });
      expect(document.querySelectorAll("[data-transform-handle-hit]")).toHaveLength(7);
      expect(document.querySelector('[data-transform-handle-hit="e"]')).not.toBeNull();
    });

    it("draws four corners, the east and west sides, and the turn grip, but no north or south side", () => {
      frame = loadFrame();
      // 7 mm at 8 px per mm is 56 px: past the 48 px under which the sides go
      // with the corners, so the label shows every grip it takes.
      frame.scale = 8;
      frame.scene({ elements: [labelled()] });

      expect(overlay().getAttribute("transform")).toBe("translate(100 50)");
      expect(document.querySelectorAll("[data-transform-handle-hit]")).toHaveLength(7);
      for (const id of ["nw", "ne", "se", "sw", "e", "w", "rotate"]) {
        expect(document.querySelector(`[data-transform-handle="${id}"]`)).not.toBeNull();
      }
      expect(document.querySelector('[data-transform-handle="n"]')).toBeNull();
      expect(document.querySelector('[data-transform-handle="s"]')).toBeNull();
      expect(document.querySelector('[data-transform-handle-hit="n"]')).toBeNull();
      expect(document.querySelector('[data-transform-handle-hit="s"]')).toBeNull();
      // The sides sit on the middle of the left and right edges.
      expect(centre(grip("e"))).toEqual([expect.closeTo(42, 1), expect.closeTo(0, 1)]);
      expect(centre(grip("w"))).toEqual([expect.closeTo(-42, 1), expect.closeTo(0, 1)]);
    });

    it("marks a locked label with a dashed box, a lock badge, and no grips", () => {
      frame = loadFrame();
      frame.scene({ elements: [labelled({ locked: true, label: labelLayout() })] });

      expect(overlay().getAttribute("data-locked")).toBe("true");
      expect(document.querySelector("[data-transform-handle]")).toBeNull();
      expect(document.querySelector("[data-transform-handle-hit]")).toBeNull();
      expect(overlay().querySelector("[data-transform-lock]")).not.toBeNull();
      // A locked label neither bends nor resizes.
      expect(document.querySelector("circle.map-bend-handle")).toBeNull();
    });

    it("grows the cap size and the width together from a corner, and posts one transform with its size", () => {
      frame = loadFrame();
      frame.scene({ elements: [labelled({ movable: true })] });

      pointer(target("se"), "pointerdown", 142, 53.5);
      pointer(svg(), "pointermove", 152, 53.5);

      // Nothing travels to the Worker until release; the box follows the pointer.
      expect(frame.port.messages).toEqual([]);
      expect(outline().getAttribute("width")).toBe("94");
      expect(Number(outline().getAttribute("height"))).toBeCloseTo(7.83, 1);
      // The chip reads the cap size and the width in the scene's own template.
      const chip = document.querySelector("g.map-readout");
      if (chip === null) throw new Error("the Frame drew no readout chip");
      expect(chip.querySelector("text")?.textContent).toBe("Cap 7.8 mm · 94 mm");
      expect(document.querySelector("rect.map-transform-ghost")).not.toBeNull();

      pointer(svg(), "pointerup", 152, 53.5);
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: {
            x: 105,
            y: expect.closeTo(50.42, 1),
            width: 94,
            height: expect.closeTo(7.83, 1),
            rotation: 0,
          },
          size: expect.closeTo(7.83, 1),
        },
      ]);
    });

    it("widens from a side handle without touching the cap size", () => {
      frame = loadFrame();
      // The side grips need the label past 48 px on screen: 7 mm at 8 px per mm.
      frame.scale = 8;
      frame.scene({ elements: [labelled({ movable: true })] });

      // Ten right and ten down still only widen, by ten: the cap size stays 7 mm.
      pointer(target("e"), "pointerdown", 142, 50);
      pointer(svg(), "pointermove", 152, 60);

      expect(outline().getAttribute("width")).toBe("94");
      expect(outline().getAttribute("height")).toBe("7");
      const chip = document.querySelector("g.map-readout");
      if (chip === null) throw new Error("the Frame drew no readout chip");
      expect(chip.querySelector("text")?.textContent).toBe("Cap 7 mm · 94 mm");

      pointer(svg(), "pointerup", 152, 60);
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: { x: 105, y: 50, width: 94, height: 7, rotation: 0 },
          size: 7,
        },
      ]);
    });

    it("stretches along its own turned side", () => {
      frame = loadFrame();
      // The side grips need the label past 48 px on screen: 7 mm at 8 px per mm.
      frame.scale = 8;
      frame.scene({ elements: [labelled({ transform: labelBox({ rotation: 18 }) })] });

      // A pull along the side stretches the side, not a screen axis.
      const angle = (18 * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const start: [number, number] = [100 + 42 * cos, 50 + 42 * sin];
      const end: [number, number] = [start[0] + 10 * cos, start[1] + 10 * sin];
      pointer(target("e"), "pointerdown", start[0], start[1]);
      pointer(svg(), "pointermove", end[0], end[1]);
      pointer(svg(), "pointerup", end[0], end[1]);

      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: {
            x: expect.closeTo(100 + 5 * cos, 5),
            y: expect.closeTo(50 + 5 * sin, 5),
            width: expect.closeTo(94, 5),
            height: expect.closeTo(7, 5),
            rotation: 18,
          },
          size: expect.closeTo(7, 5),
        },
      ]);
    });

    it("never previews a cap size below the scene's minimum", () => {
      frame = loadFrame();
      // The Worker clamps a label's width and cap size, and says the width's
      // floor through the handle data, so the preview stops where it will.
      frame.scene({ elements: [labelled({ transform: { ...labelBox(), minSize: 2 } })] });

      pointer(target("se"), "pointerdown", 142, 53.5);
      // Well past the anchored corner: the cap size must not sink below 2 mm.
      pointer(svg(), "pointermove", 0, 0);

      expect(outline().getAttribute("width")).toBe("24");
      expect(outline().getAttribute("height")).toBe("2");
      pointer(svg(), "pointerup", 0, 0);
      expect(frame.port.messages).toEqual([
        {
          kind: "transformElement",
          id: "e1",
          box: {
            x: 70,
            y: 47.5,
            width: expect.closeTo(24, 2),
            height: expect.closeTo(2, 2),
            rotation: 0,
          },
          size: expect.closeTo(2, 2),
        },
      ]);
    });

    it("cancels a label drag on Escape, restoring the box and sending nothing", () => {
      frame = loadFrame();
      // The side grips need the label past 48 px on screen: 7 mm at 8 px per mm.
      frame.scale = 8;
      frame.scene({ elements: [labelled()] });

      pointer(target("e"), "pointerdown", 142, 50);
      pointer(svg(), "pointermove", 152, 60);
      expect(outline().getAttribute("width")).toBe("94");
      expect(document.querySelector("rect.map-transform-ghost")).not.toBeNull();

      expect(key("Escape").defaultPrevented).toBe(true);
      expect(outline().getAttribute("width")).toBe("84");
      expect(outline().getAttribute("height")).toBe("7");
      expect(document.querySelector("g.map-readout")).toBeNull();
      expect(document.querySelector("rect.map-transform-ghost")).toBeNull();

      pointer(svg(), "pointerup", 152, 60);
      expect(frame.port.messages).toEqual([]);
    });

    it("keeps the preview after release until the next scene arrives", () => {
      frame = loadFrame();
      frame.scene({ elements: [labelled()] });

      pointer(target("se"), "pointerdown", 142, 53.5);
      pointer(svg(), "pointermove", 152, 53.5);
      pointer(svg(), "pointerup", 152, 53.5);

      // The Worker has not answered, so the label keeps the size the drag gave it.
      expect(outline().getAttribute("width")).toBe("94");
      expect(Number(outline().getAttribute("height"))).toBeCloseTo(7.83, 1);

      // A scene that still holds the start box ends the preview, as a refused drag does.
      frame.scene({ elements: [labelled()] });
      expect(outline().getAttribute("width")).toBe("84");
      expect(outline().getAttribute("height")).toBe("7");
    });

    it("still bends from the bend handle, which no transform grip covers", () => {
      frame = loadFrame();
      frame.scene({ elements: [labelled({ movable: true, label: labelLayout() })] });

      // The straight label's apex sits at its own middle, where no grip sits
      // once the top and bottom middles are gone.
      expect(bendHandle().getAttribute("cx")).toBe("100");
      expect(bendHandle().getAttribute("cy")).toBe("50");

      pointer(bendHandle(), "pointerdown", 100, 50);
      pointer(svg(), "pointermove", 100, 36);
      pointer(svg(), "pointerup", 100, 36);

      // The press shaped the curve: it never picked, moved, or resized the label.
      expect(frame.port.messages).toEqual([{ kind: "bendLabel", id: "e1", bend: 14 }]);
      frame.port.messages.length = 0;

      // A grip press still resizes, and never bends.
      pointer(target("se"), "pointerdown", 142, 53.5);
      pointer(svg(), "pointermove", 152, 53.5);
      pointer(svg(), "pointerup", 152, 53.5);
      expect(frame.port.messages).toHaveLength(1);
      expect(frame.port.messages[0]).toMatchObject({ kind: "transformElement", id: "e1" });
    });

    it("draws the bend handle above the transform box, so it wins a tie", () => {
      frame = loadFrame();
      frame.scene({ elements: [labelled({ movable: true, label: labelLayout() })] });

      // Later in the document paints above, so a press where a grip and the
      // bend handle meet reaches the bend handle first.
      const order = overlay().compareDocumentPosition(bendHandle());
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it("grows the side grip under the pointer, and reads side cursors", () => {
      frame = loadFrame();
      // The side grips need the label past 48 px on screen: 7 mm at 8 px per mm.
      frame.scale = 8;
      frame.scene({ elements: [labelled()] });
      const resting = pixels(grip("e"), 8);

      pointer(target("e"), "pointermove", 142, 50);
      expect(grip("e").getAttribute("data-hovered")).toBe("true");
      expect(pixels(grip("e"), 8)).toBeGreaterThan(resting);
      pointer(svg(), "pointermove", 300, 300);
      expect(grip("e").getAttribute("data-hovered")).toBeNull();

      expect(cursor("e")).toBe("e-resize");
      expect(cursor("w")).toBe("w-resize");
      expect(cursor("rotate")).toBe("grab");

      // A quarter turn carries each side's arrow round with it.
      frame.scene({ elements: [labelled({ transform: labelBox({ rotation: 90 }) })] });
      expect(cursor("e")).toBe("s-resize");
      expect(cursor("w")).toBe("n-resize");
    });
  });
});

describe("the Frame's mirrored handle maths (#795)", () => {
  /** A box centred on the page, 40 mm wide and 20 mm high unless a case says otherwise. */
  const box = (overrides: Partial<TransformBox> = {}): TransformBox => ({
    x: 100,
    y: 50,
    width: 40,
    height: 20,
    rotation: 0,
    ...overrides,
  });

  /** Where a point of a box's own frame sits on the page, in millimetres. */
  const pageOf = (frame: TransformBox, local: [number, number]): [number, number] => {
    const angle = (frame.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [frame.x + local[0] * cos - local[1] * sin, frame.y + local[0] * sin + local[1] * cos];
  };

  /** The page point of one corner of a box, named the way a handle is. */
  const cornerOf = (frame: TransformBox, corner: "nw" | "ne" | "se" | "sw"): [number, number] => {
    const signX = corner === "ne" || corner === "se" ? 1 : -1;
    const signY = corner === "sw" || corner === "se" ? 1 : -1;
    return pageOf(frame, [(signX * frame.width) / 2, (signY * frame.height) / 2]);
  };

  /** Where a point sits a given angle and distance from the page centre. */
  const aim = (degrees: number, radius = 10): [number, number] => [
    100 + radius * Math.cos((degrees * Math.PI) / 180),
    50 + radius * Math.sin((degrees * Math.PI) / 180),
  ];

  /** Ten millimetres along the local +x of an 18° box, from its east side. */
  const turned18 = box({ rotation: 18 });
  const east18 = pageOf(turned18, [20, 0]);
  const along18: [number, number] = [
    east18[0] + 10 * Math.cos((18 * Math.PI) / 180),
    east18[1] + 10 * Math.sin((18 * Math.PI) / 180),
  ];

  const cases: { name: string; gesture: TransformGesture }[] = [
    {
      name: "a corner growing with its aspect kept",
      gesture: { box: box(), handle: "se", start: [120, 60], point: [130, 65], aspect: true },
    },
    {
      name: "a corner shrinking with its aspect kept",
      gesture: { box: box(), handle: "nw", start: [80, 40], point: [85, 45], aspect: true },
    },
    {
      name: "a corner growing about the centre with Alt",
      gesture: {
        box: box(),
        handle: "se",
        start: [120, 60],
        point: [130, 65],
        aspect: true,
        fromCentre: true,
      },
    },
    {
      name: "a side moving one axis",
      gesture: { box: box(), handle: "e", start: [120, 50], point: [130, 50], aspect: false },
    },
    {
      name: "a free corner with no aspect kept",
      gesture: { box: box(), handle: "se", start: [120, 60], point: [130, 65] },
    },
    {
      name: "a side of an 18° box pulled along its own side",
      gesture: {
        box: turned18,
        handle: "e",
        start: east18,
        point: along18,
      },
    },
    {
      name: "a corner of a turned box in its own frame",
      gesture: {
        box: box({ rotation: 90 }),
        handle: "se",
        start: cornerOf(box({ rotation: 90 }), "se"),
        point: [90, 80],
        aspect: true,
      },
    },
    {
      name: "a turn the pointer sweeps",
      gesture: { box: box(), handle: "rotate", start: [100, 40], point: [110, 50] },
    },
    {
      name: "a turn added to the angle the box had",
      gesture: {
        box: box({ rotation: 350 }),
        handle: "rotate",
        start: [100, 40],
        point: [110, 50],
      },
    },
    {
      name: "a turn snapped to a 15° step with Shift",
      gesture: { box: box(), handle: "rotate", start: [110, 50], point: aim(44), snap: true },
    },
    {
      name: "a turn stuck to a right angle within 2°",
      gesture: { box: box(), handle: "rotate", start: [110, 50], point: aim(89) },
    },
    {
      name: "a drag past the anchor kept above zero",
      gesture: {
        box: box(),
        handle: "se",
        start: [120, 60],
        point: [60, 40],
        aspect: false,
        minWidth: 1,
        minHeight: 1,
      },
    },
  ];

  it("returns the same box as geometry.ts over the table of cases", () => {
    frame = loadFrame();
    for (const { name, gesture } of cases) {
      const mirrored = frame.transformBox(gesture);
      const geometry = geometryTransformBox(gesture);
      for (const key of ["x", "y", "width", "height", "rotation"] as const) {
        expect(mirrored[key], `${name}: ${key}`).toBeCloseTo(geometry[key], 6);
      }
    }
  });
});

describe("an uploaded picture on the Map (#756)", () => {
  /** One image primitive: an 80 by 40 mm box centred on (100, 50), upright and opaque. */
  const imageShape = (overrides: Record<string, unknown> = {}) => ({
    kind: "image",
    assetId: "a1",
    x: 100,
    y: 50,
    width: 80,
    height: 40,
    rotation: 0,
    opacity: 1,
    ...overrides,
  });

  /** Every `blob:` URL a test makes, and every one it frees. */
  function stubBlobUrls(): { created: string[]; revoked: string[]; restore(): void } {
    const created: string[] = [];
    const revoked: string[] = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      const url = `blob:mock/${created.length + 1}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    return {
      created,
      revoked,
      restore() {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      },
    };
  }

  it("draws a picture in the box the scene gives it, at the blob URL it was sent", () => {
    const blobs = stubBlobUrls();
    try {
      frame = loadFrame();
      frame.port.deliver({ kind: "asset", id: "a1", mime: "image/png", data: "AAAA" });
      frame.scene({
        elements: [
          sceneElement({
            id: "scan",
            shapes: [imageShape({ rotation: 15, opacity: 0.4, tint: "#1f2933" })],
          }),
        ],
      });

      const drawn = document.querySelector("image.map-image");
      expect(drawn?.getAttribute("href")).toBe("blob:mock/1");
      expect(drawn?.getAttribute("x")).toBe("60");
      expect(drawn?.getAttribute("y")).toBe("30");
      expect(drawn?.getAttribute("width")).toBe("80");
      expect(drawn?.getAttribute("height")).toBe("40");
      expect(drawn?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
      expect(drawn?.getAttribute("opacity")).toBe("0.4");
      expect(drawn?.getAttribute("transform")).toBe("rotate(15 100 50)");
      expect(drawn?.getAttribute("filter")).toBe("url(#asset-tint-1f2933)");
    } finally {
      blobs.restore();
    }
  });

  it("draws nothing for a picture whose bytes have not arrived, though it can still be picked", () => {
    frame = loadFrame();
    frame.scene({ elements: [sceneElement({ id: "scan", shapes: [imageShape()] })] });

    expect(document.querySelector("image.map-image")).toBeNull();
    // The box itself is the target, so a press still selects the Element.
    const hit = document.querySelector("path.map-hit");
    expect(hit?.getAttribute("d")).toBe("M 60 30 L 140 30 L 140 70 L 60 70 Z");
    expect(hit?.getAttribute("data-fill")).toBe("true");
  });

  it("draws the picture as soon as its bytes arrive, after the scene that names it", () => {
    const blobs = stubBlobUrls();
    try {
      frame = loadFrame();
      // The Worker sends the scene first and a picture's bytes after the Library
      // read that holds them (#756), so the Frame repaints when they land: an
      // upload must not wait for the next pan, select, or edit to appear.
      frame.scene({ elements: [sceneElement({ id: "scan", shapes: [imageShape()] })] });
      expect(document.querySelector("image.map-image")).toBeNull();

      frame.port.deliver({ kind: "asset", id: "a1", mime: "image/png", data: "AAAA" });

      const drawn = document.querySelector("image.map-image");
      expect(drawn?.getAttribute("href")).toBe("blob:mock/1");
      expect(drawn?.getAttribute("x")).toBe("60");
      expect(drawn?.getAttribute("width")).toBe("80");
      // The Element it belongs to keeps its selection and its hit box.
      expect(document.querySelector("g[data-element-id='scan'] path.map-hit")).not.toBeNull();
    } finally {
      blobs.restore();
    }
  });

  it("holds a picture sent before any scene, and draws it with the first one", () => {
    const blobs = stubBlobUrls();
    try {
      frame = loadFrame();
      // No scene yet: the bytes are kept and nothing is drawn.
      frame.port.deliver({ kind: "asset", id: "a1", mime: "image/png", data: "AAAA" });
      expect(document.querySelector("svg")).toBeNull();

      frame.scene({ elements: [sceneElement({ id: "scan", shapes: [imageShape()] })] });

      expect(document.querySelector("image.map-image")?.getAttribute("href")).toBe("blob:mock/1");
    } finally {
      blobs.restore();
    }
  });

  it("marks a selected picture with the box it covers", () => {
    frame = loadFrame();
    frame.scene({
      elements: [sceneElement({ id: "scan", selected: true, shapes: [imageShape()] })],
    });

    const outline = document.querySelector("path.map-selection");
    expect(outline?.getAttribute("d")).toBe("M 60 30 L 140 30 L 140 70 L 60 70 Z");
  });

  it("drops a picture the scene gives no asset id or no size", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        sceneElement({
          id: "scan",
          shapes: [
            imageShape({ assetId: "" }),
            imageShape({ width: 0 }),
            imageShape({ height: -4 }),
            imageShape({ x: undefined }),
          ],
        }),
      ],
    });

    expect(document.querySelector("image.map-image")).toBeNull();
  });

  it("swaps the export's picture placeholders for the data URIs it keeps, dropping one it never got", () => {
    const blobs = stubBlobUrls();
    try {
      frame = loadFrame();
      frame.port.deliver({ kind: "asset", id: "a1", mime: "image/png", data: "AAAA" });

      const swapped = frame.assetSvg(
        '<svg><image href="asset:a1" x="0" y="0" width="8" height="4" preserveAspectRatio="xMidYMid meet"/><image href="asset:gone" x="0" y="0" width="8" height="4" preserveAspectRatio="xMidYMid meet"/></svg>'
      );

      // A browser loads no subresource into an SVG it draws as an image, a
      // `blob:` one included, so the raster carries the picture's own bytes.
      expect(swapped).toContain('href="data:image/png;base64,AAAA"');
      expect(swapped).not.toContain("asset:");
      expect(swapped).not.toContain("blob:");
      expect(swapped.match(/<image /g)).toHaveLength(1);
    } finally {
      blobs.restore();
    }
  });

  it("draws a Custom Fill's texture with the bitmap URL it keeps, once its picture arrives", () => {
    const blobs = stubBlobUrls();
    try {
      frame = loadFrame();
      // `sceneToSvg` names a Custom Fill's texture picture inside the pattern
      // the Frame injects as definitions, so the placeholder needs the same
      // swap the drawn markup gets, or the live canvas paints nothing.
      const defs = [
        '<pattern id="custom-fill-texture-1" patternUnits="userSpaceOnUse" width="20" height="10"><image href="asset:a1" x="0" y="0" width="20" height="10" preserveAspectRatio="xMidYMid slice"/></pattern>',
      ];
      frame.scene({ defs, elements: [sceneElement({ id: "meadow" })] });

      // Before the bytes land the picture is dropped rather than left blank.
      expect(document.querySelector("defs pattern#custom-fill-texture-1 image")).toBeNull();

      // The Worker sends the bytes after the scene, and the repaint they cause
      // is what puts the picture in the pattern.
      frame.port.deliver({ kind: "asset", id: "a1", mime: "image/png", data: "AAAA" });

      const drawn = document.querySelector("defs pattern#custom-fill-texture-1 image");
      expect(drawn?.getAttribute("href")).toBe("blob:mock/1");
      // The Fill painting with that pattern still references its own id.
      expect(document.querySelector("defs")).not.toBeNull();
    } finally {
      blobs.restore();
    }
  });
});

describe("pointer zoom and pan (#777)", () => {
  /** One wheel event over the drawing; jsdom neither scrolls nor throttles it. */
  function wheel(x: number, y: number, init: WheelEventInit = {}): WheelEvent {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...init,
    });
    svg().dispatchEvent(event);
    return event;
  }

  /** One pointer event of a named kind of pointer, which jsdom has no class for. */
  function pointerOf(
    type: string,
    x: number,
    y: number,
    pointerId: number,
    pointerType: string,
    button = 0
  ) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    svg().dispatchEvent(event);
  }

  /**
   * One pointer event of a named kind of pointer that never reaches the
   * surface, the way a finger lifted past the drawing's edge does.
   */
  function pointerOffSurface(
    type: string,
    x: number,
    y: number,
    pointerId: number,
    pointerType: string
  ) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    window.dispatchEvent(event);
  }

  /** Lifting Space, which restores the tool the author was drawing with. */
  function releaseSpace(): void {
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
  }

  it("zooms around the pointer for a Ctrl or Cmd wheel, and keeps the wheel's default", () => {
    frame = loadFrame();
    frame.scene();

    const pinch = wheel(60, 25, { ctrlKey: true, deltaY: -100 });
    const command = wheel(60, 25, { metaKey: true, deltaY: 100 });

    expect(pinch.defaultPrevented).toBe(true);
    expect(command.defaultPrevented).toBe(true);
    // The page point under the pointer travels with the request, so the
    // editor can crop the view around it instead of around the centre.
    expect(frame.port.messages[0]).toEqual({
      kind: "zoom",
      point: [60, 25],
      factor: expect.closeTo(Math.exp(0.2), 5),
    });
    expect(frame.port.messages[1]).toEqual({
      kind: "zoom",
      point: [60, 25],
      factor: expect.closeTo(Math.exp(-0.2), 5),
    });
  });

  it("leaves a plain wheel to the Frame's document", () => {
    frame = loadFrame();
    frame.scene();

    const event = wheel(60, 25, { deltaY: -100 });

    expect(event.defaultPrevented).toBe(false);
    expect(frame.port.messages).toEqual([]);
  });

  it("pans with Space held whatever tool is active, and draws nothing", () => {
    frame = loadFrame();
    frame.scene({ tool: "pencil" });
    key(" ");

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 20, 15);
    pointer(svg(), "pointerup", 20, 15);

    // The drawing follows the gesture, so the view slides the other way.
    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -10, dy: -5 }]);

    // Releasing Space gives the Pencil back: the next drag draws a Map Line.
    releaseSpace();
    pointer(svg(), "pointerdown", 30, 30);
    pointer(svg(), "pointermove", 40, 30);
    pointer(svg(), "pointerup", 40, 30);

    expect(frame.port.messages).toEqual([
      { kind: "pan", dx: -10, dy: -5 },
      {
        kind: "stroke",
        points: [
          [30, 30],
          [40, 30],
        ],
      },
    ]);
  });

  it("keeps the key to itself while Space is held, so the host never draws from it", () => {
    frame = loadFrame();
    frame.scene();

    expect(key(" ").defaultPrevented).toBe(true);
  });

  it("pans on a primary drag with the Hand, picks nothing, and shows the grab cursor state", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand", elements: [sceneElement()] });
    expect(svg().getAttribute("data-tool")).toBe("hand");
    expect(svg().getAttribute("data-panning")).toBe("false");

    // The press lands on an Element, which Select would pick.
    const line = document.querySelector('g[data-element-id="e1"] path.map-line');
    if (line === null) throw new Error("the Element drew no line");
    pointer(line, "pointerdown", 10, 10);
    expect(svg().getAttribute("data-panning")).toBe("true");
    pointer(svg(), "pointermove", 20, 15);
    pointer(svg(), "pointerup", 20, 15);

    // The Hand never selects, draws, or moves: the drag is one pan step.
    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -10, dy: -5 }]);
    expect(svg().getAttribute("data-panning")).toBe("false");
  });

  it("slides the view in the Frame while a pan drags, and sends one pan on release", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand", elements: [sceneElement()] });
    expect(svg().getAttribute("viewBox")).toBe("0 0 200 100");

    // Every step moves the view at once, and none of them reaches the Worker:
    // a step per pointermove made the Worker rebuild and resend the whole
    // scene sixty times a second, which a large Map could not keep up with.
    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 15, 12);
    expect(svg().getAttribute("viewBox")).toBe("-5 -2 200 100");
    pointer(svg(), "pointermove", 20, 15);
    pointer(svg(), "pointermove", 30, 20);
    expect(svg().getAttribute("viewBox")).toBe("-20 -10 200 100");
    expect(frame.port.messages).toEqual([]);

    pointer(svg(), "pointerup", 30, 20);
    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -20, dy: -10 }]);
    // Until the Worker answers, the view stays where the drag left it.
    expect(svg().getAttribute("viewBox")).toBe("-20 -10 200 100");

    // The Worker's answer carries the pan, so the Frame stops adding its own.
    frame.scene({ tool: "hand", elements: [sceneElement()], panX: -20, panY: -10 });
    expect(svg().getAttribute("viewBox")).toBe("-20 -10 200 100");
    frame.scene({ tool: "hand", elements: [sceneElement()], panX: -20, panY: -10 });
    expect(svg().getAttribute("viewBox")).toBe("-20 -10 200 100");
  });

  it("keeps the dragged view when an unrelated scene arrives mid-pan", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand" });

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 20, 10);
    // An edit elsewhere sends a scene whose pan is the Worker's, without the
    // drag's; the drag keeps its place on top of it.
    frame.scene({ tool: "hand", elements: [sceneElement()] });
    expect(svg().getAttribute("viewBox")).toBe("-10 0 200 100");
    pointer(svg(), "pointermove", 25, 10);
    pointer(svg(), "pointerup", 25, 10);

    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -15, dy: 0 }]);
  });

  it("holds two quick pans until the Worker has answered both", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand" });

    pointer(svg(), "pointerdown", 10, 10);
    pointer(svg(), "pointermove", 20, 10);
    pointer(svg(), "pointerup", 20, 10);
    pointer(svg(), "pointerdown", 20, 10);
    pointer(svg(), "pointermove", 20, 30);
    pointer(svg(), "pointerup", 20, 30);
    expect(svg().getAttribute("viewBox")).toBe("-10 -20 200 100");

    // The first answer arrives: the second pan is still the Frame's to show.
    frame.scene({ tool: "hand", panX: -10, panY: 0 });
    expect(svg().getAttribute("viewBox")).toBe("-10 -20 200 100");
    frame.scene({ tool: "hand", panX: -10, panY: -20 });
    expect(svg().getAttribute("viewBox")).toBe("-10 -20 200 100");
    expect(frame.port.messages).toEqual([
      { kind: "pan", dx: -10, dy: 0 },
      { kind: "pan", dx: 0, dy: -20 },
    ]);
  });

  it("keeps a Hand pan's travel when a second finger joins it", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand" });

    pointerOf("pointerdown", 10, 10, 1, "touch");
    pointerOf("pointermove", 20, 10, 1, "touch");
    // The second finger hands the pan to the pair: what the first finger slid
    // goes to the Worker, and the view does not jump back.
    pointerOf("pointerdown", 40, 40, 2, "touch");
    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -10, dy: 0 }]);
    expect(svg().getAttribute("viewBox")).toBe("-10 0 200 100");

    // Both fingers travel 5 mm down, so their average does too.
    pointerOf("pointermove", 20, 15, 1, "touch");
    pointerOf("pointermove", 40, 45, 2, "touch");
    pointerOf("pointerup", 20, 15, 1, "touch");
    pointerOf("pointerup", 40, 45, 2, "touch");

    expect(frame.port.messages).toEqual([
      { kind: "pan", dx: -10, dy: 0 },
      { kind: "pan", dx: 0, dy: -5 },
    ]);
    expect(svg().getAttribute("viewBox")).toBe("-10 -5 200 100");
  });

  it("pans on a one-finger drag with the Hand", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand" });

    pointerOf("pointerdown", 10, 10, 1, "touch");
    pointerOf("pointermove", 16, 13, 1, "touch");
    pointerOf("pointerup", 16, 13, 1, "touch");

    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -6, dy: -3 }]);
  });

  it("ignores a right-button press with the Hand", () => {
    frame = loadFrame();
    frame.scene({ tool: "hand" });

    pointerOf("pointerdown", 10, 10, 1, "mouse", 2);
    pointerOf("pointermove", 20, 15, 1, "mouse", 2);
    pointerOf("pointerup", 20, 15, 1, "mouse", 2);

    expect(frame.port.messages).toEqual([]);
  });

  it("pans on a middle-button drag and never draws", () => {
    frame = loadFrame();
    frame.scene({ tool: "pencil" });

    pointer(svg(), "pointerdown", 10, 10, { button: 1 });
    pointer(svg(), "pointermove", 15, 12);
    pointer(svg(), "pointerup", 15, 12, { button: 1 });

    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -5, dy: -2 }]);
  });

  it("pans on a two-finger drag, dropping the stroke one finger began", () => {
    frame = loadFrame();
    frame.scene({ tool: "pencil" });

    pointerOf("pointerdown", 10, 10, 1, "touch");
    pointerOf("pointermove", 12, 10, 1, "touch");
    // The second finger turns the gesture into a pan: the stroke under way is
    // dropped without reaching the Worker.
    pointerOf("pointerdown", 40, 40, 2, "touch");
    // Both fingers travel together, so the pan follows their average: the pair
    // moved five millimetres right of where it began.
    pointerOf("pointermove", 22, 10, 1, "touch");
    pointerOf("pointerup", 22, 10, 1, "touch");
    pointerOf("pointerup", 40, 40, 2, "touch");

    expect(frame.port.messages).toEqual([{ kind: "pan", dx: -5, dy: 0 }]);
  });

  it("forgets a finger that lifts off the surface, so the next tap draws", () => {
    frame = loadFrame();
    frame.scene({ tool: "bucket" });

    // A touch lands on the drawing and pours where it fell.
    pointerOf("pointerdown", 20, 20, 1, "touch");
    // It slides off the surface and lifts there, so the surface never hears
    // its pointerup and no capture ever brings it back.
    pointerOffSurface("pointerup", 20, 20, 1, "touch");

    // The next tap is one finger alone, so it pours rather than panning.
    pointerOf("pointerdown", 40, 30, 2, "touch");
    pointerOf("pointermove", 45, 30, 2, "touch");
    pointerOf("pointerup", 45, 30, 2, "touch");

    expect(frame.port.messages).toEqual([
      { kind: "pour", point: [20, 20] },
      { kind: "pour", point: [40, 30] },
    ]);
  });
});

describe("pinching and twisting a selected Element (#796)", () => {
  /** One touch event on a target, carrying the finger's pointer id. */
  function touch(target: Element, type: string, x: number, y: number, pointerId: number): void {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    Object.defineProperty(event, "pointerType", { value: "touch" });
    target.dispatchEvent(event);
  }

  /** The box a selected Stamp's pinch starts from: 20 by 10 mm about (100, 50). */
  const pinchBox = (overrides: Record<string, unknown> = {}) => ({
    box: { x: 100, y: 50, width: 20, height: 10, rotation: 0, ...overrides },
    handles: "corners",
  });

  /** One selected Element carrying that box. */
  const pinched = (overrides: Record<string, unknown> = {}) =>
    sceneElement({ selected: true, movable: true, transform: pinchBox(), ...overrides });

  /** The Element's own group, where a pinch previews the art. */
  const elementGroup = (): Element => {
    const group = document.querySelector('g[data-element-id="e1"]');
    if (group === null) throw new Error("the Element drew no group");
    return group;
  };

  /** The Element's art, which the first finger lands on. */
  const art = (): Element => {
    const line = document.querySelector('g[data-element-id="e1"] path.map-line');
    if (line === null) throw new Error("the Element drew no art");
    return line;
  };

  it("pinches a selected Element to size, previews live, and sends one transformElement on release", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched()] });

    // The first finger lands on the Element, which selects it as a tap would.
    touch(art(), "pointerdown", 90, 50, 1);
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
    // The second finger starts the pinch, not a pan: the view stays put.
    touch(svg(), "pointerdown", 110, 50, 2);
    expect(svg().getAttribute("viewBox")).toBe("0 0 200 100");

    // Spreading the fingers to twice the distance doubles both sides live,
    // through the same preview a handle drag draws.
    touch(svg(), "pointermove", 80, 50, 1);
    touch(svg(), "pointermove", 120, 50, 2);
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(100 50) scale(2) translate(-100 -50)"
    );
    expect(svg().getAttribute("viewBox")).toBe("0 0 200 100");
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);

    touch(svg(), "pointerup", 80, 50, 1);
    touch(svg(), "pointerup", 120, 50, 2);
    // One gesture is one message, so it is one undo step.
    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 100, y: 50, width: 40, height: 20, rotation: 0 },
      },
    ]);
    // The preview holds until the Worker answers, so the art never jumps back.
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(100 50) scale(2) translate(-100 -50)"
    );
    frame.scene({ elements: [pinched()] });
    expect(elementGroup().getAttribute("transform")).toBeNull();
  });

  it("twists the Element from the angle change, about the fingers' midpoint", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched()] });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    // A quarter turn of the pair turns the Element a quarter turn, at the same size.
    touch(svg(), "pointermove", 100, 40, 1);
    touch(svg(), "pointermove", 100, 60, 2);
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(100 50) rotate(90) translate(-100 -50)"
    );

    touch(svg(), "pointerup", 100, 40, 1);
    touch(svg(), "pointerup", 100, 60, 2);
    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 100, y: 50, width: 20, height: 10, rotation: 90 },
      },
    ]);
  });

  it("carries the Element with the fingers' midpoint", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched()] });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    // Both fingers slide ten right and five down at the same spread and angle.
    touch(svg(), "pointermove", 100, 55, 1);
    touch(svg(), "pointermove", 120, 55, 2);

    touch(svg(), "pointerup", 100, 55, 1);
    touch(svg(), "pointerup", 120, 55, 2);
    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 110, y: 55, width: 20, height: 10, rotation: 0 },
      },
    ]);
  });

  it("carries a Map Label's cap size, scaling it with the width", () => {
    frame = loadFrame();
    frame.scene({
      elements: [
        pinched({
          transform: {
            box: { x: 100, y: 50, width: 40, height: 6, rotation: 0 },
            handles: "label",
            minSize: 2,
          },
        }),
      ],
    });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    touch(svg(), "pointermove", 80, 50, 1);
    touch(svg(), "pointermove", 120, 50, 2);
    touch(svg(), "pointerup", 80, 50, 1);
    touch(svg(), "pointerup", 120, 50, 2);

    // The corner's uniform growth, as one message with the cap size the
    // preview showed.
    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 100, y: 50, width: 80, height: 12, rotation: 0 },
        size: 12,
      },
    ]);
  });

  it("clamps the pinch to the minimum size the scene gives", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched({ transform: { ...pinchBox(), minSize: 8 } })] });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    // A tenth of the spread would shrink the width to 2 mm, under the 8 mm floor.
    touch(svg(), "pointermove", 99, 50, 1);
    touch(svg(), "pointermove", 101, 50, 2);
    touch(svg(), "pointerup", 99, 50, 1);
    touch(svg(), "pointerup", 101, 50, 2);

    expect(frame.port.messages).toEqual([
      { kind: "select", id: "e1" },
      {
        kind: "transformElement",
        id: "e1",
        box: { x: 100, y: 50, width: 8, height: 4, rotation: 0 },
      },
    ]);
  });

  it("sends nothing when the fingers lift without moving", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched()] });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    touch(svg(), "pointerup", 90, 50, 1);
    touch(svg(), "pointerup", 110, 50, 2);

    // The press selected, but the gesture never shaped anything.
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
  });

  it("pans when the first finger lands anywhere but the selected Element", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched()] });

    // Both fingers land on empty page, missing the Element entirely.
    touch(svg(), "pointerdown", 10, 10, 1);
    touch(svg(), "pointerdown", 40, 40, 2);
    touch(svg(), "pointermove", 22, 10, 1);
    touch(svg(), "pointerup", 22, 10, 1);
    touch(svg(), "pointerup", 40, 40, 2);

    expect(frame.port.messages).toContainEqual(expect.objectContaining({ kind: "pan" }));
    expect(frame.port.messages).not.toContainEqual(
      expect.objectContaining({ kind: "transformElement" })
    );
  });

  it("pans on a locked Element instead of pinching it", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched({ locked: true, movable: false })] });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    // Both fingers slide right together, so their average does too.
    touch(svg(), "pointermove", 100, 50, 1);
    touch(svg(), "pointermove", 120, 50, 2);
    touch(svg(), "pointerup", 100, 50, 1);
    touch(svg(), "pointerup", 120, 50, 2);

    expect(frame.port.messages).toContainEqual(expect.objectContaining({ kind: "pan" }));
    expect(frame.port.messages).not.toContainEqual(
      expect.objectContaining({ kind: "transformElement" })
    );
  });

  it("cancels the pinch on Escape without posting it", () => {
    frame = loadFrame();
    frame.scene({ elements: [pinched()] });

    touch(art(), "pointerdown", 90, 50, 1);
    touch(svg(), "pointerdown", 110, 50, 2);
    touch(svg(), "pointermove", 80, 50, 1);
    touch(svg(), "pointermove", 120, 50, 2);
    expect(elementGroup().getAttribute("transform")).toBe(
      "translate(100 50) scale(2) translate(-100 -50)"
    );

    key("Escape");
    expect(elementGroup().getAttribute("transform")).toBeNull();
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);

    touch(svg(), "pointerup", 80, 50, 1);
    touch(svg(), "pointerup", 120, 50, 2);
    expect(frame.port.messages).toEqual([{ kind: "select", id: "e1" }]);
  });
});
