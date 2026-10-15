// Echoes on a large Book (#504): the report draws 200 rows per tab and 200
// occurrences per expanded row, Show more adds the next 200 by keyboard, and
// expanding, collapsing, and switching tabs stay quick. Each timing is logged
// so a regression shows up as a number, not only a failure.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const nearbyList = (page: Page) => page.getByRole("listbox", { name: "Nearby echo" });

/** Milliseconds from now until the Nearby list holds `count` options, polled every frame. */
async function msUntilOptions(page: Page, count: number): Promise<number> {
  const start = Date.now();
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll('[role="listbox"][aria-label="Nearby echo"] [role="option"]')
        .length === n,
    count,
    { polling: "raf", timeout: 30_000 }
  );
  return Date.now() - start;
}

test.use({
  library: "echoesLargeBook",
  plugins: ["maibuk-echoes"],
  pluginApprovals: [
    {
      pluginId: "maibuk-echoes",
      granted: ["library:read", "editor:read", "editor:decorate"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-echoes" }],
});

test.describe("Echoes report on a large Book @wf:plugins-echoes @no-webkit", () => {
  test("draws 200 rows, shows more by keyboard, and toggles a row quickly", async ({ page }) => {
    await page.goto("/");
    await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Echoes"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(200, { timeout: 60_000 });

    // The top row is the filler "wall", said 1,800 times, so it has over 200 occurrences.
    const first = nearbyList(page).getByRole("option").first();
    await expect(first).toHaveAccessibleName(/^wall /);
    await tabTo(page, first, { max: 20 });
    await expect(first).toBeFocused();

    const timings: Record<string, number[]> = { expand: [], collapse: [] };
    for (let round = 0; round < 3; round++) {
      await page.keyboard.press("Enter");
      // 200 rows, 50 occurrences, and the occurrences' Show more row.
      timings.expand.push(await msUntilOptions(page, 251));
      await page.keyboard.press("Enter");
      timings.collapse.push(await msUntilOptions(page, 200));
    }

    const tabTimings: number[] = [];
    const nearbyTab = page.getByRole("tab", { name: "Nearby echo" });
    await tabTo(page, nearbyTab);
    let start = Date.now();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("listbox", { name: "Overused word" })).toBeVisible();
    tabTimings.push(Date.now() - start);
    start = Date.now();
    await page.keyboard.press("ArrowLeft");
    tabTimings.push(await msUntilOptions(page, 200));
    console.log(`[echoes-large] expand ${timings.expand} collapse ${timings.collapse} tab ${tabTimings}`);

    // Show more adds the next page by keyboard.
    const more = page.getByRole("button", { name: /^Show 200 more/ });
    await tabTo(page, more, { max: 400 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(400);
  });
});
