// focus.left by voice (issue #318): the microphone says "Press Left".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  focusToolbar,
  openChapterWithDictation,
  stopDictation,
  toolbar,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-left") },
});

test.describe("@wf:voice-focus-keys @sc:focus.left @chromium-only", () => {
  test("saying Press Left moves back to Size", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusToolbar(page);
    const size = toolbar(page).getByRole("combobox", { name: "Size" });
    await expect(size).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(toolbar(page).locator(":focus")).toHaveAttribute("aria-label", "Show suggestions");

    await expect(size).toBeFocused({ timeout: 90_000 });
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Left");
    await expect(editorText(page)).not.toContainText("Press Left");

    await stopDictation(page);
  });
});
