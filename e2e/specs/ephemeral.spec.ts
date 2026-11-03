import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Ephemeral (issue #209): a scratch buffer that is never saved, clears on
// demand, and can be turned into a Note. Tab indents inside the rich-text
// editor, so Escape is the way out to the header actions. A fresh device.

const editor = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const clear = (page: Page) => page.getByRole("button", { name: "Clear", exact: true });
const createNote = (page: Page) => page.getByRole("button", { name: "Create note", exact: true });
const words = (page: Page, count: number) => page.getByText(`${count} words`, { exact: true });

async function openEphemeral(page: Page) {
  await page.goto("/ephemeral");
  await expect(page.getByRole("heading", { name: "Ephemeral", level: 1 })).toBeVisible();
}

/** Tabs from the top of the screen until the editor has focus. */
async function focusEditor(page: Page) {
  await tabTo(page, editor(page), { max: 50 });
  await expect(editor(page)).toBeFocused();
}

test.describe("writing in Ephemeral @wf:ephemeral-write", () => {
  test("focus lands in the editor, typing raises the word count, and a reload loses the text", async ({
    page,
  }) => {
    await openEphemeral(page);
    await expect(words(page, 0)).toBeVisible();

    await focusEditor(page);
    await page.keyboard.type("Hello world");
    await expect(words(page, 2)).toBeVisible();

    await page.reload();

    await expect(editor(page)).toBeVisible();
    await expect(editor(page)).not.toContainText("Hello world");
    await expect(words(page, 0)).toBeVisible();
  });
});

test.describe("the Spell Check language @wf:ephemeral-write", () => {
  test("a picked language shows on its button and drives Spell Check, Opening Marks, and the Note", async ({
    page,
  }) => {
    await seedSettings(page, { toolbarExpanded: true, editorOpeningMarks: true });
    await openEphemeral(page);
    const languageButton = page.getByRole("button", { name: "Spell check language" });
    await expect(languageButton).toHaveText(/en/i);

    await tabTo(page, page.getByRole("combobox", { name: "Size" }));
    await page.keyboard.press("Home");
    await pressUntilFocused(page, "ArrowRight", languageButton, { max: 160 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Español")).toBeVisible();
    await capture(page, "ephemeral-language-menu");
    await pressUntilFocused(
      page,
      "ArrowDown",
      page.getByRole("menuitemradio", { name: /Español/ })
    );
    await page.keyboard.press("Enter");
    await expect(languageButton).toHaveText(/es/i);

    await focusEditor(page);
    await page.keyboard.type("casa house como estas?");
    await expect(editor(page)).toContainText("¿casa house como estas?");
    await expect(editor(page).locator(".spellcheck-error")).toContainText(["house"]);
    await expect(editor(page).locator(".spellcheck-error", { hasText: "casa" })).toHaveCount(0);
    await capture(page, "ephemeral-spanish-spell-check");

    // The Note it becomes is written in the picked language.
    await page.keyboard.press("Escape");
    await expect(createNote(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/.+/);
    await expect(languageButton).toHaveText(/es/i);
  });
});

test.describe("clearing the buffer @wf:ephemeral-clear", () => {
  test("Escape leaves the editor and Clear empties the buffer", async ({ page }) => {
    await openEphemeral(page);
    await focusEditor(page);
    await page.keyboard.type("Scratch text");
    await expect(words(page, 2)).toBeVisible();

    // Tab indents inside the editor; Escape is the documented way out.
    await page.keyboard.press("Escape");
    await expect(createNote(page)).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(clear(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(editor(page)).toBeEmpty();
    await expect(words(page, 0)).toBeVisible();
    await expect(clear(page)).toBeDisabled();
  });
});

test.describe("turning the buffer into a Note @wf:ephemeral-to-note", () => {
  test("Escape reaches Create note, which opens the new Note, and a reload keeps it", async ({
    page,
  }) => {
    await openEphemeral(page);
    await focusEditor(page);
    await page.keyboard.type("Note body");
    // The buffer enables Create note once the coalesced word count lands.
    await expect(words(page, 2)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(createNote(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: "Untitled note", level: 1 })).toBeVisible();
    await expect(editor(page)).toContainText("Note body");

    await page.reload();

    await expect(page.getByRole("heading", { name: "Untitled note", level: 1 })).toBeVisible();
    await expect(editor(page)).toContainText("Note body");
  });

  test("an empty buffer leaves Create note and Clear disabled", async ({ page }) => {
    await openEphemeral(page);

    await expect(createNote(page)).toBeDisabled();
    await expect(clear(page)).toBeDisabled();
  });
});
