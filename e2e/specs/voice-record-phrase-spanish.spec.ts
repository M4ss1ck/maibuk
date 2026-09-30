// Phrase Recording listens in the Dictation Language of the tab being edited
// (issue #270), not the app language. The Chromium fake microphone plays
// vendor/moonshine/e2e-voice/record-letra-gruesa.wav, a Spanish voice saying
// "Letra gruesa.". With the English UI, the Spanish tab records in Spanish: the
// status says "Listening in Spanish…" first, the field holds the Spanish words,
// and Enter adds them to Bold's Spanish Voice commands.
//
// The audio is generated once with `pnpm e2e:voice-audio`. Chromium only, one
// spec file per WAV. Pattern: e2e/specs/shortcut-editor-voice.spec.ts.
import { expect, test } from "../support/test";
import {
  openVoiceCommands,
  phraseField,
  phraseList,
  recordingStatus,
  selectLanguage,
  startRecording,
} from "../support/phrase-recording";
import { downloadSpanishFast, voiceAudioArgs } from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("record-letra-gruesa") },
});

test.describe("@wf:dictation-record-phrase @sc:dictation.recordPhrase @chromium-only", () => {
  test("on the Spanish tab the recording listens in Spanish and its phrase is added", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await downloadSpanishFast(page);
    const dialog = await openVoiceCommands(page);
    await selectLanguage(page, dialog, "Spanish");
    const field = phraseField(dialog);

    // The status names the tab's language, not the app's.
    await startRecording(page, dialog, "Spanish");
    await expect(field).toHaveValue("letra gruesa", { timeout: 120_000 });
    await expect(field).toBeFocused();
    await expect(recordingStatus(dialog)).toHaveText("Heard: letra gruesa");

    await page.keyboard.press("Enter");
    await expect(phraseList(dialog)).toContainText("letra gruesa");
    await expect(field).toHaveValue("");
  });
});
