import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// Dictation (spec docs/plans/2026-09-27-voice-dictation-design.md). Chromium
// only: the fake microphone plays vendor/moonshine/audio/two_cities_short.wav
// ("It was the best of times, it was the worst of times"); models are served
// from vendor/ by the harness route. WebKit is not cross-origin isolated
// without COEP credentialless, so it gets no control (its own test).
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });

// The Dictation control's live region. RouteAnnouncer is also role=status, so
// pick the announcement out by its text.
const announcement = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^Dictation/ });

async function downloadEnglishFast(page: Page) {
  await page.goto("/settings#dictation");
  const row = page.getByRole("group", { name: "English, Fast" });
  await tabTo(page, row.getByRole("button", { name: "Download" }), { max: 200 });
  await page.keyboard.press("Enter");
  await expect(row.getByText("Used for English")).toBeVisible({
    timeout: 60_000,
  });
  return row;
}

// Same keyboard path as editor-language.spec.ts: the first Book, Enter opens
// its first Chapter with the caret in the text. A later test reaches Home with
// the in-app "g p" sequence rather than a reload, because StartupRedirect would
// restore the last path (Settings, after a model download).
async function openChapter(page: Page) {
  const url = new URL(page.url());
  // prepareDevice leaves the page on a blank same-origin route; a spec that
  // already ran in the app reaches Home with "g p", because a reload would let
  // StartupRedirect restore the last path (Settings, after a model download).
  const onApp = url.hostname === "127.0.0.1" && !url.pathname.startsWith("/__e2e__");
  if (onApp && url.pathname !== "/") {
    await page.keyboard.press("g");
    await page.keyboard.press("p");
  } else {
    await page.goto("/");
  }
  await page.getByRole("grid", { name: "Books" }).getByRole("row").waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
}

/** The floating control sits after the Tab-trapping editor; wrap to it from the top. */
async function reachControl(page: Page, target: Locator) {
  await page.keyboard.press("Escape");
  await tabTo(page, target, { backwards: true, max: 120 });
}

test.describe("@wf:dictation-settings @chromium-only", () => {
  test("downloads and removes a model by keyboard", async ({ page }) => {
    const row = await downloadEnglishFast(page);
    await capture(page, "settings-dictation");
    await tabTo(page, row.getByRole("button", { name: "Remove" }), { max: 200 });
    await page.keyboard.press("Enter");
    await expect(row.getByRole("button", { name: "Download" })).toBeVisible();
  });

  test("Cancel during download leaves the model not downloaded", async ({ page }) => {
    // Hold the model files until Cancel is pressed, so the download is in flight.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/^https:\/\/download\.moonshine\.ai\//, async (route) => {
      await held;
      await route.abort().catch(() => {});
    });
    await page.goto("/settings#dictation");
    const row = page.getByRole("group", { name: "English, Fast" });
    await tabTo(page, row.getByRole("button", { name: "Download" }), { max: 200 });
    await page.keyboard.press("Enter");
    const cancel = row.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    release();
    await expect(row.getByRole("button", { name: "Download" })).toBeVisible();
    await expect(row.getByText("Downloaded")).toHaveCount(0);
  });

  test("a failed download shows the error and a Download button again", async ({ page }) => {
    await page.route(/^https:\/\/download\.moonshine\.ai\//, (route) =>
      route.fulfill({ status: 404 })
    );
    await page.goto("/settings#dictation");
    const row = page.getByRole("group", { name: "English, Fast" });
    await tabTo(page, row.getByRole("button", { name: "Download" }), { max: 200 });
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(/The download failed|no longer available/).first()
    ).toBeVisible();
    await expect(row.getByRole("button", { name: "Download" })).toBeVisible();
  });
});

test.describe("@wf:dictation-toggle @sc:dictation.toggle @sc:dictation.stop @chromium-only", () => {
  test("dictates into a Chapter, Escape stops, undo removes the line", async ({
    page,
  }) => {
    await downloadEnglishFast(page);
    await openChapter(page);
    await capture(page, "dictation-idle");

    await page.keyboard.press("ControlOrMeta+Shift+Space");
    await expect(announcement(page)).toHaveText(/Dictation on, English/);
    await expect(editorText(page)).toContainText("best of times", {
      timeout: 20_000,
    });
    await capture(page, "dictation-listening");

    await page.keyboard.press("Escape");
    await expect(announcement(page)).toHaveText("Dictation off");
    await expect(editorText(page)).toBeFocused();
    // Stopping clears the partial and commits the last line, so this is
    // document text now, not the partial's widget.
    await expect(editorText(page)).toContainText("best of times");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorText(page)).not.toContainText("worst of times");
  });

  test("the floating mic button toggles the same session by Enter", async ({
    page,
  }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    await reachControl(page, page.getByRole("button", { name: /Start dictation/ }));
    await page.keyboard.press("Enter");
    await expect(announcement(page)).toHaveText(/Dictation on, English/);

    await page.keyboard.press("Enter");
    await expect(announcement(page)).toHaveText("Dictation off");
    await expect(page.getByRole("button", { name: /Start dictation/ })).toBeFocused();
  });

  test("the language picker switches language with arrow keys", async ({
    page,
  }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    const picker = page.getByRole("button", { name: /Dictation language/ });
    await expect(picker).toContainText("Auto (Spell Check language)");
    await reachControl(page, picker);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(picker).toContainText("English");
    await expect(picker).not.toContainText("Auto (Spell Check language)");
  });

  test("with no model downloaded, the shortcut hints and the mic leads to Settings", async ({
    page,
  }) => {
    await openChapter(page);
    await capture(page, "dictation-no-model");

    await page.keyboard.press("ControlOrMeta+Shift+Space");
    await expect(
      page.getByText(/No English dictation model is downloaded/).first()
    ).toBeVisible();

    const mic = page.getByRole("button", { name: /Download a dictation model/ });
    await expect(mic).toBeVisible();
    await reachControl(page, mic);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Dictation" })).toBeVisible();
  });
});

// WebKit is not cross-origin isolated (no COEP credentialless), so the control
// never renders. Tagged @webkit-only: the chromium project greps it out.
test.describe("@wf:dictation-toggle @webkit-only", () => {
  test("shows no dictation control", async ({ page }) => {
    await openChapter(page);
    await expect(page.getByRole("button", { name: /dictation/i })).toHaveCount(0);
  });
});
