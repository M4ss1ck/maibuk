// The Maps editor's Export (#753): a Map leaves the Plugin as a picture. "Place
// in a Chapter or Note…" copies it into the Chapter or Note the author picks, as
// one image at 2,000 px on its long side, and opens that Chapter with the
// picture in its editor; the Export panel saves the same Map as a PNG drawn at a
// chosen print width and DPI by the Frame (the only document of the pair with a
// canvas), or as an SVG that carries the page's print size, an `@font-face` for
// every face the picture asks for, and none of the editor's own marks.
//
// The sizes below are literals, the way `plugins-maps-styles.spec.ts` mirrors
// the Map Styles: a spec drives the app through its UI and asserts what the
// browser holds, so it imports no app or Plugin code. A portrait page is 6 x 9
// in, so 150 DPI prints it at 900 x 1350 px, and a placed Map is 2,000 px on its
// long side: 1,333 x 2,000.
//
// The web Plugin File Saver opens the browser's Save dialog, which no
// keyboard-driven run can answer, so `support/save-picker.ts` removes the picker
// and the app takes its own documented download fallback; the spec then reads
// the file the browser downloaded.
//
// Tagged @sandbox because Maps runs in the Plugin sandbox: the lane runs it on
// Chromium, WebKit, and Firefox.

import { readFile } from "node:fs/promises";
import type { Download, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { forceDownloadSaves } from "../support/save-picker";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";
import { openLayers } from "../support/maps-layers";

/** The Map every test builds: a portrait page of the seed Book. */
const MAP = "Coastline";
/** The label the exports draw, so the SVG has a curved textPath to carry. */
const LABEL_TEXT = "Cape Wrath";

/** A portrait page (6 x 9 in) printed at 150 DPI: 6 x 150 by 9 x 150. */
const PRINTED_AT_150_DPI = { widthPx: 900, heightPx: 1350 };

/** A placed Map: 2,000 px on the long side, the short side by the page's aspect. */
const PLACED = { widthPx: Math.round((2000 * 152.4) / 228.6), heightPx: 2000 };

/** The PNG's fixed opening: the eight bytes every PNG file starts with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** The Map cards, by their preview's alt text (the Map's name). */
const mapNames = (page: Page) => page.getByRole("list").getByRole("img");

/** The Map editor's embedded Frame and its drawing surface. */
const mapFrame = (page: Page) => page.frameLocator('[data-plugin-frame="embedded"] iframe');
const surface = (page: Page) => mapFrame(page).locator("svg");

/** The Elements list and one row in it. */
const elementRow = (page: Page, name: string) =>
  page.getByRole("listbox", { name: "Elements" }).getByRole("option", {
    name: new RegExp(`^${name}`),
  });

/** The Insert tool's Place button, the keyboard's way to a label. */
const placeLabelButton = (page: Page) => page.getByRole("button", { name: "Place Map Label" });

/** The properties panel's fields the exports depend on. */
const textField = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const bendField = (page: Page) => page.getByRole("textbox", { name: "Bend (mm)", exact: true });

/** The top-right pill's Place button and Export popover (#778). */
const placeButton = (page: Page) =>
  page.getByRole("button", { name: /^Place in a Chapter or Note/ });
const exportTrigger = (page: Page) => page.getByRole("button", { name: "Export", exact: true });
const dpiField = (page: Page) => page.getByRole("textbox", { name: "DPI", exact: true });
const saveButton = (page: Page) => page.getByRole("button", { name: /^Save/ });

/** Opens the Export popover, which holds the format, the print fields, and Save. */
async function openExportPanel(page: Page): Promise<void> {
  await tabTo(page, exportTrigger(page), { max: 90 });
  await page.keyboard.press("Enter");
  await expect(saveButton(page)).toBeVisible();
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

/** Opens a host select by keyboard and picks `option` with the arrows. */
async function pick(page: Page, trigger: Locator, option: string): Promise<void> {
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox").last();
  await expect(listbox).toBeVisible();
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", listbox.getByRole("option", { name: option }), {
    max: 30,
  });
  await page.keyboard.press("Enter");
}

/**
 * Creates the Map every test exports from the New Map dialog by keyboard: named,
 * filed under the seed Book so its Chapters are Place targets, and a portrait
 * page, whose 6 x 9 in is what the printed sizes below are read from.
 */
