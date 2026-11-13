// The Maps editor's Pen, Eraser, Line style, Encloses Fills, and Roughen
// (#746): the author picks the Pen with its key, focuses the drawing Frame, and
// draws a closed outline with the keyboard pen (the arrows move the crosshair,
// Enter adds a point, Enter on the first point closes the line), which the
// Elements list lists as a Map Line. From the properties panel the Line style
// select moves that line to Coast and back to Plain and the Encloses Fills
// switch turns its fills off; Roughen (Mod+Shift+R) redraws the path with the
// rough ink look and Mod+Z restores it; an Eraser drag across the line splits it
// into two Map Lines. The Eraser drag is `support/frame-stroke.ts`, which
// explains why the one pointer gesture sits outside the spec.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { eraseAcross } from "../support/frame-stroke";
import {
  expectFocusWithin,
  isFocusWithin,
  leaveFrame,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";
import { openLayers } from "../support/maps-layers";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The Map editor's embedded Frame, and the iframe element around it. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("#surface");

/** The Elements list and one row in it. */
const elementsList = (page: Page) => page.getByRole("listbox", { name: "Elements" });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** Every non-hidden Element the Frame draws, and every path it draws for one. */
const drawnElements = (page: Page) => mapFrame(page).locator("[data-element-id]");
const drawnLine = (page: Page) => mapFrame(page).locator("g[data-element-id] path.map-line");

/** Opens Maps from the sidebar, waiting for the Plugin's launch scan. */
async function openMaps(page: Page): Promise<void> {
  await expect(navOption(page, "Maps")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Maps"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/** Creates a Map from the New Map dialog by keyboard. */
async function createMap(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole("button", { name: "New Map" });
  await tabTo(page, trigger, { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type(name);
  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName(name);
}

/** Opens a Map from the list and waits for its editor's Frame to draw. */
async function openMap(page: Page, name: string): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: `Open ${name}` }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(mapFrame(page).locator("svg")).toBeVisible();
  await openLayers(page);
}

/** Picks the Pen with its Command and waits for the Frame to honour it. */
async function pickPen(page: Page): Promise<void> {
  await page.keyboard.press("n");
  await expect(page.getByRole("button", { name: "Pen", exact: true, pressed: true }));
  // The scene round-trip is what proves the Frame is listening before a key.
  await expect(mapFrame(page).locator('svg[data-tool="pen"]')).toBeVisible();
}

/**
 * Draws a closed 10 mm square with the keyboard pen: Shift+Arrow moves the
 * crosshair 10 mm, Enter adds a point, and the last Enter lands on the first
 * point, which closes the line. The Frame keeps every one of those keys.
 */
async function drawClosedOutline(page: Page): Promise<void> {
  await tabTo(page, frameElement(page), { max: 60 });
  await expect(frameElement(page)).toBeFocused();

  await page.keyboard.press("Enter");
  // The surface's accessible name counts the points the Frame took, in the
  // singular for the first one.
  await expect(surface(page)).toHaveAttribute("aria-label", "Pen line, 1 point");
  // The crosshair and the one-point draft are what the author sees while drawing.
  await capture(page, "pen-draft");

  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowUp");
  // Back on the first point: this Enter closes the line instead of adding one.
  await page.keyboard.press("Enter");

  await expect(drawnElements(page)).toHaveCount(1);
}

/** Opens a Map and draws the outline every test below starts from. */
async function openEditorWithOutline(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await openMap(page, "Coastline");
  await pickPen(page);
  await drawClosedOutline(page);
  await leaveFrame(page, frameElement(page));
}

/** Focuses Back to Maps, a plain panel control (not the Elements list). */
async function focusBack(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 60,
    backwards: true,
  });
}

/** Focuses the Elements list, from the panel control before it. */
async function focusElements(page: Page): Promise<void> {
  await focusBack(page);
  const list = elementsList(page);
  // The floating chrome (#778) puts the belt's eleven tool buttons between the
  // pill's Back button and the Elements list, so the walk allows for them.
  for (let i = 0; i < 20 && !(await isFocusWithin(list)); i++) await page.keyboard.press("Tab");
  await expectFocusWithin(list);
}

/** Focuses the selected Map Line's row in the Elements list. */
async function focusLineRow(page: Page, name: string): Promise<Locator> {
  const row = elementRow(page, name);
  await focusElements(page);
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", row, { max: 10 });
  return row;
}

/**
 * Opens the Map Line's properties panel through its Item Menu, which selects
 * the line and lands focus on the panel's Name field.
 */
async function openProperties(page: Page, name: string): Promise<void> {
  await focusLineRow(page, name);
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Properties" }), {
    max: 20,
  });
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
}

/**
 * The Properties panel's Line style select trigger. Its accessible name is its
 * current value and the row's label ("Plain Line style"), so it is found by
 * that name: the row's own "Line style" label belongs to the select's native
 * control, which `getByLabel` resolves to and which the author can never focus
 * (#778).
 */
const lineStyleTrigger = (page: Page) => page.getByRole("button", { name: /Line style$/ });

/** Picks one option of the Line style select by keyboard. */
async function pickLineStyle(page: Page, option: string): Promise<void> {
  const trigger = lineStyleTrigger(page);
  // The panel's header (#778) puts the name, the two switches, and the
  // Minimise button before the select, which is where focus starts.
  await tabTo(page, trigger, { max: 20 });
  await page.keyboard.press("Enter");
  const item = page.getByRole("option", { name: option, exact: true });
  await expect(item).toBeVisible();
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", item, { max: 10 });
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText(option);
}

