/**
 * The Map Frame's drawing surface (#745) in jsdom: the real `assets/ui/map.html`
 * and `assets/ui/map.js`, the vendored Preact+htm library, a stand-in
 * `window.maibuk.port`, and the `globalThis.__mapTestHooks` seam the script
 * exposes for tests (a point converter, because jsdom has no layout, and a
 * cleanup). Each behavior is asserted by what the Frame drew and what it posted
 * to the Worker.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAP_FRAME_SRC } from "./map-page";
import { parseFrameMessage, sceneMessage } from "./frame-protocol";
import { sceneToSvg } from "./scene";

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
  /** Sends one scene, with the defaults a Select-tool, unzoomed view has. */
  scene(overrides?: Record<string, unknown>): void;
}

/** Loads the Frame's markup, the vendored library, and its script. */
function loadFrame(): Frame {
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakePort();
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  const cleanups: (() => void)[] = [];
  (globalThis as Record<string, unknown>).__mapTestHooks = {
    pagePoint: (event: MouseEvent) => [event.clientX, event.clientY],
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
    const labels = message.elements[1].shapes
      .filter((shape) => "text" in shape)
      .map((shape) => ("text" in shape ? shape.text : ""));
    expect(labels).toEqual(["0", "200 km"]);
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

  it("needs a scene before it answers a pointer", () => {
    frame = loadFrame();
    const surface = document.getElementById("surface");
    if (surface === null) throw new Error("the Frame has no surface");
    pointer(surface, "pointerdown", 5, 5);
    expect(frame.port.messages).toEqual([]);
  });
});
