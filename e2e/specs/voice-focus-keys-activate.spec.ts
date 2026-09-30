// focus.activate by voice (issue #318): the microphone says "Press Enter".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  focusChapter,
  openChapterWithDictation,
  stopDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-activate") },
});

test.describe("@wf:voice-focus-keys @sc:focus.activate @chromium-only", () => {
  test("saying Press Enter opens the focused Chapter", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusChapter(page, "The Lamp");

    // "Press enter key." runs focus.activate: the row opens like a real Enter,
    // and the words never land in the Chapter.
    const text = page.getByRole("textbox", { name: "Text of The Lamp" });
    // Opening another Chapter replaces the editor that owned the Dictation
    // live region, so its announcement goes with it until the session hands
    // off across editors (#320); the opened Chapter is the visible outcome.
    await expect(text).toBeVisible({ timeout: 90_000 });
    await expect(text).not.toContainText("Press enter key");

    await stopDictation(page);
  });
});
