import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { Download, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  expectTabContained,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { runPaletteCommand } from "../support/palette";
import { BACKUPS_NOTE } from "../support/seed/backups-present";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// PDF Fonts (issue #709): a PDF export whose text the built-in fonts cannot
// show offers the pinned Noto fonts in the warning; the downloaded file makes
// the export continue by itself, and the PDF reads the text back with the font
// embedded. The suite is hermetic, so this spec alone lets the pinned Noto
// files through with route.fetch() and tampers with one in the failure test.
test.use({ library: "backupsPresent" });

const LATIN_NAME = "Latin, Cyrillic, and Greek";
const CJK_NAME = "Chinese and Japanese";

const SAMPLES = {
  pl: "Zażółć gęślą jaźń",
  tr: "Pijamalı hasta yağız şoföre",
  ru: "Съешь ещё этих мягких",
  uk: "Їжак ґанок є",
  el: "Ξεσκεπάζω την ψυχοφθόρα",
} as const;
const LATIN_TEXT = Object.values(SAMPLES).join(" ");

const ZH = "我能吞下玻璃而不伤身体。";
const JA = "いろはにほへと、ちりぬるを。漢字カタカナ";
const HAN_400 = ZH.repeat(20).slice(0, 400);

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const noteText = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });
const warningDialog = (page: Page) =>
  page.getByRole("alertdialog", { name: "Some text may be unreadable in this PDF" });
const exportDialog = (page: Page) => page.getByRole("dialog", { name: "Export Book" });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const downloadButton = (warning: Locator, name: string) =>
  warning.getByRole("button", { name: new RegExp(`^Download ${name} \\(\\d+ MB\\)$`) });

interface PdfReadback {
  text: string;
  fonts: string;
  pages: number;
}

