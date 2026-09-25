import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";

// Editor rows that live in the Notes editor (issue #206): `[[` wikilink
// suggestions and collapsible headings. Both extensions are Notes-only, so the
// rows run on the seeded Notes Library.
test.use({ library: "notesWithLinksAndTags" });

const noteText = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });

async function openNote(page: Page, title: string) {
  await page.goto("/notes");
  const grid = page.getByRole("grid", { name: "Notes" });
  const card = grid.getByRole("row", { name: new RegExp(title) });
  await expect(card).toHaveCount(1);
  await tabTo(page, grid.getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", card, { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/.+/);
  await tabTo(page, noteText(page), { max: 80 });
  await expect(noteText(page)).toBeFocused();
}

test.describe("wikilink suggestions @wf:editor-wikilink-suggest", () => {
  test("typing [[ suggests notes, arrows move the active option, and Enter inserts the Link", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await expect(noteText(page)).toContainText("High water at six.");
    await page.keyboard.press("End");
    await page.keyboard.type(" [[Tide");

    const listbox = page.getByRole("listbox", { name: "Link suggestions" });
    await expect(listbox).toBeVisible();
    const option = listbox.getByRole("option").first();
    await expect(option).toHaveText(/Tide Tables/);
    await expect(option).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(listbox.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(option).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(noteText(page).locator("a.wikilink")).toHaveCount(1);
    await expect(noteText(page).locator("a.wikilink")).toHaveText("Tide Tables");

    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(noteText(page).locator("a.wikilink")).toHaveText("Tide Tables");
  });

  test("Esc closes the suggestion list without inserting", async ({ page }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await page.keyboard.press("End");
    await page.keyboard.type(" [[Tide");
    await expect(page.getByRole("listbox", { name: "Link suggestions" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("listbox", { name: "Link suggestions" })).toBeHidden();
    await expect(noteText(page).locator("a.wikilink")).toHaveCount(0);
  });
});

test.describe("collapsible headings @wf:editor-collapsible-heading @sc:editor.toggleHeadingCollapse", () => {
  test("Mod+Alt+H collapses the caret's section and the state persists", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await expect(noteText(page)).toContainText("The lamp holds through the gale.");

    // One real edit persists the heading ids the collapse state refers to.
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.keyboard.press("Home");
    await page.keyboard.press("Control+Alt+h");

    await expect(page.getByRole("button", { name: "Expand heading" }).first()).toBeVisible();
    await expect(noteText(page).locator(".heading-section-hidden").first()).toBeHidden();

    await page.reload();
    await expect(noteText(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand heading" }).first()).toBeVisible();

    await tabTo(page, noteText(page), { max: 80 });
    await page.keyboard.press("Home");
    await page.keyboard.press("Control+Alt+h");
    await expect(page.getByRole("button", { name: "Collapse heading" }).first()).toBeVisible();
  });
});
