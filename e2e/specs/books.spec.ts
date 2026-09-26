import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURE_DIR, HARBOR_LOG, LOCKED_EPUB, TEXT_FIXTURE_DIR } from "../support/fixtures/epubs";
import {
  expectFocusWithin,
  expectTabContained,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS, SHELF_BOOKS } from "../support/seed/names";
import { expect, test } from "../support/test";

// Books and the Book Gallery, by keyboard. bookShelf holds, in Gallery order,
// The Lighthouse Keeper (In Progress), Salt and Iron (Draft), Winter Orchard
// (Completed), and The Old Map (Archived, hidden by the default filter).

const [SALT, ORCHARD, OLD_MAP] = SHELF_BOOKS;

async function openGallery(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.getByRole("grid", { name: "Books" }).getByRole("row", { name: title });

const bookActions = (page: Page) => page.getByRole("toolbar", { name: "Book actions" });

/** Opens a Book from the Gallery; focus lands in its Chapter text, Esc leaves it. */
async function openBook(page: Page, index: number, title: string) {
  await expect(card(page, title)).toBeVisible();
  await page.keyboard.press(String(index));
  await expect(card(page, title)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Text of / })).toBeFocused();
  await page.keyboard.press("Escape");
  await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
}

async function openBookSettings(page: Page) {
  const trigger = page.getByRole("button", { name: "Book Settings" });
  await tabTo(page, trigger, { max: 80 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book Settings" });
  await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
  return { dialog, trigger };
}

/** Focuses a card the way an author finds it: 1, then arrows. */
async function focusCard(page: Page, title: string) {
  await expect(card(page, title)).toBeVisible();
  await page.keyboard.press("1");
  await pressUntilFocused(page, "ArrowRight", card(page, title));
}

/** Opens a card's status popover from the card, by Tab onto its button. */
async function openStatusMenu(page: Page, title: string) {
  await focusCard(page, title);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: `Change status of ${title}` })).toBeFocused();
  await page.keyboard.press("Enter");
  return page.getByRole("listbox", { name: `Change status of ${title}` });
}

async function openStatusFilter(page: Page) {
  const filter = bookActions(page).getByRole("button", { name: /Filter by status/ });
  await tabTo(page, bookActions(page).getByRole("button").first());
  await pressUntilFocused(page, "ArrowLeft", filter);
  await page.keyboard.press("Enter");
  return page.getByRole("listbox", { name: "Filter by status" });
}

/** g p: back to the Gallery. page.goto("/") would reopen the last screen instead. */
async function backToGallery(page: Page) {
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

test.describe("empty Gallery @wf:books-empty-state", () => {
  test("Start writing is reachable by Tab and opens New Book", async ({ page }) => {
    await openGallery(page);
    await expect(page.getByRole("heading", { name: "Your stories begin here" })).toBeVisible();
    const start = page.getByRole("button", { name: "Start writing" });

    await tabTo(page, start);
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "New Book" });
    await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(start).toBeFocused();
  });
});

