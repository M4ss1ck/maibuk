// The navigation hand-off (issue #320, spec #315, ADR 0016): the Chromium
// fake microphone plays vendor/moonshine/e2e-voice/go-to-ephemeral-handoff.wav,
// which says "Go to Ephemeral.", pauses two seconds, then dictates "The sea
// was calm.". The navigating Voice Command keeps the Dictation Session
// listening across the route change, and the sentence lands in the Ephemeral
// editor once it takes the caret.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here. One spec file
// per WAV, like the voice-focus-keys specs: the fake microphone file is a
// browser launch argument.
//
// Pattern: e2e/specs/voice-dialogs.spec.ts; setup: e2e/support/voice-focus.ts.
import type { Page } from "@playwright/test";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  openChapter,
  startDictation,
  stopDictation,
  voiceAudioArgs,
  voiceStatus,
} from "../support/voice-focus";

test.use({
  library: "oneBookThreeChapters",
  launchOptions: { args: voiceAudioArgs("go-to-ephemeral-handoff") },
});

const ephemeralEditor = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });

test.describe("@wf:voice-commands-app @chromium-only", () => {
  test("a navigating Voice Command hands Dictation to the editor that takes the caret", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await downloadEnglishFast(page);
    await openChapter(page);
    await startDictation(page);

    // "Go to Ephemeral." runs global.gotoEphemeral instead of inserting the
    // words; the Session stays listening while the route changes.
    await expect(page).toHaveURL(/\/ephemeral$/, { timeout: 90_000 });

    // The new editor takes the caret: the hand-off window closes and the
    // sentence dictated after the pause lands in it, without the command's
    // words.
    await tabTo(page, ephemeralEditor(page), { max: 60 });
    await expect(ephemeralEditor(page)).toBeFocused();
    await expect(ephemeralEditor(page)).toContainText(/sea was calm/i, { timeout: 30_000 });
    await expect(ephemeralEditor(page)).not.toContainText(/femoral|ephemeral/i);

    // Dictation is still on after the hand-off: the mic shows Stop, and the
    // live region names the Command that ran.
    await expect(page.getByRole("button", { name: /Stop dictation/ })).toBeVisible();
    await expect(voiceStatus(page)).toHaveText("Voice command: Go to Ephemeral");

    await stopDictation(page);
  });
});
