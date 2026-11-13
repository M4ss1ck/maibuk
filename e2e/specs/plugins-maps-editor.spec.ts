// The Maps editor, the Built-in Plugin's drawing surface (#745): opening a Map
// from the Maps list shows the host-rendered tool picker, Elements list, and
// properties panel around the drawing Frame. This spec proves the way in, a
// Pencil stroke landing in the Frame as a Map Line (and reaching the Maps list
// preview and the reopened Map), and the keyboard the Elements list owns: select
// the line, move it 1 mm and 10 mm, undo and redo, then delete it through the
// row's More actions menu. It also proves the Frame forwards a key its own code
// does not handle to the host's Commands (#760): undo, pan, and a bare Arrow from
// the properties panel's Hidden button. The pointer gesture itself is
// `support/frame-stroke.ts`, which explains why it sits outside the spec.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { drawStroke } from "../support/frame-stroke";
import { leaveFrame, pressUntilFocused, tabTo, tabToEither } from "../support/keyboard";
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

/** The Elements list, one row in it, and the row's More actions trigger. */
const elementsList = (page: Page) =>
  page.getByRole("list").filter({ has: page.getByRole("button", { name: /^More actions for / }) });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("button", { name: new RegExp(`^${name}`) });
const rowMenuTrigger = (page: Page, name: string) =>
  page.getByRole("button", { name: `More actions for ${name}`, exact: true });

/** Every non-hidden Element the Frame draws, and one Element's drawn line. */
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
  await tabTo(page, page.getByRole("button", { name: new RegExp(`^${name}\\b`) }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(mapFrame(page).locator("svg")).toBeVisible();
  await openLayers(page);
}

/** Picks the Pencil with its Command and waits for the Frame to honour it. */
async function pickPencil(page: Page): Promise<void> {
  await page.keyboard.press("p");
  await expect(page.getByRole("button", { name: "Pencil", pressed: true }));
  // The scene round-trip is what proves the Frame is listening before a stroke.
  await expect(mapFrame(page).locator('svg[data-tool="pencil"]')).toBeVisible();
}

/** Clicks Back to Maps from wherever focus is, by keyboard. */
async function backToMaps(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 60,
    backwards: true,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/** The first point of a drawn path, as `[x, y]` page millimetres. */
function firstPoint(d: string): [number, number] {
  const match = /^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(d);
  if (match === null) throw new Error(`unexpected Map Line path: ${d}`);
  return [Number(match[1]), Number(match[2])];
}

/** The `d` attribute a drawn Element has now, for undo/redo comparisons. */
async function pathData(line: Locator): Promise<string> {
  const d = await line.getAttribute("d");
  if (d === null) throw new Error("the Element's line has no path");
  return d;
}

/**
 * Focuses an Elements row and selects it with Enter: the rows are plain
 * buttons, so Tab is how the list is reached, and the selection shows in the
 * properties panel's Name field.
 */
async function selectElement(page: Page, name: string): Promise<Locator> {
  const row = elementRow(page, name);
  // Start at Back to Maps, the first panel control, and Tab forward into the
  // list: the floating chrome (#778) puts the pill's other three controls and
  // the eleven belt buttons between it and the list, so the walk allows for them.
  await focusBack(page);
  await tabTo(page, row, { max: 200 });
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(new RegExp(`^${name}`));
  return row;
}

/** Runs one entry of an Element's row menu by keyboard. */
async function runRowMenu(page: Page, name: string, label: string): Promise<void> {
  await selectElement(page, name);
  await tabTo(page, rowMenuTrigger(page, name), { max: 5 });
  await page.keyboard.press("Enter");
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: label, exact: true }) });
  const item = dialog.getByRole("button", { name: label, exact: true });
  await tabTo(page, item, { max: 15 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** The Elements rows' names, top of the list first. */
async function elementNames(page: Page): Promise<string[]> {
  return elementsList(page)
    .locator("li > div > button:first-child > p:first-child")
    .allTextContents();
}

/** Every drawn Map Line's `d`, in document order. */
async function pathList(page: Page): Promise<string[]> {
  const lines = await drawnLine(page).all();
  return Promise.all(lines.map(async (line) => (await line.getAttribute("d")) ?? ""));
}

/** The Frame svg's viewBox as four numbers. */
async function viewBox(page: Page): Promise<number[]> {
  const value = await mapFrame(page).locator("svg").getAttribute("viewBox");
  if (value === null) throw new Error("the Frame drew no viewBox");
  return value.split(" ").map(Number);
}

/** Focuses Back to Maps, a plain panel control (not the Elements list). */
async function focusBack(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 60,
    backwards: true,
  });
}