test.describe("moving between Books @wf:books-navigate-collection @sc:home.moveSelection @sc:home.openSelected", () => {
  test.use({ library: "bookShelf" });

  test("arrows and j/k move between cards; Enter opens the focused Book", async ({ page }) => {
    await openGallery(page);
    await expect(card(page, SEED_BOOK.title)).toBeVisible();
    await page.keyboard.press("1");
    await expect(card(page, SEED_BOOK.title)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(card(page, SALT.title)).toBeFocused();
    await page.keyboard.press("j");
    await expect(card(page, ORCHARD.title)).toBeFocused();
    await page.keyboard.press("k");
    await expect(card(page, SALT.title)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(card(page, SEED_BOOK.title)).toBeFocused();
    await page.keyboard.press("j");
    await expect(card(page, SALT.title)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: SALT.title, level: 1 })).toBeVisible();
  });

  test("Home and End reach the first and last card", async ({ page }) => {
    await openGallery(page);
    await expect(card(page, SEED_BOOK.title)).toBeVisible();
    await page.keyboard.press("2");
    await expect(card(page, SALT.title)).toBeFocused();

    await page.keyboard.press("End");
    await expect(card(page, ORCHARD.title)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(card(page, SEED_BOOK.title)).toBeFocused();
  });
});

test.describe("number keys @wf:books-jump-number @sc:home.jumpBooks", () => {
  test.use({ library: "bookShelf" });

  test("1-9 jump to the Nth Book; Enter opens it", async ({ page }) => {
    await openGallery(page);
    await expect(card(page, ORCHARD.title)).toBeVisible();

    await page.keyboard.press("3");
    await expect(card(page, ORCHARD.title)).toBeFocused();
    await page.keyboard.press("1");
    await expect(card(page, SEED_BOOK.title)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  });

  test("a number past the last Book does nothing", async ({ page }) => {
    await openGallery(page);
    await expect(card(page, SALT.title)).toBeVisible();
    await page.keyboard.press("2");
    await expect(card(page, SALT.title)).toBeFocused();

    await page.keyboard.press("9");

    await expect(card(page, SALT.title)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("Book Status filter @wf:books-status-filter", () => {
  test.use({ library: "bookShelf" });

  test("showing Archived Books is announced, and a reload keeps the filter", async ({ page }) => {
    await openGallery(page);
    await expect(page.getByText("Showing 3 books")).toBeVisible();
    await expect(card(page, OLD_MAP.title)).toHaveCount(0);

    const options = await openStatusFilter(page);
    const archived = options.getByRole("option", { name: /^Archived/ });
    await pressUntilFocused(page, "ArrowDown", archived);
    await page.keyboard.press("Space");
    await expect(archived).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(bookActions(page).getByRole("button", { name: /Filter by status/ })).toBeFocused();

    await expect(page.getByText("Showing 4 books")).toBeVisible();
    await expect(card(page, OLD_MAP.title)).toBeVisible();

    await page.reload();
    await expect(card(page, OLD_MAP.title)).toBeVisible();
    await expect(page.getByText("Showing 4 books")).toBeVisible();
  });

  test("a filter that matches nothing says so and offers every status back", async ({ page }) => {
    await openGallery(page);
    const options = await openStatusFilter(page);
    for (const name of ["Draft", "In Progress", "Completed"]) {
      const option = options.getByRole("option", { name: new RegExp(`^${name}`) });
      await pressUntilFocused(page, "ArrowDown", option);
      await page.keyboard.press("Space");
      await expect(option).toHaveAttribute("aria-selected", "false");
    }
    await page.keyboard.press("Escape");

    await expect(page.getByText("No books match this filter")).toBeVisible();
    const showAll = page.getByRole("button", { name: "Show all statuses" });
    await tabTo(page, showAll);
    await page.keyboard.press("Enter");
    await expect(card(page, OLD_MAP.title)).toBeVisible();
    await expect(card(page, SEED_BOOK.title)).toBeVisible();
  });
});

test.describe("status from the card @wf:books-change-status", () => {
  test.use({ library: "bookShelf" });

  test("pick a status with arrows and Enter: toast, focus back on the card, kept after reload", async ({
    page,
  }) => {
    await openGallery(page);
    await expect(card(page, SALT.title)).toBeVisible();
    const menu = await openStatusMenu(page, SALT.title);
    await expect(menu.getByRole("option", { name: "Draft" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("option", { name: "In Progress" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect(toast(page, `Set "${SALT.title}" to In Progress`)).toBeVisible();
    await expect(card(page, SALT.title)).toBeFocused();
    await expect(card(page, SALT.title)).toContainText("In Progress");

    await page.reload();
    await expect(card(page, SALT.title)).toContainText("In Progress");
  });

  test("Esc closes the status list without a change", async ({ page }) => {
    await openGallery(page);
    await expect(card(page, SALT.title)).toBeVisible();
    const menu = await openStatusMenu(page, SALT.title);
    await page.keyboard.press("ArrowDown");

    await page.keyboard.press("Escape");

    await expect(menu).toBeHidden();
    await expect(card(page, SALT.title)).toBeFocused();
    await expect(card(page, SALT.title)).toContainText("Draft");
  });
});

test.describe("Archive and Unarchive @wf:books-archive-unarchive", () => {
  test.use({ library: "bookShelf" });

  test("Archived leaves the default Gallery; Unarchive brings it back; both survive reload", async ({
    page,
  }) => {
    await openGallery(page);
    await expect(card(page, SALT.title)).toBeVisible();
    const menu = await openStatusMenu(page, SALT.title);
    await pressUntilFocused(page, "ArrowDown", menu.getByRole("option", { name: "Archived" }));
    await page.keyboard.press("Enter");

    await expect(toast(page, `Archived "${SALT.title}"`)).toBeVisible();
    await expect(card(page, SALT.title)).toHaveCount(0);
    await expectFocusWithin(page.getByRole("grid", { name: "Books" }));
    await page.reload();
    await expect(card(page, ORCHARD.title)).toBeVisible();
    await expect(card(page, SALT.title)).toHaveCount(0);

    const options = await openStatusFilter(page);
    await pressUntilFocused(page, "ArrowDown", options.getByRole("option", { name: /^Archived/ }));
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(card(page, SALT.title)).toBeVisible();

    const statusMenu = await openStatusMenu(page, SALT.title);
    await pressUntilFocused(page, "ArrowUp", statusMenu.getByRole("option", { name: "Draft" }));
    await page.keyboard.press("Enter");
    await expect(toast(page, `Unarchived "${SALT.title}"`)).toBeVisible();

    await page.reload();
    await expect(card(page, SALT.title)).toContainText("Draft");
  });
});

test.describe("Book Settings @wf:books-settings-dialog", () => {
  test.use({ library: "bookShelf" });

  test("edit every field by keyboard and Save; a reload keeps them", async ({ page }) => {
    await openGallery(page);
    await openBook(page, 1, SEED_BOOK.title);
    const { dialog, trigger } = await openBookSettings(page);
    await expectTabContained(page, dialog);
    await tabTo(page, dialog.getByRole("textbox", { name: "Book Title" }));

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("The Last Lighthouse");
    await page.keyboard.press("Tab");
    await page.keyboard.type("A Novel");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("A. Marsh");
    await page.keyboard.press("Tab");
    await page.keyboard.type("A keeper and a storm.");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Literary");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: /Language/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name: "Español" }));
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: /Language/ })).toContainText("Español");
    await tabTo(page, dialog.getByRole("spinbutton", { name: "Target Word Count" }));
    await page.keyboard.type("90000");
    const completed = dialog
      .getByRole("group", { name: "Status" })
      .getByRole("button", { name: "Completed" });
    await tabTo(page, completed);
    await page.keyboard.press("Enter");
    await expect(completed).toHaveAttribute("aria-pressed", "true");

    await tabTo(page, dialog.getByRole("button", { name: "Save" }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "The Last Lighthouse", level: 1 })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The Last Lighthouse", level: 1 })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const reopened = await openBookSettings(page);
    await expect(reopened.dialog.getByRole("textbox", { name: "Subtitle" })).toHaveValue("A Novel");
    await expect(reopened.dialog.getByRole("textbox", { name: "Author Name" })).toHaveValue(
      "A. Marsh"
    );
    await expect(reopened.dialog.getByRole("textbox", { name: "Description" })).toHaveValue(
      "A keeper and a storm."
    );
    await expect(reopened.dialog.getByRole("textbox", { name: "Genre" })).toHaveValue("Literary");
    await expect(reopened.dialog.getByRole("button", { name: /Language/ })).toContainText(
      "Español"
    );
    await expect(
      reopened.dialog.getByRole("spinbutton", { name: "Target Word Count" })
    ).toHaveValue("90000");
    await expect(
      reopened.dialog
        .getByRole("group", { name: "Status" })
        .getByRole("button", { name: "Completed" })
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Cancel and Esc discard changes and return focus to Book Settings", async ({ page }) => {
    await openGallery(page);
    await openBook(page, 1, SEED_BOOK.title);
    const { dialog, trigger } = await openBookSettings(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Discarded");

    await tabTo(page, dialog.getByRole("button", { name: "Cancel" }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "Book Title" })).toHaveValue(SEED_BOOK.title);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Also discarded");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  });

  test("an invalid Target Word Count is refused with focus on the field", async ({ page }) => {
    await openGallery(page);
    await openBook(page, 1, SEED_BOOK.title);
    const { dialog } = await openBookSettings(page);
    const target = dialog.getByRole("spinbutton", { name: "Target Word Count" });
    await tabTo(page, target);
    await page.keyboard.type("-5");
    await page.keyboard.press("Enter");

    await expect(target).toHaveAccessibleDescription("Enter a whole number of words, 0 or more");
    await expect(target).toBeFocused();
    await expect(dialog).toBeVisible();
  });

  test("an empty title is refused with focus on it", async ({ page }) => {
    await openGallery(page);
    await openBook(page, 1, SEED_BOOK.title);
    const { dialog } = await openBookSettings(page);
    const title = dialog.getByRole("textbox", { name: "Book Title" });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");

    await expect(title).toHaveAccessibleDescription("Title is required");
    await expect(title).toBeFocused();
  });
});

test.describe("deleting a Book @wf:books-delete", () => {
  test.use({ library: "bookShelf" });

  async function askToDelete(page: Page) {
    await openGallery(page);
    await openBook(page, 2, SALT.title);
    const { dialog } = await openBookSettings(page);
    await tabTo(page, dialog.getByRole("button", { name: "Danger Zone" }));
    await page.keyboard.press("Enter");
    const deleteBook = dialog.getByRole("button", { name: "Delete Book" });
    await tabTo(page, deleteBook);
    await page.keyboard.press("Enter");
    const confirm = dialog.getByRole("group", {
      name: /Are you sure you want to delete this book/,
    });
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    return { dialog, confirm, deleteBook };
  }

  test("confirming removes the Book and lands in the Gallery; a reload agrees", async ({
    page,
  }) => {
    const { confirm } = await askToDelete(page);
    await page.keyboard.press("Shift+Tab");
    await expect(confirm.getByRole("button", { name: "Yes, delete book" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await expect(card(page, SALT.title)).toHaveCount(0);
    await expectFocusWithin(page.getByRole("main", { name: "Main content" }));
    await page.reload();
    await expect(card(page, SEED_BOOK.title)).toBeVisible();
    await expect(card(page, SALT.title)).toHaveCount(0);
  });

  test("Cancel keeps the Book and returns focus to Delete Book", async ({ page }) => {
    const { dialog, deleteBook } = await askToDelete(page);
    await page.keyboard.press("Enter");

    await expect(deleteBook).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await backToGallery(page);
    await expect(card(page, SALT.title)).toBeVisible();
  });
});

test.describe("EPUB Import @wf:books-import-epub", () => {
  async function chooseEpub(page: Page, file: string) {
    await openGallery(page);
    const importEpub = bookActions(page).getByRole("button", { name: "Import EPUB" });
    await tabTo(page, bookActions(page).getByRole("button").first());
    await pressUntilFocused(page, "ArrowRight", importEpub);
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles(resolve(FIXTURE_DIR, file));
    const dialog = page.getByRole("dialog", { name: "Import EPUB" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    return { dialog, importEpub };
  }

  test("the Compatibility Report is acknowledged with Space, then Import creates the Book", async ({
    page,
  }) => {
    const { dialog } = await chooseEpub(page, HARBOR_LOG.file);
    await expect(dialog.getByRole("heading", { name: HARBOR_LOG.title })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Compatibility report" })).toBeVisible();
    const importButton = dialog.getByRole("button", { name: "Import EPUB" });
    await expect(importButton).toBeDisabled();
    await expectTabContained(page, dialog);

    const acknowledge = dialog.getByRole("switch", { name: "Acknowledge compatibility warnings" });
    await tabTo(page, acknowledge);
    await page.keyboard.press("Space");
    await expect(acknowledge).toBeChecked();
    await tabTo(page, importButton);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("heading", { name: HARBOR_LOG.title, level: 1 })).toBeVisible();
    const chapters = page.getByRole("grid", { name: "Chapters" }).getByRole("row");
    await expect(chapters).toHaveText(HARBOR_LOG.chapters.map((c) => new RegExp(c.title)));

    await page.keyboard.press("Escape");
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    await backToGallery(page);
    await expect(card(page, HARBOR_LOG.title)).toBeVisible();
  });

  test("Cancel imports nothing and returns focus to Import EPUB", async ({ page }) => {
    const { dialog, importEpub } = await chooseEpub(page, HARBOR_LOG.file);
    await tabTo(page, dialog.getByRole("button", { name: "Cancel" }));
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(importEpub).toBeFocused();
    await expect(page.getByRole("heading", { name: "Your stories begin here" })).toBeVisible();
  });

  test("a blocked EPUB explains why and cannot be imported", async ({ page }) => {
    const { dialog } = await chooseEpub(page, LOCKED_EPUB.file);
    await expect(dialog).toContainText("Encrypted or DRM-protected EPUB files cannot be imported.");
    await expect(dialog.getByRole("button", { name: "Import EPUB" })).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Your stories begin here" })).toBeVisible();
  });
});

test.describe("Markdown and text Import @wf:books-import-md-txt", () => {
  test.use({ library: "oneBookThreeChapters" });

  async function pickFiles(page: Page, files: string[]) {
    await openGallery(page);
    await openBook(page, 1, SEED_BOOK.title);
    const importFiles = page.getByRole("button", { name: "Import chapters from files" });
    await tabTo(page, importFiles);
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBe(true);
    await fileChooser.setFiles(files.map((file) => resolve(TEXT_FIXTURE_DIR, file)));
  }

  test("picked Markdown and text files become Chapters at the end; a reload keeps them", async ({
    page,
  }) => {
    await pickFiles(page, ["The Keeper's Journal.md", "Tide Tables.txt"]);

    const rows = page.getByRole("grid", { name: "Chapters" }).getByRole("row");
    await expect(rows).toHaveText([
      ...SEED_CHAPTERS.map((c) => new RegExp(c.title)),
      /The Keeper's Journal/,
      /Tide Tables/,
    ]);
    // The last imported Chapter is open; open the Markdown one from the list.
    const journalRow = page
      .getByRole("grid", { name: "Chapters" })
      .getByRole("row", { name: "The Keeper's Journal" });
    await tabTo(page, rows.last());
    await pressUntilFocused(page, "ArrowUp", journalRow);
    await page.keyboard.press("Enter");
    const journal = page.getByRole("textbox", { name: "Text of The Keeper's Journal" });
    await expect(journal.locator("strong")).toHaveText("first");
    await expect(journal.getByRole("listitem")).toHaveText(["Oil: two measures", "Wick: trimmed"]);

    await page.reload();
    await expect(rows).toHaveText([
      ...SEED_CHAPTERS.map((c) => new RegExp(c.title)),
      /The Keeper's Journal/,
      /Tide Tables/,
    ]);
  });

  test("an unsupported file is refused with a message and adds nothing", async ({ page }) => {
    await pickFiles(page, ["lighthouse-sketch.csv"]);

    await expect(page.getByRole("alert").or(page.getByRole("status"))).toContainText([
      /No supported text files/,
    ]);
    await expect(page.getByRole("grid", { name: "Chapters" }).getByRole("row")).toHaveCount(3);
  });
});
