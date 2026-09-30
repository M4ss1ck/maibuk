// focus.up by voice (issue #318): the microphone says "Press Up".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  focusOpenChapter,
  openChapterWithDictation,
  row,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-up") },
});

test.describe("@wf:voice-focus-keys @sc:focus.up @chromium-only", () => {
  test("saying Press Up moves to the previous Chapter row", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    // The open Chapter is the last one (Storm); Up reaches The Lamp.
    await focusOpenChapter(page);

    await expect(row(page, "The Lamp")).toBeFocused({ timeout: 90_000 });
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Up");
    await expect(editorText(page)).not.toContainText("Press Up");

    await stopDictation(page);
  });
});
