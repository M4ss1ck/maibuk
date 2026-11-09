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
