import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

// Row controls versus the row action. A real instance was fixed in the Notes
// list (a row's own Edit, Duplicate and Delete buttons act on Enter and never
// open the Note); this spec covers the other lists whose rows carry buttons.
// Only a real browser shows this: React Aria turns an Enter or Space that
// bubbles out of a row's button into the row's action, which jsdom does not.
// Every check reaches the first row by Tab, Tabs to each visible button in it,
// presses Enter or Space, and asserts the row action did not run. Whatever the
// button opened is undone with Escape (or its inline Cancel/No) before the
// next button. A button that only changes state (pin toggles) stays toggled.

test.describe("Home Books gallery row controls @wf:books-navigate-collection", () => {
  test.use({ library: "bookShelf" });

  const booksGrid = (page: Page) => page.getByRole("grid", { name: "Books" });
  const firstCard = (page: Page) => booksGrid(page).getByRole("row").first();
  const statusButton = (page: Page) =>
    firstCard(page).getByRole("button", { name: /Change status of/ });
  const statusList = (page: Page) => page.getByRole("listbox", { name: /Change status of/ });

  async function openGallery(page: Page) {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await expect(firstCard(page)).toBeVisible();
    await tabTo(page, firstCard(page), { max: 40 });
    await expect(firstCard(page)).toBeFocused();
  }

  test("Enter on the status button opens the status list, never the Book", async ({ page }) => {
    await openGallery(page);
    await tabTo(page, statusButton(page), { max: 6 });
    await expect(statusButton(page)).toBeFocused();

    await page.keyboard.press("Enter");

    // The button's own action ran ...
    await expect(statusList(page)).toBeVisible();
    // ... while the row action (navigating to /book/<id>) did not.
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press("Escape");
    await expect(statusList(page)).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test("Space on the status button opens the status list, never the Book", async ({ page }) => {
    await openGallery(page);
    await tabTo(page, statusButton(page), { max: 6 });
    await expect(statusButton(page)).toBeFocused();

    await page.keyboard.press("Space");

    await expect(statusList(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press("Escape");
    await expect(statusList(page)).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("Canvas Gallery row controls @wf:canvas-gallery", () => {
  test.use({ library: "canvasWithNodes" });

  const galleryGrid = (page: Page) => page.getByRole("grid", { name: "Canvases" });
  const firstCard = (page: Page) => galleryGrid(page).getByRole("row").first();
  // The card's title button opens the Canvas, which IS the row action, so the
  // checks below target only the three action buttons (Pin, Rename, Delete).
  const actionButton = (page: Page, name: string | RegExp) =>
    firstCard(page).getByRole("button", { name });

  async function openGallery(page: Page) {
    await page.goto("/canvas");
    await expect(page.getByRole("heading", { name: "Canvas", level: 1 })).toBeVisible();
    await expect(firstCard(page)).toBeVisible();
    await tabTo(page, firstCard(page), { max: 40 });
    await expect(firstCard(page)).toBeFocused();
  }

  async function focusAction(page: Page, name: string | RegExp) {
    await tabTo(page, firstCard(page), { max: 60 });
    await tabTo(page, actionButton(page, name), { max: 10 });
    await expect(actionButton(page, name)).toBeFocused();
  }

  async function expectStillInGallery(page: Page) {
    await expect(page).toHaveURL(/\/canvas$/);
  }

  test("Enter on Pin, Rename and Delete never opens the Canvas", async ({ page }) => {
    await openGallery(page);

    // Rename opens its inline input instead of navigating.
    await focusAction(page, "Rename canvas");
    await page.keyboard.press("Enter");
    await expect(firstCard(page).getByRole("textbox")).toBeFocused();
    await expectStillInGallery(page);
    await page.keyboard.press("Escape");
    await expect(firstCard(page).getByRole("textbox")).toHaveCount(0);

    // Pin toggles the pinned state instead of navigating.
    await focusAction(page, /Pin canvas|Unpin canvas/);
    await page.keyboard.press("Enter");
    await expectStillInGallery(page);

    // Delete asks inline instead of navigating. Its confirm button would
    // remove the row, so it is never pressed; Cancel closes the confirm.
    await focusAction(page, "Delete canvas");
    await page.keyboard.press("Enter");
    const cancel = firstCard(page).getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeVisible();
    await expectStillInGallery(page);
    await tabTo(page, cancel, { max: 10 });
    await page.keyboard.press("Enter");
    await expect(firstCard(page)).toBeVisible();
    await expectStillInGallery(page);
  });

  test("Space on Pin, Rename and Delete never opens the Canvas", async ({ page }) => {
    await openGallery(page);

    await focusAction(page, "Rename canvas");
    await page.keyboard.press("Space");
    await expect(firstCard(page).getByRole("textbox")).toBeFocused();
    await expectStillInGallery(page);
    await page.keyboard.press("Escape");
    await expect(firstCard(page).getByRole("textbox")).toHaveCount(0);

    await focusAction(page, /Pin canvas|Unpin canvas/);
    await page.keyboard.press("Space");
    await expectStillInGallery(page);

    await focusAction(page, "Delete canvas");
    await page.keyboard.press("Space");
    const cancel = firstCard(page).getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeVisible();
    await expectStillInGallery(page);
    await tabTo(page, cancel, { max: 10 });
    await page.keyboard.press("Enter");
    await expect(firstCard(page)).toBeVisible();
    await expectStillInGallery(page);
  });
});

test.describe("Chapter list row controls @wf:chapters-navigate", () => {
  test.use({ library: "oneBookThreeChapters" });

  const LAMP = SEED_CHAPTERS[1].title;
  const STORM = SEED_CHAPTERS[2].title;
  const grid = (page: Page) => page.getByRole("grid", { name: "Chapters" });
  const row = (page: Page, title: string) => grid(page).getByRole("row", { name: title });
  const rowButton = (page: Page, title: string, name: string) =>
    row(page, title).getByRole("button", { name, exact: true });
  const openChapterText = (page: Page) => page.getByRole("textbox", { name: `Text of ${STORM}` });

  // Opens the seeded Book from the Gallery by keyboard and leaves focus in
  // the Chapter list. The seed opens its last Chapter (Storm); the checks
  // press buttons on the neighbouring row (The Lamp).
  async function openBookAtChapters(page: Page) {
    await page.goto("/");
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
    await expect(card).toHaveCount(1);
    await tabTo(page, card, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
    await expect(openChapterText(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(grid(page)).toBeVisible();
  }

  async function focusLamp(page: Page) {
    await tabTo(page, grid(page).getByRole("row", { selected: true }), { max: 40 });
    await pressUntilFocused(page, "ArrowUp", row(page, LAMP));
    await expect(row(page, LAMP)).toBeFocused();
  }

  // The row action selects the row's Chapter, so Storm staying open proves the
  // row action did not run.
  async function expectStormStillOpen(page: Page) {
    await expect(openChapterText(page)).toBeVisible();
    await expect(grid(page).getByRole("row", { selected: true })).toHaveAccessibleName(STORM);
  }

  test("Enter on Reorder, Edit and Delete never selects the Chapter", async ({ page }) => {
    await openBookAtChapters(page);
    await focusLamp(page);

    // Reorder starts its keyboard drag instead of selecting.
    await tabTo(page, rowButton(page, LAMP, "Reorder"), { max: 8 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Insert between/ }).first()).toBeVisible();
    await expectStormStillOpen(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Insert between/ })).toHaveCount(0);

    // Edit opens its inline rename instead of selecting.
    await tabTo(page, rowButton(page, LAMP, "Edit Chapter"), { max: 8 });
    await page.keyboard.press("Enter");
    await expect(row(page, LAMP).getByRole("textbox")).toBeFocused();
    await expectStormStillOpen(page);
    await page.keyboard.press("Escape");
    await expect(row(page, LAMP)).toBeFocused();

    // Delete asks inline instead of selecting. Its Yes button would remove
    // the row, so it is never pressed; No closes the confirm.
    await tabTo(page, rowButton(page, LAMP, "Delete Chapter"), { max: 8 });
    await page.keyboard.press("Enter");
    const no = page.getByRole("button", { name: "No", exact: true });
    await expect(no).toBeFocused();
    await expectStormStillOpen(page);
    await page.keyboard.press("Enter");
    await expect(row(page, LAMP)).toBeVisible();
    await expectStormStillOpen(page);
    await expect(page).toHaveURL(/\/book\//);
  });

  test("Space on Reorder, Edit and Delete never selects the Chapter", async ({ page }) => {
    await openBookAtChapters(page);
    await focusLamp(page);

    // Space may or may not lift the row for a drag; either way the selection
    // must not move, and Escape leaves no drop target behind.
    await tabTo(page, rowButton(page, LAMP, "Reorder"), { max: 8 });
    await page.keyboard.press("Space");
    await expectStormStillOpen(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Insert between/ })).toHaveCount(0);
    await expectStormStillOpen(page);

    await tabTo(page, rowButton(page, LAMP, "Edit Chapter"), { max: 8 });
    await page.keyboard.press("Space");
    await expect(row(page, LAMP).getByRole("textbox")).toBeFocused();
    await expectStormStillOpen(page);
    await page.keyboard.press("Escape");
    await expect(row(page, LAMP)).toBeFocused();

    await tabTo(page, rowButton(page, LAMP, "Delete Chapter"), { max: 8 });
    await page.keyboard.press("Space");
    const no = page.getByRole("button", { name: "No", exact: true });
    await expect(no).toBeFocused();
    await expectStormStillOpen(page);
    await page.keyboard.press("Space");
    await expect(row(page, LAMP)).toBeVisible();
    await expectStormStillOpen(page);
    await expect(page).toHaveURL(/\/book\//);
  });
});