test.use({
  library: "empty",
  plugins: ["maibuk-maps"],
  pluginApprovals: [
    {
      pluginId: "maibuk-maps",
      granted: ["library:read", "editor:write", "files:pick", "files:save"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-maps" }],
});

test.describe("Maps editor @wf:plugins-maps-editor @sc:plugin.maibuk-maps.openMap @sc:plugin.maibuk-maps.undo @sc:plugin.maibuk-maps.redo @sc:plugin.maibuk-maps.zoomIn @sc:plugin.maibuk-maps.zoomOut @sc:plugin.maibuk-maps.zoomReset @sc:plugin.maibuk-maps.panLeft @sc:plugin.maibuk-maps.panRight @sc:plugin.maibuk-maps.panUp @sc:plugin.maibuk-maps.panDown @sc:plugin.maibuk-maps.moveLeft @sc:plugin.maibuk-maps.moveRight @sc:plugin.maibuk-maps.moveUp @sc:plugin.maibuk-maps.moveDown @sc:plugin.maibuk-maps.moveLeftFar @sc:plugin.maibuk-maps.moveRightFar @sc:plugin.maibuk-maps.moveUpFar @sc:plugin.maibuk-maps.moveDownFar @sc:plugin.maibuk-maps.selectTool @sc:plugin.maibuk-maps.pencilTool @sc:plugin.maibuk-maps.deleteElement @sandbox", () => {
  test("opens a Map from the list by keyboard and shows the editor", async ({ page }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline");
    await openMap(page, "Coastline");

    // The belt holds every tool as one button (#778), the Layers card shows the
    // Elements, and the top-left pill is still the way back.
    await expect(page.getByRole("button", { name: "Pencil", pressed: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close Layers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to Maps" })).toBeVisible();
  });

  test("a Pencil stroke becomes a Map Line the Maps list previews and the reopened Map keeps", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline");
    await openMap(page, "Coastline");
    await pickPencil(page);
    await drawStroke(page, mapFrame(page).locator("svg"));

    // The Worker turns the stroke into a Map Line, names it, and selects it.
    const line = elementRow(page, "Map Line 1");
    await leaveFrame(page, frameElement(page));
    await tabToEither(page, line, { max: 60 });
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(/^Map Line 1/);
    await expect(drawnElements(page)).toHaveCount(1);
    const drawn = await pathData(drawnLine(page));
    expect(drawn).toMatch(/^M -?\d/);
    await capture(page, "editor");

    // Back to Maps: the saved Map's preview card draws the line.
    await backToMaps(page);
    await expect(mapNames(page).first()).toHaveAccessibleName("Coastline");
    await expect(mapNames(page).first()).toHaveAttribute("src", /%3Cpath%20d%3D%22M%20/);
    await capture(page, "list");

    // Reopening the Map lists the line and draws its path again.
    await openMap(page, "Coastline");
    await expect(elementRow(page, "Map Line 1")).toBeVisible();
    await expect(drawnElements(page)).toHaveCount(1);
    await expect(drawnLine(page)).toHaveAttribute("d", /^M -?\d/);
  });

  test("moves, undoes, redoes, and deletes a Map Line by keyboard, and the reopened Map is empty", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline");
    await openMap(page, "Coastline");
    await pickPencil(page);
    await drawStroke(page, mapFrame(page).locator("svg"));

    // Select the line in the Elements list, then leave the list for a plain
    // panel control: a bare Arrow there runs the Map Commands.
    await selectElement(page, "Map Line 1");
    await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
      max: 60,
      backwards: true,
    });

    const start = firstPoint(await pathData(drawnLine(page)));

    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => firstPoint(await pathData(drawnLine(page)))[0])
      .toBeCloseTo(start[0] + 1, 2);
    const moved = await pathData(drawnLine(page));

    await page.keyboard.press("Shift+ArrowDown");
    await expect
      .poll(async () => firstPoint(await pathData(drawnLine(page)))[1])
      .toBeCloseTo(start[1] + 10, 2);
    const movedFar = await pathData(drawnLine(page));

    // Undo the 10 mm move, redo it, then undo it again: each step is one edit.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(drawnLine(page)).toHaveAttribute("d", moved);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(drawnLine(page)).toHaveAttribute("d", movedFar);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(drawnLine(page)).toHaveAttribute("d", moved);

    // Delete through the Elements list's row menu.
    await runRowMenu(page, "Map Line 1", "Delete");
    await expect(elementRow(page, "Map Line 1")).toHaveCount(0);
    await expect(drawnElements(page)).toHaveCount(0);

    // Reopening the Map proves the delete was saved, not just drawn.
    await backToMaps(page);
    await openMap(page, "Coastline");
    await expect(page.getByText("No Elements yet")).toBeVisible();
    await expect(elementRow(page, "Map Line 1")).toHaveCount(0);
    await expect(drawnElements(page)).toHaveCount(0);
  });

  test("renames, reorders, hides, and locks a Map Line through the Elements list", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline Map");
    await openMap(page, "Coastline Map");
    await pickPencil(page);
    await drawStroke(page, mapFrame(page).locator("svg"));
    await drawStroke(page, mapFrame(page).locator("svg"));
    await expect(drawnElements(page)).toHaveCount(2);

    // Rename the first line; the row follows.
    await runRowMenu(page, "Map Line 1", "Rename");
    const dialog = page.getByRole("dialog", { name: "Rename Element" });
    const field = dialog.getByRole("textbox", { name: "Name" });
    await expect(field).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Coastline");
    await tabTo(page, dialog.getByRole("button", { name: "Save" }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(elementRow(page, "Coastline")).toBeVisible();

    // Reorder: Move up brings it to the top of the list, Move down returns it.
    await runRowMenu(page, "Coastline", "Move up");
    await expect.poll(async () => (await elementNames(page))[0]).toMatch(/^Coastline/);
    await runRowMenu(page, "Coastline", "Move down");
    await expect.poll(async () => (await elementNames(page))[0]).toMatch(/^Map Line 2/);

    // An unlocked line moves with a bare Arrow from Back to Maps.
    const beforeMove = await pathList(page);
    await focusBack(page);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await pathList(page)).join("|")).not.toBe(beforeMove.join("|"));
    const moved = await pathList(page);

    // Lock: the same Arrow runs, but the locked line stays where it was.
    await runRowMenu(page, "Coastline", "Lock");
    await focusBack(page);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    expect(await pathList(page)).toEqual(moved);

    // Hide: the Frame stops drawing it.
    await runRowMenu(page, "Coastline", "Hide");
    await expect(drawnElements(page)).toHaveCount(1);
  });

  test("zooms in, out, and resets, and pans in four directions", async ({ page }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline Map");
    await openMap(page, "Coastline Map");
    await focusBack(page);

    const base = await viewBox(page);
    await page.keyboard.press("ControlOrMeta+=");
    await expect.poll(async () => (await viewBox(page))[2]).toBeCloseTo(base[2] / 1.25, 1);

    await page.keyboard.press("ControlOrMeta+-");
    await expect.poll(async () => (await viewBox(page))[2]).toBeCloseTo(base[2], 1);

    // Pan right, left, down, and up: each slides the viewBox by 20 mm.
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await viewBox(page))[0]).toBeCloseTo(base[0] + 20, 1);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(async () => (await viewBox(page))[0]).toBeCloseTo(base[0], 1);
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await viewBox(page))[1]).toBeCloseTo(base[1] + 20, 1);
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => (await viewBox(page))[1]).toBeCloseTo(base[1], 1);

    // Reset returns to the whole page after both a zoom and a pan.
    await page.keyboard.press("ControlOrMeta+=");
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await viewBox(page))[0]).toBeGreaterThan(base[0]);
    await page.keyboard.press("ControlOrMeta+0");
    await expect.poll(async () => await viewBox(page)).toEqual(base);
  });

  test("bare Arrows move the selected line from Back to Maps and keep focus there", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline Map");
    await openMap(page, "Coastline Map");
    await pickPencil(page);
    await drawStroke(page, mapFrame(page).locator("svg"));
    await selectElement(page, "Map Line 1");

    // The page owns its Arrows, so a bare ArrowDown from a plain panel button
    // runs the Command and arrow-navigation leaves focus alone.
    const start = firstPoint(await pathData(drawnLine(page)));
    await focusBack(page);
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(async () => firstPoint(await pathData(drawnLine(page)))[1])
      .toBeCloseTo(start[1] + 1, 2);
    await expect(page.getByRole("button", { name: "Back to Maps" })).toBeFocused();

    // A bare ArrowLeft from the same button moves the line left.
    const moved = firstPoint(await pathData(drawnLine(page)));
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => firstPoint(await pathData(drawnLine(page)))[0])
      .toBeCloseTo(moved[0] - 1, 2);
    await expect(page.getByRole("button", { name: "Back to Maps" })).toBeFocused();
  });

  test("keys the Frame does not handle reach the host Commands, and a bare Arrow from the Hidden button moves the selection @wf:plugins-maps-frame-keys", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline Map");
    await openMap(page, "Coastline Map");
    await pickPencil(page);
    await drawStroke(page, mapFrame(page).locator("svg"));
    await expect(drawnElements(page)).toHaveCount(1);

    // Visit the host properties panel first: in Firefox a Frame whose drawing
    // has no focusable element traps Tab and Shift+Tab once focus is inside it,
    // so the test ends inside the Frame rather than leaving it.
    //
    // The properties panel's Hidden button is a toggle, not a typing target: a
    // bare ArrowRight runs the host's move Command and leaves focus on it.
    // Properties selects the Map Line and lands focus on the panel's Name field.
    await runRowMenu(page, "Map Line 1", "Properties");
    await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
    const hidden = page.getByRole("button", { name: "Hidden", exact: true });
    await tabTo(page, hidden, { max: 5 });
    const start = firstPoint(await pathData(drawnLine(page)));
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => firstPoint(await pathData(drawnLine(page)))[0])
      .toBeCloseTo(start[0] + 1, 2);
    await expect(hidden).toBeFocused();

    // Undo that 1 mm move so the Pencil stroke is the newest edit the Frame's
    // undo below reverses.
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => firstPoint(await pathData(drawnLine(page)))[0])
      .toBeCloseTo(start[0], 2);

    // The Pencil's pointerdown calls preventDefault, so the mouse never focuses
    // the Frame; Tab into it the way an author would. The Frame handles no
    // keys, so the host's undo Command runs with the author on the drawing
    // (#760).
    await tabTo(page, frameElement(page), { max: 40, backwards: true });
    await expect(frameElement(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(drawnElements(page)).toHaveCount(0);
    await expect(elementRow(page, "Map Line 1")).toHaveCount(0);

    // Redo brings the line back (and selects it again) for the pan below, from
    // inside the Frame like the undo.
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(drawnElements(page)).toHaveCount(1);
    await expect(elementRow(page, "Map Line 1")).toBeVisible();

    // Redo can land focus on the Elements list, so Tab back into the Frame:
    // Alt+ArrowRight is a host pan Command the Frame does not handle either.
    await tabTo(page, frameElement(page), { max: 60 });
    await expect(frameElement(page)).toBeFocused();
    const base = await viewBox(page);
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await viewBox(page))[0]).toBeCloseTo(base[0] + 20, 1);
  });
});
