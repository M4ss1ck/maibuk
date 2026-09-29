// Custom Voice Commands in the Shortcut Editor (issue #283): a voice-eligible
// Command's phrases per Dictation Language, edited by keyboard alone, refused
// through the one phrase conflict check, kept on this device and carried by the
// Shortcut File (ADR 0012, ADR 0014).

import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  expectTabContained,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

const editorDialog = (page: Page) => page.getByRole("dialog", { name: "Customize shortcuts" });
const voiceDialog = (page: Page) => page.getByRole("dialog", { name: "Voice commands: Bold" });
const phraseField = (page: Page) =>
  voiceDialog(page).getByRole("textbox", { name: /^New voice command for Bold in / });
const phraseList = (page: Page) =>
  voiceDialog(page).getByRole("grid", { name: /^Voice commands for Bold in / });

async function openEditor(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Customize shortcuts" }), { max: 90 });
  await page.keyboard.press("Enter");
  await expect(editorDialog(page)).toBeVisible();
}

/** Filters the list to Bold and puts focus on its row. */
async function focusBold(page: Page): Promise<Locator> {
  await tabTo(page, editorDialog(page).getByRole("searchbox"));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Bold");
  const row = editorDialog(page).getByRole("row", { name: "Bold", exact: true });
  await tabTo(page, row);
  return row;
}

/** Opens Bold's Voice commands from its row and returns the Voice button. */
async function openBoldVoice(page: Page): Promise<Locator> {
  const row = await focusBold(page);
  const voice = row.getByRole("button", { name: "Voice commands for Bold" });
  await pressUntilFocused(page, "ArrowRight", voice, { max: 8 });
  await page.keyboard.press("Enter");
  await expect(voiceDialog(page)).toBeVisible();
  await expectFocusWithin(voiceDialog(page));
  return voice;
}

/**
 * Tabs into the phrase list, which keeps the row it last focused, then Home
 * puts focus on the first phrase.
 */
async function focusFirstPhrase(page: Page): Promise<Locator> {
  for (let i = 0; i < 10 && !(await isFocusWithin(phraseList(page))); i++) {
    await page.keyboard.press("Tab");
  }
  await expectFocusWithin(phraseList(page));
  await page.keyboard.press("Home");
  const first = phraseList(page).getByRole("row").first();
  await expect(first).toBeFocused();
  return first;
}

async function typePhrase(page: Page, phrase: string) {
  await tabTo(page, phraseField(page));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(phrase);
  await page.keyboard.press("Enter");
}

