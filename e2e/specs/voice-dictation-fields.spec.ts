// Dictation types into plain text fields (issue #313): the Chromium fake
// microphone plays vendor/moonshine/e2e-voice/go-to-projects-new-book.wav,
// which says "Go to Books.", pauses five seconds, dictates "The silent
// harbor.", pauses four seconds, then says "Press enter key.". The navigating
// Voice Command keeps the Dictation Session listening across the route change
// to Home; the author opens New Book inside the hand-off window, the queued
// sentence lands in the title field that takes the caret, and the focus Voice
// Command submits the dialog so the Book is created by voice.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here. One spec file
// per WAV, like the voice-focus-keys specs: the fake microphone file is a
// browser launch argument.
//
// Pattern: e2e/specs/voice-handoff.spec.ts; setup: e2e/support/voice-focus.ts.
import { capture } from "../support/capture";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  openChapter,
  startDictation,
  stopDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("go-to-projects-new-book") },
});

test.describe("@wf:dictation-fields @sc:dictation.toggle @chromium-only", () => {
  test("a dictated line queued during navigation lands in the New Book title field, and Press Enter creates the Book", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapter(page);
    await startDictation(page);

    // "Go to Books." runs global.gotoProjects instead of inserting the
    // words; the Session stays listening while the route changes.
    await expect(page).toHaveURL(/\/$/, { timeout: 90_000 });

    // Open New Book inside the hand-off window: the title field autofocuses
    // and takes the caret, so the queued sentence lands in it.
    await page.keyboard.press("Alt+n");
    const dialog = page.getByRole("dialog", { name: "New Book" });
    await expect(dialog).toBeVisible();
    const titleField = dialog.getByRole("textbox", { name: "Book Title" });
    await expect(titleField).toBeFocused();

    // The dictated line becomes the Book title, without the command's words.
    await expect(titleField).toHaveValue(/silent harbor/i, { timeout: 30_000 });
    await expect(titleField).not.toHaveValue(/go to books/i);

    await capture(page, "dictation-field-new-book", { around: [dialog] });

    // The dialog needs an author too: type it by keyboard, then Tab to the
    // Create Book button. The closing "Press enter key." (focus.activate)
    // presses Enter on the focused control, which clicks the button and
    // submits the form by voice.
    await page.keyboard.press("Tab");
    const authorField = dialog.getByRole("textbox", { name: "Author Name" });
    await expect(authorField).toBeFocused();
    await page.keyboard.type("Harbor Author");
    await tabTo(page, dialog.getByRole("button", { name: "Create Book" }), { max: 20 });

    // "Press enter key." submits the dialog: it closes and the new Book opens.
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(
      page.getByRole("heading", { name: /silent harbor/i, level: 1 })
    ).toBeVisible();

    await stopDictation(page);
  });
});
