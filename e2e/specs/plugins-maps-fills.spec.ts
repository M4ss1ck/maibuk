// The Maps editor's Bucket and Fills (#748): the tool picker gains a Bucket,
// which pours the Fill color into the face under a click, and the Frame draws
// the Fill as a filled path behind the Map Lines while the Elements list lists
// it as a Fill. From the keyboard alone the author picks the Bucket with its
// key, Tabs into the Frame, and presses Enter to pour at the keyboard
// crosshair, which rests inside the placed Shape; Mod+Z removes the Fill. The
// Fill survives a reload.
//
// The click itself is `support/frame-stroke.ts`, beside the other pointer
// gestures the drawing Frame has no key for, which explains why it sits
// outside the spec.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import type { FrameLocator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { clickPagePoint } from "../support/frame-stroke";
import { leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import { openLayers } from "../support/maps-layers";

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

/** The filled paths the Frame draws: a Fill's path has a colour where a line has none. */
const filledPaths = (page: Page) =>
  mapFrame(page).locator('g[data-element-id] path.map-line:not([fill="none"])');

/** The Fill color control the properties panel shows. */
const fillColor = (page: Page) => page.getByText("Fill color", { exact: true });

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

/** Opens an empty Map in its editor. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page, "Coastline");
  await tabTo(page, page.getByRole("button", { name: "Open Coastline" }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
  await openLayers(page);
}

/** Places a Rectangle at the view centre from its key and its Place button. */
async function placeRectangle(page: Page): Promise<void> {
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Rectangle", exact: true, pressed: true }));
  await expect(mapFrame(page).locator('svg[data-tool="rectangle"]')).toBeVisible();
  const place = page.getByRole("button", { name: "Place rectangle" });
  await tabTo(page, place, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Rectangle 1")).toBeVisible();
}

/** Picks the Bucket with its key and waits for the Frame to honour it. */
async function pickBucket(page: Page): Promise<void> {
  await page.keyboard.press("b");
  await expect(page.getByRole("button", { name: "Bucket", exact: true, pressed: true }));
  // The scene round-trip is what proves the Frame is listening before a pour.
  await expect(mapFrame(page).locator('svg[data-tool="bucket"]')).toBeVisible();
}

/** The centre of a drawn path, in page millimetres. */
function pathCentre(d: string): [number, number] {
  const values = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (values.length < 4 || values.length % 2 !== 0) {
    throw new Error(`unexpected Map Line path: ${d}`);
  }
  const xs = values.filter((_value, index) => index % 2 === 0);
  const ys = values.filter((_value, index) => index % 2 === 1);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
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

test.describe("Maps Bucket and Fills @wf:plugins-maps-fills @sc:plugin.maibuk-maps.bucketTool @sandbox", () => {
  test("the Bucket pours a Fill into a placed Rectangle, which the Elements list lists and the Frame draws filled", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickBucket(page);
    await expect(fillColor(page)).toBeVisible();

    // The click lands inside the Shape, and the Worker pours a Fill there.
    const rect = mapFrame(page).locator("g[data-element-id] path.map-line").first();
    const d = await rect.getAttribute("d");
    if (d === null) throw new Error("the Rectangle has no path");
    await clickPagePoint(page, surface(page), pathCentre(d));

    const fill = elementRow(page, "Fill 1");
    await expect(fill).toBeVisible();
    await expect(fill).toContainText("Fill");
    await expect(filledPaths(page)).toHaveCount(1);
    await capture(page, "fills-poured");
  });

  test("the Bucket's key and Enter pour at the Frame's crosshair, and Mod+Z removes the Fill", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickBucket(page);

    // The crosshair rests at the page centre, inside the Rectangle placed
    // there, and Enter pours at it from inside the Frame. The floating chrome
    // (#778) puts the Frame past the belt's eleven tool buttons, so the walk to
    // it allows for them.
    await tabTo(page, frameElement(page), { max: 60 });
    await expect(frameElement(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(elementRow(page, "Fill 1")).toBeVisible();
    await expect(filledPaths(page)).toHaveCount(1);
    await capture(page, "fills-keyboard");

    // The Frame forwards Mod+Z to the host's undo, which removes the pour.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(elementRow(page, "Fill 1")).toHaveCount(0);
    await expect(filledPaths(page)).toHaveCount(0);
  });

  test("a poured Fill is still drawn and listed after a reload and reopening the Map", async ({
    page,
  }) => {
    await openEditorWithMap(page);
    await placeRectangle(page);
    await pickBucket(page);
    await tabTo(page, frameElement(page), { max: 60 });
    await expect(frameElement(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(elementRow(page, "Fill 1")).toBeVisible();

    // Back to Maps flushes the autosave the pour queued, so the reload below
    // reads the Map from Plugin storage rather than the editor's memory.
    await leaveFrame(page, frameElement(page));
    await tabTo(page, page.getByRole("button", { name: "Back to Maps" }), {
      max: 60,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Open Coastline" }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(surface(page)).toBeVisible();
    // Layers starts shut in the floating editor (#778), so the list below is
    // opened again the way an author opens it.
    await openLayers(page);
    await expect(elementRow(page, "Fill 1")).toBeVisible();
    await expect(filledPaths(page)).toHaveCount(1);
  });
});
