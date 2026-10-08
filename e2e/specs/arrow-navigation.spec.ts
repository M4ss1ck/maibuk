// Arrow navigation and Panes (ADR 0025). Arrows inside a list, grid, or
// toolbar stay React Aria's; an arrow pressed at a widget's edge moves focus
// to the nearest arrow stop that way, then to the nearest Pane, landing where
// F6 would. F6 lands on a Pane's control (last used, else its declared entry,
// else its first control), and a frame marks the Pane the keyboard is in.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";

const notesGallery = (page: Page) => page.getByRole("grid", { name: "Notes" });
const notesListPane = (page: Page) => page.getByRole("region", { name: "Notes list" });
const notesListRow = (page: Page, title: string) =>
  notesListPane(page).getByRole("row", { name: title, exact: true });
const noteText = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });

const chapterGrid = (page: Page) => page.getByRole("grid", { name: "Chapters" });
const chapterRow = (page: Page, title: string) =>
  chapterGrid(page).getByRole("row", { name: title });
const chapterText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const bookTitleBar = (page: Page) => page.getByRole("banner", { name: "Book title bar" });

/** Opens a seeded Note from the Notes Gallery by keyboard. */
async function openNote(page: Page, title: string) {
  await page.goto("/notes");
  await expect(notesGallery(page).getByRole("row").first()).toBeVisible();
  await tabTo(page, notesGallery(page).getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(
    page,
    "ArrowRight",
    notesGallery(page).getByRole("row", { name: title, exact: true }),
    { max: 10 }
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/.+/);
}

/** Enters the seeded Book from the Gallery; focus starts in the last Chapter's text. */
async function openBook(page: Page) {
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chapterText(page)).toBeFocused();
}

/** Presses F6 until focus is inside `pane`. */
async function f6To(page: Page, pane: Locator) {
  for (let i = 0; i < 5 && !(await isFocusWithin(pane)); i++) {
    await page.keyboard.press("F6");
  }
  await expectFocusWithin(pane);
}

test.describe("leaving the Notes list @wf:arrow-leave-notes", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("Right walks the selected Note's buttons, then crosses into the note's text", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));
    const row = notesListRow(page, SEED_NOTES.keeperLog);
    await expect(row).toBeFocused();

    for (const name of ["Edit", "Duplicate note", "Delete", "Reorder"]) {
      await page.keyboard.press("ArrowRight");
      await expect(row.getByRole("button", { name, exact: true })).toBeFocused();
    }
    // Past the last button React Aria would wrap back to the row; the arrow
    // leaves for the Pane to the right and lands in its text.
    await page.keyboard.press("ArrowRight");
    await expect(noteText(page)).toBeFocused();
  });

  test("Left from the row has nothing to its left and keeps focus instead of wrapping", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));
    const row = notesListRow(page, SEED_NOTES.keeperLog);
    await expect(row).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    await expect(row).toBeFocused();
  });

  test("Down past the last Note stays in the list", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));
    const last = notesListPane(page).getByRole("row").last();
    await pressUntilFocused(page, "ArrowDown", last, { max: 10 });

    await page.keyboard.press("ArrowDown");
    await expect(last).toBeFocused();
  });
});

