import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";

// The Notes sidebar's Sort (#524, ADR 0028): picked by keyboard, remembered on
// this device per view, and left by a drag that keeps the order it showed.
// Seed: Tide Tables is Pinned; Keeper's Log then Harbor Notes are the rest.

test.use({ library: "notesWithLinksAndTags" });

const galleryGrid = (page: Page) => page.getByRole("grid", { name: "Notes" });
const galleryCard = (page: Page, title: string) =>
  galleryGrid(page).getByRole("row", { name: title, exact: true });
const notesListRow = (page: Page, title: string) =>
  page.getByRole("row", { name: title, exact: true }).first();
const sortButton = (page: Page) => page.getByRole("button", { name: /^Sort notes:/ });
const noteRows = (page: Page) =>
  page
    .getByRole("grid", { name: "Notes" })
    .first()
    .getByRole("row", { name: new RegExp(`^(${Object.values(SEED_NOTES).join("|")})$`) });
/** Row text starts with the title; previews and Tags follow it. */
const inOrder = (...titles: string[]) =>
  titles.map((title) => new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

async function openNote(page: Page, title: string) {
  await page.goto("/notes");
  await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
  await tabTo(page, galleryGrid(page).getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", galleryCard(page, title), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/.+/);
}

/** Opens the Sort menu from the keyboard and picks `label`. */
async function pickSort(page: Page, label: string) {
  await tabTo(page, sortButton(page), { max: 60 });
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name: label, exact: true });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", option, { max: 6 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(sortButton(page)).toBeFocused();
}

test.describe("Notes sidebar Sort @wf:notes-sidebar-sort", () => {
  test("a keyboard Sort reorders each section and survives a reload", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await capture(page, "notes-sidebar-sort");
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Custom");
    await expect(noteRows(page)).toHaveText(
      inOrder(SEED_NOTES.tideTables, SEED_NOTES.keeperLog, SEED_NOTES.harborNotes)
    );

    await pickSort(page, "Title (A–Z)");

    const sorted = inOrder(SEED_NOTES.tideTables, SEED_NOTES.harborNotes, SEED_NOTES.keeperLog);
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Title (A–Z)");
    await expect(noteRows(page)).toHaveText(sorted);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeVisible();
    await capture(page, "notes-sidebar-sort-menu");
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Title (A–Z)");
    await expect(noteRows(page)).toHaveText(sorted);
  });

  test("a drag while sorted keeps the shown order with the move and turns the Sort to Custom", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await pickSort(page, "Title (A–Z)");

    // Tide Tables leaves the Pinned Notes for the gap between the sorted rest.
    // Tab enters the list at the open Note; arrows walk up to Tide Tables.
    await tabTo(page, notesListRow(page, SEED_NOTES.keeperLog), { max: 60 });
    await pressUntilFocused(page, "ArrowUp", notesListRow(page, SEED_NOTES.tideTables), {
      max: 5,
    });
    const handle = notesListRow(page, SEED_NOTES.tideTables).getByRole("button", {
      name: "Reorder",
    });
    await pressUntilFocused(page, "ArrowRight", handle, { max: 6 });
    await page.keyboard.press("Enter");
    await pressUntilFocused(
      page,
      "ArrowDown",
      page.getByRole("button", {
        name: `Insert between ${SEED_NOTES.harborNotes} and ${SEED_NOTES.keeperLog}`,
        exact: true,
      }),
      { max: 8 }
    );
    await page.keyboard.press("Enter");

    const kept = inOrder(SEED_NOTES.harborNotes, SEED_NOTES.tideTables, SEED_NOTES.keeperLog);
    await expect(noteRows(page)).toHaveText(kept);
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Custom");

    await page.reload();
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Custom");
    await expect(noteRows(page)).toHaveText(kept);
  });

  test("the list and tree views keep their own Sort", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await pickSort(page, "Title (Z–A)");

    // The view toggle sits before the Sort button.
    const tree = page.getByRole("button", { name: "Tree", exact: true });
    await tabTo(page, tree, { max: 20, backwards: true });
    await page.keyboard.press("Enter");
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Custom");
    await pickSort(page, "Date (oldest first)");

    await page.reload();
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Date (oldest first)");
    const list = page.getByRole("button", { name: "List", exact: true });
    await tabTo(page, list, { max: 60 });
    await expect(list).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sortButton(page)).toHaveAccessibleName("Sort notes: Title (Z–A)");
  });
});
