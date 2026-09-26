import type { Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";

// Chapters of the seeded Book: Arrival, The Lamp, Storm. The seed sets no Last
// Opened Chapter, so the editor opens the last one (Storm) and the Chapter
// grid's Tab stop starts there.

const CHAPTERS = ["Arrival", "The Lamp", "Storm"] as const;
const CURRENT = "Storm";

test.use({ library: "oneBookThreeChapters" });

const grid = (page: Page) => page.getByRole("grid", { name: "Chapters" });
const row = (page: Page, title: string) => grid(page).getByRole("row", { name: title });
const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const pane = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });
const rowAction = (page: Page, title: string, action: string) =>
  row(page, title).getByRole("button", { name: action });

async function openBook(page: Page, { toEditor = false } = {}) {
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  await expect(editorText(page)).toBeFocused();
  if (toEditor) return;
  await page.keyboard.press("Escape");
  await expectFocusWithin(pane(page));
}

/** Tabs into the grid (it stops on the current Chapter) and arrows to `title`. */
async function focusChapter(page: Page, title: string, key: "ArrowUp" | "ArrowDown" = "ArrowUp") {
  await expect(row(page, title)).toBeVisible();
  await tabTo(page, grid(page).getByRole("row", { selected: true }));
  await pressUntilFocused(page, key, row(page, title));
}

/** Focuses a row, then Tabs to one of its actions (Reorder, Edit, Delete). */
async function focusRowAction(page: Page, title: string, action: string) {
  await focusChapter(page, title);
  await tabTo(page, rowAction(page, title, action), { max: 6 });
}

test.describe("adding a Chapter @wf:chapters-add", () => {
  test("typing a title and Enter adds it last and opens it; a reload agrees", async ({ page }) => {
    await openBook(page);
    const add = page.getByRole("button", { name: "Add Chapter" });
    await tabTo(page, add, { max: 40 });
    await page.keyboard.press("Enter");
    const title = page.getByRole("textbox", { name: "Chapter title..." });
    await expect(title).toBeFocused();
    await page.keyboard.type("Tidewatch");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("textbox", { name: "Text of Tidewatch" })).toBeVisible();
    await expect(grid(page).getByRole("row")).toHaveText([
      /Arrival/,
      /The Lamp/,
      /Storm/,
      /Tidewatch/,
    ]);

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Text of Tidewatch" })).toBeVisible();
    await expect(row(page, "Tidewatch")).toBeVisible();
  });

  test("Esc cancels create, adds nothing, and returns focus to Add Chapter", async ({ page }) => {
    await openBook(page);
    const add = page.getByRole("button", { name: "Add Chapter" });
    await tabTo(page, add, { max: 40 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Temp");
    await page.keyboard.press("Escape");

    await expect(page.getByRole("textbox", { name: "Chapter title..." })).toBeHidden();
    await expect(grid(page).getByRole("row")).toHaveCount(3);
    await expect(add).toBeFocused();
  });

  test("an empty title creates nothing and keeps the form open", async ({ page }) => {
    await openBook(page);
    await tabTo(page, page.getByRole("button", { name: "Add Chapter" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();

    await page.keyboard.press("Enter");

    await expect(page.getByRole("textbox", { name: "Chapter title..." })).toBeVisible();
    await expect(grid(page).getByRole("row")).toHaveCount(3);
  });
});

test.describe("moving through Chapters @wf:chapters-navigate", () => {
  test("arrows move between rows, Enter opens the Chapter, and a reload reopens it", async ({
    page,
  }) => {
    await openBook(page);
    await tabTo(page, grid(page).getByRole("row", { selected: true }));
    await expect(row(page, CURRENT)).toBeFocused();

    await page.keyboard.press("ArrowUp");
    await expect(row(page, "The Lamp")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(row(page, "Arrival")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, "The Lamp")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Text of The Lamp" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Text of The Lamp" })).toBeVisible();
  });
});

test.describe("renaming and Chapter Type @wf:chapters-rename-type", () => {
  test("Edit renames, sets the Chapter Type, and both survive a reload", async ({ page }) => {
    await openBook(page);
    await focusRowAction(page, "The Lamp", "Edit Chapter");
    await page.keyboard.press("Enter");
    const input = row(page, "The Lamp").getByRole("textbox");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("The Lamp");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("The Beacon");

    await page.keyboard.press("Tab");
    const chapterType = row(page, "The Lamp").getByRole("button", { name: "Chapter Type" });
    await expect(chapterType).toBeFocused();
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name: "Prologue" }));
    await page.keyboard.press("Enter");
    await expect(chapterType).toContainText("Prologue");
    await tabTo(page, row(page, "The Lamp").getByRole("button", { name: "Save" }));
    await page.keyboard.press("Enter");

    await expect(row(page, "The Beacon")).toBeFocused();

    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await focusChapter(page, "The Beacon");
    await tabTo(page, rowAction(page, "The Beacon", "Edit Chapter"));
    await page.keyboard.press("Enter");
    await expect(row(page, "The Beacon").getByRole("textbox")).toHaveValue("The Beacon");
    await expect(row(page, "The Beacon").getByRole("button", { name: "Chapter Type" })).toContainText(
      "Prologue"
    );
  });

  test("Cancel discards the rename and returns focus to the row", async ({ page }) => {
    await openBook(page);
    await focusRowAction(page, "The Lamp", "Edit Chapter");
    await page.keyboard.press("Enter");
    const input = row(page, "The Lamp").getByRole("textbox");
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Wrong Title");

    await page.keyboard.press("Escape");

    await expect(row(page, "The Lamp")).toBeFocused();
    await expect(row(page, "The Lamp").getByRole("textbox")).toHaveCount(0);
    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(grid(page).getByRole("row")).toHaveText([/Arrival/, /The Lamp/, /Storm/]);
  });
});

