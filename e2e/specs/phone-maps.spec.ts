// Maps on a phone (#744): touch has no Shift+F10 and no hover, so the Book
// Gallery card's Item Menu opens by long-press and from its ⋯ button, and its
// Maps entry opens the Maps page filtered to that Book. Runs only in the
// `phone` project (every test is @touch).

import type { Page } from "@playwright/test";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";
import { longPress } from "../support/touch";

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

const bookCard = (page: Page) =>
  page.getByRole("grid", { name: "Books" }).getByRole("row", { name: SEED_BOOK.title });

/** Taps the Maps entry in the open Book Item Menu and checks the filtered page. */
async function chooseMaps(page: Page): Promise<void> {
  const menu = page.getByRole("menu", { name: `More actions for ${SEED_BOOK.title}` });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Maps" }).tap();
  await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
  await expect(page.getByText("No Maps for this Book yet")).toBeVisible({ timeout: 30_000 });
}

test.describe("phone Book Item Menu @touch @wf:plugins-maps-list", () => {
  test("a long-press on a Book card opens its Item Menu, and Maps opens filtered to that Book", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(bookCard(page)).toBeVisible({ timeout: 60_000 });
    await longPress(page, bookCard(page).getByRole("heading", { name: SEED_BOOK.title }));
    await chooseMaps(page);
  });

  test("the ⋯ button on a Book card opens the same Item Menu", async ({ page }) => {
    await page.goto("/");
    const more = bookCard(page).getByRole("button", {
      name: `More actions for ${SEED_BOOK.title}`,
    });
    await expect(more).toBeVisible({ timeout: 60_000 });
    await more.tap();
    await chooseMaps(page);
  });
});

/** The Maps editor's drawing Frame, and the surface its tool shows on. */
const frame = (page: Page) => page.locator('[data-plugin-frame="embedded"]');
const drawnWith = (page: Page, tool: string) =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe').locator(`svg[data-tool="${tool}"]`);

test.describe("phone Maps editor @touch @wf:plugins-maps-touch", () => {
  test("the Maps page opens from the navigation menu and a tap on the belt picks the tool", async ({
    page,
  }) => {
    await page.goto("/");

    // A phone has no sidebar: the destinations live behind the navigation menu.
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menu).toBeVisible({ timeout: 60_000 });
    await menu.tap();
    const navigation = page.getByRole("dialog", { name: "Primary navigation" });
    await navigation.getByRole("option", { name: /^Maps/ }).tap();
    await expect(page).toHaveURL(/\/plugin\/maibuk-maps\/maps$/);
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();

    // A Map of its own, made by tapping: the dialog focuses Name, so the taps
    // are the button's and the text is the keyboard's.
    await page.getByRole("button", { name: "New Map" }).tap();
    const dialog = page.getByRole("dialog", { name: "New Map" });
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await page.keyboard.type("Coastline");
    await dialog.getByRole("button", { name: "Create" }).tap();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Open Coastline" }).tap();
    await expect(frame(page)).toBeVisible();
    // The editor's belt is a row of thumb-sized targets along the bottom on a
    // phone, and a tap on one of them picks that tool in the drawing (#779).
    const pen = page.getByRole("button", { name: "Pen", exact: true });
    await expect(pen).toBeVisible();
    await pen.tap();
    await expect(drawnWith(page, "pencil")).toBeVisible();
  });
});