/** Reads an exported PDF back the way the spike did: pdftotext and pdffonts. */
async function readPdf(download: Download): Promise<PdfReadback> {
  const path = await download.path();
  if (!path) throw new Error("the download has no path");
  const text = execFileSync("pdftotext", ["-layout", path, "-"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const fonts = execFileSync("pdffonts", [path], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const pages = (await PDFDocument.load(await readFile(path))).getPageCount();
  return { text, fonts, pages };
}

function normalized(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * The pinned Noto files, fetched for real and cached per worker. `tamperLatin`
 * flips the final byte of NotoSerif-Regular.ttf, keeping its length and breaking
 * only its checksum.
 */
const fontFiles = new Map<string, { body: Buffer; headers: Record<string, string> }>();

async function passThroughFonts(page: Page, { tamperLatin = false } = {}): Promise<void> {
  await page.route("https://raw.githubusercontent.com/notofonts/**", async (route) => {
    const url = route.request().url();
    let cached = fontFiles.get(url);
    if (!cached) {
      const response = await route.fetch();
      const headers = response.headers();
      // fetch() already decoded the body; forwarding these would decode it twice.
      delete headers["content-encoding"];
      delete headers["content-length"];
      delete headers["transfer-encoding"];
      cached = { body: await response.body(), headers };
      fontFiles.set(url, cached);
    }
    if (tamperLatin && url.endsWith("NotoSerif-Regular.ttf")) {
      const tampered = Buffer.from(cached.body);
      tampered[tampered.length - 1] ^= 0xff;
      await route.fulfill({ status: 200, headers: cached.headers, body: tampered });
      return;
    }
    await route.fulfill({ status: 200, headers: cached.headers, body: cached.body });
  });
}

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

/** Replaces a textbox's text and waits for the Editor's Save Status. */
async function replaceText(page: Page, textbox: Locator, text: string): Promise<void> {
  await tabTo(page, textbox, { max: 80 });
  await expect(textbox).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await expect(textbox).toContainText(text.slice(0, 20));
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/**
 * Writes two paragraphs holding the same ASCII + Polish + Cyrillic sample:
 * the first a code block (Courier, then Noto), the second an inline monospace
 * span (same fallback). Both paths have to draw every glyph correctly.
 */
const MIXED_SAMPLE = "ASCII Zażółć Съешь";

/** Moves focus from the Chapter list into a named toolbar control. */
async function focusToolbarControl(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press("Escape");
  for (let i = 0; i < 40 && !(await isFocusWithin(toolbar(page))); i++) {
    await page.keyboard.press("Tab");
  }
  await expectFocusWithin(toolbar(page));
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", target, { max: 160 });
}

async function writeMixedSample(page: Page, textbox: Locator): Promise<void> {
  await tabTo(page, textbox, { max: 80 });
  await expect(textbox).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type(MIXED_SAMPLE);
  await page.keyboard.press("Enter");
  await page.keyboard.type(MIXED_SAMPLE);

  // A comparison of the default font to the built-in ones is not the point:
  // the sample becomes monospace through the toolbar, the same as the author.
  await page.keyboard.press("Shift+Home");
  const font = toolbar(page).getByRole("combobox", { name: "Font" });
  await focusToolbarControl(page, font);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("monospace");
  await page.keyboard.press("Enter");
  await expect(font).toHaveValue("monospace");

  // The first paragraph becomes the code block.
  await tabTo(page, textbox, { max: 80 });
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+Alt+c");
  await expect(textbox.getByRole("code")).toContainText(MIXED_SAMPLE);

  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function choosePdf(page: Page, dialog: Locator): Promise<void> {
  await tabTo(page, dialog.getByRole("button", { name: "PDF", exact: true }), { max: 6 });
  await page.keyboard.press("Enter");
}

/** Presses Export PDF and returns the download it starts. */
async function exportPdf(page: Page, dialog: Locator): Promise<Download> {
  const button = dialog.getByRole("button", { name: "Export PDF", exact: true });
  await tabTo(page, button, { max: 10 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

/** Walks from the Chapter list up into the header's Export Book button. */
async function openBookExport(page: Page): Promise<Locator> {
  await page.keyboard.press("Escape");
  await expect(chapterList(page)).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Export Book" }), {
    max: 40,
    backwards: true,
  });
  await page.keyboard.press("Enter");
  const dialog = exportDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Downloads the offered font from the warning and returns the export it resumes. */
async function downloadFromWarning(page: Page, warning: Locator, name: string): Promise<Download> {
  const button = downloadButton(warning, name);
  await expect(button).toBeVisible();
  await tabTo(page, button, { max: 6 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

async function openNote(page: Page): Promise<void> {
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
  await expect(noteText(page)).toBeVisible();
}

/** Runs the Note's Export as PDF button from the toolbar. */
async function exportNotePdf(page: Page): Promise<Download> {
  await page.keyboard.press("Escape");
  for (let i = 0; i < 40 && !(await isFocusWithin(toolbar(page))); i++) {
    await page.keyboard.press("Tab");
  }
  await expectFocusWithin(toolbar(page));
  await page.keyboard.press("Home");
  await pressUntilFocused(
    page,
    "ArrowRight",
    toolbar(page).getByRole("button", { name: "Export as PDF", exact: true }),
    { max: 160 }
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

/** Settings -> Export -> PDF fonts, by the outline search. */
async function openPdfFontsSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

  const outline = page.getByRole("navigation", { name: "Settings sections" });
  const search = outline.getByRole("searchbox", { name: "Search settings" });
  await tabTo(page, search, { max: 150 });
  await page.keyboard.type("pdf fonts");
  const tree = outline.getByRole("treegrid", { name: "Settings sections" });
  await page.keyboard.press("Tab");
  await pressUntilFocused(page, "ArrowDown", tree.getByRole("row", { name: "PDF fonts" }));
  await page.keyboard.press("Enter");
}

/** Downloads one font from its Settings row and waits for the button to say Remove. */
async function installFromSettings(page: Page, name: string): Promise<void> {
  const row = page.getByRole("group", { name, exact: true });
  const download = row.getByRole("button", { name: "Download", exact: true });
  await tabTo(page, download, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(row.getByRole("button", { name: "Remove", exact: true })).toBeVisible({
    timeout: 120_000,
  });
}

/** Removes one font from its Settings row. */
async function removeFromSettings(page: Page, name: string): Promise<void> {
  const row = page.getByRole("group", { name, exact: true });
  const remove = row.getByRole("button", { name: "Remove", exact: true });
  await tabTo(page, remove, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(row.getByRole("button", { name: "Download", exact: true })).toBeVisible();
}

/** Reopens the same Book after a Settings detour, leaving focus in the Chapter list. */
async function reopenBook(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(editorText(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chapterList(page)).toBeVisible();
}

test.describe("PDF fonts @wf:export-pdf-fonts @sc:export.downloadPdfFontLatin @sc:export.downloadPdfFontCjk", () => {
  test("a Book PDF downloads the Latin font, embeds it, and a Note PDF then needs no warning", async ({
    page,
  }) => {
    await passThroughFonts(page);
    await enterBook(page);
    await replaceText(page, editorText(page), LATIN_TEXT);

    const dialog = await openBookExport(page);
    await choosePdf(page, dialog);
    const exportPdfButton = dialog.getByRole("button", { name: "Export PDF", exact: true });
    await tabTo(page, exportPdfButton, { max: 10 });
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(warning).toBeVisible();
    await expect(downloadButton(warning, LATIN_NAME)).toBeVisible();
    await capture(page, "pdf-font-warning-offer", { around: [warning] });
    await expectTabContained(page, warning);

    const bookPdf = await readPdf(await downloadFromWarning(page, warning, LATIN_NAME));
    const bookText = normalized(bookPdf.text);
    for (const sample of Object.values(SAMPLES)) expect(bookText).toContain(sample);
    expect(bookPdf.fonts).toMatch(/NotoSerif/);

    // Same device, Latin font installed: the Note exports with no warning.
    await openNote(page);
    await replaceText(page, noteText(page), LATIN_TEXT);
    const notePdf = await readPdf(await exportNotePdf(page));
    const noteReadback = normalized(notePdf.text);
    for (const sample of Object.values(SAMPLES)) expect(noteReadback).toContain(sample);
    expect(notePdf.fonts).toMatch(/NotoSerif/);
  });

  test("a CJK export offers its size, embeds the font, and keeps a 400-Han paragraph on both paths", async ({
    page,
  }) => {
    // 24 MB of pinned font plus two exports: test.slow() triples the 30 s budget.
    test.slow();
    await passThroughFonts(page);
    await enterBook(page);
    await replaceText(page, editorText(page), `${ZH} ${JA} ${HAN_400}`);

    const dialog = await openBookExport(page);
    await choosePdf(page, dialog);
    const exportPdfButton = dialog.getByRole("button", { name: "Export PDF", exact: true });
    await tabTo(page, exportPdfButton, { max: 10 });
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(downloadButton(warning, CJK_NAME)).toBeVisible();
    const bookPdf = await readPdf(await downloadFromWarning(page, warning, CJK_NAME));
    const bookText = normalized(bookPdf.text);
    expect(bookText.replace(/\s+/g, "")).toContain(HAN_400);
    expect(bookText).toContain(ZH);
    expect(bookText).toContain(JA);
    expect(bookPdf.fonts).toMatch(/NotoSerif/);

    await openNote(page);
    await replaceText(page, noteText(page), `${ZH} ${JA}`);
    const notePdf = await readPdf(await exportNotePdf(page));
    const noteReadback = normalized(notePdf.text);
    expect(noteReadback).toContain(ZH);
    expect(noteReadback).toContain(JA);
    expect(notePdf.fonts).toMatch(/NotoSerif/);
  });

  test("a tampered font file fails, keeps the warning open, and installs nothing", async ({
    page,
  }) => {
    await passThroughFonts(page, { tamperLatin: true });
    await enterBook(page);
    const bookUrl = page.url();
    await replaceText(page, editorText(page), LATIN_TEXT);
    const dialog = await openBookExport(page);
    await choosePdf(page, dialog);
    await tabTo(page, dialog.getByRole("button", { name: "Export PDF", exact: true }), {
      max: 10,
    });
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(downloadButton(warning, LATIN_NAME)).toBeVisible();
    await tabTo(page, downloadButton(warning, LATIN_NAME), { max: 6 });
    await page.keyboard.press("Enter");

    await expect(warning.getByRole("status")).toHaveText("Download failed. Try again.");
    await expect(warning).toBeVisible();
    await expect(downloadButton(warning, LATIN_NAME)).toBeVisible();

    // Settings still offers the Download, so nothing was installed.
    await page.keyboard.press("Escape");
    await expect(warning).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await openPdfFontsSettings(page);
    const row = page.getByRole("group", { name: LATIN_NAME, exact: true });
    await expect(row.getByRole("button", { name: "Download", exact: true })).toBeVisible();
    await capture(page, "pdf-fonts-settings", { around: [row] });

    // Export PDF anyway still downloads.
    await reopenBook(page, bookUrl);
    const retry = await openBookExport(page);
    await choosePdf(page, retry);
    await tabTo(page, retry.getByRole("button", { name: "Export PDF", exact: true }), { max: 10 });
    await page.keyboard.press("Enter");
    const again = warningDialog(page);
    await expect(again).toBeVisible();
    await tabTo(page, again.getByRole("button", { name: "Export PDF anyway", exact: true }), {
      max: 6,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    expect((await readPdf(download)).text.length).toBeGreaterThan(0);
  });

  test("an emoji has no covering font: the warning offers no download and Continue downloads", async ({
    page,
  }) => {
    await enterBook(page);
    await replaceText(page, editorText(page), "😊");
    const dialog = await openBookExport(page);
    await choosePdf(page, dialog);
    await tabTo(page, dialog.getByRole("button", { name: "Export PDF", exact: true }), {
      max: 10,
    });
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(warning).toBeVisible();
    await expect(warning.getByRole("button", { name: /^Download / })).toHaveCount(0);
    await tabTo(page, warning.getByRole("button", { name: "Export PDF anyway", exact: true }), {
      max: 8,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    expect((await readPdf(download)).text).toContain("The Keeper's Atlas");
  });

  test("English and Spanish keep the built-in fonts, with the same pages after both fonts are installed", async ({
    page,
  }) => {
    // 27 MB of pinned fonts: test.slow() triples the 30 s budget.
    test.slow();
    await passThroughFonts(page);
    await enterBook(page);
    const bookUrl = page.url();
    await replaceText(page, editorText(page), "The quick brown fox — “quoted” … €5");

    const before = await openBookExport(page);
    await choosePdf(page, before);
    const beforePdf = await readPdf(await exportPdf(page, before));
    expect(beforePdf.fonts).toMatch(/Times-Roman/);
    await page.keyboard.press("Escape");

    await openPdfFontsSettings(page);
    await installFromSettings(page, LATIN_NAME);
    await installFromSettings(page, CJK_NAME);

    await reopenBook(page, bookUrl);
    const after = await openBookExport(page);
    await choosePdf(page, after);
    await tabTo(page, after.getByRole("button", { name: "Export PDF", exact: true }), { max: 10 });
    const afterPdf = await readPdf(await exportPdf(page, after));
    expect(afterPdf.pages).toBe(beforePdf.pages);
    expect(afterPdf.fonts).toMatch(/Times-Roman/);
    expect(afterPdf.fonts).not.toMatch(/Noto/);

    // Spanish, Note path, both fonts installed: still no warning.
    await openNote(page);
    await replaceText(page, noteText(page), "¿Dónde está el niño? ¡Mañana!");
    const notePdf = await readPdf(await exportNotePdf(page));
    expect(notePdf.fonts).toMatch(/Times-Roman/);
    expect(notePdf.fonts).not.toMatch(/Noto/);
  });

  test("Remove in Settings returns the warning, and the Command Palette installs the font by label", async ({
    page,
  }) => {
    await passThroughFonts(page);
    await enterBook(page);
    const bookUrl = page.url();
    await replaceText(page, editorText(page), LATIN_TEXT);

    // Install through the Settings row, then Remove it.
    await openPdfFontsSettings(page);
    await installFromSettings(page, LATIN_NAME);
    const row = page.getByRole("group", { name: LATIN_NAME, exact: true });
    await capture(page, "pdf-fonts-settings", { around: [row] });
    await removeFromSettings(page, LATIN_NAME);

    // Remove returns the warning.
    await reopenBook(page, bookUrl);
    const dialog = await openBookExport(page);
    await choosePdf(page, dialog);
    await tabTo(page, dialog.getByRole("button", { name: "Export PDF", exact: true }), {
      max: 10,
    });
    await page.keyboard.press("Enter");
    const warning = warningDialog(page);
    await expect(downloadButton(warning, LATIN_NAME)).toBeVisible();

    // The Command Palette runs the download Command by its label.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await runPaletteCommand(page, `Download PDF font: ${LATIN_NAME} (3 MB)`);

    // With the font installed the warning is gone and the export embeds Noto.
    const retry = await openBookExport(page);
    await choosePdf(page, retry);
    const pdf = await readPdf(await exportPdf(page, retry));
    expect(normalized(pdf.text)).toContain(SAMPLES.pl);
    expect(pdf.fonts).toMatch(/NotoSerif/);
  });

  test("code and an inline font-family keep Courier for ASCII and Noto for the rest on a Book and a Note", async ({
    page,
  }) => {
    test.slow();
    await passThroughFonts(page);
    await seedSettings(page, { toolbarExpanded: true });
    await enterBook(page);
    await writeMixedSample(page, editorText(page));
    await expect(editorText(page).getByRole("code")).toContainText(MIXED_SAMPLE);

    const dialog = await openBookExport(page);
    await choosePdf(page, dialog);
    await tabTo(page, dialog.getByRole("button", { name: "Export PDF", exact: true }), {
      max: 10,
    });
    await page.keyboard.press("Enter");

    const warning = warningDialog(page);
    await expect(downloadButton(warning, LATIN_NAME)).toBeVisible();
    const bookPdf = await readPdf(await downloadFromWarning(page, warning, LATIN_NAME));
    const bookText = normalized(bookPdf.text);
    // Both blocks read back exactly: no standard font drew a glyph it lacks.
    expect(bookText.match(new RegExp(MIXED_SAMPLE, "g"))).toHaveLength(2);
    expect(bookPdf.fonts).toMatch(/Courier/);
    expect(bookPdf.fonts).toMatch(/NotoSerif/);

    await openNote(page);
    await writeMixedSample(page, noteText(page));
    const notePdf = await readPdf(await exportNotePdf(page));
    const noteTextReadback = normalized(notePdf.text);
    expect(noteTextReadback.match(new RegExp(MIXED_SAMPLE, "g"))).toHaveLength(2);
    expect(notePdf.fonts).toMatch(/Courier/);
    expect(notePdf.fonts).toMatch(/NotoSerif/);
  });
});
