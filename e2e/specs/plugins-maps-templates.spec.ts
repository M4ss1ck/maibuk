// The Maps Map Templates (#754): the New Map dialog's "Start from" group starts
// a Map from one of six ready-made Templates instead of a blank page. By
// keyboard alone the author names the Map, Tabs to Start from, arrows to
// Archipelago or Cuba, and creates the Map: the editor's Elements list then
// holds the Template's coasts, one Fill per face, the compass rose, and the
// title cartouche, whose Map Label writes the Map's name across the page. Cuba
// (#755) is real geography, so it also names its provinces in drawn Labels.
//
// A Map made from a Template is a copy: renaming an Element of the first Map
// leaves the Template untouched, so a second Map made from it is the same
// Template again. Both Maps keep their Elements, and the first Map's Elements
// are still there after a reload.
//
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { isFocusWithin, leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

/**
 * What the Archipelago Template lays down, as `templates.ts` declares it: six
 * islands inside the world border, so seven Fills (the sea and one land face
 * per island) and seven Map Lines (the border and one coast per island).
 */
const ARCHIPELAGO_FILLS = 7;
const ARCHIPELAGO_LINES = 7;

/**
 * What the Cuba Template lays down on the page the New Map dialog opens on, as
 * `cuba.ts` declares it: two coasts (the main island and Isla de la Juventud)
 * cut by thirty-eight province borders, so seventeen Fills (the sea and one land
 * face per province) and a Label per province.
 */
const CUBA_FILLS = 17;

/** The provinces the Cuba Template names, in the order `cuba.ts` lists them. */
const CUBA_PROVINCES = [
  "Pinar del Río",
  "La Habana",
  "Matanzas",
  "Villa Clara",
  "Cienfuegos",
  "Sancti Spíritus",
  "Ciego de Ávila",
  "Camagüey",
  "Las Tunas",
  "Holguín",
  "Granma",
  "Santiago de Cuba",
  "Guantánamo",
  "Artemisa",
  "Mayabeque",
  "Isla de la Juventud",
];

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

/** The Elements list, one row in it, and the rows of one kind. */
const elementsList = (page: Page) => page.getByRole("listbox", { name: "Elements" });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("option", { name: new RegExp(`^${name}`) });
const fillRows = (page: Page) => elementsList(page).getByRole("option", { name: /^Fill \d/ });
const lineRows = (page: Page) => elementsList(page).getByRole("option", { name: /^Map Line \d/ });

/**
 * The text the Template's title Map Label draws in the Frame. A label's halo is
 * a second copy of the same text, so the label draws two, halo first.
 */
const drawnLabelPaths = (page: Page) =>
  mapFrame(page).locator("g[data-element-id] text.map-line textPath");

/** Opens Maps from the sidebar, waiting for the Plugin's launch scan. */
async function openMaps(page: Page): Promise<void> {
  await expect(navOption(page, "Maps")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"), { max: 60 });
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Maps"), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/**
 * Creates a Map from a Map Template in the New Map dialog by keyboard: the name,
 * then Tab to the Start from group, whose Blank entry it leaves with the arrows.
 * `shot` captures the open dialog before a Template is picked, for the PR's
 * screenshots; it runs before the Start from assertions so a base-branch run
 * still reaches it. The dialog's page size is left on the landscape page it
 * opens on.
 */
async function createMapFromTemplate(
  page: Page,
  name: string,
  template: string,
  shot: string | null = null
): Promise<void> {
  const trigger = page.getByRole("button", { name: "New Map" });
  await tabTo(page, trigger, { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type(name);
  if (shot !== null) await capture(page, shot);

  // Blank is the default, so the group starts on it and the arrows walk away.
  await expect(dialog.getByRole("radiogroup", { name: "Start from" })).toBeVisible();
  const blank = dialog.getByRole("radio", { name: "Blank", exact: true });
  await expect(blank).toBeChecked();
  await tabTo(page, blank, { max: 30 });
  const picked = dialog.getByRole("radio", { name: template, exact: true });
  await pressUntilFocused(page, "ArrowDown", picked, { max: 10 });
  await expect(picked).toBeChecked();

  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName(name);
}

/** Opens a Map from the list and waits for its editor's Frame to draw. */
async function openMap(page: Page, name: string): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: `Open ${name}` }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
}

/** Leaves the Map Frame and Tabs back to Back to Maps, then opens it by keyboard. */
async function backToMaps(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 80,
    backwards: true,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
}

/** Focuses Back to Maps, a plain panel control (not the Elements list). */
async function focusBack(page: Page): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
    max: 60,
    backwards: true,
  });
}

