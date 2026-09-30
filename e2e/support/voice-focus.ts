// Shared setup for the voice-focus-keys specs (issue #318): one spec file
// per WAV, since the fake microphone file is a browser launch argument and
// Playwright forbids test.use({ launchOptions }) inside a describe. Each spec
// opens a Chapter, places focus by keyboard, turns Dictation on, and waits
// for its phrase. The WAVs carry 45 s of leading silence (the download and
// keyboard setup finish first) and 30 s of trailing silence (the looping fake
// mic never repeats a phrase inside a test).
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "./keyboard";
import { expect } from "./test";

const VOICE_DIR = resolve(import.meta.dirname, "../../vendor/moonshine/e2e-voice");

/** Browser launch flags playing one synthesized phrase file as the microphone. */
export function voiceAudioArgs(name: string): string[] {
  const file = resolve(VOICE_DIR, `${name}.wav`);
  if (!existsSync(file)) {
    throw new Error(`Missing ${file}: run \`pnpm e2e:voice-audio\` to synthesize it.`);
  }
  return [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${file}`,
  ];
}

export const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
export const grid = (page: Page) => page.getByRole("grid", { name: "Chapters" });
export const row = (page: Page, title: string) => grid(page).getByRole("row", { name: title });
export const pane = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });
export const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });

// The Dictation control's live regions (the same ones dictation.spec.ts reads).
export const dictationStatus = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^Dictation/ });
export const voiceStatus = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^Voice command/ });

export async function downloadEnglishFast(page: Page) {
  await downloadEnglish(page, "Fast");
}

export async function downloadEnglishAccurate(page: Page) {
  await downloadEnglish(page, "Accurate");
}

export async function downloadEnglish(page: Page, tier: "Fast" | "Accurate") {
  await page.goto("/settings#dictation");
  const group = page.getByRole("group", { name: `English, ${tier}` });
  await tabTo(page, group.getByRole("button", { name: "Download" }), { max: 200 });
  await page.keyboard.press("Enter");
  await expect(group.getByText("Used for English")).toBeVisible({ timeout: 60_000 });
}

// The first Book, Enter opens its last Chapter with the caret in the text.
// After a model download the last path is Settings, which StartupRedirect
// would restore, so an app already running returns Home with "g p".
export async function openChapter(page: Page) {
  const url = new URL(page.url());
  const onApp = url.hostname === "127.0.0.1" && !url.pathname.startsWith("/__e2e__");
  if (onApp && url.pathname !== "/") {
    await page.keyboard.press("g");
    await page.keyboard.press("p");
  } else {
    await page.goto("/");
  }
  await page.getByRole("grid", { name: "Books" }).getByRole("row").first().waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
}

export async function startDictation(page: Page) {
  await page.keyboard.press("ControlOrMeta+Shift+Space");
  await expect(dictationStatus(page)).toHaveText(/Dictation on, English/);
}

export async function stopDictation(page: Page) {
  await page.keyboard.press("ControlOrMeta+Shift+Space");
  // Off clears the live region once nothing is listening; the control may also
  // unmount it. Either reads as stopped.
  await expect
    .poll(async () => {
      const texts = await dictationStatus(page).allTextContents();
      return texts.length === 0 || texts.every((text) => text === "Dictation off");
    })
    .toBe(true);
}

// Opens the Chapter with the caret in the text, Escapes to the Chapter list,
// then turns Dictation on there. Escape before Dictation starts: once it
// listens, Escape belongs to Stop Dictation. Dictation must start before any
// dialog opens too: a Modal blocks `useShortcuts`, so the toggle key would not
// reach it, while the Voice Command still runs through the Command Runner.
export async function openChapterWithDictation(page: Page) {
  await openChapter(page);
  await page.keyboard.press("Escape");
  await expectFocusWithin(pane(page));
  await startDictation(page);
}

/** Tabs into the grid and arrows to `title` with real keys, from any row. */
export async function focusChapter(page: Page, title: string) {
  await tabTo(page, grid(page).getByRole("row", { selected: true }));
  await pressUntilFocused(page, "ArrowUp", row(page, title));
  await pressUntilFocused(page, "ArrowDown", row(page, title));
}

/** Tabs into the grid to the open Chapter (the last one, Storm). */
export async function focusOpenChapter(page: Page) {
  await tabTo(page, grid(page).getByRole("row", { selected: true }));
  await expect(row(page, "Storm")).toBeFocused();
}

export async function openBookSettings(page: Page) {
  const trigger = page.getByRole("button", { name: "Book Settings" });
  await tabTo(page, trigger, { max: 80, backwards: true });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book Settings" });
  await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
  return { dialog, trigger };
}

/** Tabs from the Chapter list until focus is inside the formatting toolbar. */
export async function focusToolbar(page: Page) {
  for (let i = 0; i < 40; i++) {
    if (await isFocusWithin(toolbar(page))) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the toolbar");
}
