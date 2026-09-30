// Click by Name inside a dialog (issue #321): the dialog is open by keyboard
// before the phrase, and "Click Cancel." presses the dialog's control.
// Pattern: e2e/specs/voice-focus-keys-next.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openBookSettings,
  openChapterWithDictation,
  stopDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("click-cancel") },
});

test.describe("@wf:voice-click-by-name @sc:dictation.toggle @chromium-only", () => {
  test("saying Click Cancel presses the dialog control, not one behind it", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    const { dialog, trigger } = await openBookSettings(page);

    // "Click Cancel." presses the dialog's Cancel button: the dialog closes
    // and focus returns to its trigger.
    await expect(dialog).toBeHidden({ timeout: 90_000 });
    await expect(trigger).toBeFocused();

    // The words never land in the Chapter.
    await expect(editorText(page)).not.toContainText("Click Cancel");

    await stopDictation(page);
  });
});
