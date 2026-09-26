import { readFile } from "node:fs/promises";
import type { Download, Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { expectFocusWithin, isFocusWithin, pressUntilFocused } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Chapter Export from the editor toolbar (issue #207). Downloads are captured
// and their contents checked: Markdown text, PDF header and page count, and
// the PNG signature for the image.
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });

async function openEditor(page: Page) {
  await seedSettings(page, { toolbarExpanded: true });
  await page.goto("/");
  await page.getByRole("grid", { name: "Books" }).getByRole("row").waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
  // Escape only hands focus to the Chapter list when it starts in the editor.
  await expect(editorText(page)).toBeFocused();
}

async function exportDownload(page: Page, buttonName: string): Promise<Download> {
  // After the first export focus sits on the previous button, still inside the
  // toolbar: no need to walk back. Only the first call (from the editor)
  // normalizes through the Chapter list and Tabs into the toolbar.
  if (!(await isFocusWithin(toolbar(page)))) {
    for (let i = 0; i < 2 && !(await isFocusWithin(chapterList(page))); i++) {
      await page.keyboard.press("Escape");
    }
    await expectFocusWithin(chapterList(page));
    for (let i = 0; i < 40; i++) {
      if (await isFocusWithin(toolbar(page))) break;
      await page.keyboard.press("Tab");
    }
    if (!(await isFocusWithin(toolbar(page)))) throw new Error("Tab never reached the toolbar");
  }
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", page.getByRole("button", { name: buttonName }), {
    max: 160,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  return download;
}

test.describe("chapter export @wf:editor-export-chapter", () => {
  test("Markdown, PDF and image exports carry the Chapter", async ({ page }) => {
    await openEditor(page);

    const markdown = await exportDownload(page, "Export as Markdown");
    expect(markdown.suggestedFilename()).toBe("storm.md");
    const markdownPath = await markdown.path();
    const markdownText = await readFile(markdownPath as string, "utf8");
    expect(markdownText).toContain("The storm came in from the west without warning.");

    const pdf = await exportDownload(page, "Export as PDF");
    expect(pdf.suggestedFilename()).toBe("storm.pdf");
    const pdfBytes = await readFile((await pdf.path()) as string);
    expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    const document = await PDFDocument.load(pdfBytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);

    const png = await exportDownload(page, "Export as Image");
    expect(png.suggestedFilename()).toBe("storm.png");
    const pngBytes = await readFile((await png.path()) as string);
    expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
