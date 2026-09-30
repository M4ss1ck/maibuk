// Keyboard navigation to a Voice Command's phrase field and its record button
// (issue #270, Phrase Recording). The Phrase Recording specs edit Bold's Voice
// commands in the Shortcut Editor, so one helper opens that field by keyboard
// and one switches the Dictation Language tab.
import type { Locator, Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, tabTo } from "./keyboard";
import { expect } from "./test";

export const shortcutEditor = (page: Page) =>
  page.getByRole("dialog", { name: "Customize shortcuts" });

export const voiceDialog = (page: Page, command = "Bold") =>
  page.getByRole("dialog", { name: `Voice commands: ${command}` });

export const phraseField = (dialog: Locator) =>
  dialog.getByRole("textbox", { name: /^New voice command for / });

export const phraseList = (dialog: Locator) =>
  dialog.getByRole("grid", { name: /^Voice commands for / });

export const recordButton = (dialog: Locator) =>
  dialog.getByRole("button", { name: "Record phrase" });

export const recordingStatus = (dialog: Locator) => dialog.locator('p[role="status"]');

/** Opens Settings → Customize shortcuts → the Command's Voice commands by keyboard. */
export async function openVoiceCommands(page: Page, command = "Bold"): Promise<Locator> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Customize shortcuts" }), { max: 90 });
  await page.keyboard.press("Enter");
  await expect(shortcutEditor(page)).toBeVisible();

  await tabTo(page, shortcutEditor(page).getByRole("searchbox"));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(command);
  const row = shortcutEditor(page).getByRole("row", { name: command, exact: true });
  await tabTo(page, row);
  const voice = row.getByRole("button", { name: `Voice commands for ${command}` });
  await pressUntilFocused(page, "ArrowRight", voice, { max: 8 });
  await page.keyboard.press("Enter");
  await expect(voiceDialog(page, command)).toBeVisible();
  await expectFocusWithin(voiceDialog(page, command));
  return voiceDialog(page, command);
}

/** Switches the dialog to a Dictation Language tab by arrow keys. */
export async function selectLanguage(page: Page, dialog: Locator, name: string): Promise<void> {
  await tabTo(page, dialog.getByRole("tab", { name: "English" }));
  await pressUntilFocused(page, "ArrowRight", dialog.getByRole("tab", { name }), { max: 4 });
  await expect(dialog.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/** Presses the field's record button and waits for its listening status. */
export async function startRecording(page: Page, dialog: Locator, language: string): Promise<void> {
  await tabTo(page, recordButton(dialog));
  await page.keyboard.press("Enter");
  await expect(recordingStatus(dialog)).toHaveText(
    `Listening in ${language}. Say the phrase once; Escape cancels.`
  );
}