test.describe("leaving widgets in the Book Editor @wf:arrow-leave-book-editor", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("Right walks the title bar by position, and Down crosses into the text", async ({
    page,
  }) => {
    await openBook(page);
    await f6To(page, bookTitleBar(page));
    const back = bookTitleBar(page).getByRole("button", { name: "Back to Home" });
    await expect(back).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(bookTitleBar(page).getByRole("button", { name: "Hide chapters" })).toBeFocused();
    await pressUntilFocused(
      page,
      "ArrowRight",
      bookTitleBar(page).getByRole("button", { name: "Book Settings" }),
      { max: 12 }
    );
    await page.keyboard.press("ArrowDown");
    await expect(chapterText(page)).toBeFocused();
  });

  test("Up and Down move between outline headings inside the Chapter row", async ({ page }) => {
    await openBook(page);
    // Two headings in the open Chapter so the outline has somewhere to move.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("Landfall");
    await page.keyboard.press("Control+Alt+1");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nightfall");
    await page.keyboard.press("Control+Alt+2");

    const outline = page.getByRole("toolbar", { name: "Outline" });
    await expect(outline.getByRole("button")).toHaveCount(2);
    const storm = chapterRow(page, "Storm");
    await f6To(page, page.getByRole("complementary", { name: "Chapter list" }));
    await expect(storm).toBeFocused();
    const landfall = outline.getByRole("button", { name: "Landfall" });
    await pressUntilFocused(page, "ArrowRight", landfall, { max: 8 });

    await page.keyboard.press("ArrowDown");
    await expect(outline.getByRole("button", { name: "Nightfall" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(landfall).toBeFocused();
  });

  test("Up from the first outline heading returns to its Chapter row", async ({ page }) => {
    await openBook(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("Landfall");
    await page.keyboard.press("Control+Alt+1");

    const outline = page.getByRole("toolbar", { name: "Outline" });
    await f6To(page, page.getByRole("complementary", { name: "Chapter list" }));
    const storm = chapterRow(page, "Storm");
    await expect(storm).toBeFocused();
    await pressUntilFocused(page, "ArrowRight", outline.getByRole("button", { name: "Landfall" }), {
      max: 8,
    });

    await page.keyboard.press("ArrowUp");
    await expect(storm).toBeFocused();
  });

  test("Down past the last Chapter stays in the list", async ({ page }) => {
    await openBook(page);
    await f6To(page, page.getByRole("complementary", { name: "Chapter list" }));
    const storm = chapterRow(page, "Storm");
    await expect(storm).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(storm).toBeFocused();
  });
});

test.describe("leaving the card galleries @wf:arrow-leave-galleries", () => {
  test.use({ library: "bookShelf" });

  const books = (page: Page) => page.getByRole("grid", { name: "Books" });
  const sidebar = (page: Page) => page.getByRole("complementary", { name: "Navigation sidebar" });

  async function openGallery(page: Page) {
    await page.goto("/");
    await expect(books(page).getByRole("row").first()).toBeVisible();
  }

  test("Down from nothing lands on the first card, Right moves card by card", async ({ page }) => {
    await openGallery(page);
    const cards = books(page).getByRole("row");

    await page.keyboard.press("ArrowDown");
    await expect(cards.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(cards.nth(0)).toBeFocused();
  });

  test("Left from the first card leaves the grid for the navigation sidebar", async ({ page }) => {
    await openGallery(page);
    await page.keyboard.press("ArrowDown");
    await expect(books(page).getByRole("row").first()).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    await expectFocusWithin(sidebar(page));
  });

  test("Right at the last card has nowhere to go and keeps focus instead of wrapping", async ({
    page,
  }) => {
    await openGallery(page);
    const last = books(page).getByRole("row").last();
    await page.keyboard.press("ArrowDown");
    await pressUntilFocused(page, "ArrowRight", last, { max: 10 });

    await page.keyboard.press("ArrowRight");
    await expect(last).toBeFocused();
  });

  test("Down from the Book actions toolbar enters the grid", async ({ page }) => {
    await openGallery(page);
    const actions = page.getByRole("toolbar", { name: "Book actions" });
    await tabTo(page, actions.getByRole("button").first(), { max: 40 });

    await page.keyboard.press("ArrowDown");
    await expectFocusWithin(books(page));
  });
});

test.describe("leaving the Settings outline @wf:arrow-leave-settings", () => {
  const outline = (page: Page) => page.getByRole("treegrid", { name: "Settings sections" });

  async function openSettings(page: Page) {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  test("Left from the section on screen leaves for the settings beside it", async ({ page }) => {
    await openSettings(page);
    const appearance = outline(page).getByRole("row", { name: /^Appearance/ });
    await page.keyboard.press("ArrowDown");
    await expect(appearance).toBeFocused();

    // The section on screen stays open, so Left cannot fold it and leaves.
    await page.keyboard.press("ArrowLeft");
    await expectFocusWithin(page.getByRole("main", { name: "Main content" }));
    expect(await isFocusWithin(outline(page))).toBe(false);
  });

  test("Left on another open section folds it first", async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press("ArrowDown");
    const editor = outline(page).getByRole("row", { name: /^Editor/ });
    await pressUntilFocused(page, "ArrowDown", editor, { max: 20 });
    await page.keyboard.press("ArrowRight");
    await expect(editor).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(editor).toHaveAttribute("aria-expanded", "false");
    await expect(editor).toBeFocused();
  });

  test("Right from a setting returns to the outline", async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowLeft");
    expect(await isFocusWithin(outline(page))).toBe(false);

    // Right moves along the settings by position and then into the outline,
    // which sits to their right.
    for (let i = 0; i < 6 && !(await isFocusWithin(outline(page))); i++) {
      await page.keyboard.press("ArrowRight");
    }
    await expectFocusWithin(outline(page));
  });
});

test.describe("F6 lands on a control in each Pane @wf:pane-cycle-landing @sc:global.cyclePanesForward @sc:global.cyclePanesBackward", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("F6 into the Notes list lands on the selected Note, and arrows move at once", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await expect(noteText(page)).toBeVisible();

    await f6To(page, notesListPane(page));
    await expect(notesListRow(page, SEED_NOTES.keeperLog)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(notesListRow(page, SEED_NOTES.keeperLog)).not.toBeFocused();
    await expectFocusWithin(notesListPane(page));
  });

  test("F6 into the note editor lands in its text", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));

    await f6To(page, page.getByRole("main", { name: "Note editor" }));
    await expect(noteText(page)).toBeFocused();
  });

  test("F6 returns to the control last used in a Pane", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));
    await page.keyboard.press("ArrowRight");
    const edit = notesListRow(page, SEED_NOTES.keeperLog).getByRole("button", {
      name: "Edit",
      exact: true,
    });
    await expect(edit).toBeFocused();

    await page.keyboard.press("F6");
    await expect.poll(() => isFocusWithin(notesListPane(page))).toBe(false);
    await f6To(page, notesListPane(page));
    await expect(edit).toBeFocused();
  });

  test("Shift+F6 steps back into the previous Pane", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));

    await page.keyboard.press("Shift+F6");
    await expectFocusWithin(page.getByRole("banner", { name: "Note title bar" }));
  });
});

