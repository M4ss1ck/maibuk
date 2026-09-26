// The Cover Designer (issue #211): opening it from the Book Editor, Cover
// Templates, Cover Size Presets, the Background, the layout-aid toggles, and
// Export — all by keyboard alone, over the seeded `oneBookThreeChapters`
// Library. Content is asserted through the Layers panel and the exported
// files' headers and dimensions, never pixel screenshots.

import { readFile } from "node:fs/promises";
import type { Download, Locator, Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { DOT_PNG, IMAGE_FIXTURE_DIR } from "../support/fixtures/images";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const designCover = (page: Page) => page.getByRole("button", { name: "Design Cover", exact: true });
const back = (page: Page) => page.getByRole("button", { name: "Back", exact: true });
const preset = (page: Page) => page.getByRole("button", { name: /^6" x 9"$|^A5$/ });
const templates = (page: Page) => page.getByRole("button", { name: "Templates", exact: true });
const exportTrigger = (page: Page) => page.getByRole("button", { name: "Export", exact: true });

async function openBookEditor(page: Page) {
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toBeFocused();
}

/** Opens the Cover Designer the way an author does: from the Book Editor. */
async function openCover(page: Page) {
  await openBookEditor(page);
  // Tab is trapped inside the editor, so Escape first hands focus to the
  // Chapter list pane, the last stop before the header controls.
  await page.keyboard.press("Escape");
  await tabTo(page, designCover(page), { max: 40 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/book\/[\w-]+\/cover$/);
  await expect(page.getByRole("heading", { name: "Cover Designer", level: 1 })).toBeVisible();
}

/**
 * Tabs to a toolbar menu trigger and opens it. React Aria labels the menu from
 * the trigger, so the open menu is found by role alone.
 */
async function openMenu(page: Page, trigger: Locator, max = 60) {
  await tabTo(page, trigger, { max });
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Moves inside an open menu to an item and picks it. */
async function pickMenuItem(page: Page, name: string | RegExp, max = 10) {
  const item = page.getByRole("menuitem", { name });
  await pressUntilFocused(page, "ArrowDown", item, { max });
  await page.keyboard.press("Enter");
}

/** Saves through the registered Cover shortcut. */
async function saveCover(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
}

/** Opens the Export menu, picks a format, and captures the download. */
async function exportCover(page: Page, itemName: string): Promise<Download> {
  await openMenu(page, exportTrigger(page));
  const item = page.getByRole("menuitem", { name: itemName, exact: true });
  await pressUntilFocused(page, "ArrowDown", item, { max: 4 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

function pngSize(bytes: Buffer) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer) {
  let i = 2;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw new Error("JPEG has no start-of-frame marker");
}

test.describe("opening the Cover Designer @wf:cover-open", () => {
  test("Design Cover opens it by keyboard and hands focus to Back and the toolbar", async ({
    page,
  }) => {
    await openCover(page);
    await expect(page.getByText(SEED_BOOK.title, { exact: true }).first()).toBeVisible();

    // The route leaves focus on the body; the first Tab stop is the Back
    // control, and the toolbar's menus follow it.
    await tabTo(page, back(page), { max: 5 });
    await expect(back(page)).toBeFocused();
    await tabTo(page, templates(page), { max: 5 });
    await expect(templates(page)).toBeFocused();
    await expect(page.getByRole("button", { name: '6" x 9"', exact: true })).toBeVisible();
  });
});

test.describe("Cover Templates @wf:cover-templates", () => {
  test("the Templates menu moves with arrows; Enter applies it and Mod+S keeps it", async ({
    page,
  }) => {
    await openCover(page);
    const menu = await openMenu(page, templates(page));
    await expect(menu.getByRole("menuitem", { name: "Classic Centered" })).toBeFocused();

    await pickMenuItem(page, "Minimal Line");

    // The Minimal Line template adds a line shape the fresh Cover lacks, and
    // keeps the Book's title and author as text layers.
    await expect(page.getByRole("button", { name: "line", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: SEED_BOOK.title, exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: SEED_BOOK.authorName, exact: true })
    ).toBeVisible();

    await saveCover(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "line", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: SEED_BOOK.title, exact: true })).toBeVisible();
  });
});

test.describe("Cover Size Presets @wf:cover-size-preset", () => {
  test("a preset updates the size and survives a save and reload", async ({ page }) => {
    await openCover(page);
    await openMenu(page, preset(page));
    await pickMenuItem(page, /^A5/, 8);
    await expect(page.getByRole("button", { name: "A5", exact: true })).toBeVisible();

    await saveCover(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "A5", exact: true })).toBeVisible();

    // The stored Cover Size Preset is the real document size: the export is
    // rendered at that size.
    const png = await exportCover(page, "Export as PNG");
    const bytes = await readFile((await png.path()) as string);
    expect(pngSize(bytes)).toEqual({ width: 1748, height: 2480 });
  });
});

test.describe("Cover background @wf:cover-background", () => {
  test("a background colour is set, saved, and reloaded", async ({ page }) => {
    await openCover(page);
    // Escape deselects the seeded title layer, revealing the Background panel.
    await page.keyboard.press("Escape");
    await expect(page.getByText("Background", { exact: true })).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "#e94560", exact: true }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Color")).toHaveValue("#e94560");

    await saveCover(page);
    await page.reload();
    await expect(page.getByLabel("Color")).toHaveValue("#e94560");
  });

  test("a background image is added through the file chooser and removed again", async ({
    page,
  }) => {
    await openCover(page);
    await page.keyboard.press("Escape");

    const upload = page.getByRole("button", { name: "Background Image", exact: true });
    await tabTo(page, upload, { max: 60 });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(`${IMAGE_FIXTURE_DIR}/${DOT_PNG}`);

    const remove = page.getByRole("button", { name: "Remove Background Image" });
    await expect(remove).toBeVisible();
    // Image fit and opacity replace the colour controls.
    await expect(page.getByRole("button", { name: "Cover", exact: true })).toBeVisible();
    const opacity = page.getByRole("slider", { name: "Opacity" });
    await expect(opacity).toBeVisible();

    await tabTo(page, opacity, { max: 20, backwards: true });
    await page.keyboard.press("ArrowLeft");
    await expect(opacity).not.toHaveValue("1");

    await saveCover(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "Remove Background Image" })).toBeVisible();

    const removeAfter = page.getByRole("button", { name: "Remove Background Image" });
    await tabTo(page, removeAfter, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove Background Image" })).toBeHidden();
    await expect(page.getByLabel("Color")).toBeVisible();
  });
});

