// Echoes on a large Book (#504): the report draws 200 rows per tab, and the one
// expanded row (only one is open at a time) draws its occurrences 50 per page.
// Show more adds rows within a drawing budget, or the next 50 occurrences, by
// keyboard, and expanding, collapsing, and switching tabs stay quick. Each
// timing is logged so a regression shows up as a number, not only a failure.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { watchForText } from "../support/layout";
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

test.describe("Echoes report on a large Book @wf:plugins-echoes", () => {
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
    console.log(
      `[echoes-large] expand ${timings.expand} collapse ${timings.collapse} tab ${tabTimings}`
    );

    // Show more adds the next page by keyboard.
    const more = page.getByRole("button", { name: /^Show 200 more/ });
    await tabTo(page, more, { max: 400 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(400);
  });

  test("the list fills a tall window and keeps Show more on screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto("/");
    await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Echoes"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(200, { timeout: 60_000 });

    // Taller than the old fixed 20rem (320px) cap, and the button after it still
    // fits in the window without scrolling the page.
    const more = page.getByRole("button", { name: /^Show 200 more/ });
    await expect
      .poll(async () => (await nearbyList(page).boundingBox())?.height ?? 0)
      .toBeGreaterThan(320);
    const button = await more.boundingBox();
    expect(button).not.toBeNull();
    expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(1100);
    await capture(page, "echoes-report-tall-window");
  });

  test("a long Book row keeps its word visible and shows the full row in a tooltip", async ({
    page,
  }) => {
    // At 1100px the top row's 12-Part summary still fits; 900px is the widest
    // window that cuts it off while the sidebar stays open.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto("/");
    await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Echoes"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(200, { timeout: 60_000 });

    // The word has 1,800 occurrences across many Chapters: its description is cut
    // off, so the label keeps its own width and the tooltip carries both texts.
    const first = nearbyList(page).getByRole("option").first();
    await tabTo(page, first, { max: 20 });
    await expect(first).toBeFocused();
    await capture(page, "echoes-long-row");
    await expect(first.getByText("wall", { exact: true })).toBeVisible();

    // Keyboard focus opens the tooltip with the full label and description. The
    // arrows move focus off the row and back, so the tooltip follows the focus.
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("wall");
    await expect(tooltip).toContainText("1800 times");
    await capture(page, "echoes-long-row-tooltip-focus");

    await page.keyboard.press("ArrowDown");
    await expect(first).not.toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();
    await expect(page.getByRole("tooltip")).toContainText("1800 times");
  });

  test("a revisit paints the kept report without the loading screen", async ({ page }) => {
    await page.goto("/");
    await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Echoes"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(200, { timeout: 60_000 });

    // Leave for Books and come back, by keyboard.
    await tabTo(page, navOption(page, "Echoes"));
    await pressUntilFocused(page, "ArrowUp", navOption(page, "Books"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page)).toHaveCount(0);
    // Watch for the loading screen from the moment the page is chosen again.
    const sawLoading = await watchForText(page, "Checking the Book");
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Echoes"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(nearbyList(page).getByRole("option")).toHaveCount(200);
    expect(await sawLoading()).toBe(false);
  });
});