async function createMap(page: Page): Promise<void> {
  await tabTo(page, page.getByRole("button", { name: "New Map" }), { max: 60 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New Map" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type(MAP);
  await pick(page, dialog.getByRole("button", { name: /Book$/ }), SEED_BOOK.title);
  await tabTo(page, dialog.getByRole("radio", { name: "Landscape page" }), { max: 20 });
  await pressUntilFocused(page, "ArrowLeft", dialog.getByRole("radio", { name: "Portrait page" }));
  await expect(dialog.getByRole("radio", { name: "Portrait page" })).toBeChecked();
  await tabTo(page, dialog.getByRole("button", { name: "Create" }), { max: 20 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(mapNames(page).first()).toHaveAccessibleName(MAP);
}

/** Opens the Map in its editor, where every test below starts. */
async function openEditorWithMap(page: Page): Promise<void> {
  await page.goto("/");
  await openMaps(page);
  await createMap(page);
  await tabTo(page, page.getByRole("button", { name: new RegExp(`^${MAP}\\b`) }), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/map$/);
  await expect(surface(page)).toBeVisible();
  await openLayers(page);
}

/** Places a Map Label at the view centre: the Insert tool's key, then its button. */
async function placeLabel(page: Page): Promise<void> {
  await page.keyboard.press("i");
  await expect(page.getByRole("button", { name: "Insert", exact: true, pressed: true }));
  // The scene round-trip is what proves the Frame is listening before a press.
  await expect(mapFrame(page).locator('svg[data-tool="insert"]')).toBeVisible();
  await tabTo(page, placeLabelButton(page), { max: 60 });
  await page.keyboard.press("Enter");
  await expect(elementRow(page, "Map Label 1")).toBeVisible();
}

/** Writes one field: focus it, select all, type the value, Enter to commit. */
async function writeField(page: Page, field: Locator, value: string): Promise<void> {
  await tabTo(page, field, { max: 120 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue(value);
}

/**
 * Names the label and bows its baseline, so the exports draw a curved name: the
 * SVG's textPath assertion has a curve to follow, and the PNG has ink to draw.
 */
async function curveLabel(page: Page): Promise<void> {
  await placeLabel(page);
  await writeField(page, textField(page), LABEL_TEXT);
  await writeField(page, bendField(page), "6");
}

/** Presses Enter on the focused control and returns the file the browser downloaded. */
async function enterForDownload(page: Page): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

/** Tabs to `button`, then presses it, returning the file the browser downloaded. */
async function saveByKeyboard(page: Page, button: Locator): Promise<Download> {
  await tabTo(page, button, { max: 90 });
  return enterForDownload(page);
}

/** The bytes the browser kept for one download. */
async function downloadBytes(download: Download): Promise<Uint8Array> {
  const path = await download.path();
  if (path === null) throw new Error("the browser kept no file for the download");
  return new Uint8Array(await readFile(path));
}

/**
 * The pixel size a PNG declares, read from its own header: the 8-byte signature,
 * then the IHDR chunk every PNG writes first, whose two big-endian 32-bit fields
 * are the width and the height. A file that is not a PNG fails here rather than
 * reporting a size that was never encoded.
 */
function pngSize(bytes: Uint8Array): { widthPx: number; heightPx: number } {
  const file = Buffer.from(bytes);
  expect(file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true);
  expect(file.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { widthPx: file.readUInt32BE(16), heightPx: file.readUInt32BE(20) };
}

/** The base64 payload of a `data:` URI, as bytes. */
function dataUriBytes(uri: string): Buffer {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(uri);
  if (match === null) throw new Error(`not a data URI: ${uri.slice(0, 60)}`);
  return Buffer.from(match[2], "base64");
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

test.describe("Maps export: Place a Map in a Chapter @wf:plugins-maps-place @sc:plugin.maibuk-maps.insertTool @sandbox", () => {
  test("Place in a Chapter opens it with the Map's picture in its editor", async ({ page }) => {
    await forceDownloadSaves(page);
    await openEditorWithMap(page);
    await curveLabel(page);

    // The Place dialog lists the Map's Book's Chapters and Notes, offers the
    // Map's own name as the alt text, and takes focus into itself.
    await tabTo(page, placeButton(page), { max: 90 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Place Map" });
    await expect(dialog).toBeVisible();
    await pick(page, dialog.getByRole("button", { name: /Chapter or Note$/ }), "Arrival");
    const altText = dialog.getByRole("textbox", { name: "Alt text" });
    await expect(altText).toHaveValue(MAP);
    await expect(dialog.getByRole("button", { name: "Place", exact: true })).toBeEnabled();
    await capture(page, "maps-export-place-dialog", { around: [dialog] });

    await tabTo(page, dialog.getByRole("button", { name: "Place", exact: true }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    // It opens the Chapter it placed into, and the picture is in its text.
    await expect(page.getByRole("textbox", { name: "Text of Arrival" })).toBeVisible();
    await expect(page).toHaveURL(/\/book\/[^/]+$/);
    const figure = page
      .getByRole("textbox", { name: "Text of Arrival" })
      .locator("figure[data-image]");
    await expect(figure).toHaveCount(1);
    const image = figure.locator("img");
    await expect(image).toHaveAttribute("alt", MAP);
    // One image, carried in the document itself rather than by a URL.
    await expect(image).toHaveAttribute("src", /^data:image\//);
    // It decoded at the placed size: 2,000 px on the long side, the short side
    // by the page's own 6 x 9 in aspect.
    await expect(image).toHaveJSProperty("naturalWidth", PLACED.widthPx);
    await expect(image).toHaveJSProperty("naturalHeight", PLACED.heightPx);
    await capture(page, "maps-export-placed", { around: [figure] });
  });

  test("Escape closes the Place dialog and returns focus to its button", async ({ page }) => {
    await forceDownloadSaves(page);
    await openEditorWithMap(page);
    await curveLabel(page);

    const trigger = placeButton(page);
    await tabTo(page, trigger, { max: 90 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Place Map" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Alt text" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // Nothing was placed: the Map is still the page on screen.
    await expect(surface(page)).toBeVisible();
  });
});

test.describe("Maps export: save a Map as PNG or SVG @wf:plugins-maps-export @sc:plugin.maibuk-maps.insertTool @sandbox", () => {
  test("Save downloads a PNG drawn at the print width and DPI the author picks", async ({
    page,
  }) => {
    await forceDownloadSaves(page);
    await openEditorWithMap(page);
    await curveLabel(page);
    await openExportPanel(page);

    // A portrait page starts at its own 6 in wide and 300 DPI.
    await expect(page.getByText(/1800 × 2700 px/)).toBeVisible();
    await writeField(page, dpiField(page), "150");
    // The panel says what the file will be before it is saved.
    await expect(page.getByText(/900 × 1350 px/)).toBeVisible();

    // Tabbing to Save brings the whole Export panel into view, where it is
    // worth the before/after picture.
    await tabTo(page, saveButton(page), { max: 90 });
    await capture(page, "maps-export-panel", { around: [placeButton(page), saveButton(page)] });
    const download = await enterForDownload(page);
    expect(download.suggestedFilename()).toBe(`${MAP}.png`);
    const bytes = await downloadBytes(download);

    // A real PNG, whose own header declares the printed size: 6 x 9 in at 150 DPI.
    expect(pngSize(bytes)).toEqual(PRINTED_AT_150_DPI);
  });

  test("Save downloads an SVG that draws the curved label in its embedded face, with no editor marks", async ({
    page,
  }) => {
    await forceDownloadSaves(page);
    await openEditorWithMap(page);
    await curveLabel(page);
    await openExportPanel(page);

    // The SVG radio is the other format of the same group; the print fields go
    // away with it, since an SVG is sized in millimetres.
    await expect(page.getByRole("radio", { name: "PNG", exact: true }));
    await tabTo(page, page.getByRole("radio", { name: "PNG", exact: true }), { max: 90 });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "SVG", exact: true }));
    await expect(dpiField(page)).toHaveCount(0);
    await capture(page, "maps-export-svg", { around: [placeButton(page), saveButton(page)] });

    const download = await saveByKeyboard(page, saveButton(page));
    expect(download.suggestedFilename()).toBe(`${MAP}.svg`);
    const bytes = await downloadBytes(download);
    const svg = new TextDecoder().decode(bytes);

    // The page keeps its print size, so a renderer draws it at 6 x 9 in.
    expect(svg).toMatch(/<svg\b[^>]*\bwidth="152\.4mm"/);
    expect(svg).toMatch(/<svg\b[^>]*\bheight="228\.6mm"/);
    // The curved label travels as the textPath the Frame drew.
    expect(svg).toContain("<textPath");
    expect(svg).toContain(LABEL_TEXT);

    // The face the label asks for travels inside the file as one @font-face
    // whose bytes are a real TrueType font, so a renderer without the app draws
    // the same letterforms.
    const face = /@font-face\{font-family:"IM Fell English";src:url\((data:[^)]+)\)\}/.exec(svg);
    expect(face).not.toBeNull();
    const font = dataUriBytes(face?.[1] ?? "");
    expect(font.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x01, 0x00, 0x00]));

    // None of the editor's own marks travel with it.
    expect(svg).not.toContain("data-element-id");
    expect(svg).not.toContain("data-selected");
  });
});
