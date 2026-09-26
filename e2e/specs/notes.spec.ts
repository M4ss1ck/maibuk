import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_NOTES, SEED_NOTE_TAGS } from "../support/seed/names";
import { expect, test } from "../support/test";

// The Notes Gallery and the Notes list (issue #208). Every flow starts from the
// keyboard-reachable UI: the Gallery is `role=grid` named "Notes" (one row of
// cards at this viewport), the Notes list is the sidebar on `/notes/:noteId`,
// and each item's menu opens with Shift+F10 on its focused row.
test.use({ library: "notesWithLinksAndTags" });

const galleryGrid = (page: Page) => page.getByRole("grid", { name: "Notes" });
const galleryCard = (page: Page, title: string) =>
  galleryGrid(page).getByRole("row", { name: title, exact: true });
const countText = (page: Page) => page.locator("h1 + p");
const noteText = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const notesListRow = (page: Page, title: string) =>
  page.getByRole("row", { name: title, exact: true }).first();
const menu = (page: Page) => page.getByRole("menu");
const deleteDialog = (page: Page) => page.getByRole("dialog", { name: "Delete this note?" });

/** Opens a seeded Note from the Gallery the way an author reaches it. */
async function openNote(page: Page, title: string) {
  await page.goto("/notes");
  await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
  await tabTo(page, galleryGrid(page).getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", galleryCard(page, title), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/.+/);
}

/** Enters the open Note's editor body by keyboard. */
async function focusNoteEditor(page: Page) {
  await tabTo(page, noteText(page), { max: 80 });
  await expect(noteText(page)).toBeFocused();
}

/** Opens the focused item's dialog with Shift+F10 and presses `item`. */
async function chooseFromItemMenu(page: Page, item: string) {
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await pressUntilFocused(page, "ArrowDown", menu(page).getByRole("menuitem", { name: item }));
  await page.keyboard.press("Enter");
}

test.describe("Notes Gallery browsing @wf:notes-gallery-browse", () => {
  test("arrows move between cards and Enter opens the focused note", async ({ page }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row")).toHaveCount(3);

    await tabTo(page, galleryGrid(page).getByRole("row").first(), { max: 40 });
    await expect(galleryCard(page, SEED_NOTES.tideTables)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(galleryCard(page, SEED_NOTES.keeperLog)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(galleryCard(page, SEED_NOTES.harborNotes)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(galleryCard(page, SEED_NOTES.keeperLog)).toBeFocused();

    await page.keyboard.press("End");
    await expect(galleryCard(page, SEED_NOTES.harborNotes)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(galleryCard(page, SEED_NOTES.tideTables)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/.+/);
    await expect(page.getByRole("heading", { name: SEED_NOTES.keeperLog, level: 1 })).toBeVisible();
  });

  test.describe("empty Library @wf:notes-gallery-browse", () => {
    test.use({ library: "empty" });

    test("shows the empty state and its create control", async ({ page }) => {
      await page.goto("/notes");
      await expect(page.getByText("No notes yet. Capture your first thought.")).toBeVisible();
      await expect(page.getByRole("button", { name: "New note" }).first()).toBeVisible();
    });
  });
});

test.describe("Notes creation @wf:notes-create", () => {
  test("creates a Note from the Gallery, reaches its editor and persists the body", async ({
    page,
  }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "New note" }).first(), { max: 40 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/notes\/.+/);
    await focusNoteEditor(page);
    await page.keyboard.type("A fresh start on the shore.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();
    await expect(noteText(page)).toContainText("A fresh start on the shore.");
  });

  test("creates a Note from the Notes list, names it and persists title and body", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await tabTo(page, page.getByRole("button", { name: "New note" }), { max: 60 });
    await page.keyboard.press("Enter");

    const created = notesListRow(page, "Untitled note");
    await expect(created).toBeVisible();

    // Give it a title through the row's Item Menu.
    await tabTo(page, created, { max: 60 });
    await chooseFromItemMenu(page, "Rename");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Fresh Thoughts");
    await page.keyboard.press("Enter");
    await expect(notesListRow(page, "Fresh Thoughts")).toBeVisible();

    // The editor already shows the new Note; type its body and let it save.
    await focusNoteEditor(page);
    await page.keyboard.type("Tide, wind and a new line.");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // The Notes list reuses the route, so reach the new Note from the Gallery.
    await page.goto("/notes");
    await expect(galleryCard(page, "Fresh Thoughts")).toBeVisible();
    await openNote(page, "Fresh Thoughts");
    await expect(noteText(page)).toContainText("Tide, wind and a new line.");
  });

  test("a Note created without a title falls back to Untitled note", async ({ page }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "New note" }).first(), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/.+/);

    await page.goto("/notes");
    await expect(galleryCard(page, "Untitled note")).toBeVisible();
  });
});

