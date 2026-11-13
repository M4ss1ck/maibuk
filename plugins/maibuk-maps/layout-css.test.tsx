/**
 * The floating editor's CSS against the host's DOM (#778, the "Risk" section of
 * #775): Decision 1 lays the editor out through Plugin CSS over host `ui.View`s,
 * which carry no nameable class or attribute, so the stylesheet reaches each
 * control through the shape of the page it draws. A host refactor could silently
 * move the Frame or a card, and the page would keep rendering with nothing in
 * its way. This suite mounts the Map page through the host renderer - the same
 * Remote UI surface the app draws a Plugin page with - and holds every selector
 * in `MAP_EDITOR_CSS` to the element it is meant for, found through what that
 * element holds rather than through its place; the one selector that sizes a
 * whole row of controls is held to that row in document order. The stylesheet's
 * two switches are held too: the narrow block asks the editor root's own width
 * (a `@container` query), and the 44px touch minimum asks for a coarse pointer.
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
import { format } from "./i18n";

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
type State = "open" | "closed" | "minimised";

interface Expectation {
  /** The selector exactly as `MAP_EDITOR_CSS` writes it, before scoping. */
  selector: string;
  /** The state whose page the selector matches in. */
  state: State;
  /**
   * The element the selector is meant for, found through what that element
   * holds; or every element, in document order, for a selector that sizes a
   * whole row of controls at once (the narrow tool belt's 44px targets).
   */
  expected(mounted: Mounted): Element | Element[];
  /** The selector reaches into the Frame, which the kit does not draw. */
  needsFrame?: true;
}

