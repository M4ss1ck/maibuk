// The Book title bar's width tiers: from 1152px Export, Design Cover, and Book
// Settings show a two-line label beside their icon and drop the tooltip; below
// that they are icon-only with a tooltip; below the `@4xl` container width they
// live in the More menu, which sizes to its widest row. All by keyboard, over
// the seeded `oneBookThreeChapters` Library.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

const titleBar = (page: Page) =>
  page.getByRole("banner", { name: /^(Book title bar|Barra de título del libro)$/ });
const button = (page: Page, name: string) =>
  titleBar(page).getByRole("button", { name, exact: true });

async function openBookEditor(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/");
  const card = page.getByRole("grid").getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: /^(Text of|Texto de) / })).toBeFocused();
  // Escape hands focus to the Chapter list; the title bar sits above it, so
  // Shift+Tab walks back into the header controls.
  await page.keyboard.press("Escape");
}

/** The two label lines, top to bottom, that a labelled action draws. */
async function expectTwoLines(action: Locator, first: string, second: string) {
  const top = action.getByText(first, { exact: true });
  const bottom = action.getByText(second, { exact: true });
  await expect(top).toBeVisible();
  await expect(bottom).toBeVisible();
  const [a, b] = [await top.boundingBox(), await bottom.boundingBox()];
  expect(b?.y ?? 0).toBeGreaterThan((a?.y ?? 0) + (a?.height ?? 0) - 1);
}

test.describe("Book title bar labels @wf:book-title-bar", () => {
  test("a wide bar labels its actions on two lines, without tooltips, and Enter still acts", async ({
    page,
  }) => {
    await openBookEditor(page, 1440);
    const settings = button(page, "Book Settings");
    await expectTwoLines(button(page, "Export Book"), "Export", "Book");
    await expectTwoLines(button(page, "Design Cover"), "Design", "Cover");
    await expectTwoLines(settings, "Book", "Settings");

    await tabTo(page, settings, { max: 30, backwards: true });
    // Tooltips of controls Shift+Tab passed may still be fading out.
    await expect(page.getByRole("tooltip").filter({ hasText: "Book Settings" })).toHaveCount(0);
    await capture(page, "book-title-bar-labels-en", { around: [titleBar(page)] });

    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Book Settings" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(settings).toBeFocused();
  });

  test("Spanish labels split at the balanced space", async ({ page }) => {
    await seedSettings(page, { language: "es" });
    await openBookEditor(page, 1440);
    await expectTwoLines(button(page, "Exportar Libro"), "Exportar", "Libro");
    await expectTwoLines(button(page, "Diseñar Portada"), "Diseñar", "Portada");
    await expectTwoLines(button(page, "Configuración del Libro"), "Configuración", "del Libro");
    await capture(page, "book-title-bar-labels-es", { around: [titleBar(page)] });
  });

  test("a mid-width bar is icon-only and the tooltip names the action", async ({ page }) => {
    await openBookEditor(page, 1100);
    const exportBook = button(page, "Export Book");
    await expect(exportBook.getByText("Export", { exact: true })).toHaveCount(0);

    await tabTo(page, exportBook, { max: 30, backwards: true });
    await expect(page.getByRole("tooltip").filter({ hasText: "Export Book" })).toBeVisible();
    await capture(page, "book-title-bar-icons", { around: [titleBar(page)] });
  });

  test("a narrow bar keeps the actions in a More menu that fits its rows", async ({ page }) => {
    await seedSettings(page, { language: "es" });
    await openBookEditor(page, 900);
    const more = button(page, "Más");
    await tabTo(page, more, { max: 30, backwards: true });
    await page.keyboard.press("Enter");

    const settings = page.getByRole("button", { name: "Configuración del Libro", exact: true });
    const exportBook = page.getByRole("button", { name: "Exportar Libro", exact: true });
    await expect(settings).toBeVisible();
    // The menu grows to its widest row: no row wraps onto a second line.
    const [one, long] = [await exportBook.boundingBox(), await settings.boundingBox()];
    // A wrapped row would be a whole line (20px) taller; the open animation
    // can leave a fraction of a pixel between rows.
    expect(Math.abs((long?.height ?? 0) - (one?.height ?? 0))).toBeLessThan(4);
    await capture(page, "book-title-bar-more-es", { around: [titleBar(page), settings] });

    await tabTo(page, settings, { max: 10 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Configuración del Libro" })).toBeVisible();
  });
});
