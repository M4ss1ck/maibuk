// focus.next by voice (issue #318): the microphone says "Press Tab".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openBookSettings,
  openChapterWithDictation,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-next") },
});

test.describe("@wf:voice-focus-keys @sc:focus.next @chromium-only", () => {
  test("saying Press Tab moves focus from Book Title to Subtitle", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    // Dictation starts before the dialog: a Modal blocks the toggle shortcut,
    // but the Voice Command itself runs through the Command Runner.
    await openChapterWithDictation(page);
    const { dialog } = await openBookSettings(page);

    // "Press Tab." is a Voice Command: focus.next moves to Subtitle.
    await expect(dialog.getByRole("textbox", { name: "Subtitle" })).toBeFocused({
      timeout: 90_000,
    });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The live region sits outside the modal's accessibility tree, so it is
    // read once the dialog is closed. The words never land in the Chapter.
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Tab");
    await expect(editorText(page)).not.toContainText("Press Tab");

    await stopDictation(page);
  });
});