/** The tool belt's controls in page order: every tool, then the Layers toggle. */
const BELT_LABELS = [
  "tools.select",
  "tools.hand",
  "tools.pencil",
  "tools.pen",
  "tools.bucket",
  "tools.area",
  "tools.ellipse",
  "tools.rectangle",
  "tools.polygon",
  "tools.insert",
  "tools.eraser",
  "chrome.layers",
] as const;

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
    expected: (mounted) => cardHolding(mounted.root, () => screen.getByRole("list")),
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
    // The narrow bar's two groups (#779): the pill's own three controls, and
    // the one overflow popover the stylesheet swaps them for.
    selector: `${ROOT} > div:nth-child(7) > div:nth-child(1)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 7).children.item(0) as Element,
  },
  {
    selector: `${ROOT} > div:nth-child(7) > div:nth-child(2)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 7).children.item(1) as Element,
  },
  {
    // With both bottom regions open the narrow block splits the bottom half:
    // Insert and Layers above, and Properties below them (#779).
    selector: `${ROOT}:has(> div:nth-child(6) > div) > div:nth-child(3)`,
    state: "open",
    expected: (mounted) => slotThree(mounted),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(6) > div) > div:nth-child(4)`,
    state: "open",
    expected: (mounted) => slotFour(mounted),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(3):not(:empty)) > div:nth-child(6):has(> div)`,
    state: "open",
    expected: (mounted) => slotSix(mounted),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(4):not(:empty)) > div:nth-child(6):has(> div)`,
    state: "open",
    expected: (mounted) => slotSix(mounted),
  },
  {
    // The full-height toggle, still the region it belongs to: Properties and
    // Layers each own one (#779, #775 review R2).
    selector: `${ROOT}:has(> div:nth-child(4) > div:first-child button[aria-pressed="true"]) > div:nth-child(4)`,
    state: "open",
    expected: (mounted) => slotFour(mounted),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(6) > div:first-child > div:last-child > button[aria-pressed="true"]) > div:nth-child(6)`,
    state: "open",
    expected: (mounted) => slotSix(mounted),
  },
  {
    selector: `${ROOT} > div:nth-child(8)`,
    state: "open",
    expected: (mounted) =>
      cardHolding(mounted.root, () => screen.getByRole("button", { name: en["chrome.zoomIn"] })),
  },
  {
    // The narrow bar's buttons, and the Map's name that gives up the room: the
    // back button shows its arrow alone, so the name keeps its letters (#779).
    selector: `${ROOT} > div:nth-child(1) > button`,
    state: "open",
    expected: () => barButtons(),
  },
  {
    selector: `${ROOT} > div:nth-child(1) > button:nth-of-type(1)`,
    state: "open",
    expected: () => screen.getByRole("button", { name: en["map.backToMaps"] }),
  },
  {
    selector: `${ROOT} > div:nth-child(1) > button:nth-of-type(2)`,
    state: "open",
    expected: () => screen.getByRole("button", { name: "Coast" }),
  },
  {
    // The Properties header (#778): the name and its two toggles take the row,
    // and the card's own two controls keep their width at its right.
    selector: `${ROOT} > div:nth-child(6) > div:first-child > div:first-child`,
    state: "open",
    expected: () => headerRow().children.item(0) as Element,
  },
  {
    selector: `${ROOT} > div:nth-child(6) > div:first-child > div:first-child > div`,
    state: "open",
    expected: () => nameFieldOf(headerRow().children.item(0) as Element),
  },
  {
    // Minimised, Properties is its restore button alone in a card that fits it.
    selector: `${ROOT} > div:nth-child(6):has(> button:only-child)`,
    state: "minimised",
    expected: (mounted) => slotSix(mounted),
  },
  {
    // An Elements list row: the row button stacks the name over the kind, and
    // the eye and the menu keep their width beside it.
    selector: `${ROOT} > div:nth-child(4) > ul > li > div > button:first-child`,
    state: "open",
    expected: () => rowButton(),
  },
  {
    selector: `${ROOT} > div:nth-child(4) > ul > li > div > button:first-child > p`,
    state: "open",
    expected: () => Array.from(rowButton().children),
  },
  {
    selector: `${ROOT} > div:nth-child(4) > ul > li > div > button:first-child > p:last-child`,
    state: "open",
    expected: () => rowButton().lastElementChild as Element,
  },
  {
    selector: `${ROOT} > div:nth-child(4) > ul > li > div > button:last-child`,
    state: "open",
    expected: () =>
      screen.getByRole("button", { name: format(en["elements.moreFor"], { name: "Line one" }) }),
  },
  {
    // A hidden Element's row dims its name beside its pressed eye.
    selector: `${ROOT} > div:nth-child(4) > ul > li > div:has(> button[aria-pressed="true"]) > button:first-child`,
    state: "open",
    expected: () => rowButton(),
  },
  {
    // The zoom cluster sits above the belt, or above whichever bottom region is
    // open, so it stays reachable (#779, #775 review R2).
    selector: `${ROOT}:has(> div:nth-child(3):not(:empty)) > div:nth-child(8)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 8),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(4):not(:empty)) > div:nth-child(8)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 8),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(6) > div) > div:nth-child(8)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 8),
  },
  {
    // A full-height region leaves no room above the middle, so the cluster moves
    // under the top bar instead (#775 review R2).
    selector: `${ROOT}:has(> div:nth-child(4) > div:first-child button[aria-pressed="true"]) > div:nth-child(8)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 8),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(6) > div:first-child > div:last-child > button[aria-pressed="true"]) > div:nth-child(8)`,
    state: "open",
    expected: (mounted) => slot(mounted.root, 8),
  },
  {
    // The desktop width hides the full-height toggles, and stacks Insert over
    // Layers when both are open (#775 review R2).
    selector: `${ROOT} > div:nth-child(4) > div:first-child > div > button:first-child`,
    state: "open",
    expected: () => screen.getByRole("button", { name: en["chrome.expandLayers"] }),
  },
  {
    selector: `${ROOT} > div:nth-child(6) > div:first-child > div:last-child > button:first-child`,
    state: "open",
    expected: () => screen.getByRole("button", { name: en["chrome.expandProperties"] }),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(4):not(:empty)) > div:nth-child(3)`,
    state: "open",
    expected: (mounted) => slotThree(mounted),
  },
  {
    selector: `${ROOT}:has(> div:nth-child(3):not(:empty)) > div:nth-child(4)`,
    state: "open",
    expected: (mounted) => slotFour(mounted),
  },
  { selector: `${ROOT} > div:nth-child(3)`, state: "closed", expected: slotThree },
  { selector: `${ROOT} > div:nth-child(4)`, state: "closed", expected: slotFour },
  { selector: `${ROOT} > div:nth-child(6)`, state: "closed", expected: slotSix },
  {
    // The touch minimum is not a width rule: every control the page draws is a
    // 44px target on any coarse pointer, at any width (#779, #775 Decision 6).
    selector: `${ROOT} button`,
    state: "open",
    expected: (mounted) => Array.from(mounted.root.querySelectorAll("button")),
  },
  {
    // The belt's tools, each held to its own width inside the scrolling row, so
    // the layout never squashes one (#779).
    selector: `${ROOT} > div:nth-child(2) > button`,
    state: "open",
    expected: () => BELT_LABELS.map((key) => screen.getByRole("button", { name: en[key] })),
  },
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

/** The top bar's own buttons, in page order: back, the Map's name, undo, redo. */
function barButtons(): Element[] {
  return [
    screen.getByRole("button", { name: en["map.backToMaps"] }),
    screen.getByRole("button", { name: "Coast" }),
    screen.getByRole("button", { name: en["chrome.undo"] }),
    screen.getByRole("button", { name: en["chrome.redo"] }),
  ];
}

/** The Properties header row: the row whose right-hand group holds Minimise. */
function headerRow(): HTMLElement {
  const button = screen.getByRole("button", { name: en["chrome.minimiseProperties"] });
  const row = button.parentElement?.parentElement ?? null;
  if (row === null) throw new Error("the Minimise control has no header row");
  return row;
}

