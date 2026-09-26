import type { Page } from "@playwright/test";
import { readClipboard, writeClipboard } from "../support/clipboard";
import { tabTo } from "../support/keyboard";
import { seedSettings, seedPasteCleanupPreset } from "../support/storage";
import { expect, test } from "../support/test";

// Real clipboard paste and copy (issue #207). Chromium only: WebKit cannot
// grant the clipboard permissions these rows need.
test.use({
  library: "oneBookThreeChapters",
  permissions: ["clipboard-read", "clipboard-write"],
});

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });

async function openEditor(page: Page) {
  await seedSettings(page, { toolbarExpanded: true });
  await page.goto("/");
  await page.getByRole("grid", { name: "Books" }).getByRole("row").waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
  await expect(editorText(page)).toBeFocused();
}

async function saveNow(page: Page) {
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test.describe("paste cleanup @wf:editor-paste-cleanup @chromium-only", () => {
  test("Mod+V cleans pasted HTML with the Match my book preset and it persists", async ({
    page,
  }) => {
    await seedPasteCleanupPreset(page, "matchBook");
    await openEditor(page);
    await page.keyboard.press("End");
    await writeClipboard(page, {
      text: "Bold and italic",
      html: '<p style="color: red; font-family: Arial; font-size: 24px"><strong>Bold</strong> and <em>italic</em></p>',
    });

    await page.keyboard.press("ControlOrMeta+v");

    const text = editorText(page);
    await expect(text).toContainText("Bold and italic");
    await expect(text.locator("strong, b").first()).toContainText("Bold");
    await expect(text.locator("em, i").first()).toContainText("italic");
    await expect(text.locator('[style*="color"]')).toHaveCount(0);
    await expect(text.locator('[style*="font-family"]')).toHaveCount(0);

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toContainText("Bold and italic");
  });

  test("paste without formatting inserts the plain text", async ({ page }) => {
    await seedPasteCleanupPreset(page, "keepAll");
    await openEditor(page);
    await page.keyboard.press("End");
    await writeClipboard(page, {
      text: "Plain words",
      html: '<p style="color: red"><strong>Plain</strong> words</p>',
    });

    await page.keyboard.press("ControlOrMeta+Shift+v");

    const text = editorText(page);
    await expect(text).toContainText("Plain words");
    await expect(text.locator("strong, b")).toHaveCount(0);
    await expect(text.locator('[style*="color"]')).toHaveCount(0);
  });
});

test.describe("markdown paste @wf:editor-markdown-paste @chromium-only", () => {
  test("the prompt converts pasted Markdown and it persists", async ({ page }) => {
    await seedSettings(page, { promptMarkdownOnPaste: true });
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await writeClipboard(page, { text: "# Heading one\n\n**strong** text" });

    await page.keyboard.press("ControlOrMeta+v");

    const dialog = page.getByRole("dialog", { name: "Markdown detected" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "Convert" }));
    await page.keyboard.press("Enter");

    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("Heading one");
    await expect(editorText(page).locator("strong")).toHaveText("strong");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("Heading one");
  });

  test("Esc keeps the pasted text as plain content", async ({ page }) => {
    await seedSettings(page, { promptMarkdownOnPaste: true });
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    // Two distinct Markdown signals; the detector is deliberately conservative.
    await writeClipboard(page, { text: "# Heading one\n\nSome **bold** words" });

    await page.keyboard.press("ControlOrMeta+v");
    const dialog = page.getByRole("dialog", { name: "Markdown detected" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toContainText("# Heading one");
    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveCount(0);
  });
});

test.describe("copy @wf:editor-copy @chromium-only", () => {
  test("Mod+C puts the formatted selection on the clipboard", async ({ page }) => {
    await openEditor(page);
    // Type the word, select all through the editor's keymap, bold, and copy.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("storm");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+c");

    const clipboard = await readClipboard(page);
    expect(clipboard.text).toContain("storm");
    expect(clipboard.html ?? "").toMatch(/<(strong|b)\b/i);
  });
});