test.describe("keyboard reorder @wf:chapters-reorder-keyboard", () => {
  test("Enter starts the drag, ArrowDown moves the target, Enter drops; a reload keeps it", async ({
    page,
  }) => {
    await openBook(page);
    await focusRowAction(page, "Arrival", "Reorder");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Insert between Arrival and The Lamp" })
    ).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("button", { name: "Insert between The Lamp and Storm" })
    ).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(row(page, "Arrival")).toBeFocused();
    await expect(grid(page).getByRole("row")).toHaveText([/The Lamp/, /Arrival/, /Storm/]);

    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(grid(page).getByRole("row")).toHaveText([/The Lamp/, /Arrival/, /Storm/]);
  });

  test("Escape cancels the drag and leaves the order unchanged", async ({ page }) => {
    await openBook(page);
    await focusRowAction(page, "Arrival", "Reorder");
    const handle = rowAction(page, "Arrival", "Reorder");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");

    await page.keyboard.press("Escape");

    await expect(grid(page).getByRole("row")).toHaveText([/Arrival/, /The Lamp/, /Storm/]);
    await expect(handle).toBeFocused();
  });
});

test.describe("deleting a Chapter @wf:chapters-delete", () => {
  test("confirming removes the row, focuses its neighbor, and a reload agrees", async ({ page }) => {
    await openBook(page);
    await focusRowAction(page, "The Lamp", "Delete Chapter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "No", exact: true })).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(row(page, "The Lamp")).toHaveCount(0);
    await expect(row(page, "Storm")).toBeFocused();

    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(grid(page).getByRole("row")).toHaveText([/Arrival/, /Storm/]);
  });

  test("No keeps the Chapter and returns focus to Delete Chapter", async ({ page }) => {
    await openBook(page);
    await focusRowAction(page, "The Lamp", "Delete Chapter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "No", exact: true })).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(row(page, "The Lamp")).toBeVisible();
    await expect(rowAction(page, "The Lamp", "Delete Chapter")).toBeFocused();
  });

  test("deleting the open Chapter opens another", async ({ page }) => {
    await openBook(page);
    await tabTo(page, grid(page).getByRole("row", { selected: true }));
    await expect(row(page, CURRENT)).toBeFocused();
    await tabTo(page, rowAction(page, CURRENT, "Delete Chapter"));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "No", exact: true })).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");

    await expect(row(page, "Storm")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Text of Arrival" })).toBeVisible();
    await expect(row(page, "The Lamp")).toBeFocused();

    await page.reload();
    await expect(row(page, "Storm")).toHaveCount(0);
  });
});

test.describe("compact view @wf:chapters-compact-view", () => {
  test("toggling compact hides the metadata line and survives a reload", async ({ page }) => {
    await openBook(page);
    await expect(row(page, "Arrival")).toContainText("words");
    const toggle = page.getByRole("button", { name: "Switch to compact view" });
    await tabTo(page, toggle, { max: 40 });
    await page.keyboard.press("Enter");

    const normalToggle = page.getByRole("button", { name: "Switch to normal view" });
    await expect(normalToggle).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, "Arrival")).not.toContainText("words");

    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Switch to normal view" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(row(page, "Arrival")).not.toContainText("words");
  });
});

test.describe("sidebar toggle @wf:chapters-toggle-sidebar @sc:editor.toggleSidebar", () => {
  test("Mod+\\ hides and shows the Chapter sidebar without losing focus", async ({ page }) => {
    await openBook(page);
    const add = page.getByRole("button", { name: "Add Chapter" });
    await tabTo(page, add, { max: 40 });
    const main = page.getByRole("main", { name: "Editor" });
    expect((await main.boundingBox())?.x ?? 0).toBeGreaterThan(0);

    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect.poll(async () => (await main.boundingBox())?.x ?? -1).toBe(0);
    await expect(add).toBeFocused();

    await page.keyboard.press("ControlOrMeta+Backslash");
    await expect.poll(async () => (await main.boundingBox())?.x ?? 0).toBeGreaterThan(0);
    await expect(add).toBeFocused();
  });
});

test.describe("Chapter Status display @wf:chapters-status-display", () => {
  test("each row shows its Chapter Status", async ({ page }) => {
    await openBook(page);
    for (const title of CHAPTERS) {
      await expect(row(page, title)).toContainText("draft");
    }
  });
});

test.describe("Backspace @wf:chapters-back @sc:editor.back", () => {
  test("Backspace in the Chapter text deletes and does not navigate", async ({ page }) => {
    await openBook(page, { toEditor: true });
    const textbox = page.getByRole("textbox", { name: "Text of Storm" });
    await page.keyboard.press("End");

    await page.keyboard.press("Backspace");

    await expect(page).toHaveURL(/\/book\//);
    await expect(textbox).toContainText("without warning");
    await expect(textbox).not.toContainText("warning.");
    await expect(textbox).toBeFocused();
  });

  test("Backspace outside the editor returns to the Gallery", async ({ page }) => {
    await openBook(page);
    await expectFocusWithin(pane(page));

    await page.keyboard.press("Backspace");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  });
});

test.describe("word count @wf:chapters-word-count", () => {
  test("typing raises the word count and a selection shows its stats", async ({ page }) => {
    await openBook(page, { toEditor: true });
    const main = page.getByRole("main", { name: "Editor" });
    await expect(main.getByText("9 words", { exact: true })).toBeVisible();

    await page.keyboard.press("End");
    await page.keyboard.type(" One two three four five.");
    await expect(main.getByText("14 words", { exact: true })).toBeVisible();

    await page.keyboard.press("Shift+ArrowLeft");
    await expect(main.getByText(/1 words \/ 1 chars/)).toBeVisible();
  });
});
