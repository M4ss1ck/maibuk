// The Maps editor's Map Styles and colour overrides (#752): a Map is drawn in
// one of four Map Styles, and every colour an Element holds either follows one
// of the Style's roles or overrides it with a hex of its own. From the header
// picker the author moves a Map from Atlas to Night by keyboard, which recolours
// the Frame's page background and every Element that follows a role; a Map Line
// that took a hex from its colour picker keeps that hex across a Style switch,
// and "Use Map Style color" hands it back to the Style, which then recolours it.
// The Style and the override survive a reload and reopening the Map.
//
// The colours below mirror `plugins/maibuk-maps/styles.ts` `MAP_STYLES` as
// literals: a spec drives the app through its UI and asserts what the Frame
// draws, so it imports no app or Plugin code.
//
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

/**
 * The colours the Frame draws, by Map Style, as `styles.ts` declares them: the
 * water a Map's page is drawn on, and the ink a Map Line follows until it takes
 * a colour of its own.
 */
const STYLE_COLORS = {
  atlas: { water: "#d7e6ec", ink: "#1f2933" },
  parchment: { water: "#e9ddc4", ink: "#4a3b2a" },
  ink: { water: "#ffffff", ink: "#000000" },
  night: { water: "#14202b", ink: "#e8edf2" },
} as const;

/** A colour no Map Style holds, so a pick of it is an override. */
const OVERRIDE = "#EF4444";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The Map editor's embedded Frame, its iframe, and its drawing surface. */
const mapFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The page the Map is drawn on: the rect the Frame fills with the Style's water. */
const pageBackground = (page: Page) => mapFrame(page).locator("svg > rect").first();
/** The ink the Map Line paints, which follows the Style's ink until it overrides it. */
const drawnLine = (page: Page) => mapFrame(page).locator("g[data-element-id] path.map-line");

/** The Elements list and one row in it. */
const elementsList = (page: Page) => page.getByRole("listbox", { name: "Elements" });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("option", { name: new RegExp(`^${name}`) });

/**
 * The header's Map Style picker, named "<Style> Map Style" (its value first), so
 * anchoring the end keeps it apart from the "Use Map Style color" button.
 */
const mapStyleTrigger = (page: Page) => page.getByRole("button", { name: /Map Style$/ });
/** The selected Map Line's colour control, and the path back to the Style's colour. */
const lineColorTrigger = (page: Page) => page.getByRole("button", { name: "Map Line color" });
const useMapStyleColor = (page: Page) => page.getByRole("button", { name: "Use Map Style color" });

/** The case-insensitive attribute matcher for one drawn colour. */
function hex(color: string): RegExp {
  return new RegExp(`^${color}$`, "i");
}

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

/** Opens an empty Map in its editor, where every test below starts. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await tabTo(page, page.getByRole("button", { name: "Open Coastline" }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
}

/**
 * Places a Rectangle at the view centre from the Rectangle tool's key and its
 * Place button, leaving it selected. Its plain line follows the Style's ink, so
 * it is the Element that proves a Style switch reaches the drawing.
 */
async function placeRectangle(page: Page): Promise<void> {
  await page.keyboard.press("r");
  await expect(page.getByRole("radio", { name: "Rectangle", exact: true })).toBeChecked();
  await expect(mapFrame(page).locator('svg[data-tool="rectangle"]')).toBeVisible();
  const place = page.getByRole("button", { name: "Place rectangle" });
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Rectangle 1")).toBeVisible();
}

/**
 * Picks a Map Style from the header by keyboard: Enter opens its list, Home goes
 * to the first entry (a previous pick leaves the list where it was), and the
 * arrows walk to the named Style, which Enter takes.
 */
async function pickMapStyle(page: Page, style: string): Promise<void> {
  const trigger = mapStyleTrigger(page);
  await leaveFrame(page, frameElement(page));
  await tabTo(page, trigger, { max: 80, backwards: true });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const item = page.getByRole("option", { name: style, exact: true });
  await expect(item).toBeVisible();
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", item, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toContainText(style);
}

/**
 * Commits one colour on the selected Map Line through its picker's hex field,
 * the picker's precise keyboard path, then closes the dialog with Escape, which
 * puts focus back on the trigger.
 */
async function pickLineColor(page: Page, value: string): Promise<void> {
  const trigger = lineColorTrigger(page);
  await tabTo(page, trigger, { max: 80 });
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Map Line color" });
  await expect(picker).toBeVisible();
  // Opening the picker moves focus into it, as every dialog does.
  await expectFocusWithin(picker);
  const field = picker.getByRole("textbox", { name: "Hex color" });
  await tabTo(page, field, { max: 25 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
}

/** Tabs back to Maps, which flushes the autosave the edits queued. */
async function backToMaps(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 80,
    backwards: true,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
}

/** Reopens the Map after a reload, where the assertions below read the saved state. */
async function reopenMap(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Open Coastline" }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(surface(page)).toBeVisible();
  await expect(elementRow(page, "Rectangle 1")).toBeVisible();
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

test.describe("Maps Map Styles @wf:plugins-maps-styles @sc:plugin.maibuk-maps.rectangleTool @sc:plugin.maibuk-maps.nextMapStyle @sandbox", () => {
  test("picking a Map Style from the header recolours the page and the Map Line that follows it", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);

    // An Atlas Map is drawn on the Style's water, and a plain line in its ink.
    await expect(pageBackground(page)).toHaveAttribute("fill", hex(STYLE_COLORS.atlas.water));
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(STYLE_COLORS.atlas.ink));
    await capture(page, "styles-atlas");

    await pickMapStyle(page, "Night");

    // The page and the line both follow the Style they are drawn in.
    await expect(pageBackground(page)).toHaveAttribute("fill", hex(STYLE_COLORS.night.water));
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(STYLE_COLORS.night.ink));
    await capture(page, "styles-night");
  });

  test("a Map Line's own colour stays an override across a Map Style switch", async ({ page }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);

    // A hex no Style holds overrides the role the line followed.
    await pickLineColor(page, OVERRIDE);
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(OVERRIDE));

    await pickMapStyle(page, "Parchment");

    // The page follows the new Style; the line keeps the colour it was given.
    await expect(pageBackground(page)).toHaveAttribute("fill", hex(STYLE_COLORS.parchment.water));
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(OVERRIDE));
  });

  test("Use Map Style color hands the line back to the Style, which then recolours it", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickLineColor(page, OVERRIDE);
    await pickMapStyle(page, "Night");
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(OVERRIDE));

    const clear = useMapStyleColor(page);
    await tabTo(page, clear, { max: 80 });
    await expect(clear).toBeEnabled();
    await page.keyboard.press("Enter");

    // Nothing is left to clear, and the line draws in the Style again.
    await expect(clear).toBeDisabled();
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(STYLE_COLORS.night.ink));

    // It follows the Style, so the next one recolours it too.
    await pickMapStyle(page, "Ink");
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(STYLE_COLORS.ink.ink));
  });

  test("the Map Style and the override survive a reload and reopening the Map", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickMapStyle(page, "Night");
    await pickLineColor(page, OVERRIDE);
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(OVERRIDE));

    await backToMaps(page);
    await reopenMap(page);

    await expect(mapStyleTrigger(page)).toContainText("Night");
    await expect(pageBackground(page)).toHaveAttribute("fill", hex(STYLE_COLORS.night.water));
    await expect(drawnLine(page)).toHaveAttribute("stroke", hex(OVERRIDE));
  });
});
