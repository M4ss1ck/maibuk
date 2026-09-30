// Dictation types into plain text fields (issue #313): the Chromium fake
// microphone plays vendor/moonshine/e2e-voice/go-to-books-new-book.wav,
// which says "Go to Books.", pauses five seconds, dictates "The silent
// harbor.", pauses six seconds, says "Press the tab key.", pauses three
// seconds, dictates "Harbor Author.", pauses four seconds, then says "Press
// enter key.". The navigating Voice Command keeps the Dictation Session
// listening across the route change to Home; the author opens New Book inside
// the hand-off window, the first queued sentence lands in the title field
// that takes the caret, the focus Voice Command moves to the Author field,
// the second sentence lands there, and the closing focus Voice Command
// submits the dialog so the Book is created by voice.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here. One spec file
// per WAV, like the voice-focus-keys specs: the fake microphone file is a
// browser launch argument.
//
// Pattern: e2e/specs/voice-handoff.spec.ts; setup: e2e/support/voice-focus.ts.
import { capture } from "../support/capture";
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
  launchOptions: { args: voiceAudioArgs("go-to-books-new-book") },
});

test.describe("@wf:dictation-fields @sc:dictation.toggle @chromium-only", () => {
  test("a dictated line queued during navigation lands in the New Book fields, and Press Enter creates the Book", async ({
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

    // One dictated line is one undo step: Ctrl+Z removes the whole title
    // and Ctrl+Shift+Z restores it.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(titleField).toHaveValue("");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(titleField).toHaveValue(/silent harbor/i);

    await capture(page, "dictation-field-new-book", { around: [dialog] });

    // No more keyboard: "Press the tab key." (focus.next) moves to the
    // Author field, "Harbor Author." is dictated there, and "Press enter
    // key." (focus.activate) submits the form by voice.
    const authorField = dialog.getByRole("textbox", { name: "Author Name" });
    await expect(authorField).toBeFocused({ timeout: 30_000 });
    await expect(authorField).toHaveValue(/harbor author/i, { timeout: 30_000 });

    // "Press enter key." submits the dialog: it closes and the new Book opens.
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(
      page.getByRole("heading", { name: /silent harbor/i, level: 1 })
    ).toBeVisible();

    await stopDictation(page);
  });
});
