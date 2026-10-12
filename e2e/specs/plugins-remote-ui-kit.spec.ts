// Host-rendered Plugin UI, part 2 (issue #439): the remote-ui fixture's gallery
// page draws tabs, a selectable and expandable collection with row Item Menus, a
// table, progress, status, empty state, overlays, and Plugin CSS. Keyboard only:
// arrows move inside the tab list and the collection, Enter expands a row, the
// row's Item Menu runs from the keyboard, Escape dismisses the modal and the
// popover and focus returns to the trigger, and Plugin CSS reaches the surface's
// own elements but not Maibuk chrome. Each matrix edge gets its own test.
// @no-webkit: the seed needs OPFS, which the webkit project does not carry.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { checkCssScopeCorpus } from "../support/css-scope-corpus";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const PAGE_TITLE = "UI kit";

const navOption = (page: Page, name: string) =>
  page.getByRole("listbox", { name: "Primary navigation" }).getByRole("option", {
    name: new RegExp(`^${name}`),
  });

/** Opens the gallery page the way an author reaches it (Tab, ArrowDown, Enter). */
async function openGallery(page: Page): Promise<void> {
  await page.goto("/");
  await expect(navOption(page, PAGE_TITLE)).toBeVisible({ timeout: 15_000 });
  await tabTo(page, navOption(page, "Books"));
  await pressUntilFocused(page, "ArrowDown", navOption(page, PAGE_TITLE), { max: 12 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/remote-ui\/gallery$/);
  await expect(page.getByRole("heading", { name: PAGE_TITLE, level: 1 })).toBeVisible();
}

test.describe("Host-rendered Plugin UI kit @wf:plugins-remote-ui-kit @no-webkit", () => {
  test.use({ plugins: ["remote-ui"] });

  test("the gallery page renders the organization kit", async ({ page }) => {
    await openGallery(page);
    await expect(page.getByRole("heading", { name: "Kit gallery" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("tablist", { name: "Gallery sections" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Chapters" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Statistics" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Exporting" })).toBeVisible();
    await expect(page.getByRole("status").first()).toBeVisible();
    await expect(page.getByText("No notes yet")).toBeVisible();
    await capture(page, "plugin-kit-gallery");
  });

  test("tabs and the collection move and select from the keyboard", async ({ page }) => {
    await openGallery(page);
    const overview = page.getByRole("tab", { name: "Overview" });
    const details = page.getByRole("tab", { name: "Details" });
    await expect(overview).toBeVisible({ timeout: 15_000 });

    await tabTo(page, overview);
    await page.keyboard.press("ArrowRight");
    await expect(details).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveText("Panel: details");

    // Enter on the focused row expands its panel; arrows move, Space selects.
    const firstRow = page.getByRole("option", { name: /^Chapter one/ });
    const thirdRow = page.getByRole("option", { name: /^Chapter three/ });
    await tabTo(page, firstRow);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Chapter one summary")).toBeVisible();
    await pressUntilFocused(page, "ArrowDown", thirdRow);
    await page.keyboard.press("Space");
    await expect(thirdRow).toHaveAttribute("aria-selected", "true");
    await capture(page, "plugin-kit-collection");
  });

  test("a row Item Menu runs from the keyboard", async ({ page }) => {
    await openGallery(page);
    const firstRow = page.getByRole("option", { name: /^Chapter one/ });
    const secondRow = page.getByRole("option", { name: /^Chapter two/ });
    await expect(firstRow).toBeVisible({ timeout: 15_000 });

    // A collection is one Tab stop: arrows move between rows, and Enter on the
    // row opens its Item Menu.
    await tabTo(page, firstRow);
    await pressUntilFocused(page, "ArrowDown", secondRow);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    // The programmatic open focuses the menu itself; Down enters its items.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Menu action: rename")).toBeVisible();
  });

  test("the modal closes with Escape and returns focus", async ({ page }) => {
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Open modal" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Chapter details" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("the confirmation dialog cancels with Escape and returns focus", async ({ page }) => {
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Delete chapter" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    const dialog = page.getByRole("alertdialog", { name: "Delete chapter?" });

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("the confirmation dialog confirms from the keyboard", async ({ page }) => {
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Delete chapter" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    const dialog = page.getByRole("alertdialog", { name: "Delete chapter?" });

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    const confirm = page.getByRole("button", { name: "Confirm" });
    await tabTo(page, confirm);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
  });

  test("the confirmation dialog reopens after Escape", async ({ page }) => {
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "Delete chapter" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    const dialog = page.getByRole("alertdialog", { name: "Delete chapter?" });

    // Escape dismisses immediately; the Plugin acknowledges through
    // onOpenChange, so opening it again is a real reopen (the same pattern as
    // the Modal, whose Worker never echoes).
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
  });

  test("a tooltip shows on focus", async ({ page }) => {
    await openGallery(page);
    const target = page.getByRole("button", { name: "Tooltip target" });
    await expect(target).toBeVisible({ timeout: 15_000 });

    await tabTo(page, target);
    // Tabbing here passes chrome controls whose tooltips may still be closing,
    // so name the Plugin's tooltip rather than expecting it to be the only one.
    await expect(page.getByRole("tooltip", { name: "Saved locally" })).toBeVisible();
    await capture(page, "plugin-kit-tooltip");
  });

  test("the popover opens from the keyboard and closes with Escape", async ({ page }) => {
    await openGallery(page);
    const trigger = page.getByRole("button", { name: "More options" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Popover body")).toBeVisible();
    await capture(page, "plugin-kit-popover");

    await page.keyboard.press("Escape");
    await expect(page.getByText("Popover body")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Plugin CSS styles its surface and not Maibuk chrome", async ({ page }) => {
    await openGallery(page);
    const header = page.getByRole("columnheader", { name: "Name" });
    await expect(header).toBeVisible({ timeout: 15_000 });
    await expect(header).toHaveCSS("text-transform", "uppercase");

    // The page's own heading is not inside the surface, so the Plugin's
    // `:is(th, caption)` rule cannot reach it and the app's headings keep their
    // casing.
    const chromeHeading = page.getByRole("heading", { name: PAGE_TITLE, level: 1 });
    await expect(chromeHeading).toHaveCSS("text-transform", "none");
  });

  test("the scoper keeps a hostile corpus fully inside the surface in Chromium", async ({
    page,
  }) => {
    // Chromium's CSS parser is the ground truth; jsdom's is not. Every scoped
    // output is re-parsed by the engine, and no style rule may escape the scope.
    const result = await checkCssScopeCorpus(page);
    const failing = new Set(result.leaks.map((leak) => leak.split(":")[0]));
    const scoped = result.total - failing.size;
    console.log(`[plugins-remote-ui-kit] hostile CSS corpus: ${scoped}/${result.total} scoped`);
    expect(result.leaks, JSON.stringify(result.leaks, null, 2)).toEqual([]);
  });
});
