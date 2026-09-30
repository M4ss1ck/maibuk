// Every Command answers to its label (ADR 0016), end to end: the Chromium fake
// microphone plays vendor/moonshine/e2e-voice/dark-theme.wav, the app hears
// "Dark theme." and runs global.themeDark instead of inserting the words.
//
// The audio is generated once with `pnpm e2e:voice-audio` (Piper text to
// speech, not the author's voice). Chromium only: the fake microphone is a
// Chromium flag and WebKit is not cross-origin isolated here.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/test";
import { tabTo } from "../support/keyboard";

const AUDIO = resolve(import.meta.dirname, "../../vendor/moonshine/e2e-voice/dark-theme.wav");

if (!existsSync(AUDIO)) {
  throw new Error(
    `Missing ${AUDIO}: run \`pnpm e2e:voice-audio\` to synthesize the E2E Voice Command audio.`
  );
}

test.use({
  library: "oneBookThreeChapters",
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${AUDIO}`,
    ],
  },
});

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });

// The Dictation control's live region (the same one dictation.spec.ts reads).
const dictationStatus = (page: Page) => page.getByRole("status").filter({ hasText: /^Dictation/ });
const voiceStatus = (page: Page) => page.getByRole("status").filter({ hasText: /^Voice command/ });

async function downloadEnglishFast(page: Page) {
  await page.goto("/settings#dictation");
  const row = page.getByRole("group", { name: "English, Fast" });
  await tabTo(page, row.getByRole("button", { name: "Download" }), { max: 200 });
  await page.keyboard.press("Enter");
  await expect(row.getByText("Used for English")).toBeVisible({ timeout: 60_000 });
}

// Same keyboard path as dictation.spec.ts: the first Book, Enter opens its
// first Chapter with the caret in the text.
async function openChapter(page: Page) {
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await page.getByRole("grid", { name: "Books" }).getByRole("row").waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
}

test.describe("@wf:voice-commands-app @sc:dictation.toggle @chromium-only", () => {
  test("saying a command's label runs the Command, not text", async ({ page }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    await page.keyboard.press("ControlOrMeta+Shift+Space");
    await expect(dictationStatus(page)).toHaveText(/Dictation on, English/);

    // "Dark theme." is a Voice Command: global.themeDark runs (the theme turns
    // dark, the Command's live-region message names it) and the words are
    // never inserted into the Chapter.
    await expect(html).toHaveClass(/dark/, { timeout: 25_000 });
    await expect(voiceStatus(page)).toHaveText("Voice command: Dark");
    await expect(editorText(page)).not.toContainText("Dark theme");

    await page.keyboard.press("Escape");
    await expect(dictationStatus(page)).toHaveText("Dictation off");
  });
});
