// Saying "Show voice commands" opens the shortcut help with its Voice
// Commands (issue #322): the Chromium fake microphone plays
// vendor/moonshine/e2e-voice/show-voice-commands.wav, the app hears
// "Show voice commands." and runs global.showHelp, and the help lists each
// Bound Shortcut's Voice Command next to its Shortcut.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here.
//
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { capture } from "../support/capture";
import { expectFocusWithin } from "../support/keyboard";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openChapterWithDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("show-voice-commands") },
});

test.describe("@wf:voice-commands-app @chromium-only", () => {
  test("saying Show voice commands opens the help with its Voice Commands", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    // Dictation starts before the dialog: a Modal blocks the toggle shortcut,
    // but the Voice Command itself runs through the Command Runner.
    await openChapterWithDictation(page);

    // "Show voice commands." runs global.showHelp: the Keyboard shortcuts
    // dialog opens and lists each Bound Shortcut's Voice Command next to its
    // Shortcut. The spoken words never land in the Chapter text.
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await expectFocusWithin(dialog);
    const notes = dialog.getByRole("listitem").filter({ hasText: "Go to Notes" }).first();
    await expect(notes.getByText(/Voice \(English\)/)).toBeVisible();
    // The label and its Voice Command read the same; both are listed.
    await expect(notes.getByText("Go to Notes")).toHaveCount(2);
    await expect(editorText(page)).not.toContainText("Show voice commands");
    await capture(page, "shortcut-help-voice", { around: [dialog] });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