/** Focuses an Elements row, making it the selection. */
async function selectElement(page: Page, name: string): Promise<Locator> {
  const row = elementRow(page, name);
  const list = elementsList(page);
  // Start at Back to Maps, the first panel control, and Tab forward into the
  // list: from either side of it, that is the one direction that always works.
  await focusBack(page);
  for (let i = 0; i < 10 && !(await isFocusWithin(list)); i++) await page.keyboard.press("Tab");
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", row, { max: 20 });
  if ((await row.getAttribute("aria-selected")) !== "true") await page.keyboard.press(" ");
  await expect(row).toHaveAttribute("aria-selected", "true");
  return row;
}

/** Runs one entry of the focused row's Item Menu by keyboard. */
async function runRowMenu(page: Page, name: string, label: string): Promise<void> {
  await selectElement(page, name);
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: label }), {
    max: 20,
  });
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
}

/** Renames an Element through its row's Item Menu and the dialog it opens. */
async function renameElement(page: Page, name: string, rename: string): Promise<void> {
  await runRowMenu(page, name, "Rename");
  const dialog = page.getByRole("dialog", { name: "Rename Element" });
  const field = dialog.getByRole("textbox", { name: "Name" });
  await expect(field).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(rename);
  await tabTo(page, dialog.getByRole("button", { name: "Save" }), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(elementRow(page, rename)).toBeVisible();
  await expect(elementRow(page, name)).toHaveCount(0);
}

/**
 * Asserts the open Map is the Archipelago Template: its coasts and Fills in the
 * Elements list, the compass rose and title cartouche Stamps, and the title Map
 * Label writing this Map's name across the cartouche.
 */
async function expectArchipelagoTemplate(page: Page, title: string): Promise<void> {
  await expect(elementsList(page)).toBeVisible();
  await expect(fillRows(page)).toHaveCount(ARCHIPELAGO_FILLS);
  await expect(lineRows(page)).toHaveCount(ARCHIPELAGO_LINES);
  await expect(elementRow(page, "Compass rose")).toBeVisible();
  await expect(elementRow(page, "Title cartouche")).toBeVisible();
  await expect(elementRow(page, "Map Label 1")).toBeVisible();
  await expect(drawnLabelPaths(page).first()).toHaveText(title);
}

/**
 * Asserts the open Map is the Cuba Template: the sea and one land Fill per
 * province in the Elements list, the compass rose and title cartouche Stamps
 * with the title Label in the cartouche, and a drawn Label per province, whose
 * halo is the second copy of its text.
 */
async function expectCubaTemplate(page: Page, title: string): Promise<void> {
  await expect(elementsList(page)).toBeVisible();
  await expect(fillRows(page)).toHaveCount(CUBA_FILLS);
  await expect(elementRow(page, "Compass rose")).toBeVisible();
  await expect(elementRow(page, "Title cartouche")).toBeVisible();
  await expect(drawnLabelPaths(page).first()).toHaveText(title);
  // The title Label is Map Label 1, so the last province Label is the 17th.
  await expect(elementRow(page, `Map Label ${CUBA_PROVINCES.length + 1}`)).toBeVisible();
  for (const province of CUBA_PROVINCES) {
    await expect(drawnLabelPaths(page).filter({ hasText: province })).toHaveCount(2);
  }
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

test.describe("Maps Map Templates @wf:plugins-maps-templates @sandbox", () => {
  test("Start from Archipelago creates a Map whose Elements are the Template, and a reload keeps them", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMapFromTemplate(page, "Coastline", "Archipelago", "templates-new-map");
    await openMap(page, "Coastline");

    await expectArchipelagoTemplate(page, "Coastline");
    await capture(page, "templates-map");

    // The Template's Elements are saved with the Map, not drawn from the Template.
    await backToMaps(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    await openMap(page, "Coastline");
    await expectArchipelagoTemplate(page, "Coastline");
  });

  test("Start from Cuba creates a Map whose Elements are the island's provinces", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    // The default page the dialog opens on, the landscape one.
    await createMapFromTemplate(page, "Cuba", "Cuba");
    await openMap(page, "Cuba");

    await expectCubaTemplate(page, "Cuba");
    await capture(page, "templates-cuba");
  });

  test("a second Map from the same Template is an unchanged copy after the first Map's Element is renamed", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMapFromTemplate(page, "First Coast", "Archipelago");
    await openMap(page, "First Coast");
    await expectArchipelagoTemplate(page, "First Coast");

    // Edit the Template's first coast, which the second Map must not inherit.
    await renameElement(page, "Map Line 1", "Northern Border");

    // The rename is saved with the Map, not only drawn in the editor.
    await backToMaps(page);
    await openMap(page, "First Coast");
    await expect(elementRow(page, "Northern Border")).toBeVisible();
    await expect(elementRow(page, "Map Line 1")).toHaveCount(0);

    await backToMaps(page);
    await createMapFromTemplate(page, "Second Coast", "Archipelago");
    await openMap(page, "Second Coast");

    // The same Template again, under this Map's own name.
    await expectArchipelagoTemplate(page, "Second Coast");
    await expect(elementRow(page, "Map Line 1")).toBeVisible();
    await expect(elementRow(page, "Northern Border")).toHaveCount(0);
  });
});
