// focus.right by voice (issue #318): the microphone says "Press Right".
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
  launchOptions: { args: voiceAudioArgs("focus-right") },
});

test.describe("@wf:voice-focus-keys @sc:focus.right @chromium-only", () => {
  test("saying Press Right moves to the next toolbar control", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusToolbar(page);
    await expect(toolbar(page).getByRole("combobox", { name: "Size" })).toBeFocused();

    const next = toolbar(page).locator(":focus");
    await expect(next).toHaveAttribute("aria-label", "Show suggestions", { timeout: 90_000 });
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Right");
    await expect(editorText(page)).not.toContainText("Press Right");

    await stopDictation(page);
  });
});