/** The name field's own box: the header group's child that holds the Name textbox. */
function nameFieldOf(group: Element): Element {
  const field = screen.getByRole("textbox", { name: en["properties.name"] });
  const box = Array.from(group.children).find((child) => child.contains(field));
  if (box === undefined) throw new Error("the header group holds no Name field");
  return box;
}

/** The Elements list's one row button: the Map's only line, by name. */
function rowButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Line one/ });
}

/** Fills every card: Insert shows, so does Layers, and the line is selected. */
async function fillEveryCard(mounted: Mounted): Promise<void> {
  const user = userEvent.setup();
  mounted.editor.setTool("insert");
  await user.click(await screen.findByRole("button", { name: en["chrome.layers"] }));
  await screen.findByRole("list");
  mounted.editor.select("e1");
  // The line hidden, so its row draws the dimmed name beside the pressed eye.
  mounted.editor.setHidden("e1", true);
  await screen.findByRole("button", { name: en["chrome.minimiseProperties"] });
  // Both full-height toggles pressed, so the stylesheet's own region selectors
  // match the Layers and Properties cards (#779, #775 review R2).
  for (const key of ["chrome.expandLayers", "chrome.expandProperties"] as const) {
    await user.click(await screen.findByRole("button", { name: en[key] }));
  }
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
        const expected = expectation.expected(mounted);
        const wanted = Array.isArray(expected) ? expected : [expected];
        expect(matched.length, selector).toBe(wanted.length);
        for (const [index, element] of wanted.entries()) {
          expect(matched[index], selector).toBe(element);
        }
      }
      // The minimised card's selectors stay off the open card.
      for (const expectation of EXPECTATIONS.filter((one) => one.state === "minimised")) {
        const selector = `${scope} ${expectation.selector}`;
        expect(document.querySelectorAll(selector).length, selector).toBe(0);
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
      expect(screen.queryByRole("list")).toBeNull();
      expect(screen.queryByRole("button", { name: en["chrome.minimiseProperties"] })).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });

  it("fits the minimised Properties card to its restore button, and keeps the open card's selectors off it", async () => {
    const mounted = await mount();
    try {
      const user = userEvent.setup();
      mounted.editor.select("e1");
      await user.click(
        await screen.findByRole("button", { name: en["chrome.minimiseProperties"] })
      );
      const restore = await screen.findByRole("button", { name: en["chrome.restoreProperties"] });
      expect(cardOf(mounted.root, restore)).toBe(slotSix(mounted));
      const scope = `[data-plugin-ui="${mounted.scope}"]`;
      for (const expectation of EXPECTATIONS.filter((one) => one.state === "minimised")) {
        const selector = `${scope} ${expectation.selector}`;
        const matched = Array.from(document.querySelectorAll(selector));
        expect(matched.length, selector).toBe(1);
        expect(matched[0], selector).toBe(expectation.expected(mounted));
      }
      // No rule for the open card reaches the minimised one: it neither splits
      // the narrow page's bottom half nor lifts the zoom cluster.
      for (const selector of [
        `${ROOT}:has(> div:nth-child(6) > div) > div:nth-child(8)`,
        `${ROOT} > div:nth-child(6) > div:first-child > div:first-child`,
      ]) {
        expect(document.querySelectorAll(`${scope} ${selector}`).length, selector).toBe(0);
      }
    } finally {
      await mounted.unmount();
    }
  });

  it("switches the narrow page on the editor container's width, and sizes touch targets by pointer", () => {
    const scope = '[data-plugin-ui="plugin-ui-1"]';
    const scoped = scopePluginCss(MAP_EDITOR_CSS, scope);
    expect(scoped).not.toBe("");

    // The root is the query container the narrow block asks about, so a narrow
    // editor inside a wide window gets the narrow chrome (#779, review R1).
    expect(scoped).toMatch(
      /[^}]*div\[data-plugin-ui\]\s*\{[^}]*container-type: inline-size[^}]*\}/
    );
    expect(scoped).toContain("@container (max-width: 639px)");
    expect(scoped).toContain("@container (min-width: 640px)");
    expect(scoped).not.toMatch(/@media \(max-width/);
    expect(scoped).not.toMatch(/@media \(min-width/);

    // The 44px touch minimum is a pointer rule, not a width rule: a coarse
    // pointer gets it at any width, and no width rule reintroduces it (#779,
    // #775 Decision 6).
    expect(scoped).toContain("@media (pointer: coarse)");
    const coarse = scoped.slice(scoped.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain("min-width: 2.75rem; min-height: 2.75rem");
    expect(scoped.slice(0, scoped.indexOf("@media (pointer: coarse)"))).not.toContain(
      "min-width: 2.75rem; min-height: 2.75rem"
    );
  });
});
