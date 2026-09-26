import { readFile } from "node:fs/promises";
import type { Download, Locator, Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { failBlobDownloads } from "../support/fault";
import { BACKUPS_CHAPTERS } from "../support/seed/backups-present";
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
  await tabTo(page, trigger, { max: 40 });
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
});

test.describe("Book export @wf:export-book-pdf", () => {
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
