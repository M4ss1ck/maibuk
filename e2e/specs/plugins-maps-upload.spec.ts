// The Maps editor's Insert upload (#756): a picture the author picks with the
// Insert panel's Upload… button becomes a Library picture, and the Custom Stamp
// or Map Image the panel asked for lands at the view centre. This spec proves
// the Custom Stamp path with one small one-colour SVG: the Elements list lists
// it under the file's own name, the Frame draws it as a picture, its single
// paint takes the Stamp color picker, and because the picture belongs to the
// Library rather than to the Map, a second Map's Stamp picker lists it too. The
// same picture then has to survive Export: the PNG the Frame rasterizes carries
// the picture's bytes as a data URI, since an SVG drawn as an image loads no
// external subresource and would otherwise print bare paper.
//
// The file dialog itself is `support/file-picker.ts`: the host opens it through
// the File System Access API, which Playwright cannot drive, so the stub
// answers with a real File and the spec still opens the dialog with a key.
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import { readFile } from "node:fs/promises";
import type { Download, FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { installFilePicker } from "../support/file-picker";
import { leaveFrame, pressUntilFocused, tabTo } from "../support/keyboard";
import { countInkPixels } from "../support/png-ink";
import { forceDownloadSaves } from "../support/save-picker";
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

/** Every Element the Frame draws, and the pictures it draws for them. */
const drawnElements = (page: Page) => mapFrame(page).locator("g[data-element-id]");
const drawnPictures = (page: Page) => mapFrame(page).locator("g[data-element-id] image.map-image");

/** The Insert panel's Upload button, which picks a picture and places it. */
const uploadButton = (page: Page) => page.getByRole("button", { name: "Upload…", exact: true });

/** The Export panel's fields the picture test saves through. */
const dpiField = (page: Page) => page.getByRole("textbox", { name: "DPI", exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: /^Save/ });

/**
 * The Insert tool's Stamp picker: its trigger button, its list, and one option.
 * The control names its trigger after the label and the picked value
 * ("Capital Stamp"); the list it opens in a dialog is named by the label alone.
 */
const stampTrigger = (page: Page) => page.getByRole("button", { name: /Stamp$/ });
const stampList = (page: Page) => page.getByRole("listbox", { name: "Stamp", exact: true });
const stampOption = (page: Page, name: string) =>
  stampList(page).getByRole("option", { name, exact: true });

/** The name the uploaded picture takes: the file's own stem. */
const UPLOADED_STAMP = "Beacon";

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
  await expect(surface(page)).toBeVisible();
  await openLayers(page);
}

/** Leaves the Map Frame and Tabs back to Back to Maps, then presses it. */
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

/** Picks the Insert tool with its key and waits for the Frame to honour it. */
async function pickInsert(page: Page): Promise<void> {
  await page.keyboard.press("i");
  await expect(page.getByRole("button", { name: "Insert", exact: true, pressed: true }));
  // The scene round-trip is what proves the Frame is listening before an upload.
  await expect(mapFrame(page).locator('svg[data-tool="insert"]')).toBeVisible();
}

/** Opens the Insert tool's Stamp picker by keyboard. */
async function openStampPicker(page: Page): Promise<void> {
  await tabTo(page, stampTrigger(page), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(stampList(page)).toBeVisible();
}

/** Writes one field: focus it, select all, type the value, Enter to commit. */
async function writeField(page: Page, field: Locator, value: string): Promise<void> {
  await tabTo(page, field, { max: 120 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue(value);
}

/** Tabs to `button` and presses it, returning the file the browser downloaded. */
async function saveByKeyboard(page: Page, button: Locator): Promise<Download> {
  await tabTo(page, button, { max: 90 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

/** The bytes the browser kept for one download. */
async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (path === null) throw new Error("the browser kept no file for the download");
  return readFile(path);
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

test.beforeEach(async ({ page }) => {
  await installFilePicker(page, [
    { name: `${UPLOADED_STAMP}.svg`, path: "e2e/fixtures/Beacon.svg", type: "image/svg+xml" },
  ]);
});

test.describe("Maps Insert upload @wf:plugins-maps-upload @sc:plugin.maibuk-maps.insertTool @sandbox", () => {
  test("an SVG uploaded through Insert lands as a Custom Stamp the Frame draws, and a second Map's Stamp picker lists it", async ({
    page,
  }) => {
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline");
    await openMap(page, "Coastline");
    await pickInsert(page);

    // Upload… picks the picture, which becomes a Library picture before the
    // Custom Stamp made from it lands at the view centre, selected.
    await tabTo(page, uploadButton(page), { max: 80 });
    await page.keyboard.press("Enter");

    const row = elementRow(page, UPLOADED_STAMP);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(drawnElements(page)).toHaveCount(1);
    await expect(drawnPictures(page)).toHaveCount(1);

    // The picture paints one colour, so its Stamp takes the Stamp's own colour.
    await expect(page.getByRole("button", { name: "Stamp color" })).toBeVisible();
    await capture(page, "maps-upload-custom-stamp");

    // The picture belongs to the Library, not to this Map, so another Map's
    // Stamp picker offers it beside the built-in Stamps.
    await backToMaps(page);
    await createMap(page, "Second Coastline");
    await openMap(page, "Second Coastline");
    await pickInsert(page);
    await openStampPicker(page);
    await expect(stampOption(page, UPLOADED_STAMP)).toBeVisible();
    await expect(elementRow(page, UPLOADED_STAMP)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(stampList(page)).toBeHidden();
    await expect(stampTrigger(page)).toBeFocused();
  });

  test("the PNG the Map exports draws the uploaded picture instead of bare paper", async ({
    page,
  }) => {
    // The Save dialog is no place for a keyboard run, so the app takes its own
    // download fallback and the spec reads the file the browser saved.
    await forceDownloadSaves(page);
    await page.goto("/");
    await openMaps(page);
    await createMap(page, "Coastline");
    await openMap(page, "Coastline");
    await pickInsert(page);

    // The Custom Stamp lands at the view centre, which is the page's centre.
    await tabTo(page, uploadButton(page), { max: 80 });
    await page.keyboard.press("Enter");
    await expect(drawnPictures(page)).toHaveCount(1);

    // A smaller print keeps the file quick to read back, and the panel says
    // what it will save before it saves it: the landscape page at 150 DPI.
    await writeField(page, dpiField(page), "150");
    await expect(page.getByText(/1350 × 900 px/)).toBeVisible();

    const download = await saveByKeyboard(page, saveButton(page));
    expect(download.suggestedFilename()).toBe("Coastline.png");
    const png = await downloadBytes(download);

    // The picture draws in the Map's own dark ink over pale paper, so the box
    // around the page's centre is where it shows. An SVG drawn as an image
    // loads no external subresource, `blob:` included, so a raster that swapped
    // in the wrong URL leaves the centre as bare as a corner.
    const [centre, corner] = await countInkPixels(page, png.toString("base64"), [
      { x: 0.5, y: 0.5, width: 0.05 },
      { x: 0.05, y: 0.05, width: 0.05 },
    ]);
    expect(centre).toBeGreaterThan(100);
    expect(corner).toBe(0);
  });
});
