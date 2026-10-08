import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { seedWebBackups } from "../support/storage";
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
const announcement = (page: Page) => page.getByRole("status").filter({ hasText: /^Dictation/ });

// The bar's picker trigger: it now shows the code (auto/en/es) while its
// accessible name stays "Dictation language".
const dictationPicker = (page: Page) => page.getByRole("button", { name: /Dictation language/ });

// The floating bar is the mic button's parent; measuring it proves the whole
// bar keeps its width, not just the picker.
const dictationBar = (page: Page) =>
  page.getByRole("button", { name: /Start dictation/ }).locator("xpath=..");

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

/** Settings opened on Dictation: its heading on screen and its switch focused. */
async function expectDictationSettingsShown(page: Page) {
  await expect(page.getByRole("switch", { name: "Dictation" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Dictation", exact: true })).toBeInViewport();
}

/**
 * Binds Cycle Dictation language to Alt+L through the real Shortcut Editor
 * (the Command has no Default Shortcut, so this is the only way it gets a key).
 */
async function bindCycleDictationShortcut(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const open = page.getByRole("button", { name: "Customize shortcuts" });
  await tabTo(page, open, { max: 90 });
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Customize shortcuts" });
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByRole("searchbox"));
  await page.keyboard.type("Cycle Dictation language");
  const row = dialog.getByRole("row", {
    name: "Cycle Dictation language",
    exact: true,
  });
  await tabTo(page, row);
  await pressUntilFocused(
    page,
    "ArrowRight",
    row.getByRole("button", {
      name: /^Add a shortcut to Cycle Dictation language/,
    }),
    { max: 8 }
  );
  await page.keyboard.press("Enter");

  const recorder = dialog.getByRole("textbox", { name: /Press the new shortcut/ });
  await expect(recorder).toBeFocused();
  await page.keyboard.press("Alt+l");
  await page.keyboard.press("Enter");
  await expect(row).toContainText("L");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test.describe("@wf:dictation-settings @chromium-only", () => {
  test("downloads and removes a model by keyboard", async ({ page }) => {
    const row = await downloadEnglishFast(page);
    await capture(page, "settings-dictation");
    await tabTo(page, row.getByRole("button", { name: "Remove" }), { max: 200 });
    await page.keyboard.press("Enter");
    await expect(row.getByRole("button", { name: "Download" })).toBeVisible();
  });

  test("the Dictation Language tab scopes the models and the language editors", async ({
    page,
  }) => {
    await page.goto("/settings#dictation");
    // The tab list opens on the author's language: English models, no Spanish.
    await expect(page.getByRole("group", { name: "English, Fast" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Spanish, Fast" })).toHaveCount(0);

    const englishTab = page.getByRole("tab", { name: "English" });
    await tabTo(page, englishTab, { max: 200 });
    await pressUntilFocused(page, "ArrowRight", page.getByRole("tab", { name: "Spanish" }));
    await expect(page.getByRole("tab", { name: "Spanish" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // The one panel scopes the model fieldsets, Spoken punctuation, and the
    // Dictation vocabulary editor to the chosen language.
    await expect(page.getByRole("group", { name: "Spanish, Fast" })).toBeVisible();
    await expect(page.getByRole("group", { name: "English, Fast" })).toHaveCount(0);
    await expect(
      page.getByRole("switch", { name: "Spoken punctuation for Spanish" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Spoken punctuation entries for Spanish" })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dictation vocabulary" })).toBeVisible();
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
    await expect(page.getByText(/The download failed|no longer available/).first()).toBeVisible();
    await expect(row.getByRole("button", { name: "Download" })).toBeVisible();
  });

  test("turning Dictation off removes the bar and the toggle does nothing; turning it on restores both", async ({
    page,
  }) => {
    const row = await downloadEnglishFast(page);
    // Captured before the switch is touched, so the base branch still gets a shot.
    await capture(page, "settings-dictation-switch", {
      around: [page.locator("#dictation")],
    });

    const dictationSwitch = page.getByRole("switch", { name: "Dictation" });
    await tabTo(page, dictationSwitch, { backwards: true, max: 200 });
    await page.keyboard.press("Space");
    await expect(dictationSwitch).not.toBeChecked();
    // Off keeps the downloaded models; the author can still manage them.
    await expect(row.getByText("Used for English")).toBeVisible();

    // A switch is an input, where a "g p" sequence would type instead; Tab off
    // it before navigating.
    await page.keyboard.press("Tab");

    // Off means gone, not hidden: no bar, and Start or stop Dictation is no
    // longer bound, so its key does nothing and the help leaves it out.
    await openChapter(page);
    await expect(page.getByRole("button", { name: /dictation/i })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+Space");
    await expect(announcement(page)).toHaveCount(0);

    await page.keyboard.press("Escape");
    // Escape hands focus to the Chapter list on the next frame; wait for it
    // before "?" or it lands in the editor as text.
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await capture(page, "shortcut-help");
    await expect(
      help.getByRole("region", { name: "On this screen" }).getByText("Start or stop dictation")
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();

    // Back on, the bar and the key return, and the model is still downloaded.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const backOn = page.getByRole("switch", { name: "Dictation" });
    await tabTo(page, backOn, { max: 200 });
    await page.keyboard.press("Space");
    await expect(backOn).toBeChecked();
    await expect(
      page.getByRole("group", { name: "English, Fast" }).getByText("Used for English")
    ).toBeVisible();

    // Back on, the switch is followed by the Dictation bar size radios, also
    // inputs: Tab past both before navigating.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Full" })).toBeFocused();
    await page.keyboard.press("Tab");
    await openChapter(page);
    await expect(page.getByRole("button", { name: /Start dictation/ })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+Space");
    await expect(announcement(page)).toHaveText(/Dictation on, English/);
    await page.keyboard.press("Escape");
    await expect(announcement(page)).toHaveText("Dictation off");
  });
});

test.describe("@wf:dictation-toggle @wf:dictation-interpreter-stats @sc:dictation.toggle @sc:dictation.stop @sc:dictation.cycleLanguage @chromium-only", () => {
  test("dictates into a Chapter, Escape stops, undo removes the line", async ({ page }) => {
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

    await page.keyboard.press("Escape");
    await tabTo(page, page.getByRole("button", { name: "Back to Home" }), {
      backwards: true,
      max: 120,
    });
    await page.keyboard.press("Enter");
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await page.locator("#dictation").scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-interpreter", {
      around: [page.locator("#dictation")],
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#dictation p").last().scrollIntoViewIfNeeded();
    await capture(page, "settings-dictation-interpreter-narrow");
    await expect(page.getByText(/Interpreter: typical delay/)).toBeVisible();
  });

  test("the floating mic button toggles the same session by Enter", async ({ page }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    await reachControl(page, page.getByRole("button", { name: /Start dictation/ }));
    await page.keyboard.press("Enter");
    await expect(announcement(page)).toHaveText(/Dictation on, English/);

    await page.keyboard.press("Enter");
    await expect(announcement(page)).toHaveText("Dictation off");
    await expect(page.getByRole("button", { name: /Start dictation/ })).toBeFocused();
  });

  test("the language picker switches language with arrow keys", async ({ page }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    const picker = dictationPicker(page);
    await expect(picker).toContainText("auto");
    await reachControl(page, picker);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(picker).toContainText("en");
    await expect(picker).not.toContainText("auto");
  });

  test("Cycle Dictation language, bound in the Shortcut Editor, cycles the picker and announces", async ({
    page,
  }) => {
    await downloadEnglishFast(page);
    await bindCycleDictationShortcut(page);

    await openChapter(page);
    const picker = dictationPicker(page);
    await expect(picker).toContainText("auto");

    // One model downloaded: Auto -> English -> Auto, announced each step.
    await page.keyboard.press("Alt+l");
    await expect(announcement(page)).toHaveText("Dictation language: English");
    await expect(picker).toContainText("en");

    await page.keyboard.press("Alt+l");
    await expect(announcement(page)).toHaveText("Dictation language: Auto");
    await expect(picker).toContainText("auto");
  });

  test("the bar keeps the same width across picker values", async ({ page }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    const bar = dictationBar(page);
    await expect(bar).toBeVisible();
    // Captured before the width assertion so the base branch still gets a shot.
    await capture(page, "dictation-bar-wide", { around: [bar] });

    const picker = dictationPicker(page);
    const autoBarWidth = (await bar.boundingBox())?.width ?? 0;
    const autoPickerWidth = (await picker.boundingBox())?.width ?? 0;
    expect(autoBarWidth).toBeGreaterThan(0);

    await reachControl(page, picker);
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(picker).toContainText("en");

    const enBarWidth = (await bar.boundingBox())?.width ?? 0;
    const enPickerWidth = (await picker.boundingBox())?.width ?? 0;
    expect(enBarWidth).toBeCloseTo(autoBarWidth, 1);
    expect(enPickerWidth).toBeCloseTo(autoPickerWidth, 1);
  });

  test("with no model downloaded, the shortcut hints and the mic leads to Settings", async ({
    page,
  }) => {
    await openChapter(page);
    await capture(page, "dictation-no-model");

    await page.keyboard.press("ControlOrMeta+Shift+Space");
    await expect(page.getByText(/No English dictation model is downloaded/).first()).toBeVisible();

    const mic = page.getByRole("button", { name: /Download a dictation model/ });
    await expect(mic).toBeVisible();
    await reachControl(page, mic);
    await page.keyboard.press("Enter");
    await expectDictationSettingsShown(page);
  });

  // Regression: the bar's link scrolled before the Backup list above Dictation
  // finished loading, so the list's growth left the page on the Editor section.
  // Without Backups nothing grows, so the bug needs them seeded to show.
  test("the bar's settings button lands on the Dictation section", async ({ page }) => {
    await page.goto("/");
    await seedWebBackups(page, 20);
    await openChapter(page);

    await reachControl(page, page.getByRole("button", { name: "Dictation settings" }));
    await page.keyboard.press("Enter");
    await expectDictationSettingsShown(page);
    // The heading sits at the top of the screen, not under the Editor section.
    const heading = await page.getByRole("heading", { name: "Dictation", exact: true }).boundingBox();
    const viewport = page.viewportSize();
    expect(heading && viewport && heading.y < viewport.height / 4).toBe(true);
    await capture(page, "dictation-settings-from-bar");
  });
});

test.describe("@wf:dictation-toggle @chromium-only at phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the bar fits a phone width", async ({ page }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    const bar = dictationBar(page);
    await expect(bar).toBeVisible();
    await capture(page, "dictation-bar-narrow", { around: [bar] });

    const box = await bar.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    // The compact picker stays a visible touch target inside the bar. On this
    // layout the Chapter list keeps Tab, so the picker is not reached by keys
    // here; cycling it is covered at the default viewport.
    const pickerBox = await dictationPicker(page).boundingBox();
    expect(pickerBox?.width ?? 0).toBeGreaterThan(0);
    expect((pickerBox?.x ?? 0) + (pickerBox?.width ?? 0)).toBeLessThanOrEqual(390);
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
