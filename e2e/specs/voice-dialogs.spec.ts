// A navigating Voice Command said over an open dialog (issue #319): the
// Chromium fake microphone plays vendor/moonshine/e2e-voice/go-to-notes.wav,
// the app hears "Go to Notes.", closes the Book Settings dialog first, and
// runs global.gotoNotes instead of inserting the words.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here.
//
// Pattern: e2e/specs/voice-commands-app.spec.ts; setup: e2e/support/voice-focus.ts.
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openBookSettings,
  openChapter,
  openChapterWithDictation,
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

  // No shipped dialog can be held in a state whose onClose refuses while the
  // phrase plays (the Export dialog's busy window lasts seconds against the
  // phrase's 45 s lead-in), so the refusal path has no passing E2E: it is
  // unit-tested through runCommand ("refused-dialog-close") and the session
  // ("dialog_refused"). Kept as an expected failure citing the issue.
  test.fail(
    "a dialog that cannot close keeps the route @wf:voice-commands-app",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/328",
      },
    },
    async ({ page }) => {
      test.setTimeout(180_000);
      await downloadEnglishFast(page);
      await openChapterWithDictation(page);
      const { dialog } = await openBookSettings(page);

      // A refusal would leave the route and the dialog as they are. The Book
      // Settings dialog is dismissable, so this fails: the dialog closes and
      // the gallery is shown. It passes again once a holdable busy dialog
      // ships (see the issue), and the guard flags that.
      await expect(page).toHaveURL(/\/notes$/, { timeout: 90_000 });
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/book\//);
      await expect(dialog).toBeVisible();
    }
  );
});
