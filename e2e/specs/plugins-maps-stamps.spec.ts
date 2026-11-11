// The Maps editor's Insert tool and Stamps (#749): the tool picker gains Insert,
// which opens a Stamp picker listing every built-in Stamp beside a Place button
// named after the pick. From the keyboard alone the author picks Insert with its
// key, picks a Stamp by its name in the picker, and presses Place: the Stamp
// lands at the view centre, the Elements list lists it, and the Frame draws its
// art; an arrow moves the selected Stamp 1 mm and Delete removes it. A click in
// the Frame places the picked Stamp where the pointer landed. The scale bar has
// no art: it reads the page's scale, so the Frame draws its distance label. A
// one-colour Stamp takes a new colour from the Stamp color picker, which art
// with fills of its own does not offer.
//
// The click is `support/frame-stroke.ts`, beside the other pointer gestures the
// drawing Frame has no key for, which explains why it sits outside the spec.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { clickPagePoint } from "../support/frame-stroke";
import { leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

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

/** The Elements list and one row in it. */
const elementsList = (page: Page) => page.getByRole("listbox", { name: "Elements" });
const elementRow = (page: Page, name: string) =>
  elementsList(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** Every Element the Frame draws, and the paths one Element's picture is made of. */
const drawnElements = (page: Page) => mapFrame(page).locator("g[data-element-id]");
const drawnPaths = (page: Page) => mapFrame(page).locator("g[data-element-id] path.map-line");
/** The labels a Stamp writes into the Frame: the scale bar's two readings. */
const drawnLabels = (page: Page) => mapFrame(page).locator("g[data-element-id] text.map-line");
/** The paths a Stamp draws in one colour, which only one-colour art can. */
const recolouredPaths = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] path.map-line[fill="#EF4444"]');

/**
 * The Insert tool's Stamp picker: its trigger button, its list, and one option.
 * The control names its trigger after the label and the picked value
 * ("Capital Stamp"); the list it opens in a dialog is named by the label alone.
 */
const stampTrigger = (page: Page) => page.getByRole("button", { name: /Stamp$/ });
const stampList = (page: Page) => page.getByRole("listbox", { name: "Stamp", exact: true });
const stampOption = (page: Page, name: string) =>
  stampList(page).getByRole("option", { name, exact: true });

/** The Insert tool's Place button, named after the Stamp it would place. */
const placeButton = (page: Page, stamp: string) =>
  page.getByRole("button", { name: `Place ${stamp}`, exact: true });

/**
 * The Map's page defaults to the landscape preset, so its centre is 114.3 by
 * 76.2 mm, the point a keyboard Place and the default view land on.
 */
const PAGE_CENTRE_MM: readonly [number, number] = [114.3, 76.2];

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

/** Picks the Insert tool with its key and waits for the Frame to honour it. */
async function pickInsert(page: Page): Promise<void> {
  await page.keyboard.press("i");
  await expect(page.getByRole("radio", { name: "Insert", exact: true })).toBeChecked();
  // The scene round-trip is what proves the Frame is listening before a click.
  await expect(mapFrame(page).locator('svg[data-tool="insert"]')).toBeVisible();
}

/**
 * Picks one built-in Stamp from the Insert tool's picker by keyboard: Tab to the
 * picker, Enter to open it, Home to its first entry (a previous pick leaves the
 * list where it was), then the arrows to the named Stamp, which Enter takes.
 */
async function pickStamp(page: Page, name: string): Promise<void> {
  await tabTo(page, stampTrigger(page), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(stampList(page)).toBeVisible();
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", stampOption(page, name), { max: 40 });
  await page.keyboard.press("Enter");
  await expect(stampList(page)).toBeHidden();
  await expect(stampTrigger(page)).toContainText(name);
}

/** Places the picked Stamp with its Place button, the keyboard's way to drop one. */
async function placeStamp(page: Page, name: string): Promise<void> {
  const place = placeButton(page, name);
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, name)).toBeVisible();
}

/** The page point a drawn Element's transform places it at, in millimetres. */
function placedAt(transform: string): [number, number] {
  const values = (transform.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 2) throw new Error(`unexpected Stamp transform: ${transform}`);
  return [values[0], values[1]];
}

