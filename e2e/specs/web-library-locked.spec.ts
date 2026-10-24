import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { BACKUPS_BOOK } from "../support/seed/backups-present";
import { expect, test } from "../support/test";

// One Library, one tab (ADR 0035): the Web Lock says another tab owns the
// Library, so a second tab shows the full-screen locked message and never
// opens it. Try again re-runs the whole open sequence, including the lock.
//
// WebKit has OPFS only in a persistent context, so `usesPluginDirectory` gives
// this spec one in WebKit (the same seam the Plugin Directory rows use).
test.use({ library: "backupsPresent", usesPluginDirectory: true });

const lockedTitle = (page: Page) =>
  page.getByRole("heading", { name: "Maibuk is open in another tab" });
const booksHeading = (page: Page) => page.getByRole("heading", { name: "My Books", level: 1 });
const seededBook = (page: Page) =>
  page
    .getByRole("grid", { name: "Books" })
    .getByRole("row")
    .filter({ hasText: BACKUPS_BOOK.title });

test.describe("another tab holds the Library @wf:web-library-locked", () => {
  test("the second tab shows the locked screen and never opens the Library", async ({ page }) => {
    // Two app boots on one dev server; the second waits on a wasm Library.
    test.slow();

    await page.goto("/");
    await expect(booksHeading(page)).toBeVisible();
    await expect(seededBook(page)).toHaveCount(1);

    const second = await page.context().newPage();
    await second.goto("/");

    await expect(lockedTitle(second)).toBeVisible();
    await capture(second, "web-library-locked");
    const retry = second.getByRole("button", { name: "Try again" });
    await expect(retry).toBeFocused();
    // The Library was never opened in this tab.
    await expect(booksHeading(second)).toHaveCount(0);

    // Try again while the other tab still holds the Library: the lock check
    // runs again and answers the same way.
    await second.keyboard.press("Enter");
    await expect(lockedTitle(second)).toBeVisible();
    await expect(retry).toBeFocused();
    await expect(booksHeading(second)).toHaveCount(0);

    // The other tab leaves the Library; the same action now opens it.
    await page.goto("about:blank");
    await second.keyboard.press("Enter");
    await expect(booksHeading(second)).toBeVisible();
    await expect(seededBook(second)).toHaveCount(1);
  });
});
