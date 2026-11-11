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
import { afterEach, describe, expect, it } from "vitest";
import { MAP_FRAME_SRC } from "./map-page";
import { parseFrameMessage, sceneMessage } from "./frame-protocol";
import { MAP_LABEL_FONT_FAMILIES, MAP_LABEL_FONTS } from "./maps";
import { TEXT_FONT_FAMILY, sceneToSvg } from "./scene";

const HTML = readFileSync(join(__dirname, "assets/ui/map.html"), "utf8");
const LIBRARY = readFileSync(join(__dirname, "assets/ui/lib/htm-preact-standalone.umd.js"), "utf8");
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
  /** Sends one scene, with the defaults a Select-tool, unzoomed view has. */
  scene(overrides?: Record<string, unknown>): void;
}

/** Loads the Frame's markup, the vendored library, and its script. */
function loadFrame(): Frame {
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakePort();
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  const cleanups: (() => void)[] = [];
  const origin: [number, number] = [0, 0];
  (globalThis as Record<string, unknown>).__mapTestHooks = {
    pagePoint: (event: MouseEvent) => [event.clientX - origin[0], event.clientY - origin[1]],
    onReady: (cleanup: () => void) => cleanups.push(cleanup),
  };
  try {
    new Function(LIBRARY)();
    new Function(SCRIPT)();
  } finally {
    delete (globalThis as Record<string, unknown>).__mapTestHooks;
  }
  return {
    port,
    cleanups,
    origin,
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
        ...overrides,
      });
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
  delete (globalThis as Record<string, unknown>).FontFace;
  delete (document as unknown as { fonts?: unknown }).fonts;
  document.documentElement.innerHTML = "";
});

describe("the Map Frame page", () => {
  it("mounts a document that exists in the Plugin folder", () => {
    expect(MAP_FRAME_SRC).toBe("assets/ui/map.html");
    expect(existsSync(join(__dirname, MAP_FRAME_SRC))).toBe(true);
    expect(HTML).toContain('src="lib/htm-preact-standalone.umd.js"');
    expect(HTML).toContain('src="map.js"');
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
    for (const file of files) expect(HTML).toContain(`url("fonts/${file}")`);

    expect(HTML.match(/@font-face/g)).toHaveLength(MAP_LABEL_FONTS.length);
    expect(HTML.match(/font-display: block;/g)).toHaveLength(MAP_LABEL_FONTS.length);
    for (const font of MAP_LABEL_FONTS) {
      expect(HTML).toContain(`font-family: "${MAP_LABEL_FONT_FAMILIES[font]}"`);
    }

    // The PDF Font is the author's own installed face: the Worker sends its
    // bytes over the Frame's port and map.js registers the face, so the page
    // itself declares no family for it.
    expect(HTML).not.toContain(`"${MAP_LABEL_FONT_FAMILIES.pdf}"`);
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
          font: "im-fell-english",
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
    const placing = ["pencil", "pen", "bucket", "insert", "ellipse", "rectangle", "polygon"];
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
