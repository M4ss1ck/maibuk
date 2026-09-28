import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// Spoken Punctuation settings (issue #280, ADR 0014). Dictation needs a model
// and a microphone, so this spec drives only the settings: what the author can
// list, switch, teach, and reset, keyboard-only. Chromium only for the same
// reason as the rest of the Dictation settings (WebKit has no Dictation).
test.use({ library: "oneBookThreeChapters" });

const languageTrigger = (page: Page) => page.getByRole("button", { name: /Dictation language/ });

/** Opens the focused Spoken punctuation language Select and picks a language. */
async function chooseLanguage(page: Page, name: "English" | "Spanish") {
  await page.keyboard.press("Enter");
  // Home lands on the first option, so the walk works from any selection.
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", page.getByRole("option", { name }));
  await page.keyboard.press("Enter");
}

test.describe("@wf:dictation-spoken-punctuation @chromium-only", () => {
  test("lists each entry's phrases and what it inserts, per Dictation Language", async ({
    page,
  }) => {
    await page.goto("/settings#dictation");
    await tabTo(page, languageTrigger(page), { max: 220 });

    const comma = page.getByRole("group", { name: "comma", exact: true });
    await expect(comma.getByText("comma", { exact: true }).first()).toBeVisible();
    await expect(comma.getByText(",", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "question mark", exact: true })).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "new paragraph", exact: true })
        .getByText("New paragraph", { exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "scratch that", exact: true })
        .getByText("Removes the last dictated sentence")
    ).toBeVisible();

    await page.locator("#dictation").scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-spoken-punctuation", {
      around: [page.locator("#dictation")],
    });

    await chooseLanguage(page, "Spanish");
    await expect(page.getByRole("group", { name: "coma", exact: true })).toBeVisible();
    await expect(
      page.getByRole("group", { name: "punto", exact: true }).getByText("punto y seguido")
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "nuevo párrafo", exact: true })
        .getByText("New paragraph", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("group", { name: "comma", exact: true })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("group", { name: "coma", exact: true }).scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-spoken-punctuation-narrow", {
      around: [page.locator("#dictation")],
    });
  });

  test("switches one entry and the whole layer off by keyboard", async ({ page }) => {
    await page.goto("/settings#dictation");
    const comma = page.getByRole("group", { name: "comma", exact: true });
    const commaSwitch = comma.getByRole("switch", { name: "comma", exact: true });

    // English models punctuate, so marks start off.
    await tabTo(page, commaSwitch, { max: 230 });
    await expect(commaSwitch).not.toBeChecked();
    await page.keyboard.press("Space");
    await expect(commaSwitch).toBeChecked();

    // The master switch stops the whole layer and disables the entries.
    const master = page.getByRole("switch", { name: "Spoken punctuation for English" });
    await tabTo(page, master, { backwards: true, max: 20 });
    await page.keyboard.press("Space");
    await expect(master).not.toBeChecked();
    await expect(commaSwitch).toBeDisabled();

    await page.keyboard.press("Space");
    await expect(master).toBeChecked();
    await expect(commaSwitch).toBeEnabled();
    await expect(commaSwitch).toBeChecked();
  });

  test("adds and removes an extra phrase by keyboard", async ({ page }) => {
    await page.goto("/settings#dictation");
    const comma = page.getByRole("group", { name: "comma", exact: true });
    const field = comma.getByRole("textbox", { name: "Add a phrase to comma" });

    await tabTo(page, field, { max: 240 });
    await page.keyboard.type("komma");
    await page.keyboard.press("Enter");
    await expect(comma.getByText("komma", { exact: true })).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");

    const remove = comma.getByRole("button", { name: "Remove komma from comma" });
    await tabTo(page, remove, { backwards: true, max: 20 });
    await page.keyboard.press("Enter");
    await expect(comma.getByText("komma", { exact: true })).toHaveCount(0);
    // The remove button unmounted; focus moved into the field, not to <body>.
    await expect(field).toBeFocused();
  });

  test("refuses a phrase that is already a phrase, or starts with the escape word", async ({
    page,
  }) => {
    await page.goto("/settings#dictation");
    const comma = page.getByRole("group", { name: "comma", exact: true });
    const field = comma.getByRole("textbox", { name: "Add a phrase to comma" });

    await tabTo(page, field, { max: 240 });
    await page.keyboard.type("period");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText(
      "period is already a Spoken punctuation phrase."
    );
    // The refused text stays in the field for editing.
    await expect(field).toHaveValue("period");

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("literal comma");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText(
      "literal comma starts with the escape word, literal."
    );
    // Nothing was stored: the phrase list still holds only the default.
    await expect(comma.getByText("literal comma", { exact: true })).toHaveCount(0);
  });

  test("resets one entry's switch and phrases to the defaults", async ({ page }) => {
    await page.goto("/settings#dictation");
    const comma = page.getByRole("group", { name: "comma", exact: true });
    const commaSwitch = comma.getByRole("switch", { name: "comma", exact: true });
    const field = comma.getByRole("textbox", { name: "Add a phrase to comma" });

    // English marks start off; switch the entry on and teach it a phrase.
    await tabTo(page, commaSwitch, { max: 230 });
    await page.keyboard.press("Space");
    await expect(commaSwitch).toBeChecked();
    await tabTo(page, field, { max: 20 });
    await page.keyboard.type("komma");
    await page.keyboard.press("Enter");
    await expect(comma.getByText("komma", { exact: true })).toBeVisible();

    const reset = comma.getByRole("button", {
      name: "Reset comma to its default switch and phrases",
    });
    await tabTo(page, reset, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(comma.getByText("komma", { exact: true })).toHaveCount(0);
    await expect(commaSwitch).not.toBeChecked();
    // The Reset button unmounted; focus moved into the field, not to <body>.
    await expect(field).toBeFocused();
  });

  test("keeps the settings per language and across a reload", async ({ page }) => {
    await page.goto("/settings#dictation");
    await tabTo(page, languageTrigger(page), { max: 220 });
    await chooseLanguage(page, "Spanish");

    // Spanish models add no punctuation, so marks start on.
    const coma = page.getByRole("group", { name: "coma", exact: true });
    const comaSwitch = coma.getByRole("switch", { name: "coma", exact: true });
    await expect(comaSwitch).toBeChecked();
    await tabTo(page, comaSwitch, { max: 20 });
    await page.keyboard.press("Space");
    await expect(comaSwitch).not.toBeChecked();

    // English keeps its own list and its own defaults.
    await tabTo(page, languageTrigger(page), { backwards: true, max: 20 });
    await chooseLanguage(page, "English");
    await expect(
      page
        .getByRole("group", { name: "comma", exact: true })
        .getByRole("switch", { name: "comma", exact: true })
    ).not.toBeChecked();

    // Device-local: the switch survives a reload.
    await page.reload();
    await tabTo(page, languageTrigger(page), { max: 220 });
    await chooseLanguage(page, "Spanish");
    await expect(
      page
        .getByRole("group", { name: "coma", exact: true })
        .getByRole("switch", { name: "coma", exact: true })
    ).not.toBeChecked();
  });
});
