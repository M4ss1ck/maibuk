// Phrase Recording (issue #270): the record button beside a Voice Command's
// phrase field. The Chromium fake microphone plays
// vendor/moonshine/e2e-voice/record-make-italic.wav, which says "Make italic.".
// The line lands in the field as heard ("make italic"), lowercase and without
// punctuation, and runs no Voice Command. Pressing Enter submits the draft to
// the normal conflict check, which refuses it because "make italic" already
// runs the Italic Voice Command. Nothing is added.
//
// ("Make italic" rather than the more evocative "press tab": the Fast model
// misheard that clip as "pressed hebb" often enough to flake under the
// parallel acceptance run; see the PR report.)
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here. One spec file per
// WAV: the fake microphone file is a browser launch argument.
//
// Pattern: e2e/specs/shortcut-editor-voice.spec.ts; setup:
// e2e/support/phrase-recording.ts and e2e/support/voice-focus.ts.
import { capture } from "../support/capture";
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
  launchOptions: { args: voiceAudioArgs("record-make-italic") },
});

test.describe("@wf:dictation-record-phrase @sc:dictation.recordPhrase @chromium-only", () => {
  test("a recorded phrase is taken as heard, and the conflict check still decides", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await downloadEnglishFast(page);
    const dialog = await openVoiceCommands(page);
    await capture(page, "record-phrase-dialog", { around: [dialog] });
    const field = phraseField(dialog);

    await startRecording(page, dialog, "English");
    await capture(page, "record-phrase-listening", { around: [dialog] });

    // The recorded line replaces the draft and lands as the model heard it:
    // lowercase, no punctuation. The field keeps focus and no Voice Command
    // ran (the words were not interpreted).
    await expect(field).toHaveValue("make italic", { timeout: 120_000 });
    await expect(field).toBeFocused();
    await expect(recordingStatus(dialog)).toHaveText("Heard: make italic");
    await capture(page, "record-phrase-heard", { around: [dialog] });

    // Enter submits the recorded draft; the phrase conflict check refuses it
    // because "make italic" already runs the Italic Voice Command. The
    // refusal is the proof the recording only filled the field.
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toHaveText("make italic already runs Italic.");
    await expect(field).toHaveValue("make italic");
    await expect(phraseList(dialog)).not.toContainText("make italic");
  });
});
