// focus.previous by voice (issue #318): the microphone says "Press Shift Tab".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openBookSettings,
  openChapterWithDictation,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-previous") },
});

test.describe("@wf:voice-focus-keys @sc:focus.previous @chromium-only", () => {
  test("saying Press Shift Tab moves focus back to Book Title", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    const { dialog } = await openBookSettings(page);
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("textbox", { name: "Subtitle" })).toBeFocused();

    await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused({
      timeout: 90_000,
    });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expect(voiceStatus(page)).toHaveText("Voice command: Press Shift Tab");
    await expect(editorText(page)).not.toContainText("Press Shift Tab");

    await stopDictation(page);
  });
});