test.describe("Notes search and filters @wf:notes-search-filter", () => {
  async function openFilters(page: Page) {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Filters" }), { max: 40 });
    await page.keyboard.press("Enter");
  }

  async function toggleTag(page: Page, inputName: string, tag: string) {
    const input = page.getByPlaceholder(inputName);
    await tabTo(page, input, { max: 30 });
    // The include combobox opens as Tab passes through it, so an excluded Tag's
    // checkbox is the last one with that name.
    const checkbox = page.getByRole("checkbox", { name: tag });
    const target = inputName === "Any tag" ? checkbox.first() : checkbox.last();
    await tabTo(page, target, { max: 8 });
    await page.keyboard.press("Space");
  }

  test("search narrows the Gallery and the count reports matches", async ({ page }) => {
    await page.goto("/notes");
    await expect(countText(page)).toHaveText("3 notes");
    await tabTo(page, page.getByPlaceholder("Search notes..."), { max: 40 });
    await page.keyboard.type("Harbor");

    await expect(countText(page)).toHaveText("1 of 3 note");
    await expect(galleryGrid(page).getByRole("row")).toHaveCount(1);
    await expect(galleryCard(page, SEED_NOTES.harborNotes)).toBeVisible();
    await expect(galleryCard(page, SEED_NOTES.keeperLog)).toHaveCount(0);
  });

  test("a Tag filter narrows the Gallery", async ({ page }) => {
    await openFilters(page);
    await toggleTag(page, "Any tag", SEED_NOTE_TAGS.research);

    await expect(countText(page)).toHaveText("2 of 3 notes");
    await expect(galleryGrid(page).getByRole("row")).toHaveCount(2);
    await expect(galleryCard(page, SEED_NOTES.harborNotes)).toHaveCount(0);
  });

  test("an excluded Tag hides matching Notes", async ({ page }) => {
    await openFilters(page);
    await toggleTag(page, "No excluded tags", SEED_NOTE_TAGS.harbor);

    await expect(countText(page)).toHaveText("2 of 3 notes");
    await expect(galleryCard(page, SEED_NOTES.harborNotes)).toHaveCount(0);
    await expect(galleryCard(page, SEED_NOTES.tideTables)).toBeVisible();
  });

  test("a date range chosen with the keyboard filters the Gallery", async ({ page }) => {
    await openFilters(page);
    await tabTo(page, page.getByRole("button", { name: "Updated from" }), { max: 30 });
    await page.keyboard.press("Enter");
    // The popover follows the trigger: Previous month, Next month, then days.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await tabTo(page, page.getByRole("button", { name: "1", exact: true }), { max: 45 });
    await page.keyboard.press("Enter");

    // Every seeded Note predates next month's first day.
    await expect(countText(page)).toHaveText("0 of 3 notes");
    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
  });

  test("clearing the filters restores every Note", async ({ page }) => {
    await page.goto("/notes");
    await tabTo(page, page.getByPlaceholder("Search notes..."), { max: 40 });
    await page.keyboard.type("Harbor");
    await expect(countText(page)).toHaveText("1 of 3 note");

    await tabTo(page, page.getByRole("button", { name: "Clear filters" }).first(), { max: 40 });
    await page.keyboard.press("Enter");

    await expect(countText(page)).toHaveText("3 notes");
    await expect(galleryGrid(page).getByRole("row")).toHaveCount(3);
  });

  test("an unmatched search shows the No matches state", async ({ page }) => {
    await page.goto("/notes");
    await tabTo(page, page.getByPlaceholder("Search notes..."), { max: 40 });
    await page.keyboard.type("zzzzz");

    await expect(page.getByRole("heading", { name: "No notes match" })).toBeVisible();
    await expect(countText(page)).toHaveText("0 of 3 notes");
  });
});

