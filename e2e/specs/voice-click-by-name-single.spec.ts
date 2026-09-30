// Click by Name, single match (issue #321): the microphone says
// "Click Book Settings." and the app presses that control.
// Pattern: e2e/specs/voice-focus-keys-next.spec.ts; setup: e2e/support/voice-focus.ts.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openChapterWithDictation,
  stopDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("click-book-settings") },
});

// The Dictation live region holds the Click by Name notice.
const clickStatus = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: text });

test.describe("@wf:voice-click-by-name @sc:dictation.toggle @chromium-only", () => {
  test("saying Click Book Settings presses that control", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);

    // "Click Book Settings." presses the Book Settings button: its dialog opens.
    const dialog = page.getByRole("dialog", { name: "Book Settings" });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
    // The notice is heard while the dialog it opened is showing (issue #336).
    await expect(clickStatus(page, "Pressed Book Settings.")).toBeVisible();

    // The words never land in the Chapter.
    await expect(editorText(page)).not.toContainText("Click Book Settings");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await stopDictation(page);
  });
});
