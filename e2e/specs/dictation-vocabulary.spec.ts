import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// Dictation Vocabulary settings (issue #281, ADR 0014). Dictation needs a
// model and a microphone, so this spec drives only the settings: what the
// author can add, edit, and remove, keyboard-only. Chromium only for the same
// reason as the rest of the Dictation settings (WebKit has no Dictation).
test.use({ library: "oneBookThreeChapters" });

const selectTrigger = (page: Page) => page.getByRole("button", { name: /Vocabulary language/ });
const heardField = (page: Page) => page.getByRole("textbox", { name: "What Dictation hears" });
const writtenField = (page: Page) => page.getByRole("textbox", { name: "Write instead" });

/** Opens Settings at the Dictation section and tabs into the Vocabulary editor. */
async function openVocabularyEditor(page: Page) {
  await page.goto("/settings#dictation");
  await tabTo(page, selectTrigger(page), { max: 320 });
}

/** Adds one entry from the open editor's add form. */
async function addEntry(page: Page, heard: string, written: string) {
  await tabTo(page, heardField(page), { max: 40 });
  await page.keyboard.type(heard);
  await page.keyboard.press("Tab");
  await expect(writtenField(page)).toBeFocused();
  await page.keyboard.type(written);
  await page.keyboard.press("Enter");
}

/** Opens the focused Vocabulary language Select and picks a language. */
async function chooseLanguage(page: Page, name: "English" | "Spanish") {
  await page.keyboard.press("Enter");
  // Home lands on the first option, so the walk works from any selection.
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name }));
  await page.keyboard.press("Enter");
}

test.describe("@wf:dictation-vocabulary @chromium-only", () => {
  test("adds an entry by keyboard and shows it as heard → written", async ({ page }) => {
    await page.goto("/settings#dictation");
    const section = page.locator("#dictation");
    // The capture point both the base and this branch can reach: the last
    // Spoken punctuation entry, which the vocabulary editor follows.
    await page
      .getByRole("group", { name: "scratch that", exact: true })
      .scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-vocabulary", { around: [section] });

    await tabTo(page, selectTrigger(page), { max: 320 });
    await addEntry(page, "a reliano", "Aureliano");

    const list = page.getByRole("list", { name: "Dictation vocabulary for English" });
    await expect(list.getByText("a reliano", { exact: true })).toBeVisible();
    await expect(list.getByText("Aureliano", { exact: true })).toBeVisible();
    // The form is ready for the next word instead of dropping focus to <body>.
    await expect(heardField(page)).toBeFocused();

    await list.scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-vocabulary-entry", { around: [list] });

    await page.setViewportSize({ width: 390, height: 844 });
    await list.scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-vocabulary-narrow", {
      around: [page.locator("#dictation")],
    });
  });

  test("refuses a heard form that folds to an existing entry, with an alert", async ({ page }) => {
    await openVocabularyEditor(page);
    await addEntry(page, "a reliano", "Aureliano");

    await addEntry(page, "A RELIANO", "Otro");

    await expect(page.getByRole("alert")).toHaveText(
      "A RELIANO is already in the Dictation vocabulary."
    );
    await expect(heardField(page)).toBeFocused();
    const list = page.getByRole("list", { name: "Dictation vocabulary for English" });
    await expect(list.getByText("Otro", { exact: true })).toHaveCount(0);
    await expect(list.getByText("Aureliano", { exact: true })).toBeVisible();
  });

  test("edits an entry in place and removes it by keyboard", async ({ page }) => {
    await openVocabularyEditor(page);
    await addEntry(page, "a reliano", "Aureliano");

    const edit = page.getByRole("button", { name: "Edit a reliano" });
    await tabTo(page, edit, { max: 40 });
    await page.keyboard.press("Enter");

    const form = page.getByRole("form", { name: "Edit a reliano" });
    const editHeard = form.getByRole("textbox", { name: "What Dictation hears" });
    await expect(editHeard).toBeFocused();
    await expect(editHeard).toHaveValue("a reliano");
    await page.keyboard.press("End");
    await page.keyboard.type(" buendía");
    // Tabbing into the field selects its text, so typing replaces it.
    await page.keyboard.press("Tab");
    await page.keyboard.type("Aureliano Buendía");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Edit a reliano buendía" })).toBeFocused();
    const list = page.getByRole("list", { name: "Dictation vocabulary for English" });
    await expect(list.getByText("Aureliano Buendía", { exact: true })).toBeVisible();

    // The Remove button follows the Edit button in the row.
    await page.keyboard.press("Tab");
    const remove = page.getByRole("button", { name: "Remove a reliano buendía" });
    await expect(remove).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(list.getByText("a reliano buendía", { exact: true })).toHaveCount(0);
    await expect(heardField(page)).toBeFocused();
  });

  test("keeps entries per language and across a reload", async ({ page }) => {
    await openVocabularyEditor(page);
    await addEntry(page, "a reliano", "Aureliano");

    // Spanish starts empty, and takes its own entries.
    await tabTo(page, selectTrigger(page), { backwards: true, max: 60 });
    await chooseLanguage(page, "Spanish");
    await expect(
      page.getByText("No entries yet. Add the first word Dictation gets wrong.")
    ).toBeVisible();
    await addEntry(page, "nuevo párrafo", "Nuevo Palafox");
    const spanishList = page.getByRole("list", { name: "Dictation vocabulary for Spanish" });
    await expect(spanishList.getByText("Nuevo Palafox", { exact: true })).toBeVisible();

    // Device-local: both languages survive a reload.
    await page.reload();
    await tabTo(page, selectTrigger(page), { max: 320 });
    await chooseLanguage(page, "Spanish");
    await expect(
      page
        .getByRole("list", { name: "Dictation vocabulary for Spanish" })
        .getByText("Nuevo Palafox", { exact: true })
    ).toBeVisible();
    await tabTo(page, selectTrigger(page), { backwards: true, max: 60 });
    await chooseLanguage(page, "English");
    await expect(
      page
        .getByRole("list", { name: "Dictation vocabulary for English" })
        .getByText("Aureliano", { exact: true })
    ).toBeVisible();
  });
});
