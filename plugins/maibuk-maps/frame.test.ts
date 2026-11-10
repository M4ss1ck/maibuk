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
import { sceneMessage } from "./frame-protocol";
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
