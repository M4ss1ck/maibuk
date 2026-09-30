// focus.first by voice (issue #318): the microphone says "Press Home".
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
  launchOptions: { args: voiceAudioArgs("focus-first") },
});

test.describe("@wf:voice-focus-keys @sc:focus.first @chromium-only", () => {
  test("saying Press Home moves to the first Chapter row", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusOpenChapter(page);

    await expect(row(page, "Arrival")).toBeFocused({ timeout: 90_000 });
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Home");
    await expect(editorText(page)).not.toContainText("Press Home");

    await stopDictation(page);
  });
});
