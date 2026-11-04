import { readFile } from "node:fs/promises";
import type { Download, Locator, Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { capture } from "../support/capture";
import {
  expectTabContained,
  expectFocusWithin,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { failBlobDownloads } from "../support/fault";
import { BACKUPS_CHAPTERS, BACKUPS_NOTE } from "../support/seed/backups-present";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Book Export (issue #213): the Export dialog reached from the Book Editor
// header. Downloads are captured and their contents checked — the EPUB is
// unzipped and its Table of Contents, numbered chapters, and Maibuk stylesheet
// asserted; the PDF's header, page count, and chosen page size are checked.
test.use({ library: "backupsPresent" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });

/** Opens the seeded Book and leaves focus in the Chapter list. */
async function enterBook(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "Books" }).getByRole("row")).toHaveCount(1);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chapterList(page)).toBeVisible();
}

/** Opens the Book Export dialog from the header button; focus lands on EPUB. */
async function openExportDialog(page: Page) {
  await enterBook(page);
  const trigger = page.getByRole("button", { name: "Export Book" });
  // The title bar sits above the Chapter list in document order, so Shift+Tab
  // walks back into the header to Export Book.
  await tabTo(page, trigger, { max: 40, backwards: true });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Export Book" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "EPUB", exact: true })).toBeFocused();
  return dialog;
}