test.describe("Notes list grouping, view and sort @wf:notes-list-group-sort", () => {
  test("the sort menu reorders the Gallery by keyboard and persists", async ({ page }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Sort by" }), { max: 40 });
    await page.keyboard.press("Enter");

    const titleAsc = page.getByRole("option", { name: "Title (A–Z)" });
    await pressUntilFocused(page, "ArrowDown", titleAsc);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Sort by" })).toContainText("Title (A–Z)");
    await expect(galleryGrid(page).getByRole("row").first()).toHaveAccessibleName("Harbor Notes");

    await page.reload();
    await expect(page.getByRole("button", { name: "Sort by" })).toContainText("Title (A–Z)");
    await expect(galleryGrid(page).getByRole("row").first()).toHaveAccessibleName("Harbor Notes");
  });

  test("the list/tree view and group mode persist across a reload", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);

    const tree = page.getByRole("button", { name: "Tree", exact: true });
    await tabTo(page, tree, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(tree).toHaveAttribute("aria-pressed", "true");

    // Group by tag, then by date, from the group toggles.
    await tabTo(page, page.getByRole("button", { name: "Tag", exact: true }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Tag", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await tabTo(page, page.getByRole("button", { name: "Date", exact: true }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Date", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.reload();
    await expect(page.getByRole("button", { name: "Tree", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByRole("button", { name: "Date", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

test.describe("Note Item Menu @wf:notes-item-menu", () => {
  test("a Gallery card's Item Menu duplicates from Shift+F10 and returns focus", async ({
    page,
  }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    await tabTo(page, galleryCard(page, SEED_NOTES.tideTables), { max: 40 });

    await page.keyboard.press("Shift+F10");
    await expect(menu(page)).toBeFocused();
    await expect(menu(page).getByRole("menuitem", { name: "Duplicate note" })).toBeVisible();

    await chooseFromItemMenu(page, "Duplicate note");
    await expect(galleryCard(page, `${SEED_NOTES.tideTables} (copy)`)).toBeVisible();
    await expect(galleryCard(page, SEED_NOTES.tideTables)).toBeFocused();
  });

  test("the Notes list Item Menu renames and pins by keyboard, persisting both", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);

    await tabTo(page, notesListRow(page, SEED_NOTES.keeperLog), { max: 60 });
    await chooseFromItemMenu(page, "Rename");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Night Watch Log");
    await page.keyboard.press("Enter");
    await expect(notesListRow(page, "Night Watch Log")).toBeVisible();

    await page.reload();
    await expect(notesListRow(page, "Night Watch Log")).toBeVisible();

    // Only the selected row is a Tab stop; reach the other note with arrows.
    await tabTo(page, notesListRow(page, "Night Watch Log"), { max: 60 });
    await pressUntilFocused(page, "ArrowDown", notesListRow(page, SEED_NOTES.harborNotes));
    await chooseFromItemMenu(page, "Pin");
    await expect(page.getByText("2 pinned")).toBeVisible();

    await page.reload();
    await expect(notesListRow(page, "Night Watch Log")).toBeVisible();
    await expect(page.getByText("2 pinned")).toBeVisible();
  });

  test("the Notes list Item Menu moves a Note to a Book and duplicates it", async ({ page }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await tabTo(page, notesListRow(page, SEED_NOTES.tideTables), { max: 60 });

    await page.keyboard.press("Shift+F10");
    await expect(menu(page)).toBeVisible();
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu(page).getByRole("menuitem", { name: "Move to book" })
    );
    await page.keyboard.press("ArrowRight");
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu(page).getByRole("menuitem", { name: SEED_BOOK.title })
    );
    await page.keyboard.press("Enter");

    // Duplicating from the same menu path keeps it in the list.
    await tabTo(page, notesListRow(page, SEED_NOTES.tideTables), { max: 60 });
    await chooseFromItemMenu(page, "Duplicate note");
    await expect(notesListRow(page, `${SEED_NOTES.tideTables} (copy)`)).toBeVisible();

    // A reload proves the move stuck: the Book tree group holds it.
    await page.reload();
    await tabTo(page, page.getByRole("button", { name: "Tree", exact: true }), { max: 60 });
    await page.keyboard.press("Enter");
    const bookGroup = page.getByTestId(/^book-group-/).filter({ hasText: SEED_BOOK.title });
    await expect(bookGroup).toContainText(SEED_NOTES.tideTables);
  });

  test("Deleting from the Item Menu can be cancelled @wf:notes-item-menu", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    const row = notesListRow(page, SEED_NOTES.keeperLog);
    await tabTo(page, row, { max: 60 });
    await chooseFromItemMenu(page, "Delete");

    await expect(deleteDialog(page)).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(deleteDialog(page)).toBeHidden();
    await expect(row).toBeFocused();
    await expect(notesListRow(page, SEED_NOTES.keeperLog)).toBeVisible();
  });
});

test.describe("Deleting a Note @wf:notes-delete", () => {
  test("the dialog traps Tab and Escape cancels back to the note's row", async ({ page }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    const row = galleryCard(page, SEED_NOTES.tideTables);
    await tabTo(page, row, { max: 40 });
    await chooseFromItemMenu(page, "Delete");

    await expect(deleteDialog(page)).toBeVisible();
    await expect(deleteDialog(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Delete note" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(deleteDialog(page).locator(":focus")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(deleteDialog(page)).toBeHidden();
    await expect(row).toBeFocused();
    await expect(galleryGrid(page).getByRole("row")).toHaveCount(3);
  });

  test("confirming delete removes the Note, focuses its neighbour and persists", async ({
    page,
  }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    const row = galleryCard(page, SEED_NOTES.tideTables);
    await tabTo(page, row, { max: 40 });
    await chooseFromItemMenu(page, "Delete");

    await expect(deleteDialog(page)).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Delete note" }), { max: 6 });
    await page.keyboard.press("Enter");

    await expect(galleryCard(page, SEED_NOTES.tideTables)).toHaveCount(0);
    await expect(galleryCard(page, SEED_NOTES.keeperLog)).toBeFocused();
    await expect(countText(page)).toHaveText("2 notes");

    await page.reload();
    await expect(galleryGrid(page).getByRole("row")).toHaveCount(2);
    await expect(galleryCard(page, SEED_NOTES.keeperLog)).toBeVisible();
  });
});
