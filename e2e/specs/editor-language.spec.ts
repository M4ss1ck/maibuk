import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Spell Check, the Custom Dictionary, and Word Lookup (issue #207). The
// Wiktionary API is stubbed with page.route (`[simulated]`); the offline case
// uses the suite's hermetic network.
test.use({ library: "oneBookThreeChapters" });

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

async function stubWiktionary(page: Page, definition: string) {
  await page.route("https://en.wiktionary.org/**", (route) =>
    route.fulfill({
      json: {
        parse: {
          text: `<div class="mw-parser-output"><p>${definition}</p></div>`,
        },
      },
    })
  );
}

async function openContextMenuOnMisspelling(page: Page, word: string) {
  await expect(editorText(page).locator(".spellcheck-error")).toContainText(word);
  // Move the caret into the word at the end of the text.
  await page.keyboard.press("End");
  for (let i = 0; i < word.length; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Editor options" });
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("spell check @wf:editor-spell-check", () => {
  test("a misspelled word is marked and the context menu replaces it", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" recieve");
    await expect(editorText(page).locator(".spellcheck-error")).toContainText("recieve");

    const menu = await openContextMenuOnMisspelling(page, "recieve");
    const suggestion = menu.getByRole("menuitem", { name: "receive", exact: true });
    await pressUntilFocused(page, "ArrowDown", suggestion, { max: 12 });
    await page.keyboard.press("Enter");

    await expect(editorText(page)).toContainText("receive");
    await expect(editorText(page).locator(".spellcheck-error")).toHaveCount(0);
  });

  test("Add to Dictionary unmarks the word and the Custom Dictionary keeps it", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" teh");
    const menu = await openContextMenuOnMisspelling(page, "teh");
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu.getByRole("menuitem", { name: "Add to Dictionary" }),
      {
        max: 12,
      }
    );
    await page.keyboard.press("Enter");

    await expect(editorText(page).locator(".spellcheck-error")).toHaveCount(0);

    // The word survives a reload and shows up in Settings.
    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await page.goto("/settings");
    // The count lives on the Settings page, not inside the modal.
    await expect(page.getByText("1 words")).toBeVisible();
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await expect(edit).toBeVisible();
    await tabTo(page, edit, { max: 200 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Custom Dictionary" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("teh");

    await tabTo(page, dialog.getByRole("button", { name: "Remove" }));
    await page.keyboard.press("Enter");
    await expect(dialog).not.toContainText("teh");
  });
});

test.describe("custom dictionary and word lookup @wf:editor-custom-dictionary @wf:editor-word-lookup @sc:editor.dictionary", () => {
  test("Mod+Shift+D prompts for a word and shows its definition", async ({ page }) => {
    await stubWiktionary(page, "A gentle wind.");
    await openEditor(page);
    await page.keyboard.press("Control+Shift+d");

    const prompt = page.getByRole("dialog", { name: "Look up a word" });
    await expect(prompt).toBeVisible();
    const word = prompt.getByRole("textbox", { name: "Word" });
    await expect(word).toBeFocused();
    await page.keyboard.type("breeze");
    await tabTo(page, prompt.getByRole("button", { name: "Look up", exact: true }));
    await page.keyboard.press("Enter");

    const definition = page.getByRole("dialog", { name: "breeze" });
    await expect(definition).toContainText("A gentle wind.");
    await page.keyboard.press("Escape");
    await expect(definition).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("Look up a selected word shows its definition", async ({ page }) => {
    await stubWiktionary(page, "A violent disturbance of the atmosphere.");
    await openEditor(page);
    // Select "storm".
    // Type the word and select it; Ctrl+A goes through the editor's own
    // keymap, so Word Lookup reads a settled selection (rapid Shift+Arrows can
    // race the editor's selection state).
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("storm");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Control+Shift+d");

    const definition = page.getByRole("dialog", { name: "storm" });
    await expect(definition).toContainText("A violent disturbance of the atmosphere.");
  });

  test("an unavailable dictionary says so instead of failing", async ({ page }) => {
    await openEditor(page);
    // Type the word and select it; Ctrl+A goes through the editor's own
    // keymap, so Word Lookup reads a settled selection (rapid Shift+Arrows can
    // race the editor's selection state).
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("storm");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Control+Shift+d");

    const definition = page.getByRole("dialog", { name: "storm" });
    await expect(definition).toContainText("No definition found");
  });
});
