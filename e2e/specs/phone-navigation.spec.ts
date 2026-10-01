import type { Page } from "@playwright/test";
import { SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";

// Phone: the sidebar folds into the navigation menu, and the Notes Gallery is
// how notes are reached (AGENTS.md section 2, item 7). Runs only in the
// `phone` project, driven by touch.

test.use({ library: "notesWithLinksAndTags" });

const menuDialog = (page: Page) => page.getByRole("dialog", { name: "Primary navigation" });

async function openMenu(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  // The desktop sidebar is not there to tap on a phone.
  await expect(page.getByRole("complementary", { name: "Navigation sidebar" })).toBeHidden();
  await page.getByRole("button", { name: "Open navigation menu" }).tap();
  await expect(menuDialog(page)).toBeVisible();
}

test.describe("phone navigation menu @touch @wf:phone-nav-menu", () => {
  test("a tap on a destination navigates and closes the menu", async ({ page }) => {
    await openMenu(page);
    await menuDialog(page).getByRole("option", { name: "Notes" }).tap();
    await expect(menuDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  });

  test("the close button closes the menu without navigating", async ({ page }) => {
    await openMenu(page);
    await menuDialog(page).getByRole("button", { name: "Close navigation menu" }).tap();
    await expect(menuDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });

  test("a tap on the backdrop closes the menu", async ({ page }) => {
    await openMenu(page);
    // The dialog itself lays out as `display: contents`; its nav has the width.
    const box = await menuDialog(page).getByRole("navigation").boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("menu or viewport has no size");
    // Past the menu's right edge is the dimmed backdrop.
    await page.touchscreen.tap((box.x + box.width + viewport.width) / 2, viewport.height / 2);
    await expect(menuDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("phone Notes Gallery @touch @wf:phone-notes-gallery", () => {
  test("the Gallery opens a Note full screen and Back returns to it", async ({ page }) => {
    await openMenu(page);
    await menuDialog(page).getByRole("option", { name: "Notes" }).tap();
    const gallery = page.getByRole("grid", { name: "Notes" });
    await expect(gallery.getByRole("row")).toHaveCount(3);

    await gallery.getByRole("row", { name: SEED_NOTES.tideTables }).tap();
    await expect(page).toHaveURL(/\/notes\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: SEED_NOTES.tideTables, level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("main", { name: "Note editor" })).toBeVisible();
    // The notes list is a desktop sidebar; a phone shows the open Note alone.
    await expect(page.getByRole("complementary", { name: "Notes list" })).toBeHidden();

    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(gallery.getByRole("row", { name: SEED_NOTES.tideTables })).toBeVisible();
  });
});
