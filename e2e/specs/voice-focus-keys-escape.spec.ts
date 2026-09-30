// focus.escape by voice (issue #318): the microphone says "Press Escape".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  focusChapter,
  openChapterWithDictation,
  row,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-escape") },
});

test.describe("@wf:voice-focus-keys @sc:focus.escape @chromium-only", () => {
  test("saying Press Escape closes the shortcuts help", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusChapter(page, "The Lamp");
    await page.keyboard.press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();

    await expect(dialog).toBeHidden({ timeout: 90_000 });
    await expect(row(page, "The Lamp")).toBeFocused();
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Escape");

    await stopDictation(page);
  });
});
