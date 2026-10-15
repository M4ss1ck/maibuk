// The fixture-everything Plugin on a phone (issue #446): touch reaches its
// contributions without hover. A Chapter's Item Menu opens by long-press and
// runs the Plugin's targeted `stamp` Command on that Chapter (naming it), and
// the Plugin's page opens from the sidebar and renders its deterministic
// content. Runs only in the `phone` project (every test is @touch).
// @no-webkit: seeding the Plugin Directory needs OPFS.

import type { Page } from "@playwright/test";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";
import { longPress } from "../support/touch";

/** The fixture's required Plugin Permissions, the record the approval flow writes. */
const REQUIRED_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:api.fixture.test",
];
/** The two Chapters of the `oneBookTwoChapters` seed: A is opened, B is last. */
const CHAPTER_A = SEED_CHAPTERS[0].title;

test.use({
  library: "oneBookTwoChapters",
  plugins: ["fixture-everything"],
  pluginApprovals: [{ pluginId: "fixture-everything", granted: [...REQUIRED_PERMISSIONS] }],
});

/** The `stamp` notification, whose text names the Chapter the host acted on. */
const stampedToast = (page: Page) =>
  page.getByRole("status").filter({ hasText: /Fixture stamped/ });

/** Opens the seeded Book and its Chapters drawer on a phone, returning the grid. */
async function openChapters(page: Page) {
  await page.goto("/");
  // The sandbox frame means the Plugin is ready, so its targeted Command is enabled.
  await expect(page.locator("iframe")).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole("grid", { name: "Books" }).getByRole("row").tap();
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Chapters", exact: true }).tap();
  const grid = page.getByRole("grid", { name: "Chapters" });
  await expect(grid.getByRole("row")).toHaveCount(2);
  return grid;
}

test.describe("phone fixture-everything Item Menu @touch @wf:plugins-contributions @no-webkit", () => {
  test("a long-press on a Chapter opens its Item Menu and Stamp names that Chapter", async ({
    page,
  }) => {
    const grid = await openChapters(page);
    const row = grid.getByRole("row", { name: CHAPTER_A });
    await expect(row).toBeVisible();
    // A phone never hovers, so the ⋯ button and the long-press are the ways in.
    await expect(row.getByRole("button", { name: `More actions for ${CHAPTER_A}` })).toBeVisible();

    await longPress(page, row.getByText(CHAPTER_A));
    const menu = page.getByRole("menu", { name: `More actions for ${CHAPTER_A}` });
    await expect(menu.getByRole("menuitem", { name: "Stamp" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Stamp" }).tap();

    // The Item Menu supplied Chapter A as the target: the Plugin's notification
    // names it.
    await expect(stampedToast(page)).toContainText(CHAPTER_A, { timeout: 5_000 });
  });
});

test.describe("phone fixture-everything page @touch @wf:plugins-contributions @no-webkit", () => {
  test("a tap on the sidebar entry opens the Plugin page with its content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("iframe")).toHaveCount(1, { timeout: 15_000 });

    // The desktop sidebar folds into the navigation menu on a phone.
    await page.getByRole("button", { name: "Open navigation menu" }).tap();
    const dialog = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option", { name: /^Everything fixture/ }).tap();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/plugin\/fixture-everything\/panel$/);
    await expect(page.getByRole("heading", { name: "Everything fixture", level: 1 })).toBeVisible();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
  });
});
