// focus.toggle by voice (issue #318): the microphone says "Press Space".
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  focusChapter,
  grid,
  openChapterWithDictation,
  row,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("focus-toggle") },
});

test.describe("@wf:voice-focus-keys @sc:focus.toggle @chromium-only", () => {
  test("saying Press Space presses No and keeps the Chapter", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    await focusChapter(page, "The Lamp");
    const remove = row(page, "The Lamp").getByRole("button", { name: "Delete Chapter" });
    await tabTo(page, remove, { max: 6 });
    await page.keyboard.press("Enter");
    const no = page.getByRole("button", { name: "No", exact: true });
    await expect(no).toBeFocused();

    // "Press Space." runs focus.toggle: No is pressed, the confirm closes,
    // the Chapter stays, and focus returns to its Delete button.
    await expect(no).toBeHidden({ timeout: 90_000 });
    await expect(row(page, "The Lamp")).toBeVisible();
    await expect(remove).toBeFocused();
    await expect(grid(page).getByRole("row")).toHaveCount(3);
    await expect(voiceStatus(page)).toHaveText("Voice command: Press Space");

    await stopDictation(page);
  });
});
