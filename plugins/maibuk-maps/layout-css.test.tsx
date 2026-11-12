/**
 * The floating editor's CSS against the host's DOM (#778, the "Risk" section of
 * #775): Decision 1 lays the editor out through Plugin CSS over host `ui.View`s,
 * which carry no nameable class or attribute, so the stylesheet reaches each
 * control through the shape of the page it draws. A host refactor could silently
 * move the Frame or a card, and the page would keep rendering with nothing in
 * its way. This suite mounts the Map page through the host renderer - the same
 * Remote UI surface the app draws a Plugin page with - and holds every selector
 * in `MAP_EDITOR_CSS` to the one element it is meant for, found through what
 * that element holds rather than through its place.
 *
 * The kit draws no Frame (it mounts a tree with no runtime to hand it a port),
 * so the three selectors that reach into the Frame's own wrapper are proven by
 * the `@wf:plugins-maps-layout` spec instead, which measures the Frame's box
 * against the page body's in a real browser.
 *
 * The page is driven through the editor's own API for the state this layout
 * needs, because what is under test here is the drawing, not the keys; the
 * keyboard paths are `plugin.test.tsx`'s.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { scopePluginCss, splitSelectorList } from "@/features/plugins/remote-ui/css-scope";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import type { MapEditor } from "./editor";
import { INDEX_KEY, mapKey, type MapDocument, type MapLineElement } from "./maps";
import { MAP_EDITOR_CSS, MAP_PAGE_ID } from "./map-page";
import { startMaps } from "./runtime";
import en from "./locales/runtime/en.json";

/** The editor's root, and the Frame the stylesheet pins over the drawing. */
const ROOT = "div[data-plugin-ui]";
const FRAME = '[data-plugin-frame="embedded"]';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function mapsManifest() {
  const result = parsePluginManifest(readFileSync(join(__dirname, "manifest.json"), "utf8"), {
    builtIn: true,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

/** The one Map Line the Map holds, which the Properties card can show as a selection. */
function lineElement(): MapLineElement {
  return {
    id: "e1",
    kind: "line",
    name: "Line one",
    hidden: false,
    locked: false,
    points: [
      [10, 10],
      [20, 20],
    ],
    style: "plain",
    enclosesFills: true,
    closed: false,
    curves: [true],
    roughened: false,
  };
}

/** A Library holding one Map, `m1`, with that line drawn on it. */
function mapStorage(): Map<string, unknown> {
  const storage = new Map<string, unknown>();
  storage.set(INDEX_KEY, [
    {
      id: "m1",
      bookId: null,
      name: "Coast",
      preset: "portrait",
      updatedAt: 1,
      preview: "data:image/svg+xml,%3Csvg%2F%3E",
    },
  ]);
  storage.set(mapKey("m1"), {
    id: "m1",
    name: "Coast",
    bookId: null,
    page: { preset: "portrait", widthMm: 152.4, heightMm: 228.6 },
    elements: [lineElement()],
    styleId: "atlas",
    overrides: {},
    createdAt: 1,
    updatedAt: 1,
    dataVersion: 1,
  } satisfies MapDocument);
  return storage;
}

/** A mounted editor page, and the root the stylesheet under test positions. */
interface Mounted {
  editor: MapEditor;
  /** The surface's own `data-plugin-ui` value, which scopes the stylesheet. */
  scope: string;
  /** The editor's root: the Surface that holds every card in its slots. */
  root: HTMLElement;
  unmount(): Promise<void>;
}

/** Mounts the Map editor with its line drawn and nothing else picked. */
async function mount(): Promise<Mounted> {
  const host = createTestHost({
    manifest: mapsManifest(),
    library: { books: [] },
    storage: mapStorage(),
    language: "en",
  });
  cleanups.push(() => void host.stop());
  const runtime = startMaps(createPluginClient(host.port), servePluginUi);
  expect(await runtime.openMap("m1")).toBe(true);
  const page = await host.renderPage(MAP_PAGE_ID);
  const editor = runtime.editor;
  if (editor === null) throw new Error("the page opened no editor");
  await screen.findByRole("button", { name: en["chrome.layers"] });

  const surfaces = Array.from(document.querySelectorAll<HTMLElement>("[data-plugin-ui]"));
  const surface = surfaces[0];
  if (surface === undefined) throw new Error("the editor draws outside a Surface");
  const scope = surface.getAttribute("data-plugin-ui");
  if (scope === null) throw new Error("the Surface has no scope");
  const root = surface.querySelector<HTMLElement>(ROOT);
  if (root === null) throw new Error("the Surface holds no editor root");
  return { editor, scope, root, unmount: () => page.unmount() };
}

/** The card a control sits in: the child of the root the control belongs to. */
function cardOf(root: HTMLElement, control: HTMLElement): HTMLElement {
  let element: HTMLElement | null = control;
  while (element !== null && element.parentElement !== root) {
    element = element.parentElement;
  }
  if (element === null) throw new Error("that control is not inside the editor's root");
  return element;
}

/** The card that holds the first control `find` returns. */
function cardHolding(root: HTMLElement, find: () => HTMLElement): HTMLElement {
  return cardOf(root, find());
}

/** The Frame's own wrapper, which the stylesheet pins over the drawing. */
function frameElement(): HTMLElement {
  const frame = document.querySelector<HTMLElement>(FRAME);
  if (frame === null) throw new Error("the page drew no Frame");
  return frame;
}

/** One of the root's eight slots, by its place in the DOM. */
function slot(root: HTMLElement, index: number): HTMLElement {
  const element = root.children.item(index - 1);
  if (!(element instanceof HTMLElement)) throw new Error(`the root has no slot ${index}`);
  return element;
}

/** Every selector `css` writes, in file order, with its comment blocks removed. */
function selectorsOf(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  for (const block of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of splitSelectorList(block[1])) selectors.push(selector.trim());
  }
  return selectors;
}

/** The stylesheet the Surface mounted, read off the `<style>` it drew. */
function mountedCss(root: HTMLElement): string {
  const style = root.parentElement?.querySelector("style") ?? null;
  if (style === null) throw new Error("the Surface drew no stylesheet");
  return style.textContent ?? "";
}

/** The states the stylesheet draws: every card filled, and every card shut. */
type State = "open" | "closed";

interface Expectation {
  /** The selector exactly as `MAP_EDITOR_CSS` writes it, before scoping. */
  selector: string;
  /** The state whose page the selector matches in. */
  state: State;
  /** The element the selector is meant for, found through what that element holds. */
  expected(mounted: Mounted): Element;
  /** The selector reaches into the Frame, which the kit does not draw. */
  needsFrame?: true;
}

const EXPECTATIONS: ReadonlyArray<Expectation> = [
  {
    selector: ROOT,
    state: "open",
    expected: (mounted) => mounted.root,
  },
  {
    selector: `${ROOT} > div:nth-child(5)`,
    state: "open",
    expected: slotFive,
  },
  {
    selector: `${ROOT} > div:nth-child(5) > ${FRAME}`,
    state: "open",
    expected: () => frameElement(),
    needsFrame: true,
  },
  {
    selector: `${ROOT} > div:nth-child(5) > ${FRAME} > div`,
    state: "open",
    expected: () => frameElement().firstElementChild as HTMLElement,
    needsFrame: true,
  },
  {
    selector: `${ROOT} > div:nth-child(1)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () => screen.getByRole("button", { name: en["map.backToMaps"] })),
  },
  {
    selector: `${ROOT} > div:nth-child(2)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () => screen.getByRole("button", { name: en["tools.pencil"] })),
  },
  {
    selector: `${ROOT} > div:nth-child(3)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () =>
        screen.getByRole("button", { name: en["properties.upload"] })
      ),
  },
  {
    selector: `${ROOT} > div:nth-child(4)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () => screen.getByRole("listbox", { name: en["elements.label"] })),
  },
  {
    selector: `${ROOT} > div:nth-child(6)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () =>
        screen.getByRole("button", { name: en["chrome.minimiseProperties"] })
      ),
  },
  {
    selector: `${ROOT} > div:nth-child(7)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () => screen.getByRole("button", { name: en["export.label"] })),
  },
  {
    selector: `${ROOT} > div:nth-child(8)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () => screen.getByRole("button", { name: en["chrome.zoomIn"] })),
  },
  { selector: `${ROOT} > div:nth-child(3)`, state: "closed", expected: slotThree },
  { selector: `${ROOT} > div:nth-child(4)`, state: "closed", expected: slotFour },
  { selector: `${ROOT} > div:nth-child(6)`, state: "closed", expected: slotSix },
  { selector: `${ROOT} > div:nth-child(3):empty`, state: "closed", expected: slotThree },
  { selector: `${ROOT} > div:nth-child(4):empty`, state: "closed", expected: slotFour },
  { selector: `${ROOT} > div:nth-child(6):empty`, state: "closed", expected: slotSix },
];

function slotFive(mounted: Mounted): Element {
  // With a Frame drawn, the drawing's slot is the Frame's own parent; the kit
  // draws none, so only the slot's place says which View it is.
  const frame = document.querySelector<HTMLElement>(FRAME);
  return frame?.parentElement ?? slot(mounted.root, 5);
}

function slotThree(mounted: Mounted): Element {
  return slot(mounted.root, 3);
}

function slotFour(mounted: Mounted): Element {
  return slot(mounted.root, 4);
}

function slotSix(mounted: Mounted): Element {
  return slot(mounted.root, 6);
}

/** Fills every card: Insert shows, so does Layers, and the line is selected. */
async function fillEveryCard(mounted: Mounted): Promise<void> {
  const user = userEvent.setup();
  mounted.editor.setTool("insert");
  await user.click(await screen.findByRole("button", { name: en["chrome.layers"] }));
  await screen.findByRole("listbox", { name: en["elements.label"] });
  mounted.editor.select("e1");
  await screen.findByRole("button", { name: en["chrome.minimiseProperties"] });
}

/** Whether this mount drew a Frame the stylesheet's Frame selectors can reach. */
function drawsFrame(): boolean {
  return document.querySelector(FRAME) !== null;
}

describe("the floating editor's stylesheet against the host's DOM", () => {
  it("writes only selectors this suite lists, and nothing is dropped as unscopable", async () => {
    const mounted = await mount();
    try {
      const scope = `[data-plugin-ui="${mounted.scope}"]`;
      const drops: string[] = [];
      const scoped = scopePluginCss(MAP_EDITOR_CSS, scope, (reason) => drops.push(reason));

      expect(drops).toEqual([]);
      // The page draws exactly this stylesheet, so the selectors checked below
      // are the ones the app runs.
      expect(mountedCss(mounted.root)).toBe(scoped);
      const written = Array.from(new Set(selectorsOf(scoped))).sort();
      const listed = Array.from(
        new Set(EXPECTATIONS.map((one) => `${scope} ${one.selector}`))
      ).sort();
      expect(written).toEqual(listed);
    } finally {
      await mounted.unmount();
    }
  });

  it("reaches exactly its own element from every selector, with every card open", async () => {
    const mounted = await mount();
    try {
      await fillEveryCard(mounted);
      const scope = `[data-plugin-ui="${mounted.scope}"]`;
      for (const expectation of EXPECTATIONS.filter((one) => one.state === "open")) {
        const selector = `${scope} ${expectation.selector}`;
        const matched = Array.from(document.querySelectorAll(selector));
        if (expectation.needsFrame === true && !drawsFrame()) {
          // The kit draws no Frame: there is nothing for these three to reach
          // here, and `@wf:plugins-maps-layout` measures the real one.
          expect(matched.length, selector).toBe(0);
          continue;
        }
        expect(matched.length, selector).toBe(1);
        expect(matched[0], selector).toBe(expectation.expected(mounted));
      }
    } finally {
      await mounted.unmount();
    }
  });

  it("matches a shut card's own empty slot, and takes it out of the page", async () => {
    const mounted = await mount();
    try {
      const scope = `[data-plugin-ui="${mounted.scope}"]`;
      for (const expectation of EXPECTATIONS.filter((one) => one.state === "closed")) {
        const selector = `${scope} ${expectation.selector}`;
        const matched = Array.from(document.querySelectorAll(selector));
        expect(matched.length, selector).toBe(1);
        expect(matched[0], selector).toBe(expectation.expected(mounted));
      }

      // A shut card is out of the page: no card box floats over the drawing for
      // a Layers card the author never opened, and none of its controls is a
      // Tab stop.
      for (const index of [3, 4, 6]) {
        expect(window.getComputedStyle(slot(mounted.root, index)).display).toBe("none");
      }
      expect(screen.queryByRole("listbox", { name: en["elements.label"] })).toBeNull();
      expect(screen.queryByRole("button", { name: en["chrome.minimiseProperties"] })).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });
});