test.describe("Cover layout aids @wf:cover-overlays-snapping", () => {
  test("the margin-guide and snapping toggles flip their pressed state", async ({ page }) => {
    await openCover(page);
    const overlays = page.getByRole("button", { name: "Toggle margin guides" });
    const snapping = page.getByRole("button", { name: "Toggle snapping" });
    await expect(overlays).toHaveAttribute("aria-pressed", "true");
    await expect(snapping).toHaveAttribute("aria-pressed", "true");

    await tabTo(page, overlays, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(overlays).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect(overlays).toHaveAttribute("aria-pressed", "true");

    await tabTo(page, snapping, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(snapping).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("Cover export @wf:cover-export", () => {
  test("PNG, JPG, and PDF downloads carry the Cover at the document size", async ({ page }) => {
    await openCover(page);

    const png = await exportCover(page, "Export as PNG");
    expect(png.suggestedFilename()).toBe(`${SEED_BOOK.title}.png`);
    const pngBytes = await readFile((await png.path()) as string);
    expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(pngSize(pngBytes)).toEqual({ width: 1800, height: 2700 });

    const jpg = await exportCover(page, "Export as JPG");
    expect(jpg.suggestedFilename()).toBe(`${SEED_BOOK.title}.jpg`);
    const jpgBytes = await readFile((await jpg.path()) as string);
    expect(jpgBytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(jpegSize(jpgBytes)).toEqual({ width: 1800, height: 2700 });

    const pdf = await exportCover(page, "Export as PDF (print)");
    expect(pdf.suggestedFilename()).toBe(`${SEED_BOOK.title}.pdf`);
    const pdfBytes = await readFile((await pdf.path()) as string);
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    const document = await PDFDocument.load(pdfBytes);
    expect(document.getPageCount()).toBe(1);
    const { width, height } = document.getPage(0).getSize();
    expect(Math.round(width)).toBe(432);
    expect(Math.round(height)).toBe(648);
  });
});
