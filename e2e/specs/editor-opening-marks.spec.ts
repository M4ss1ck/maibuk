import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { LANGUAGE_BOOKS } from "../support/seed/names";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Opening Marks: with the setting on, typing ? or ! in a Spanish Book adds the
// matching ¿ or ¡ where the question or exclamation starts. An English Book
// is never touched.
test.use({ library: "spanishAndEnglishBooks" });

const { spanish, english } = LANGUAGE_BOOKS;

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const card = (page: Page, title: string) =>
  page.getByRole("grid", { name: "Books" }).getByRole("row", { name: title });

/** Opens the Gallery with Opening Marks on, as the Settings switch leaves them. */
async function openGalleryWithOpeningMarks(page: Page) {
  await seedSettings(page, { editorOpeningMarks: true }, { once: true });
  await page.goto("/");
}

/** From the Gallery, opens a Book's only Chapter with the caret at the end of its text. */
async function openBook(page: Page, book: { title: string; text: string }) {
  await expect(card(page, book.title)).toBeVisible();
  await page.keyboard.press("1");
  await pressUntilFocused(page, "ArrowRight", card(page, book.title));
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toContainText(book.text);
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
}

test.describe("Opening Marks @wf:editor-opening-marks", () => {
  test("Space turns the Settings switch on and it stays on after a reload", async ({ page }) => {
    await page.goto("/settings");
    const main = page.getByRole("main");
    // The new row sits between Auto-close pairs and Paste cleanup; both exist
    // before and after this feature, so the PR screenshots compare the same crop.
    const autoClose = main.getByRole("switch", { name: "Toggle auto-close pairs" });
    await tabTo(page, autoClose, { max: 90 });
    await capture(page, "settings-editor-opening-marks", {
      around: [autoClose, main.getByRole("heading", { name: "Paste cleanup", level: 3 })],
    });
    const toggle = main.getByRole("switch", { name: "Toggle Spanish opening marks" });
    await tabTo(page, toggle, { max: 90 });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await expect(
      page.getByRole("main").getByRole("switch", { name: "Toggle Spanish opening marks" })
    ).toHaveAttribute("aria-checked", "true");
  });

  test("a Spanish Chapter gets ¿ and ¡ as closers are typed", async ({ page }) => {
    await openGalleryWithOpeningMarks(page);
    await openBook(page, spanish);

    await page.keyboard.type(" Si vienes, me avisas?");
    await expect(editorText(page)).toContainText("rocas. Si vienes, ¿me avisas?");

    await page.keyboard.type(" Qué haces?!");
    await expect(editorText(page)).toContainText("¿me avisas? ¡¿Qué haces?!");
  });

  test("Backspace right after takes back only the opening mark", async ({ page }) => {
    await openGalleryWithOpeningMarks(page);
    await openBook(page, spanish);

    await page.keyboard.type(" Qué bien!!");
    await expect(editorText(page)).toContainText("rocas. ¡¡Qué bien!!");

    await page.keyboard.press("Backspace");
    await expect(editorText(page)).toContainText("rocas. ¡Qué bien!!");
  });

  test("undo right after takes back only the opening mark", async ({ page }) => {
    await openGalleryWithOpeningMarks(page);
    await openBook(page, spanish);

    await page.keyboard.type(" Vienes?");
    await expect(editorText(page)).toContainText("rocas. ¿Vienes?");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorText(page)).toContainText("rocas. Vienes?");
    await expect(editorText(page)).not.toContainText("¿");
  });

  test("an English Book is never touched", async ({ page }) => {
    await openGalleryWithOpeningMarks(page);
    await openBook(page, english);

    await page.keyboard.type(" Are you coming?!");
    await expect(editorText(page)).toContainText("rocks. Are you coming?!");
    await expect(editorText(page)).not.toContainText("¿");
    await expect(editorText(page)).not.toContainText("¡");
  });

  test("off by default: a Spanish Chapter is left as typed", async ({ page }) => {
    await page.goto("/");
    await openBook(page, spanish);

    await page.keyboard.type(" Vienes?");
    await expect(editorText(page)).toContainText("rocas. Vienes?");
    await expect(editorText(page)).not.toContainText("¿");
  });
});
