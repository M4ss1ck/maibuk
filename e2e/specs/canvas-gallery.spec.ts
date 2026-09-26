import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// Canvas Gallery (issue #210): create, open, rename, pin, delete and search
// Canvases by keyboard alone, over the seeded `canvasWithNodes` Library (Map,
// Ideas, Broken map). The gallery is a React Aria GridList: Tab enters it,
// arrows move between cards, Enter opens the focused card.

test.use({ library: "canvasWithNodes" });

const grid = (page: Page) => page.getByRole("grid", { name: "Canvases" });
const rows = (page: Page) => grid(page).getByRole("row");

/**
 * Enters the gallery and moves focus to a named card. On a fresh page the
 * GridList's single Tab stop is the first card; Home and the arrow keys move
 * from there.
 */
async function focusCard(page: Page, name: RegExp) {
  await tabTo(page, grid(page).getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  const row = grid(page).getByRole("row", { name });
  await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
  await expect(row).toBeFocused();
}

test.describe("opening a Canvas @wf:canvas-gallery", () => {
  test("Tab enters the gallery, arrows move between cards, and Enter opens the focused one", async ({
    page,
  }) => {
    await page.goto("/canvas");
    await expect(page.getByRole("heading", { name: "Canvas", level: 1 })).toBeVisible();
    await expect(page.getByText("3 canvases", { exact: true })).toBeVisible();

    await tabTo(page, rows(page).first(), { max: 40 });
    await expect(rows(page).first()).toBeFocused();
    await expect(rows(page).first()).toContainText("Map");

    await page.keyboard.press("ArrowRight");
    await expect(rows(page).nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(rows(page).first()).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
    await expect(page.getByRole("textbox", { name: "Rename canvas" })).toHaveValue("Map");
  });
});

test.describe("card actions @wf:canvas-gallery", () => {
  test("Rename canvas opens an inline input that saves with Enter", async ({ page }) => {
    await page.goto("/canvas");
    await tabTo(page, rows(page).first(), { max: 40 });

    const rename = rows(page).first().getByRole("button", { name: "Rename canvas" });
    await tabTo(page, rename, { max: 6 });
    await page.keyboard.press("Enter");

    const input = rows(page).first().getByRole("textbox");
    await expect(input).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Chart");
    await page.keyboard.press("Enter");

    await expect(grid(page).getByRole("row", { name: /Chart/ })).toHaveCount(1);
    await page.reload();
    await expect(grid(page).getByRole("row", { name: /Chart/ })).toHaveCount(1);
  });

  test("Pin canvas moves the card to the front and survives a reload", async ({ page }) => {
    await page.goto("/canvas");
    const broken = rows(page).nth(2);
    await tabTo(page, rows(page).first(), { max: 40 });
    await page.keyboard.press("End");
    await expect(broken).toBeFocused();
    await expect(broken).toContainText("Broken map");

    await tabTo(page, broken.getByRole("button", { name: "Pin canvas" }), { max: 6 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Unpin canvas" })).toHaveCount(1);

    await page.reload();
    await tabTo(page, rows(page).first(), { max: 40 });
    await expect(rows(page).first()).toContainText("Broken map");
  });

  test("Delete canvas asks to confirm, and Cancel keeps the card", async ({ page }) => {
    await page.goto("/canvas");
    const ideas = grid(page).getByRole("row", { name: /Ideas/ });
    await focusCard(page, /Ideas/);

    await tabTo(page, ideas.getByRole("button", { name: "Delete canvas" }), { max: 6 });
    await page.keyboard.press("Enter");
    await expect(ideas).toContainText("Delete this canvas? This cannot be undone.");

    // The card now holds its confirm buttons; the grid still remembers Ideas as
    // its Tab stop, so Tab re-enters it on that row.
    await tabTo(page, ideas, { max: 60 });
    await tabTo(page, ideas.getByRole("button", { name: "Cancel", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");
    await expect(grid(page).getByRole("row", { name: /Ideas/ })).toHaveCount(1);
  });

  test("Delete canvas confirmed removes the card for good", async ({ page }) => {
    await page.goto("/canvas");
    const ideas = grid(page).getByRole("row", { name: /Ideas/ });
    await focusCard(page, /Ideas/);

    await tabTo(page, ideas.getByRole("button", { name: "Delete canvas" }), { max: 6 });
    await page.keyboard.press("Enter");

    await tabTo(page, ideas, { max: 60 });
    await tabTo(page, ideas.getByRole("button", { name: "Delete canvas", exact: true }), {
      max: 6,
    });
    await page.keyboard.press("Enter");
    await expect(grid(page).getByRole("row", { name: /Ideas/ })).toHaveCount(0);
    await page.reload();
    await expect(grid(page).getByRole("row", { name: /Ideas/ })).toHaveCount(0);
  });
});

test.describe("searching the gallery @wf:canvas-gallery", () => {
  test("a search with no match shows the empty message and clearing restores the cards", async ({
    page,
  }) => {
    await page.goto("/canvas");
    const search = page.getByPlaceholder("Search canvases…");
    await tabTo(page, search, { max: 40 });
    await page.keyboard.type("zzz");

    await expect(page.getByText("No canvases match your search")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe("empty gallery @wf:canvas-gallery", () => {
  test.use({ library: "empty" });

  test("a fresh device offers New canvas, which opens an Untitled canvas", async ({ page }) => {
    await page.goto("/canvas");
    await expect(page.getByText("No canvases yet")).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "New canvas" }).first(), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: "Untitled canvas", level: 1 })).toBeVisible();

    // The new canvas is listed back in the gallery.
    await tabTo(page, page.getByRole("button", { name: "Back to canvas gallery" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas$/);
    await expect(grid(page).getByRole("row", { name: /Untitled canvas/ })).toHaveCount(1);
  });
});
