// A Plugin Command's Voice Command (issue #446): the fixture-everything Plugin's
// `openPage` Command answers to its label "Open fixture page", so the fake
// microphone (vendor/moonshine/e2e-voice/fixture-open-page.wav, synthesized by
// `pnpm e2e:voice-audio`) makes the host run it — navigating to the Plugin's
// page — instead of inserting the words into the Chapter. Chromium only: the
// fake microphone is a Chromium flag and WebKit is not cross-origin isolated
// here. Runs in the `voice` project (see e2e/support/voice-focus.ts).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "../support/test";
import {
  downloadEnglishFast,
  editorText,
  openChapterWithDictation,
  voiceAudioArgs,
} from "../support/voice-focus";

const AUDIO = resolve(
  import.meta.dirname,
  "../../vendor/moonshine/e2e-voice/fixture-open-page.wav"
);

if (!existsSync(AUDIO)) {
  throw new Error(
    `Missing ${AUDIO}: run \`pnpm e2e:voice-audio\` to synthesize the E2E Voice Command audio.`
  );
}

/** The fixture's required Plugin Permissions, the record the approval flow writes. */
const REQUIRED_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:api.fixture.test",
];

test.use({
  library: "oneBookTwoChapters",
  plugins: ["fixture-everything"],
  pluginApprovals: [{ pluginId: "fixture-everything", granted: [...REQUIRED_PERMISSIONS] }],
  launchOptions: { args: voiceAudioArgs("fixture-open-page") },
});

test.describe("@wf:plugins-contributions @chromium-only", () => {
  test("saying a Plugin Command's label runs it, not text", async ({ page }) => {
    test.setTimeout(300_000);
    await downloadEnglishFast(page);
    await openChapterWithDictation(page);

    // "Open fixture page." is the Plugin Command's label-derived Voice Command:
    // the host navigates to the Plugin's page (the words are never inserted).
    await expect(page).toHaveURL(/\/plugin\/fixture-everything\/panel$/, { timeout: 120_000 });
    await expect(page.getByRole("heading", { name: "Everything fixture", level: 1 })).toBeVisible();
    await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
    // The Chapter editor is gone: the phrase did not land as text.
    await expect(editorText(page)).toHaveCount(0);
  });
});
