// Phrase Recording with no model for the language (issue #270): the field shows
// a role=alert that names the Dictation Language and points to Settings. No
// model is downloaded, so the Spanish tab cannot record; the recording is
// refused before anything listens. The fake microphone never speaks, so the WAV
// is the same one the other specs use (its 70 s of leading silence is plenty).
//
// Chromium only. Pattern: e2e/specs/shortcut-editor-voice.spec.ts.
import { expect, test } from "../support/test";
import { openVoiceCommands, recordButton, selectLanguage } from "../support/phrase-recording";
import { voiceAudioArgs } from "../support/voice-focus";
import { tabTo } from "../support/keyboard";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("record-letra-gruesa") },
});

test.describe("@wf:dictation-record-phrase @sc:dictation.recordPhrase @chromium-only", () => {
  test("with no model for the language the field shows the download alert", async ({ page }) => {
    const dialog = await openVoiceCommands(page);
    await selectLanguage(page, dialog, "Spanish");

    await tabTo(page, recordButton(dialog));
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toHaveText(
      "No Spanish dictation model is downloaded. Download one in Settings → Dictation."
    );
    await expect(dialog).toBeVisible();
  });
});