async function exportDownload(page: Page, dialog: Locator, name: string): Promise<Download> {
  const button = dialog.getByRole("button", { name, exact: true });
  await tabTo(page, button, { max: 10 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

test.describe("Book export @wf:export-book-epub", () => {
  test("EPUB carries a Table of Contents, numbered chapters, and Maibuk styles", async ({
    page,
  }) => {
    const dialog = await openExportDialog(page);

    // Space toggles the EPUB switches; TOC and numbering stay on for the export.
    const toc = dialog.getByRole("switch", { name: "Include Table of Contents" });
    await tabTo(page, toc, { max: 4 });
    await page.keyboard.press("Space");
    await expect(toc).not.toBeChecked();
    await page.keyboard.press("Space");
    await expect(toc).toBeChecked();

    const numbered = dialog.getByRole("switch", { name: "Number chapters in TOC" });
    await tabTo(page, numbered, { max: 2 });
    await expect(numbered).toBeChecked();

    const download = await exportDownload(page, dialog, "Export EPUB");
    expect(download.suggestedFilename()).toBe("The_Keeper's_Atlas.epub");
    const files = unzipSync(new Uint8Array(await readFile((await download.path()) as string)));
    const texts = new Map(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));

    const all = [...texts.values()].join("\n");
    // The Book metadata travels with the EPUB (XML-escaped in the package).
    expect(all).toContain("The Keeper&#39;s Atlas");
    // Numbered chapters: the generator prefixes each Chapter title.
    expect(all).toMatch(/Chapter 1:\s*Landfall/);
    expect(all).toMatch(/Chapter 2:\s*The Light/);
    // Maibuk's stylesheet travels with the EPUB.
    expect(all).toContain('font-family: Georgia, "Times New Roman", serif');
    // Chapter text lives in the reading documents, not only in the TOC.
    const bodies = [...texts.entries()]
      .filter(([name]) => name.endsWith(".xhtml") && !name.endsWith("toc.xhtml"))
      .map(([, text]) => text)
      .join("\n");
    expect(bodies).toContain(BACKUPS_CHAPTERS[0].text);
    expect(bodies).toContain(BACKUPS_CHAPTERS[1].text);
  });

  test("Cancel closes the dialog and returns focus to the Export Book button", async ({ page }) => {
    const dialog = await openExportDialog(page);
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await tabTo(page, cancel, { max: 8 });
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Export Book" })).toBeFocused();
  });

  test("Tab stays inside the dialog and Escape closes it, returning focus to Export Book", async ({
    page,
  }) => {
    const dialog = await openExportDialog(page);
    await expectTabContained(page, dialog);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Export Book" })).toBeFocused();
  });
});

test.describe("Book export @wf:export-book-pdf", () => {
  test("with PDF chosen, Tab stays inside the dialog and Escape closes it", async ({ page }) => {
    const dialog = await openExportDialog(page);
    await tabTo(page, dialog.getByRole("button", { name: "PDF", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("switch", { name: "Include page numbers" })).toBeVisible();
    await expectTabContained(page, dialog);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Export Book" })).toBeFocused();
  });

  test("PDF uses the chosen page size, margins, and page numbers", async ({ page }) => {
    const dialog = await openExportDialog(page);
    await tabTo(page, dialog.getByRole("button", { name: "PDF", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");

    const pageNumbers = dialog.getByRole("switch", { name: "Include page numbers" });
    await tabTo(page, pageNumbers, { max: 8 });
    await expect(pageNumbers).toBeChecked();
    await page.keyboard.press("Space");
    await expect(pageNumbers).not.toBeChecked();
    await page.keyboard.press("Space");
    await expect(pageNumbers).toBeChecked();

    // Page size: open the listbox by keyboard and arrow onto US Letter.
    const pageSize = dialog.getByRole("button", { name: "Page size" });
    await tabTo(page, pageSize, { max: 6 });
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name: "US Letter" }), {
      max: 4,
    });
    await page.keyboard.press("Enter");
    await expect(pageSize).toContainText("US Letter");

    // Margins: same listbox path, choosing Wide. A fresh tabTo keeps this robust
    // to where the Select restored focus after the page-size selection.
    const margins = dialog.getByRole("button", { name: "Margins" });
    await tabTo(page, margins, { max: 12 });
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name: "Wide" }), {
      max: 4,
    });
    await page.keyboard.press("Enter");
    await expect(margins).toContainText("Wide");

    const download = await exportDownload(page, dialog, "Export PDF");
    expect(download.suggestedFilename()).toBe("The_Keeper's_Atlas.pdf");
    const bytes = await readFile((await download.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    // US Letter measures 612 × 792 pt.
    const { width, height } = document.getPage(0).getSize();
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
  });

  test("a failed export shows the failure message and keeps the dialog open", async ({ page }) => {
    const dialog = await openExportDialog(page);
    await tabTo(page, dialog.getByRole("button", { name: "PDF", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");

    await failBlobDownloads(page);
    const pdfButton = dialog.getByRole("button", { name: "Export PDF", exact: true });
    await tabTo(page, pdfButton, { max: 10 });
    await page.keyboard.press("Enter");

    await expect(dialog.getByText("Export failed", { exact: true })).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});

// PDF text warning (issue #706): the PDF's built-in fonts encode through
// Windows-1252, so text outside it would come out garbled. Both PDF paths warn
// first, and the author chooses whether to continue. The Polish words below are
// the ones the issue rendered as garbage; the EPUB keeps them.
const UNSUPPORTED_TEXT = "Zażółć gęślą jaźń";

const warningDialog = (page: Page) =>
  page.getByRole("alertdialog", { name: "Some text may be unreadable in this PDF" });

/** Watches every download the page starts, so a cancelled export can be proven to start none. */
function recordDownloads(page: Page): Download[] {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  return downloads;
}

/** Types the unsupported text into the open editor and waits until the Chapter or Note is saved. */
async function typeUnsupportedText(page: Page, textbox: Locator): Promise<void> {
  await tabTo(page, textbox, { max: 80 });
  await expect(textbox).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${UNSUPPORTED_TEXT}`);
  await expect(textbox).toContainText(UNSUPPORTED_TEXT);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test.describe("PDF text warning @wf:export-pdf-text-warning", () => {
  test("a Book PDF with unsupported text warns first, and only Export PDF anyway downloads", async ({
    page,
  }) => {
    const downloads = recordDownloads(page);
    await enterBook(page);
    await typeUnsupportedText(page, editorText(page));

    // Back out of the editor and walk up into the header's Export Book button.
    await page.keyboard.press("Escape");
    await expect(chapterList(page)).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Export Book" }), {
      max: 40,
      backwards: true,
    });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Export Book" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "PDF", exact: true }), { max: 6 });
    await page.keyboard.press("Enter");

    const exportPdf = dialog.getByRole("button", { name: "Export PDF", exact: true });
    await tabTo(page, exportPdf, { max: 10 });
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(warning).toBeVisible();
    expect(downloads).toHaveLength(0);
    await capture(page, "pdf-text-warning-book", { around: [warning] });
    await expectTabContained(page, warning);
    await expect(
      warning.getByRole("button", { name: "Export PDF anyway", exact: true })
    ).toBeVisible();

    // Escape closes only the warning: the Export dialog stays up and nothing downloads.
    await page.keyboard.press("Escape");
    await expect(warning).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(downloads).toHaveLength(0);
    await expect(exportPdf).toBeFocused();

    // The same warning returns, and its Cancel exports nothing either.
    await page.keyboard.press("Enter");
    await expect(warning).toBeVisible();
    await tabTo(page, warning.getByRole("button", { name: "Cancel", exact: true }), { max: 4 });
    await page.keyboard.press("Enter");
    await expect(warning).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(downloads).toHaveLength(0);
    await expect(exportPdf).toBeFocused();

    // Export PDF anyway is the only path that starts the download.
    await page.keyboard.press("Enter");
    await expect(warning).toBeVisible();
    await tabTo(page, warning.getByRole("button", { name: "Export PDF anyway", exact: true }), {
      max: 4,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    expect(download.suggestedFilename()).toBe("The_Keeper's_Atlas.pdf");
    const bytes = await readFile((await download.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("a Note PDF with unsupported text warns first, and Export PDF anyway downloads", async ({
    page,
  }) => {
    const downloads = recordDownloads(page);
    // The Note editor's toolbar holds the export buttons; an expanded toolbar
    // wraps them into view instead of clipping the row.
    await seedSettings(page, { toolbarExpanded: true });

    const gallery = page.getByRole("grid", { name: "Notes" });
    await page.goto("/notes");
    await expect(gallery.getByRole("row").first()).toBeVisible();
    await tabTo(page, gallery.getByRole("row").first(), { max: 40 });
    await pressUntilFocused(
      page,
      "ArrowRight",
      gallery.getByRole("row", { name: BACKUPS_NOTE, exact: true }),
      { max: 10 }
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/.+/);

    const noteText = page.getByRole("textbox", { name: "Text", exact: true });
    await typeUnsupportedText(page, noteText);

    // Escape leaves the writing surface; Tab then walks the title bar into the
    // editor toolbar, which is one Tab stop that the arrows move through.
    await page.keyboard.press("Escape");
    const toolbar = page.getByRole("toolbar", { name: "Toolbar" });
    for (let i = 0; i < 40 && !(await isFocusWithin(toolbar)); i++) {
      await page.keyboard.press("Tab");
    }
    await expectFocusWithin(toolbar);
    await page.keyboard.press("Home");
    await pressUntilFocused(
      page,
      "ArrowRight",
      toolbar.getByRole("button", { name: "Export as PDF", exact: true }),
      { max: 160 }
    );
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(warning).toBeVisible();
    expect(downloads).toHaveLength(0);
    await capture(page, "pdf-text-warning-note", { around: [warning] });

    await tabTo(page, warning.getByRole("button", { name: "Export PDF anyway", exact: true }), {
      max: 4,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    expect(download.suggestedFilename()).toBe("tide-notes.pdf");
    const bytes = await readFile((await download.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