test.describe("the Pane frame @wf:pane-frame", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("F6 rings the Pane it lands in and names it in a badge", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));

    const pane = page.locator('[data-focus-pane="notes-sidebar"]');
    // Soft, so a screenshot run on the base (no frame yet) still reaches the
    // capture and shows the "before".
    await expect.soft(pane).toHaveAttribute("data-pane-active", "");
    const badge = page.getByTestId("pane-badge");
    await expect.soft(badge).toHaveText("Notes list · F6 next pane");
    await capture(page, "pane-frame-notes-list");

    // An arrow into another Pane moves the ring with it: past the row's four
    // buttons, the fifth Right slides the frame to the note editor.
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await capture(page, "pane-frame-mid-slide", { freezeAnimationsAt: 90 });
    await expect(noteText(page)).toBeFocused();
    const editorPane = page.locator('[data-focus-pane="notes-content"]');
    await expect(editorPane).toHaveAttribute("data-pane-active", "");
    await expect(pane).not.toHaveAttribute("data-pane-active", "");
    await capture(page, "pane-frame-note-editor");
  });

  test("with keyboard hints hidden, F6 still rings the Pane but shows no badge", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));
    await expect(page.getByTestId("pane-badge")).toBeVisible();
    // g h toggles keyboard hints (a sequence, so focus must not be in text).
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(page.getByTestId("pane-badge")).toBeHidden();

    await page.keyboard.press("F6");
    await f6To(page, notesListPane(page));
    await expect(page.locator('[data-focus-pane="notes-sidebar"]')).toHaveAttribute(
      "data-pane-active",
      ""
    );
    await expect(page.getByTestId("pane-badge")).toBeHidden();
  });
});

// The Notes and Canvas galleries are the same 2D card grid as the Books one:
// Left/Right by position, leaving at the side edges instead of wrapping.
const galleryCards = (page: Page, grid: string) =>
  page.getByRole("grid", { name: grid }).getByRole("row");

async function focusFirstCard(page: Page, path: string, grid: string) {
  await page.goto(path);
  const first = galleryCards(page, grid).first();
  await expect(first).toBeVisible();
  await tabTo(page, first, { max: 40 });
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
}

async function crossGalleryEdges(page: Page, path: string, grid: string) {
  await focusFirstCard(page, path, grid);
  const cards = galleryCards(page, grid);
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cards.first()).toBeFocused();

  await page.keyboard.press("ArrowLeft");
  await expectFocusWithin(page.getByRole("complementary", { name: "Navigation sidebar" }));
}

async function stopAtLastCard(page: Page, path: string, grid: string) {
  await focusFirstCard(page, path, grid);
  const last = galleryCards(page, grid).last();
  await pressUntilFocused(page, "ArrowRight", last, { max: 10 });

  await page.keyboard.press("ArrowRight");
  await expect(last).toBeFocused();
}

test.describe("leaving the Notes gallery @wf:arrow-leave-notes-gallery", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("Right moves card by card, and Left from the first card leaves for the sidebar", async ({
    page,
  }) => {
    await crossGalleryEdges(page, "/notes", "Notes");
  });

  test("Right at the last card keeps focus instead of wrapping", async ({ page }) => {
    await stopAtLastCard(page, "/notes", "Notes");
  });
});

test.describe("leaving the Canvas gallery @wf:arrow-leave-canvas-gallery", () => {
  test.use({ library: "canvasWithNodes" });

  test("Right moves card by card, and Left from the first card leaves for the sidebar", async ({
    page,
  }) => {
    await crossGalleryEdges(page, "/canvas", "Canvases");
  });

  test("Right at the last card keeps focus instead of wrapping", async ({ page }) => {
    await stopAtLastCard(page, "/canvas", "Canvases");
  });
});

/** Tabs to a resize handle, presses Right twice, and checks the width grew and survives a reload. */
async function resizeByKeyboard(page: Page, name: string) {
  const handle = page.getByRole("separator", { name });
  await tabTo(page, handle, { max: 30 });
  const before = Number(await handle.getAttribute("aria-valuenow"));

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await handle.getAttribute("aria-valuenow")))
    .toBeGreaterThan(before);
  const after = await handle.getAttribute("aria-valuenow");

  await page.reload();
  await expect(page.getByRole("separator", { name })).toHaveAttribute("aria-valuenow", after ?? "");
}

test.describe("resizing the Notes list by keyboard @wf:resize-handles-keyboard", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("the handle is a Tab stop, arrows widen the list, and the width survives a reload", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await f6To(page, notesListPane(page));
    await resizeByKeyboard(page, "Resize notes list");
  });
});

test.describe("resizing the Chapter list by keyboard @wf:resize-handles-keyboard", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("the handle is a Tab stop, arrows widen the list, and the width survives a reload", async ({
    page,
  }) => {
    await openBook(page);
    await f6To(page, page.getByRole("complementary", { name: "Chapter list" }));
    await resizeByKeyboard(page, "Resize chapter list");
  });
});
