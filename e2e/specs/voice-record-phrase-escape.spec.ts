// Phrase Recording Escape (issue #270): Escape cancels a recording without
// closing the dialog. The Chromium fake microphone plays
// vendor/moonshine/e2e-voice/record-make-it-heavy.wav, whose 70 s of leading
// silence means the phrase has not arrived when the author cancels.
//
// The audio is generated once with `pnpm e2e:voice-audio`. Chromium only, one
// spec file per WAV. Pattern: e2e/specs/shortcut-editor-voice.spec.ts.
import { expect, test } from "../support/test";
import {
  openVoiceCommands,
  phraseField,
  recordingStatus,
  startRecording,
} from "../support/phrase-recording";
import { downloadEnglishFast, voiceAudioArgs } from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("record-make-it-heavy") },
});

test.describe("@wf:dictation-record-phrase @sc:dictation.recordPhrase @chromium-only", () => {
  test("Escape cancels the recording and does not close the dialog", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    const dialog = await openVoiceCommands(page);
    const field = phraseField(dialog);

    await startRecording(page, dialog, "English");

    // The recording consumes Escape: it cancels, and the dialog stays open with
    // the caret back in the field and nothing written to it.
    await page.keyboard.press("Escape");
    await expect(recordingStatus(dialog)).toHaveText("Recording cancelled.");
    await expect(dialog).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
  });
});
