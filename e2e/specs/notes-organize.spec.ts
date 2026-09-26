import { readFile } from "node:fs/promises";
import type { Download, Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_NOTES } from "../support/seed/names";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// The organizing half of Notes (issue #208): pinning order, moving a Note into
// a Book, keyboard reorder, Tags, Links and Backlinks, Last Edited, and Export.
// It starts where an author does: the Notes Gallery (`role=grid`, "Notes") or
// the Notes list on `/notes/:noteId`, reached with arrows and Enter.
test.use({ library: "notesWithLinksAndTags" });

const galleryGrid = (page: Page) => page.getByRole("grid", { name: "Notes" });
const galleryCard = (page: Page, title: string) =>
  galleryGrid(page).getByRole("row", { name: title, exact: true });
const noteText = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const notesListRow = (page: Page, title: string) =>
  page.getByRole("row", { name: title, exact: true }).first();
const menu = (page: Page) => page.getByRole("menu");
const deleteDialog = (page: Page) => page.getByRole("dialog", { name: "Delete this note?" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const addTag = (page: Page) => page.getByRole("button", { name: "Add tag" });
/**
 * The Note header's Last Edited date. NoteTagsRow also renders an aria-hidden
 * measuring copy, so only the visible span counts.
 */
const lastEdited = (page: Page, text: string) =>
  page.locator('[data-tutorial="notes.tags"]').getByText(text).filter({ visible: true }).first();

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

/** Reaches the formatting toolbar by Tab from the page's first focusable. */
async function exportDownload(page: Page, buttonName: string): Promise<Download> {
  if (!(await isFocusWithin(toolbar(page)))) {
    await expect(toolbar(page)).toBeVisible();
    for (let i = 0; i < 60; i++) {
      if (await isFocusWithin(toolbar(page))) break;
      await page.keyboard.press("Tab");
    }
    if (!(await isFocusWithin(toolbar(page)))) throw new Error("Tab never reached the toolbar");
  }
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", page.getByRole("button", { name: buttonName }), {
    max: 200,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

test.describe("Pinned Notes @wf:notes-pin-order", () => {
  test("pinning a Note moves it into the Pinned section and the order persists", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);

    // Baseline: only Tide Tables is pinned, and it leads the list.
    await expect(page.getByText("1 pinned")).toBeVisible();
    // Only the selected row is a Tab stop; arrow from it to walk the list.
    await tabTo(page, notesListRow(page, SEED_NOTES.keeperLog), { max: 60 });
    await page.keyboard.press("ArrowUp");
    await expect(notesListRow(page, SEED_NOTES.tideTables)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(notesListRow(page, SEED_NOTES.keeperLog)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(notesListRow(page, SEED_NOTES.harborNotes)).toBeFocused();

    // Pin Harbor Notes from its Item Menu.
    await chooseFromItemMenu(page, "Pin");
    await expect(page.getByText("2 pinned")).toBeVisible();

    // It now sits in the Pinned section, above the unpinned Keeper's Log.
    await pressUntilFocused(page, "ArrowUp", notesListRow(page, SEED_NOTES.tideTables), {
      max: 10,
    });
    await page.keyboard.press("ArrowDown");
    await expect(notesListRow(page, SEED_NOTES.harborNotes)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(notesListRow(page, SEED_NOTES.keeperLog)).toBeFocused();

    await page.reload();
    await expect(page.getByText("2 pinned")).toBeVisible();
    await tabTo(page, notesListRow(page, SEED_NOTES.keeperLog), { max: 60 });
    await page.keyboard.press("ArrowUp");
    await expect(notesListRow(page, SEED_NOTES.harborNotes)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(notesListRow(page, SEED_NOTES.tideTables)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(notesListRow(page, SEED_NOTES.harborNotes)).toBeFocused();
  });
});

test.describe("Moving a Note to a Book @wf:notes-move-to-book", () => {
  test("an Unfiled Note joins a Book and can move back, both persisting", async ({ page }) => {
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    const unfiled = galleryCard(page, SEED_NOTES.tideTables);
    await expect(unfiled).not.toContainText(SEED_BOOK.title);
    await expect(galleryCard(page, SEED_NOTES.keeperLog)).toContainText(SEED_BOOK.title);

    // Move it into the Book from the card's Item Menu.
    await tabTo(page, unfiled, { max: 40 });
    await page.keyboard.press("Shift+F10");
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
    await expect(unfiled).toContainText(SEED_BOOK.title);

    await page.reload();
    await expect(galleryCard(page, SEED_NOTES.tideTables)).toContainText(SEED_BOOK.title);

    // Move it back to Unfiled.
    const filed = galleryCard(page, SEED_NOTES.tideTables);
    await tabTo(page, filed, { max: 40 });
    await page.keyboard.press("Shift+F10");
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu(page).getByRole("menuitem", { name: "Move to book" })
    );
    await page.keyboard.press("ArrowRight");
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu(page).getByRole("menuitem", { name: "Unfiled" })
    );
    await page.keyboard.press("Enter");
    await expect(filed).not.toContainText(SEED_BOOK.title);

    await page.reload();
    await expect(galleryCard(page, SEED_NOTES.tideTables)).not.toContainText(SEED_BOOK.title);
  });
});

test.describe("Notes list keyboard reorder @wf:notes-reorder-keyboard", () => {
  test.fail(
    "Space lifts a Note and arrows move it in the list",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/219",
      },
    },
    async ({ page }) => {
      await openNote(page, SEED_NOTES.keeperLog);
      await tabTo(page, notesListRow(page, SEED_NOTES.harborNotes), { max: 60 });

      // Native HTML5 drag has no keyboard path: there is no lift.
      await page.keyboard.press("Space");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");

      // Harbor Notes would lead the unpinned list if the move had landed.
      await tabTo(page, notesListRow(page, SEED_NOTES.tideTables), { max: 20 });
      await page.keyboard.press("ArrowDown");
      await expect(notesListRow(page, SEED_NOTES.harborNotes)).toBeFocused();
    }
  );
});

test.describe("Editing Note Tags @wf:notes-tags-edit", () => {
  test("adding a Tag saves it and the chip survives a reload", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await tabTo(page, addTag(page), { max: 60 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("logbook");
    await page.keyboard.press("Enter");

    const chip = page.getByText("logbook", { exact: true }).filter({ visible: true });
    await expect(chip.first()).toBeVisible();

    await page.reload();
    await focusNoteEditor(page);
    await expect(
      page.getByText("logbook", { exact: true }).filter({ visible: true }).first()
    ).toBeVisible();
  });

  test("removing a Tag saves the change", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await tabTo(page, addTag(page), { max: 60 });
    await page.keyboard.press("Enter");
    // The chips sit before the combobox input, so Shift+Tab reaches the last
    // chip's Remove button.
    await tabTo(page, page.getByRole("button", { name: "Remove lamp" }), {
      max: 10,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove lamp" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.reload();
    // Reach the header's Tag control without entering (and being kept in) the
    // editor body.
    await tabTo(page, addTag(page), { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove lamp" })).toHaveCount(0);
  });

  test("adding an already-present Tag does not duplicate the chip", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await tabTo(page, addTag(page), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove lamp" })).toHaveCount(1);

    await page.keyboard.type("lamp");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Remove lamp" })).toHaveCount(1);
  });
});

test.describe("Note Links and Backlinks @wf:notes-links-backlinks", () => {
  test("a Backlink opens its source and the link persists", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);

    // Escape is the way out of the writing surface; it lands on the Backlink.
    await focusNoteEditor(page);
    await page.keyboard.press("Escape");
    const source = page.getByRole("button", { name: SEED_NOTES.harborNotes });
    await expect(source).toBeFocused();
    await page.keyboard.press("Enter");

    // The editor switches to the linking Note.
    await expect(
      page.getByRole("heading", { name: SEED_NOTES.harborNotes, level: 1 })
    ).toBeVisible();
    await expect(noteText(page)).toContainText("See Keeper's Log for the watch.");

    // The URL stayed on Keeper's Log, so a reload shows its Backlink again.
    await page.reload();
    await expect(page.getByRole("button", { name: SEED_NOTES.harborNotes })).toBeVisible();
  });

  test("deleting the linking Note removes the Backlink", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await expect(page.getByRole("button", { name: SEED_NOTES.harborNotes })).toBeVisible();

    await tabTo(page, notesListRow(page, SEED_NOTES.keeperLog), { max: 60 });
    await pressUntilFocused(page, "ArrowDown", notesListRow(page, SEED_NOTES.harborNotes));
    await chooseFromItemMenu(page, "Delete");
    await expect(deleteDialog(page)).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Delete note" }), { max: 6 });
    await page.keyboard.press("Enter");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Linked from" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: SEED_NOTES.harborNotes })).toHaveCount(0);
  });
});

test.describe("Note Last Edited @wf:notes-last-edited", () => {
  test("body and title edits move Last Edited while pinning and tagging do not", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-06-15T12:00:00Z") });
    await page.goto("/notes");
    await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "New note" }).first(), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/.+/);
    await focusNoteEditor(page);

    // Created just now under the fixed clock.
    await expect(lastEdited(page, "seconds ago")).toBeVisible();

    // Age two hours; the untouched Note reads as two hours old.
    await page.clock.setFixedTime(new Date("2026-06-15T14:00:00Z"));
    await page.reload();
    await expect(lastEdited(page, "2 hours ago")).toBeVisible();

    // Pinning is metadata: Last Edited stays put.
    await tabTo(page, notesListRow(page, "Untitled note"), { max: 60 });
    await chooseFromItemMenu(page, "Pin");
    await expect(lastEdited(page, "2 hours ago")).toBeVisible();

    // Tagging is metadata too.
    await tabTo(page, addTag(page), { max: 60 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("sharp");
    await page.keyboard.press("Enter");
    await expect(lastEdited(page, "2 hours ago")).toBeVisible();

    // A body edit is content: it resets Last Edited.
    await focusNoteEditor(page);
    await page.keyboard.type("Set the net.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(lastEdited(page, "seconds ago")).toBeVisible();

    // An hour later the saved body edit reads an hour old.
    await page.clock.setFixedTime(new Date("2026-06-15T15:00:00Z"));
    await page.reload();
    await expect(lastEdited(page, "1 hour ago")).toBeVisible();

    // A title edit is content as well.
    await tabTo(page, notesListRow(page, "Untitled note"), { max: 60 });
    await chooseFromItemMenu(page, "Rename");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Net Watch");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Net Watch", level: 1 })).toBeVisible();
    await expect(lastEdited(page, "seconds ago")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Net Watch", level: 1 })).toBeVisible();
    await expect(lastEdited(page, "seconds ago")).toBeVisible();
  });
});

test.describe("Note export @wf:notes-export", () => {
  test("Markdown, PDF and image exports carry the Note", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openNote(page, SEED_NOTES.keeperLog);

    const markdown = await exportDownload(page, "Export as Markdown");
    expect(markdown.suggestedFilename()).toBe("keeper-s-log.md");
    const markdownText = await readFile((await markdown.path()) as string, "utf8");
    expect(markdownText).toContain("The lamp holds through the gale.");

    const pdf = await exportDownload(page, "Export as PDF");
    expect(pdf.suggestedFilename()).toBe("keeper-s-log.pdf");
    const pdfBytes = await readFile((await pdf.path()) as string);
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    const document = await PDFDocument.load(pdfBytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);

    const png = await exportDownload(page, "Export as Image");
    expect(png.suggestedFilename()).toBe("keeper-s-log.png");
    const pngBytes = await readFile((await png.path()) as string);
    expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
