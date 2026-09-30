// Phrase Recording (issue #270): a conflict-free recorded phrase is added with
// Enter. The Chromium fake microphone plays
// vendor/moonshine/e2e-voice/record-make-it-heavy.wav, which says "Make it
// heavy." No Command owns that phrase, so the field holds "make it heavy", the
// status says so, and Enter adds it to Bold's English Voice commands.
//
// The audio is generated once with `pnpm e2e:voice-audio`. Chromium only, one
// spec file per WAV. Pattern: e2e/specs/shortcut-editor-voice.spec.ts.
import { expect, test } from "../support/test";
import {
  openVoiceCommands,
  phraseField,
  phraseList,
  recordingStatus,
  startRecording,
} from "../support/phrase-recording";
import { downloadEnglishFast, voiceAudioArgs } from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("record-make-it-heavy") },
});

test.describe("@wf:dictation-record-phrase @sc:dictation.recordPhrase @chromium-only", () => {
  test("a recorded phrase no Command owns is added with Enter", async ({ page }) => {
    test.setTimeout(300_000);
    await downloadEnglishFast(page);
    const dialog = await openVoiceCommands(page);
    const field = phraseField(dialog);

    await startRecording(page, dialog, "English");
    await expect(field).toHaveValue("make it heavy", { timeout: 120_000 });
    await expect(field).toBeFocused();
    await expect(recordingStatus(dialog)).toHaveText("Heard: make it heavy");

    // The draft is only a draft: Enter adds it through the same form path a
    // typed phrase uses, and the field empties for the next one.
    await page.keyboard.press("Enter");
    await expect(phraseList(dialog)).toContainText("make it heavy");
    await expect(field).toHaveValue("");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });
});
