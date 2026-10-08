import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";
import {
  dictationStatus,
  downloadEnglishFast,
  openChapter,
  startDictation,
  stopDictation,
} from "../support/voice-focus";

// The Dictation Bar's size (Settings → Dictation) and its collapse. Chromium
// only, like every Dictation spec: WebKit is not cross-origin isolated.
test.use({ library: "oneBookThreeChapters" });

const mic = (page: Page) => page.getByRole("button", { name: /(Start|Stop) dictation/ });
const bar = (page: Page) => mic(page).locator("xpath=..");
const picker = (page: Page) => page.getByRole("button", { name: /Dictation language/ });
const sizeGroup = (page: Page) => page.getByRole("radiogroup", { name: "Dictation bar size" });

const SIZES = ["Hidden", "Compact", "Full"] as const;

/** Settings → Dictation; Tab reaches the checked size and the arrows step to `size`. */
async function pickSize(page: Page, size: (typeof SIZES)[number]) {
  // A model download leaves the page here already; a goto to the same URL
  // would not navigate.
  if (!page.url().endsWith("/settings#dictation")) await page.goto("/settings#dictation");
  const radio = (name: string) => sizeGroup(page).getByRole("radio", { name });
  let current = -1;
  for (const [i, name] of SIZES.entries()) if (await radio(name).isChecked()) current = i;
  await tabTo(page, radio(SIZES[current]), { max: 200 });
  const target = SIZES.indexOf(size);
  for (let i = current; i !== target; i += target > current ? 1 : -1) {
    await page.keyboard.press(target > current ? "ArrowRight" : "ArrowLeft");
  }
  await expect(radio(size)).toBeChecked();
  // A radio is a typing target; leave it so the "g p" Shortcut reaches Home.
  await page.keyboard.press("Tab");
}

/** The bar's controls sit after the Tab-trapping editor; wrap to them from the top. */
async function reachBar(page: Page, target: ReturnType<Page["getByRole"]>) {
  await page.keyboard.press("Escape");
  await tabTo(page, target, { backwards: true, max: 120 });
}

test.describe("@wf:dictation-bar-size @sc:dictation.toggleBar @chromium-only", () => {
  test("Compact in Settings draws the editor's bar at its preview's size", async ({ page }) => {
    await downloadEnglishFast(page);
    await pickSize(page, "Compact");
    await capture(page, "dictation-bar-size-setting", { around: [sizeGroup(page)] });
    const previews = sizeGroup(page).locator("[data-dictation-bar-preview] > [data-bar-part]");
    const compactPreview = await previews.nth(0).boundingBox();
    const fullPreview = await previews.nth(1).boundingBox();

    await openChapter(page);
    await expect(picker(page)).toHaveText(/auto/);
    await capture(page, "dictation-bar-compact", { around: [bar(page)] });
    const compactBar = await bar(page).boundingBox();
    expect(compactBar?.width).toBeCloseTo(compactPreview?.width ?? -1, 0);
    expect(compactBar?.height).toBeCloseTo(compactPreview?.height ?? -1, 0);
    // Compact takes markedly less room than Full.
    expect(compactBar?.width ?? 0).toBeLessThan((fullPreview?.width ?? 0) * 0.75);

    await pickSize(page, "Full");
    await openChapter(page);
    await capture(page, "dictation-bar-full", { around: [bar(page)] });
    const fullBar = await bar(page).boundingBox();
    expect(fullBar?.width).toBeCloseTo(fullPreview?.width ?? -1, 0);
  });

  test("collapses to the microphone, stays collapsed across screens, and expands", async ({
    page,
  }) => {
    await downloadEnglishFast(page);
    await openChapter(page);

    const collapse = page.getByRole("button", { name: "Collapse dictation bar" });
    await reachBar(page, collapse);
    await page.keyboard.press("Enter");
    const expand = page.getByRole("button", { name: "Expand dictation bar" });
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dictation settings" })).toHaveCount(0);
    await expect(mic(page)).toBeVisible();
    await capture(page, "dictation-bar-collapsed", { around: [bar(page)] });

    // The microphone still starts and stops the Session while collapsed.
    await startDictation(page);
    await stopDictation(page);

    // Ephemeral has its own bar; the collapse is the same.
    await page.keyboard.press("Escape");
    await page.keyboard.press("g");
    await page.keyboard.press("e");
    await expect(page.getByRole("button", { name: "Expand dictation bar" })).toBeVisible();

    await openChapter(page);
    await reachBar(page, page.getByRole("button", { name: "Expand dictation bar" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Collapse dictation bar" })).toBeFocused();
    await expect(picker(page)).toBeVisible();
  });

  test("Hidden shows only a microphone while a Session runs", async ({ page }) => {
    await downloadEnglishFast(page);
    await pickSize(page, "Hidden");
    await openChapter(page);
    await expect(mic(page)).toHaveCount(0);

    await startDictation(page);
    await expect(page.getByRole("button", { name: /Stop dictation/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Collapse|Expand/ })).toHaveCount(0);
    await expect(picker(page)).toHaveCount(0);
    await capture(page, "dictation-bar-hidden-listening", { around: [bar(page)] });

    await page.keyboard.press("Escape");
    await expect(dictationStatus(page)).toHaveText("Dictation off");
    await expect(mic(page)).toHaveCount(0);
  });
});