/** The `d` attribute a drawn Element's first path has now. */
async function pathData(line: Locator): Promise<string> {
  const d = await line.getAttribute("d");
  if (d === null) throw new Error("the Element's line has no path");
  return d;
}

/** Every drawn Map Line path's `d`, in document order. */
async function pathList(page: Page): Promise<string[]> {
  const lines = await drawnLine(page).all();
  return Promise.all(lines.map(async (line) => (await line.getAttribute("d")) ?? ""));
}

/** The drawn path's page millimetres, as `[left, top, right, bottom]`. */
function pathBounds(d: string): [number, number, number, number] {
  const values = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 4 || values.length % 2 !== 0) {
    throw new Error(`unexpected Map Line path: ${d}`);
  }
  const xs = values.filter((_value, index) => index % 2 === 0);
  const ys = values.filter((_value, index) => index % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The Elements rows' text, top of the list first. */
async function elementNames(page: Page): Promise<string[]> {
  return elementsList(page).getByRole("option").allTextContents();
}

test.use({
  library: "bookShelf",
  plugins: ["maibuk-maps"],
  pluginApprovals: [
    {
      pluginId: "maibuk-maps",
      granted: ["library:read", "editor:write", "files:pick", "files:save"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-maps" }],
});

test.describe("Maps Pen, Eraser, line styles, and Roughen @wf:plugins-maps-pen @sc:plugin.maibuk-maps.penTool @sc:plugin.maibuk-maps.eraserTool @sc:plugin.maibuk-maps.roughen @sandbox", () => {
  test("the keyboard pen draws a closed outline the Elements list lists as a Map Line", async ({
    page,
  }) => {
    await openEditorWithOutline(page);

    // The Worker turns the finished Pen line into a Map Line, names it, and
    // selects it: the row is the drawing's accessible view.
    const row = await focusLineRow(page, "Map Line 1");
    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(drawnElements(page)).toHaveCount(1);

    // Four points with straight segments, and the closing Z the last Enter gave.
    const d = await pathData(drawnLine(page).first());
    expect(d).toMatch(/^M -?\d/);
    expect(d.match(/ L /g) ?? []).toHaveLength(3);
    expect(d).toMatch(/ Z$/);
  });

  test("changes the selected line's Line style to Coast and back, and turns Encloses Fills off", async ({
    page,
  }) => {
    await openEditorWithOutline(page);
    await openProperties(page, "Map Line 1");

    // A new Pen line is Plain, and Coast draws a thicker ink stroke.
    const styleTrigger = lineStyleTrigger(page);
    await tabTo(page, styleTrigger, { max: 20 });
    await expect(styleTrigger).toHaveText("Plain");
    await expect(drawnLine(page).first()).toHaveAttribute("stroke-width", "0.6");

    await pickLineStyle(page, "Coast");
    await expect(drawnLine(page).first()).toHaveAttribute("stroke-width", "0.9");
    // Coast's preset encloses Fills, so the switch follows the style.
    const encloses = page.getByRole("switch", { name: "Encloses Fills" });
    await expect(encloses).toBeChecked();
    await capture(page, "pen-styles");

    await pickLineStyle(page, "Plain");
    await expect(drawnLine(page).first()).toHaveAttribute("stroke-width", "0.6");

    // The switch is the author's own edit, one step apart from the style.
    await tabTo(page, encloses, { max: 20 });
    await expect(encloses).toBeChecked();
    await page.keyboard.press(" ");
    await expect(encloses).not.toBeChecked();
  });

  test("Roughens the selected Map Line by its Shortcut, and Mod+Z restores its path", async ({
    page,
  }) => {
    await openEditorWithOutline(page);
    await focusBack(page);

    const before = await pathList(page);
    expect(before).toHaveLength(1);

    await page.keyboard.press("ControlOrMeta+Shift+r");
    await expect.poll(async () => (await pathList(page)).join("|")).not.toBe(before.join("|"));
    await capture(page, "pen-roughen");

    // One undo step puts the exact path back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await pathList(page)).join("|")).toBe(before.join("|"));
  });

  test("an Eraser drag across the Map Line splits it into two Map Lines", async ({ page }) => {
    await openEditorWithOutline(page);
    await focusBack(page);

    await page.keyboard.press("e");
    await expect(page.getByRole("button", { name: "Eraser", exact: true, pressed: true }));
    await expect(mapFrame(page).locator('svg[data-tool="eraser"]')).toBeVisible();

    // A drag across the middle of the closed outline cuts it twice, once per
    // side, which leaves the top and bottom halves as two open Map Lines.
    const [left, top, right, bottom] = pathBounds(await pathData(drawnLine(page).first()));
    const middle = (top + bottom) / 2;
    await eraseAcross(page, mapFrame(page).locator("svg"), [left - 3, middle], [right + 3, middle]);

    await expect(elementsList(page).getByRole("option")).toHaveCount(2);
    const names = await elementNames(page);
    expect(names.filter((name) => name.startsWith("Map Line 1 2"))).toHaveLength(1);
    expect(names.filter((name) => /^Map Line 1(?! 2)/.test(name))).toHaveLength(1);
  });
});
