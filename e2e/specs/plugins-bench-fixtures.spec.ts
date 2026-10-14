// The bench fixtures (issue #448): the E2E seeding and the `fixture-bench`
// Plugin the `bench:plugins` and `bench:frames` lanes measure. The first group
// installs twenty clones of `fixture-everything-on-demand` under distinct Plugin
// ids and proves Settings lists them all; the second opens `fixture-bench`'s
// echo page, types into its host-owned field, and reads the echoed text and the
// last of 1,000 rows; the third opens a Chapter and proves the Plugin's editor
// highlights land as view-only decorations.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).
// @sandbox: the lane runs it on Chromium and Firefox.

import type { Locator, Page } from "@playwright/test";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { clonePluginSeeds, seedSettings } from "../support/storage";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

const main = (page: Page) => page.getByRole("main", { name: "Main content" });
const navOption = (page: Page, name: string) =>
  page
    .getByRole("listbox", { name: "Primary navigation" })
    .getByRole("option", { name: new RegExp(`^${name}`) });

/** The Settings outline treegrid. */
const outline = (page: Page) =>
  page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });

/** Opens Settings by URL and lands on the Plugins section, by keyboard. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = outline(page);
  await expect(tree).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await page.keyboard.press("Home");
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(main(page).getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/**
 * Opens the Plugin's page and waits for its Worker to answer the handshake (its
 * Remote UI tree renders only then). `lastPath` is seeded null so a later return
 * to Home sticks; the caller leaves the page by keyboard, not a reload, so the
 * running Worker is kept.
 */
async function openPluginPage(page: Page, pluginId: string, ready: Locator): Promise<void> {
  await seedSettings(page, { lastPath: null });
  await page.goto(`/plugin/${pluginId}/echo`);
  await expect(ready).toBeVisible({ timeout: 15_000 });
}

test.describe("bench fixtures: twenty cloned Plugins @sandbox @no-webkit", () => {
  test.use({
    library: "empty",
    // Twenty copies of the on-demand fixture, each under its own id, manifest
    // id and name rewritten and its default Shortcuts dropped (#448).
    plugins: clonePluginSeeds("fixture-everything-on-demand", 20),
  });

  test("lists every clone in Settings → Plugins", async ({ page }) => {
    await openPluginsSection(page);
    const rows = main(page).getByRole("button", { name: /^Fixture Everything Clone \d+$/ });
    await expect(rows).toHaveCount(20);
    await expect(rows.first()).toBeVisible();
    await expect(rows.last()).toBeVisible();
  });
});

test.describe("bench fixture: the echo page @sandbox @no-webkit", () => {
  test.use({
    library: "empty",
    plugins: ["fixture-bench"],
    pluginApprovals: [{ pluginId: "fixture-bench", granted: ["editor:read", "editor:decorate"] }],
  });

  test("echoes typed text and renders 1,000 rows", async ({ page }) => {
    const field = page.getByRole("textbox", { name: "Echo input" });
    await page.goto("/plugin/fixture-bench/echo");
    await expect(field).toBeVisible({ timeout: 15_000 });

    // Typing is host-owned; every keystroke round-trips through the Plugin and
    // back into its Remote UI Text.
    await tabTo(page, field);
    await page.keyboard.type("abc");
    await expect(page.getByText("echo:abc")).toBeVisible();

    // The table renders exactly 1,000 rows, "Row 1".."Row 1000".
    await expect(page.getByText("Row 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Row 1000", { exact: true })).toBeVisible();
  });
});

test.describe("bench fixture: editor highlights @sandbox @no-webkit", () => {
  test.use({
    library: "oneBookThreeChapters",
    plugins: ["fixture-bench"],
    pluginApprovals: [{ pluginId: "fixture-bench", granted: ["editor:read", "editor:decorate"] }],
  });

  test("paints highlight decorations on the focused Chapter", async ({ page }) => {
    // The Plugin's highlight subscription is not replayed, so its Worker must be
    // ready before the Chapter editor takes focus. Open its page first, then
    // leave by keyboard (not a reload) so it keeps running.
    await openPluginPage(page, "fixture-bench", page.getByRole("textbox", { name: "Echo input" }));
    await tabTo(page, navOption(page, "Books"));
    await page.keyboard.press("Enter");

    // Open the seeded Book: its last Chapter opens in the editor.
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
    await expect(card).toHaveCount(1);
    await page.keyboard.press("1");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();

    const editor = page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` });
    await tabTo(page, editor, { max: 80 });

    // The host renders each highlight as a `plugin-highlight` span.
    const highlights = page.locator(".plugin-highlight");
    await expect(highlights.first()).toBeVisible({ timeout: 15_000 });
    expect(await highlights.count()).toBeGreaterThan(0);
  });
});
