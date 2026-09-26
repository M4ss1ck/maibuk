import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expectFocusWithin, expectTabContained, tabTo } from "../support/keyboard";
import { BACKUPS_BOOK, BACKUPS_CANVAS } from "../support/seed/backups-present";
import { expect, test } from "../support/test";

// Database File and Reset (issue #213): Export and Import the SQL Database
// File, and Reset the Library, all from Settings > Advanced by keyboard. The
// web build downloads the file and reads one back through a file chooser.
test.use({ library: "backupsPresent" });

const INVALID_SQL = resolve(import.meta.dirname, "../fixtures/not-a-database.sql");
const booksRow = (page: Page) => page.getByRole("grid", { name: "Books" }).getByRole("row");

async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/**
 * Opens the Books gallery by keyboard and settles on its screen. `/` would
 * re-open the last visited screen instead, so use the global "g p" sequence.
 * The screen heading, not the grid, is the signal: an empty Library has no grid.
 */
async function openBooksGallery(page: Page): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}

/** Expands the Advanced section and returns it; its buttons are now visible. */
async function openAdvanced(page: Page): Promise<Locator> {
  const toggle = page.getByRole("button", { name: "Advanced" }).last();
  await tabTo(page, toggle, { max: 60 });
  await page.keyboard.press("Enter");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Export", exact: true }) });
  await expect(section.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  return section;
}

async function exportDatabaseFile(page: Page, section: Locator): Promise<string> {
  await tabTo(page, section.getByRole("button", { name: "Export", exact: true }), { max: 10 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  expect(download.suggestedFilename()).toMatch(/^maibuk-backup-\d{4}-\d{2}-\d{2}\.sql$/);
  return (await download.path()) as string;
}

/** Renames the seeded Book through Book Settings, so an import must overwrite it. */
async function renameBook(page: Page, title: string): Promise<void> {
  await openBooksGallery(page);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: /^Text of / })).toBeFocused();
  await page.keyboard.press("Escape");
  await tabTo(page, page.getByRole("button", { name: "Book Settings" }), { max: 40 });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book Settings" });
  const field = dialog.getByRole("textbox", { name: "Book Title" });
  await expect(field).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(title);
  await tabTo(page, dialog.getByRole("button", { name: "Save" }), { max: 40 });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** Deletes the seeded Canvas, so an import must add it back. */
async function deleteCanvas(page: Page): Promise<void> {
  await page.goto("/canvas");
  const card = page.getByRole("grid", { name: "Canvases" }).getByRole("row", {
    name: BACKUPS_CANVAS,
  });
  await expect(card).toHaveCount(1);
  await tabTo(page, card, { max: 40 });
  await tabTo(page, card.getByRole("button", { name: "Delete canvas" }), { max: 6 });
  await page.keyboard.press("Enter");
  await tabTo(page, card, { max: 60 });
  await tabTo(page, card.getByRole("button", { name: "Delete canvas", exact: true }), { max: 6 });
  await page.keyboard.press("Enter");
  await expect(card).toHaveCount(0);
}

test.describe("Export Database @wf:database-export", () => {
  test("Export downloads a SQL dump that contains the Books", async ({ page }) => {
    await openSettings(page);
    const section = await openAdvanced(page);

    const path = await exportDatabaseFile(page, section);
    const sql = await readFile(path, "utf8");
    expect(sql).toContain("-- Maibuk Database Export (SQL Dump)");
    expect(sql).toContain("-- Books");
    expect(sql).toContain('INSERT OR REPLACE INTO "books"');
    expect(sql).toContain("Keeper");
    // The seeded Canvas is in the dump too.
    expect(sql).toContain("-- Canvases");
    expect(sql).toContain("Harbor Plan");
  });
});

test.describe("Import Database @wf:database-import", () => {
  test("Import adds and overwrites rows, after a pre-restore Backup", async ({ page }) => {
    // Many keyboard-navigation steps (two Settings visits, the Books gallery,
    // Canvas deletion, the file chooser); it runs close to the 30s default.
    test.slow();
    await openSettings(page);
    const section = await openAdvanced(page);
    const path = await exportDatabaseFile(page, section);

    // Change the Library the export must overcome: a renamed Book (overwrite)
    // and a missing Canvas (add).
    await renameBook(page, "Changed Atlas");
    await deleteCanvas(page);

    await openSettings(page);
    const advanced = await openAdvanced(page);
    const importButton = advanced.getByRole("button", { name: "Import", exact: true });
    await tabTo(page, importButton, { max: 10 });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.keyboard.press("Enter"),
    ]);
    await chooser.setFiles(path);

    // Import reloads the app; the Library is back and a safety Backup exists.
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Pre-restore" })).toHaveCount(1);

    await page.goto("/canvas");
    await expect(
      page.getByRole("grid", { name: "Canvases" }).getByRole("row", { name: BACKUPS_CANVAS })
    ).toHaveCount(1);

    await openBooksGallery(page);
    await expect(booksRow(page)).toHaveCount(1);
    await expect(booksRow(page).first()).toContainText(BACKUPS_BOOK.title);
  });

  test("an invalid file leaves the Library untouched", async ({ page }) => {
    await openSettings(page);
    const section = await openAdvanced(page);
    const importButton = section.getByRole("button", { name: "Import", exact: true });

    const alert = page.waitForEvent("dialog");
    await tabTo(page, importButton, { max: 10 });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.keyboard.press("Enter"),
    ]);
    await chooser.setFiles(INVALID_SQL);

    const dialog = await alert;
    expect(dialog.message()).toBe(
      "Import failed. Check that the file is a valid Maibuk database export."
    );
    await dialog.dismiss();

    await openBooksGallery(page);
    await expect(booksRow(page)).toHaveCount(1);
    await expect(booksRow(page).first()).toContainText(BACKUPS_BOOK.title);
  });
});

