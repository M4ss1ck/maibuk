import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// Dictation Vocabulary settings (issue #281, ADR 0014). Dictation needs a
// model and a microphone, so this spec drives only the settings: what the
// author can add, edit, and remove, keyboard-only. Chromium only for the same
// reason as the rest of the Dictation settings (WebKit has no Dictation).
test.use({ library: "oneBookThreeChapters" });

const languageTab = (page: Page, name: "English" | "Spanish") => page.getByRole("tab", { name });
const heardField = (page: Page) => page.getByRole("textbox", { name: "What Dictation hears" });
const writtenField = (page: Page) => page.getByRole("textbox", { name: "Write instead" });
const vocabularyList = (page: Page, name: "English" | "Spanish") =>
  page.getByRole("list", { name: `Dictation vocabulary for ${name}` });

/** Opens Settings at the Dictation section and tabs into the Vocabulary editor. */
async function openVocabularyEditor(page: Page) {
  await page.goto("/settings#dictation");
  await tabTo(page, heardField(page), { max: 320 });
}

/** Adds one entry from the open editor's add form. */
async function addEntry(page: Page, heard: string, written: string) {
  await tabTo(page, heardField(page), { max: 40 });
  await page.keyboard.type(heard);
  // The heard field's record button comes next in the Tab order.
  await tabTo(page, writtenField(page), { max: 3 });
  await page.keyboard.type(written);
  await page.keyboard.press("Enter");
}

/**
 * Walks the Dictation Language tab list with the arrow keys: selection follows
 * focus, so the wanted tab is focused and selected on arrival. Focus is inside
 * the section, so the tab list is reached by tabbing back.
 */
async function chooseLanguage(
  page: Page,
  current: "English" | "Spanish",
  wanted: "English" | "Spanish"
) {
  await tabTo(page, languageTab(page, current), { backwards: true, max: 120 });
  const target = languageTab(page, wanted);
  await pressUntilFocused(page, wanted === "Spanish" ? "ArrowRight" : "ArrowLeft", target);
  await expect(target).toHaveAttribute("aria-selected", "true");
}

test.describe("@wf:dictation-vocabulary @chromium-only", () => {
  test("adds an entry by keyboard and shows it as heard → written", async ({ page }) => {
    await page.goto("/settings#dictation");
    const section = page.locator("#dictation");
    // The Vocabulary editor sits at the end of the Dictation section.
    await page.getByRole("heading", { name: "Dictation vocabulary" }).scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-vocabulary", { around: [section] });
    await expect(heardField(page)).toBeVisible();
    await capture(page, "record-phrase-vocabulary", {
      around: [
        page.getByRole("heading", { name: "Dictation vocabulary" }),
        heardField(page),
        writtenField(page),
      ],
    });

    await tabTo(page, heardField(page), { max: 320 });
    await addEntry(page, "a reliano", "Aureliano");

    const list = vocabularyList(page, "English");
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
    const list = vocabularyList(page, "English");
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
    // Tabbing into the field (past the heard field's record button) selects
    // its text, so typing replaces it.
    await tabTo(page, form.getByRole("textbox", { name: "Write instead" }), { max: 3 });
    await page.keyboard.type("Aureliano Buendía");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Edit a reliano buendía" })).toBeFocused();
    const list = vocabularyList(page, "English");
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

    // Spanish starts empty, and takes its own entries; choose it by arrow keys.
    await chooseLanguage(page, "English", "Spanish");
    await expect(
      page.getByText("No entries yet. Add the first word Dictation gets wrong.")
    ).toBeVisible();
    await addEntry(page, "nuevo párrafo", "Nuevo Palafox");
    await expect(
      vocabularyList(page, "Spanish").getByText("Nuevo Palafox", { exact: true })
    ).toBeVisible();

    // Device-local: both languages survive a reload, chosen again by arrow keys.
    await page.reload();
    await tabTo(page, languageTab(page, "English"), { max: 320 });
    await chooseLanguage(page, "English", "Spanish");
    await expect(
      vocabularyList(page, "Spanish").getByText("Nuevo Palafox", { exact: true })
    ).toBeVisible();
    await chooseLanguage(page, "Spanish", "English");
    await expect(
      vocabularyList(page, "English").getByText("Aureliano", { exact: true })
    ).toBeVisible();
  });
});
