// focus.down by voice (issue #318): the microphone says "Press Down".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  focusChapter,
  openChapterWithDictation,
  row,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-down") },
});

test.describe("@wf:voice-focus-keys @sc:focus.down @chromium-only", () => {
  test("saying Press Down moves to the next Chapter row", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusChapter(page, "Arrival");

    await expect(row(page, "The Lamp")).toBeFocused({ timeout: 90_000 });
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Down");
    await expect(editorText(page)).not.toContainText("Press Down");

    await stopDictation(page);
  });
});
