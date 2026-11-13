// The Maps editor's Shape tools (#747): the tool picker gains Ellipse,
// Rectangle, and Polygon, each with its own key and its own Place button, and
// the properties panel edits a Shape's exact geometry through number fields. A
// Shift+drag of the Ellipse squares the box into a circle, and the stored Shape
// reads back equal on both sides; from the keyboard alone the author picks a
// Shape tool by its key, presses its Place button, and types a new Width into
// the number field, which the drawn outline follows; Roughen (Mod+Shift+R)
// converts the Shape to a point-by-point line, the properties panel says which
// Shape it was converted from, and Mod+Z brings the number fields back.
//
// The Shift+drag is `support/frame-stroke.ts`, which explains why the one
// pointer gesture sits outside the spec.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { dragShape } from "../support/frame-stroke";
import { pressUntilFocused, tabTo, tabToEither } from "../support/keyboard";
import { expect, test } from "../support/test";
import { openLayers } from "../support/maps-layers";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The Map editor's embedded Frame, and its drawing surface. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The Layers card's Elements list, and one Element's row button in it. */
const elementsList = (page: Page) =>
  page.getByRole("list").filter({ has: page.getByRole("button", { name: /^More actions for / }) });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("button", { name: new RegExp(`^${name}`) });

/** The Map Line path the Frame draws for an Element. */
const drawnLine = (page: Page) => mapFrame(page).locator("g[data-element-id] path.map-line");

/** A Shape's number field, by its label. */
const numberField = (page: Page, name: string) => page.getByRole("textbox", { name });

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

/** Opens an empty Map in its editor, where every test below starts. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await openMap(page, "Coastline");
}

/** Picks a Shape tool with its key and waits for the Frame to honour it. */
async function pickShapeTool(page: Page, key: string, tool: string): Promise<void> {
  await page.keyboard.press(key);
  // The floating belt (#778) presses its tool buttons rather than checking a
  // radio, the way `plugins-maps-move` already reports its own tool.
  await expect(page.getByRole("button", { name: tool, exact: true, pressed: true })).toBeVisible();
  // The scene round-trip is what proves the Frame is listening before a drag.
  await expect(mapFrame(page).locator(`svg[data-tool="${tool.toLowerCase()}"]`)).toBeVisible();
}

/** Places the picked Shape with its Place button, the keyboard's way to draw one. */
async function placeShape(page: Page, tool: string): Promise<void> {
  const place = page.getByRole("button", { name: `Place ${tool.toLowerCase()}` });
  // The Place button is the Properties card's footer action (#778), past the
  // pill, the eleven tool buttons, the Layers list, and the Frame.
  await tabTo(page, place, { max: 120 });
  await page.keyboard.press("Enter");
}

/** The `d` attribute a drawn Element's first path has now. */
async function pathData(line: Locator): Promise<string> {
  const d = await line.getAttribute("d");
  if (d === null) throw new Error("the Element's line has no path");
  return d;
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

test.describe("Maps Shape tools, Place buttons, and Shape number fields @wf:plugins-maps-shapes @sc:plugin.maibuk-maps.ellipseTool @sc:plugin.maibuk-maps.rectangleTool @sc:plugin.maibuk-maps.polygonTool @sc:plugin.maibuk-maps.roughen @sandbox", () => {
  test("a Shift+drag of the Ellipse draws a circle whose Width and Height are equal", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickShapeTool(page, "o", "Ellipse");

    // Shift squares the drag's box, so the stored Ellipse is a circle. The
    // capture point runs with the button still down, so the preview is on screen;
    // it takes the whole page because the preview lives inside the Frame.
    await dragShape(page, surface(page), {
      constrain: true,
      during: () => capture(page, "shapes-drag-preview"),
    });

    // The finished drag named the Shape and selected it: the Elements list and
    // the properties panel show what the Worker stored.
    const rows = elementsList(page).getByRole("button", { name: /^More actions for / });
    await expect(rows).toHaveCount(1);
    await expect(elementRow(page, "Ellipse 1")).toBeVisible();
    const width = numberField(page, "Width (mm)");
    const height = numberField(page, "Height (mm)");
    await expect(width).toBeVisible();
    const side = await width.inputValue();
    expect(Number(side)).toBeGreaterThan(1);
    await expect(height).toHaveValue(side);
  });

  test("each Shape tool answers its key, and a placed Rectangle takes a new Width", async ({
    page,
  }) => {
    await openEditorWithMap(page);

    // Each Shape tool takes its own key and offers its Place button.
    for (const [key, tool] of [
      ["o", "Ellipse"],
      ["r", "Rectangle"],
      ["s", "Polygon"],
    ] as const) {
      await pickShapeTool(page, key, tool);
      await expect(page.getByRole("button", { name: `Place ${tool.toLowerCase()}` })).toBeVisible();
    }

    // The keyboard's way to draw a Shape: its key, then its Place button.
    await pickShapeTool(page, "r", "Rectangle");
    await placeShape(page, "Rectangle");
    await expect(elementRow(page, "Rectangle 1")).toBeVisible();
    const width = numberField(page, "Width (mm)");
    const height = numberField(page, "Height (mm)");
    await expect(width).toHaveValue("40");
    await expect(height).toHaveValue("40");
    await capture(page, "shapes-number-fields", {
      around: [
        numberField(page, "Center X (mm)"),
        numberField(page, "Width (mm)"),
        numberField(page, "Corner radius (mm)"),
      ],
    });

    // A number field reshapes the exact Shape; the Frame draws what it stored.
    // The fields sit in the Properties card, past the footer, the pills, and the
    // page's own chrome, so the walk allows for all of it.
    await tabToEither(page, width, { max: 120 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("60");
    await page.keyboard.press("Enter");
    await expect(width).toHaveValue("60");
    await expect(height).toHaveValue("40");
    await expect(numberField(page, "Corner radius (mm)")).toBeVisible();
    await expect(numberField(page, "Sides")).toHaveCount(0);

    const [left, top, right, bottom] = pathBounds(await pathData(drawnLine(page).first()));
    expect(right - left).toBeGreaterThan(59.5);
    expect(right - left).toBeLessThan(60.5);
    expect(bottom - top).toBeGreaterThan(39.5);
    expect(bottom - top).toBeLessThan(40.5);
  });

  test("Roughen converts the Shape and says what it was, and Mod+Z brings the number fields back", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickShapeTool(page, "o", "Ellipse");
    await placeShape(page, "Ellipse");

    const width = numberField(page, "Width (mm)");
    await expect(width).toBeVisible();

    await page.keyboard.press("ControlOrMeta+Shift+r");
    const converted = page.getByText("Converted from an ellipse to a point-by-point line");
    await expect(converted).toBeVisible();
    await capture(page, "shapes-converted", {
      around: [page.getByRole("textbox", { name: "Name" }), converted],
    });
    // The line is point by point now, so its Shape number fields are gone.
    await expect(width).toHaveCount(0);

    // One undo step restores the exact Shape and its geometry.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(width).toBeVisible();
    await expect(converted).toHaveCount(0);
  });
});
