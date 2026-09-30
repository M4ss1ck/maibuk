// The navigation hand-off with nowhere to go (issue #320, spec #315,
// ADR 0016): the Chromium fake microphone plays
// vendor/moonshine/e2e-voice/go-to-settings.wav ("Go to Settings."). Settings
// has no editor, so the hand-off window runs out, the Session stops, and the
// app-shell live region says why.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here. One spec file
// per WAV, like the voice-focus-keys specs: the fake microphone file is a
// browser launch argument.
//
// Pattern: e2e/specs/voice-dialogs.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  openChapter,
  startDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("go-to-settings") },
});

test.describe("@wf:voice-commands-app @chromium-only", () => {
  test("a navigating Voice Command to a screen with no editor stops Dictation", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapter(page);
    await startDictation(page);

    // "Go to Settings." runs global.gotoSettings instead of inserting the
    // words. No editor takes the caret there, so the hand-off window runs out
    // and the Session stops with the handoff message in the shell live region.
    await expect(page).toHaveURL(/\/settings/, { timeout: 90_000 });
    const handoffNotice = page.getByRole("status").filter({ hasText: "No editor here" });
    await expect(handoffNotice).toHaveText("No editor here, so Dictation stopped.", {
      timeout: 30_000,
    });

    // Back in the Chapter the mic is off: Dictation stayed stopped.
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await page.getByRole("grid", { name: "Books" }).getByRole("row").first().waitFor();
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: /^Text of / })).toBeFocused();
    await expect(
      page.getByRole("button", { name: /Start dictation/ })
    ).toBeVisible();
  });
});