/** One Element's first drawn transform, which carries where it sits on the page. */
async function stampPoint(element: Locator): Promise<[number, number]> {
  const transform = await element.locator("path.map-line").first().getAttribute("transform");
  if (transform === null) throw new Error("the drawn Stamp has no transform");
  return placedAt(transform);
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

test.describe("Maps Insert tool and Stamps @wf:plugins-maps-stamps @sc:plugin.maibuk-maps.insertTool @sc:plugin.maibuk-maps.moveRight @sc:plugin.maibuk-maps.deleteElement @sandbox", () => {
  test("the Insert tool picks a Stamp by keyboard, places it, moves it 1 mm, and deletes it", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickInsert(page);

    // The picker is the Insert tool's own UI, so it appears beside the tool list
    // and names its Place button after the pick.
    await tabTo(page, stampTrigger(page), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(stampList(page)).toBeVisible();
    await capture(page, "stamps-picker");

    // The keyboard pick: arrows move the list's own focus, Enter takes the pick.
    await pressUntilFocused(page, "ArrowDown", stampOption(page, "Castle"), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(stampList(page)).toBeHidden();
    await expect(placeButton(page, "Castle")).toBeVisible();

    // Enter on the Place button drops the Stamp at the view centre.
    await tabTo(page, placeButton(page, "Castle"), { max: 60 });
    await page.keyboard.press("Enter");
    const row = elementRow(page, "Castle");
    await expect(row).toBeVisible();
    await expect(drawnElements(page)).toHaveCount(1);
    await expect(drawnPaths(page)).not.toHaveCount(0);

    const drawn = drawnElements(page).first();
    const [x, y] = await stampPoint(drawn);
    expect(x).toBeCloseTo(PAGE_CENTRE_MM[0], 1);
    expect(y).toBeCloseTo(PAGE_CENTRE_MM[1], 1);

    // The Move commands act on the selected Stamp, and the Frame follows.
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await stampPoint(drawn))[0]).toBeCloseTo(x + 1, 2);

    // Delete removes the selected Stamp from the Map and from the Frame.
    await page.keyboard.press("Delete");
    await expect(row).toHaveCount(0);
    await expect(drawnElements(page)).toHaveCount(0);
  });

  test("a click in the Frame with the Insert tool places the picked Stamp where the pointer landed", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickInsert(page);
    await pickStamp(page, "Lone mountain");

    // A pointer-only gesture (see `support/frame-stroke.ts`): the Frame has no
    // key that names a point on the page.
    const point = [60, 50] as const;
    await clickPagePoint(page, surface(page), point);

    await expect(elementRow(page, "Lone mountain")).toBeVisible();
    await expect(drawnElements(page)).toHaveCount(1);
    const [x, y] = await stampPoint(drawnElements(page).first());
    expect(x).toBeCloseTo(point[0], 0);
    expect(y).toBeCloseTo(point[1], 0);
  });

  test("the scale bar inserted from the picker draws its distance label in the Frame", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickInsert(page);
    await pickStamp(page, "Scale bar");
    await placeStamp(page, "Scale bar");
    await expect(drawnElements(page)).toHaveCount(1);

    // The scale bar has no art: the Frame draws the reading the page's scale
    // supports, from zero to the round distance the landscape page makes room for.
    const labels = drawnLabels(page);
    await expect(labels).toHaveCount(2);
    await expect(labels.first()).toHaveText("0");
    await expect(labels.last()).toHaveText(/^\d+ km$/);
    await capture(page, "stamps-scale-bar");
  });

  test("a one-colour Stamp takes a new colour from the Stamp color picker", async ({ page }) => {
    await openEditorWithMap(page);
    await pickInsert(page);
    await pickStamp(page, "Town");
    await placeStamp(page, "Town");

    // The Town's art leaves every fill to the Stamp, so the panel offers its
    // colour; the burg art, whose fills are its own, offers none.
    const trigger = page.getByRole("button", { name: "Stamp color" });
    await expect(trigger).toBeVisible();
    await tabTo(page, trigger, { max: 60 });
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Stamp color" });
    await expect(picker).toBeVisible();
    // The hex field is the picker's precise keyboard path, and Enter commits it.
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await tabTo(page, hex, { max: 25 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("#EF4444");
    await page.keyboard.press("Enter");

    const row = elementRow(page, "Town");
    await expect(row).toBeVisible();
    await expect(recolouredPaths(page)).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("places a scene of Stamps and the scale bar, each where it was clicked, for the PR's picture", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await pickInsert(page);

    // One of every kind of Stamp art the slice ships a look for, plus the scale
    // bar, spread over the landscape page.
    for (const [stamp, point] of [
      ["Capital", [55, 45]],
      ["Castle", [160, 40]],
      ["Lone mountain", [150, 105]],
      ["Lone tree", [175, 95]],
      ["Compass rose", [50, 115]],
      ["Ship", [175, 55]],
      ["Scale bar", [114, 112]],
      ["Town", [90, 100]],
    ] as const) {
      await pickStamp(page, stamp);
      await clickPagePoint(page, surface(page), point);
      await expect(elementRow(page, stamp)).toBeVisible();
      // A click leaves focus in the Frame; the picker lives outside it.
      await leaveFrame(page, frameElement(page));
    }

    // The Town is one-colour art, so the panel recolours it; it is still the
    // selection the last click left.
    const trigger = page.getByRole("button", { name: "Stamp color" });
    await tabTo(page, trigger, { max: 60 });
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Stamp color" });
    await expect(picker).toBeVisible();
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await tabTo(page, hex, { max: 25 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("#EF4444");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();

    await expect(drawnElements(page)).toHaveCount(8);
    await expect(recolouredPaths(page)).toHaveCount(1);
    // Two zoom steps fill the Frame with the scene, so the picture shows the art
    // at the size an author works at rather than the whole page at once.
    await page.keyboard.press("ControlOrMeta+=");
    await page.keyboard.press("ControlOrMeta+=");
    await capture(page, "stamps-scene");
  });
});
