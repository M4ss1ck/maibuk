// Click by Name duplicates (issue #321): the main toolbar and the floating
// selection toolbar both offer Bold, so "Click Bold." shows numbered badges
// and a number answers them, pressing exactly one of the two.
//
// The number is "one": the shipped English models hear "two" as "to" and
// "three" as "free" (measured in the phrase lane), so the numbered press is
// proven with the number they transcribe. Do not add heard forms (#324).
// Pattern: e2e/specs/editor-context-menu.spec.ts; setup: e2e/support/voice-focus.ts.
import type { Page } from "@playwright/test";
import { expect, test } from "../support/test";
import { capture } from "../support/capture";
import { seedSettings } from "../support/storage";
import {
  downloadEnglishFast,
  editorText,
  openChapter,
  startDictation,
  stopDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("click-bold-then-one") },
});

async function selectFirstWords(page: Page, count: number) {
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < count; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
}

test.describe("@wf:voice-click-by-name @sc:dictation.toggle @chromium-only", () => {
  test("duplicate names show badges and a number presses exactly one", async ({ page }) => {
    test.setTimeout(240_000);
    // Expanded so the main toolbar renders every group, Bold included.
    await seedSettings(page, { toolbarExpanded: true });
    await downloadEnglishFast(page);
    await openChapter(page);
    await startDictation(page);

    // A selection shows the floating toolbar: Bold is now two controls.
    await selectFirstWords(page, 5);
    await expect(
      page.getByRole("toolbar", { name: "Selection formatting" })
    ).toBeVisible({ timeout: 10_000 });

    // "Click Bold." finds both: the live region counts the matches.
    const clickStatus = page.getByRole("status").filter({ hasText: /matches/ });
    await expect(clickStatus).toHaveText("2 matches. Say click and a number.", {
      timeout: 90_000,
    });

    // Badges show while the choices are pending, for the PR screenshots.
    await capture(page, "click-by-name-badges");

    // "Click one." presses exactly one Bold: the selection turns bold, and the
    // spoken words never land in the Chapter.
    await expect(editorText(page).locator("strong")).toBeVisible({ timeout: 90_000 });
    await expect(editorText(page)).not.toContainText("Click Bold");
    await expect(editorText(page)).not.toContainText("Click one");

    await stopDictation(page);
  });
});
