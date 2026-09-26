import type { Page } from "@playwright/test";
import { tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

// The Book side panel (Book side panel) and Quick Book Notes. The seeded Book
// opens on its last Chapter (Storm), and the panel is opened from the header's
// Book Notes button. The panel's contenteditable Quick Note keeps Tab for
// indentation, so Escape is the way out to the Add note button.
test.use({ library: "oneBookThreeChapters" });

const panel = (page: Page) => page.getByRole("complementary", { name: "Book side panel" });
const panelTab = (page: Page, name: string) => panel(page).getByRole("tab", { name, exact: true });
const resizeHandle = (page: Page) => panel(page).getByRole("separator", { name: "Resize panel" });
const quickNote = (page: Page) => page.getByRole("textbox", { name: "Book note" });
const addNote = (page: Page) => page.getByRole("button", { name: "Add note" });
const bookNotesTrigger = (page: Page) => page.getByRole("button", { name: "Book Notes" });

/** Enters the seeded Book through the Gallery and leaves focus in the editor. */
async function enterBook(page: Page) {
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panelTab(page, "Notes")).toHaveCount(0);
}

/** Opens the Book side panel on its Notes tab from the header button. */
async function openPanel(page: Page) {
  await enterBook(page);
  const trigger = bookNotesTrigger(page);
  await tabTo(page, trigger, { max: 40 });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panelTab(page, "Notes")).toBeFocused();
}

/** Types a Quick Note and adds it (Escape leaves the editor, Enter adds). */
async function addQuickNote(page: Page, text: string) {
  await tabTo(page, quickNote(page), { max: 10 });
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(addNote(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("button", { name: text })).toBeVisible();
}

test.describe("Book side panel tabs @wf:sidepanel-open-tabs", () => {
  test("opening lands focus on the active tab and Escape returns it to the trigger", async ({
    page,
  }) => {
    await enterBook(page);
    const trigger = bookNotesTrigger(page);
    await tabTo(page, trigger, { max: 40 });
    await page.keyboard.press("Enter");

    await expect(panel(page)).toBeVisible();
    await expect(panelTab(page, "Notes")).toBeFocused();
    await expect(panelTab(page, "Notes")).toHaveAttribute("aria-selected", "true");
    await expect(panelTab(page, "Footnotes")).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Escape");

    await expect(panelTab(page, "Notes")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("arrows switch between the Footnotes and Notes tabs", async ({ page }) => {
    await openPanel(page);

    await page.keyboard.press("ArrowLeft");
    await expect(panelTab(page, "Footnotes")).toBeFocused();
    await expect(panelTab(page, "Footnotes")).toHaveAttribute("aria-selected", "true");
    await expect(panel(page).getByText("No footnotes in this book yet.")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(panelTab(page, "Notes")).toBeFocused();
    await expect(panelTab(page, "Notes")).toHaveAttribute("aria-selected", "true");
    await expect(quickNote(page)).toBeVisible();
  });

  test("the last tab survives reopening the panel", async ({ page }) => {
    await openPanel(page);
    await page.keyboard.press("ArrowLeft");
    await expect(panelTab(page, "Footnotes")).toHaveAttribute("aria-selected", "true");

    // Reloading remounts the app with the panel open; the persisted tab wins.
    // (The Book Notes button deliberately forces the Notes tab, so it is not
    // the way to reopen on the last tab.)
    await page.reload();

    await expect(panelTab(page, "Footnotes")).toBeFocused();
    await expect(panelTab(page, "Footnotes")).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Book side panel keyboard resize @wf:sidepanel-resize", () => {
  test("arrows resize the panel from the separator and the width persists", async ({ page }) => {
    await openPanel(page);
    const handle = resizeHandle(page);

    await tabTo(page, handle, { max: 12, backwards: true });
    await expect(handle).toBeFocused();
    await expect(handle).toHaveAttribute("aria-valuenow", "256");
    await expect.poll(async () => (await panel(page).boundingBox())?.width).toBe(256);

    // The panel sits on the right, so ArrowLeft widens it.
    await page.keyboard.press("ArrowLeft");
    await expect(handle).toHaveAttribute("aria-valuenow", "272");
    await expect.poll(async () => (await panel(page).boundingBox())?.width).toBe(272);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "240");
    await expect.poll(async () => (await panel(page).boundingBox())?.width).toBe(240);

    await page.reload();
    await expect(panelTab(page, "Notes")).toBeFocused();
    await expect(resizeHandle(page)).toHaveAttribute("aria-valuenow", "240");
    await expect.poll(async () => (await panel(page).boundingBox())?.width).toBe(240);
  });
});

test.describe("Quick Book Notes @wf:booknotes-add-quick", () => {
  test("typing a Quick Note and adding it saves a Book Note that survives a reload", async ({
    page,
  }) => {
    await openPanel(page);
    await expect(panel(page).getByText("No notes for this book yet")).toBeVisible();

    await addQuickNote(page, "Check the tide gauge");
    await expect(panel(page).getByText("No notes for this book yet")).toHaveCount(0);

    await page.reload();
    await expect(panel(page).getByRole("button", { name: "Check the tide gauge" })).toBeVisible();
  });

  test("adding an empty Quick Note leaves the panel unchanged", async ({ page }) => {
    await openPanel(page);
    // The Quick Note keeps Tab for indentation, so Escape is the way to the
    // Add note button that follows it.
    await tabTo(page, quickNote(page), { max: 10 });
    await page.keyboard.press("Escape");
    await expect(addNote(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(panel(page).getByText("No notes for this book yet")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Untitled" })).toHaveCount(0);
  });

  test("formatting shortcuts apply inside the Quick Note editor", async ({ page }) => {
    await openPanel(page);
    await tabTo(page, quickNote(page), { max: 10 });
    await page.keyboard.type("bold");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");

    await expect(quickNote(page).locator("strong")).toHaveText("bold");
  });
});

test.describe("Book Note opens the Notes screen @wf:booknotes-open-full", () => {
  test("opening a Book Note shows it in the Notes screen and Back to the Book returns to it", async ({
    page,
  }) => {
    await openPanel(page);
    await addQuickNote(page, "Repair the lamp");

    const open = panel(page).getByRole("button", { name: "Repair the lamp" });
    await tabTo(page, open, { max: 10 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/notes\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Repair the lamp", level: 1 })).toBeVisible();
    await expect(quickNote(page)).toHaveCount(0);

    const back = page.getByRole("button", { name: `Back to ${SEED_BOOK.title}` });
    await tabTo(page, back, { max: 40 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/book\/[^/]+$/);
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
    // The panel is still open and its active tab holds focus.
    await expect(panelTab(page, "Notes")).toBeFocused();
  });
});