test.describe("Shortcut Editor Voice commands @wf:shortcut-editor-voice-commands", () => {
  test("adds, edits, removes, and resets a phrase by keyboard, and Escape returns to Voice", async ({
    page,
  }) => {
    await openEditor(page);
    const row = await focusBold(page);
    await capture(page, "shortcut-editor-voice-row", { around: [row] });
    await expect(row).toContainText("Voice (English):");
    await expect(row).toContainText("make bold");

    const voice = await openBoldVoice(page);
    await expectTabContained(page, voiceDialog(page));

    await typePhrase(page, "heavy words");
    await expect(phraseList(page)).toContainText("heavy words");
    await expect(phraseField(page)).toBeFocused();
    await expect(phraseField(page)).toHaveValue("");
    await capture(page, "voice-commands-dialog");

    // Arrow keys move between the phrases.
    const first = await focusFirstPhrase(page);
    await page.keyboard.press("ArrowDown");
    await expect(first).not.toBeFocused();
    await expect(phraseList(page).getByRole("row").nth(1)).toBeFocused();

    // Enter on a row edits it.
    await page.keyboard.press("Enter");
    // A new phrase goes first, so the second row is the first default.
    const editField = voiceDialog(page).getByRole("textbox", { name: "Change make bold" });
    await expect(editField).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("heavy type");
    await page.keyboard.press("Enter");
    await expect(phraseList(page)).toContainText("heavy type");
    const makeBold = phraseList(page).getByRole("row", { name: "make bold", exact: true });
    await expect(makeBold).toHaveCount(0);

    // Remove from the row's own button.
    const heavy = phraseList(page).getByRole("row", { name: "heavy words" });
    await focusFirstPhrase(page);
    await pressUntilFocused(page, "ArrowDown", heavy, { max: 20 });
    await pressUntilFocused(
      page,
      "ArrowRight",
      heavy.getByRole("button", { name: "Remove heavy words from Bold" }),
      { max: 3 }
    );
    await page.keyboard.press("Enter");
    await expect(phraseList(page)).not.toContainText("heavy words");
    await expect(phraseField(page)).toBeFocused();

    await tabTo(page, voiceDialog(page).getByRole("button", { name: "Reset English to defaults" }));
    await page.keyboard.press("Enter");
    await expect(makeBold).toHaveCount(1);
    await expect(phraseList(page)).not.toContainText("heavy type");

    await page.keyboard.press("Escape");
    await expect(voiceDialog(page)).toBeHidden();
    await expect(voice).toBeFocused();
    await expect(editorDialog(page)).toBeVisible();
  });

  test("a one-word phrase is refused with an alert", async ({ page }) => {
    await openEditor(page);
    await openBoldVoice(page);
    await typePhrase(page, "bold");
    await expect(voiceDialog(page).getByRole("alert")).toHaveText(
      "A Voice Command needs two words or more, so a one-word sentence never runs it."
    );
    await expect(phraseField(page)).toBeFocused();
  });

  test("a phrase that is another Command's Voice Command or Spoken Punctuation is refused with an alert", async ({
    page,
  }) => {
    await openEditor(page);
    await openBoldVoice(page);
    await typePhrase(page, "make italic");
    await expect(voiceDialog(page).getByRole("alert")).toHaveText(
      "make italic already runs Italic."
    );
    await typePhrase(page, "new paragraph");
    await expect(voiceDialog(page).getByRole("alert")).toContainText(
      "new paragraph is already Spoken punctuation"
    );
    await expect(phraseList(page)).not.toContainText("make italic");
  });

  test("Escape leaves an edit without closing the dialog, then closes it back to the row's Voice button", async ({
    page,
  }) => {
    await openEditor(page);
    const voice = await openBoldVoice(page);
    await focusFirstPhrase(page);
    await page.keyboard.press("Enter");
    const editField = voiceDialog(page).getByRole("textbox", { name: "Change make bold" });
    await expect(editField).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(voiceDialog(page)).toBeVisible();
    await expect(phraseField(page)).toBeFocused();
    await expect(phraseField(page)).toHaveValue("");

    await page.keyboard.press("Escape");
    await expect(voiceDialog(page)).toBeHidden();
    await expect(voice).toBeFocused();
  });

  test("the other Dictation Language keeps its own list", async ({ page }) => {
    await openEditor(page);
    await openBoldVoice(page);
    await typePhrase(page, "heavy words");

    await tabTo(page, voiceDialog(page).getByRole("button", { name: /Dictation language/ }), {
      backwards: true,
    });
    await page.keyboard.press("Enter");
    const spanish = page.getByRole("option", { name: "Spanish" });
    await pressUntilFocused(page, "ArrowDown", spanish, { max: 3 });
    await page.keyboard.press("Enter");

    const spanishList = voiceDialog(page).getByRole("grid", {
      name: "Voice commands for Bold in Spanish",
    });
    await expect(spanishList).toContainText("poner negrita");
    await expect(spanishList).not.toContainText("heavy words");
    await tabTo(page, voiceDialog(page).getByRole("textbox", { name: /in Spanish$/ }));
    await page.keyboard.type("pon esto fuerte");
    await page.keyboard.press("Enter");
    await expect(spanishList).toContainText("pon esto fuerte");
  });

  test("custom Voice commands survive a reload and travel in the Shortcut File", async ({
    page,
  }) => {
    await openEditor(page);
    await openBoldVoice(page);
    await typePhrase(page, "heavy words");
    await page.keyboard.press("Escape");
    await expect(voiceDialog(page)).toBeHidden();

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Save to file" }), {
      max: 40,
      backwards: true,
    });
    const download = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const path = await (await download).path();
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved).toMatchObject({ app: "maibuk", kind: "shortcuts", version: 2 });
    expect(saved.voice["editor.bold"].en).toContain("heavy words");

    await page.reload();
    await openEditor(page);
    await openBoldVoice(page);
    await expect(phraseList(page)).toContainText("heavy words");
    await page.keyboard.press("Escape");
    await expect(voiceDialog(page)).toBeHidden();

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Reset all shortcuts" }), {
      backwards: true,
    });
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: "Reset all shortcuts?" });
    await tabTo(page, confirm.getByRole("button", { name: "Reset all shortcuts" }));
    await page.keyboard.press("Enter");
    await openBoldVoice(page);
    await expect(phraseList(page)).not.toContainText("heavy words");
    await page.keyboard.press("Escape");
    await expect(voiceDialog(page)).toBeHidden();

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Load from file" }), {
      backwards: true,
    });
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles(path);
    const preview = page.getByRole("dialog", { name: "Load shortcuts from file" });
    await tabTo(page, preview.getByRole("button", { name: "Replace my shortcuts" }));
    await page.keyboard.press("Enter");
    await expect(preview).toBeHidden();
    await openBoldVoice(page);
    await expect(phraseList(page)).toContainText("heavy words");
  });
});