test.describe("Reset Library @wf:library-reset", () => {
  test("Reset clears the Library, keeps settings, and enters the dialog with focus", async ({
    page,
  }) => {
    await openSettings(page);
    // A setting to prove the reset keeps settings: dark theme.
    const dark = page.getByRole("button", { name: "Dark", exact: true }).first();
    await tabTo(page, dark, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveClass(/dark/);

    const section = await openAdvanced(page);
    await tabTo(page, section.getByRole("button", { name: "Reset", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Reset Library" });
    await expect(dialog).toBeVisible();
    // The Modal focuses its dialog container (the app's convention, same as the
    // Delete Note dialog), so assert focus is inside rather than on Cancel.
    await expectFocusWithin(dialog);
    await expectTabContained(page, dialog);

    await tabTo(page, dialog.getByRole("button", { name: "Yes, reset everything" }), { max: 4 });
    // Reset reloads the app itself; wait for the fresh document before driving it.
    const reloaded = page.waitForEvent("load");
    await page.keyboard.press("Enter");
    await reloaded;

    // The reloaded app keeps settings (dark); the Library is empty.
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await openBooksGallery(page);
    await expect(page.getByText("Your stories begin here")).toBeVisible();
    await expect(booksRow(page)).toHaveCount(0);

    await page.goto("/notes");
    await expect(page.getByText("No notes yet. Capture your first thought.")).toBeVisible();

    await page.goto("/canvas");
    await expect(page.getByText("No canvases yet")).toBeVisible();

    await page.reload();
    await expect(page.getByText("No canvases yet")).toBeVisible();
  });

  test("Cancel keeps the Library", async ({ page }) => {
    await openSettings(page);
    const section = await openAdvanced(page);
    await tabTo(page, section.getByRole("button", { name: "Reset", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Reset Library" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(section.getByRole("button", { name: "Reset", exact: true })).toBeFocused();

    await openBooksGallery(page);
    await expect(booksRow(page)).toHaveCount(1);
    await expect(booksRow(page).first()).toContainText(BACKUPS_BOOK.title);
  });
});
