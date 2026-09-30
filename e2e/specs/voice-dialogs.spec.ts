// A navigating Voice Command said over an open dialog (issue #319): the
// Chromium fake microphone plays vendor/moonshine/e2e-voice/go-to-notes.wav,
// the app hears "Go to Notes.", closes the Book Settings dialog first, and
// runs global.gotoNotes instead of inserting the words. Over a dialog that
// cannot close (a busy export, issue #328) the Command is refused instead.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here.
//
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { holdBlobReads, releaseBlobReads } from "../support/fault";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openBookSettings,
  openChapter,
  openChapterWithDictation,
  stopDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("go-to-notes") },
});

test.describe("@wf:voice-commands-app @sc:dictation.toggle @chromium-only", () => {
  test("saying Go to Notes over a dialog closes it and shows the Notes gallery", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    // Dictation starts before the dialog: a Modal blocks the toggle shortcut,
    // but the Voice Command itself runs through the Command Runner.
    await openChapterWithDictation(page);
    const { dialog } = await openBookSettings(page);

    // "Go to Notes." is a navigating Voice Command: the dialog closes first
    // and the Notes gallery is shown. The Notes gallery has no Dictation live
    // region, so the proof is the route change itself (a command runner ran,
    // not text insertion) plus the dialog being gone.
    await expect(page).toHaveURL(/\/notes$/, { timeout: 90_000 });
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Back in the Chapter by keyboard: the spoken words never landed in text.
    await openChapter(page);
    await expect(editorText(page)).not.toContainText("Go to Notes");
  });

  // A busy Export dialog refuses to close (issue #328): Blob reads are held,
  // so the export stays busy for as long as the phrase takes to arrive. "Go
  // to Notes." is refused instead of run: the route and the dialog stay, and
  // the Session says why. Releasing the reads lets the export finish and the
  // dialog close by itself, which proves the hold was the only thing keeping
  // it open.
  test("a busy Export dialog refuses Go to Notes and keeps the route", async ({ page }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);
    const bookUrl = page.url();

    const trigger = page.getByRole("button", { name: "Export Book" });
    await tabTo(page, trigger, { max: 40, backwards: true });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Export Book" });
    await expect(dialog.getByRole("button", { name: "EPUB", exact: true })).toBeFocused();

    await holdBlobReads(page);
    await tabTo(page, dialog.getByRole("button", { name: "Export EPUB", exact: true }), {
      max: 10,
    });
    await page.keyboard.press("Enter");
    const busy = dialog.getByRole("button", { name: "Exporting...", exact: true });
    await expect(busy).toBeDisabled();

    // The refusal is heard while the dialog is still open (issue #336).
    const refusal = "The dialog can't close now, so Go to Notes did not run.";
    await expect(page.getByRole("status").filter({ hasText: refusal })).toHaveCount(1, {
      timeout: 90_000,
    });
    expect(page.url()).toBe(bookUrl);
    await expect(dialog).toBeVisible();
    await expect(busy).toBeDisabled();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      releaseBlobReads(page),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.epub$/);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(bookUrl);
    await expect(page.getByRole("status").filter({ hasText: refusal })).toBeVisible();

    // The spoken words never landed in the Chapter.
    await expect(editorText(page)).not.toContainText("Go to Notes");
    await stopDictation(page);
  });
});
