// Plugin writes (#452): the `fixture-everything` Plugin's `library:write`
// Chapter Command and its optional `editor:write` insert Command, driven by
// keyboard alone. The Chapter write reaches the open editor and the author's
// own typing survives; the editor insert lands as one undoable step; without
// the optional grant the insert is refused and changes nothing.

import type { Locator, Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

/** The fixture's required Plugin Permissions, in manifest order. */
const REQUIRED_PERMISSIONS = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:api.fixture.test",
];
/** The one optional Plugin Permission the editor insert Command needs. */
const EDITOR_WRITE = "editor:write";

/** The Chapter the Book opens after its last one, reached from the list. */
const CHAPTER = SEED_CHAPTERS[0].title;

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const chapterText = (page: Page) => page.getByRole("textbox", { name: `Text of ${CHAPTER}` });

/** Opens the Command Palette and returns its dialog. */
async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Types a palette query and leaves its matching option visible. */
async function paletteItem(page: Page, dialog: Locator, query: string): Promise<Locator> {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(`>${query}`);
  const option = dialog.getByRole("option", { name: query, exact: true });
  await expect(option).toBeVisible();
  return option;
}

/**
 * Waits until the Plugin is ready, so its Commands are enabled in the palette.
 * Its page renders its Remote UI only once its Worker is ready, and a Command
 * stays disabled until its Plugin is ready, so reaching the page gates the
 * palette listing.
 */
async function waitForPluginReady(page: Page): Promise<void> {
  // Reaching the Plugin page records it as the last path; a fresh "/" would be
  // redirected back to it. Seed `lastPath` null so the return to Home sticks.
  await seedSettings(page, { lastPath: null });
  await page.goto("/plugin/fixture-everything/panel");
  await expect(page.getByText("Deterministic content")).toBeVisible({ timeout: 15_000 });
}

/**
 * Opens the seeded Book and the named Chapter, leaving the caret at the end of
 * its text. The Book opens its last Chapter, so the Chapter list reaches back.
 * The Plugin page is left by keyboard, never a reload, so the readiness the
 * gate established survives (#446).
 */
async function openChapterEditor(page: Page): Promise<void> {
  await waitForPluginReady(page);
  await tabTo(page, navOption(page, "Books"));
  await page.keyboard.press("Enter");

  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();

  await page.keyboard.press("Escape");
  const grid = page.getByRole("grid", { name: "Chapters" });
  const row = grid.getByRole("row", { name: CHAPTER });
  await expect(row).toBeVisible();
  await tabTo(page, grid.getByRole("row", { selected: true }));
  await pressUntilFocused(page, "ArrowUp", row, { max: 20 });
  await page.keyboard.press("Enter");

  const text = chapterText(page);
  await expect(text).toBeVisible();
  await tabTo(page, text, { max: 20 });
  await expect(text).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
}

/** Runs a Plugin Command from the Command Palette. */
async function runPaletteCommand(page: Page, label: string): Promise<void> {
  const dialog = await openPalette(page);
  await paletteItem(page, dialog, label);
  await page.keyboard.press("Enter");
}

test.describe("Plugin writes @wf:plugins-writes @sandbox", () => {
  test.describe("a Chapter write while the author types", () => {
    test.use({
      library: "oneBookThreeChapters",
      plugins: ["fixture-everything"],
      pluginApprovals: [
        { pluginId: "fixture-everything", granted: [...REQUIRED_PERMISSIONS] },
      ],
    });

    test("reaches the open editor and keeps every line", async ({ page }) => {
      await openChapterEditor(page);
      const text = chapterText(page);

      await page.keyboard.type("The author wrote this first.");
      await page.keyboard.press("Enter");
      await page.keyboard.type("The author kept writing.");

      await runPaletteCommand(page, "Write chapter");
      // Do not wait for the write: keep typing immediately, while it runs.
      await expect(text).toBeFocused();
      await page.keyboard.type(" The author typed on.");

      // The Plugin's paragraph and every line the author typed, before and
      // after the Command, are all in the open editor.
      await expect(text).toContainText("Plugin wrote this.");
      await expect(text).toContainText("The author wrote this first.");
      await expect(text).toContainText("The author kept writing.");
      await expect(text).toContainText("The author typed on.");

      // The writing survives a reload.
      await page.reload();
      const reopened = chapterText(page);
      await expect(reopened).toContainText("Plugin wrote this.");
      await expect(reopened).toContainText("The author wrote this first.");
      await expect(reopened).toContainText("The author kept writing.");
      await expect(reopened).toContainText("The author typed on.");
    });
  });

  test.describe("an editor insert with editor:write granted", () => {
    test.use({
      library: "oneBookThreeChapters",
      plugins: ["fixture-everything"],
      pluginApprovals: [
        {
          pluginId: "fixture-everything",
          granted: [...REQUIRED_PERMISSIONS, EDITOR_WRITE],
        },
      ],
    });

    test("undo restores a Plugin editor insert in one step", async ({ page }) => {
      await openChapterEditor(page);
      const text = chapterText(page);

      await page.keyboard.type("The author wrote an ending.");

      await runPaletteCommand(page, "Insert greeting");
      await expect(text).toContainText("Hello from the Plugin");

      // One undo removes exactly the Plugin's insert, leaving the author's text.
      await expect(text).toBeFocused();
      await page.keyboard.press("ControlOrMeta+z");
      await expect(text).not.toContainText("Hello from the Plugin");
      await expect(text).toContainText("The author wrote an ending.");
    });
  });

  test.describe("an editor insert without editor:write", () => {
    test.use({
      library: "oneBookThreeChapters",
      plugins: ["fixture-everything"],
      // The record the approval flow writes: required granted, optional off.
      pluginApprovals: [
        { pluginId: "fixture-everything", granted: [...REQUIRED_PERMISSIONS] },
      ],
    });

    test("is refused and changes nothing", async ({ page }) => {
      await openChapterEditor(page);
      const text = chapterText(page);

      await page.keyboard.type("The author wrote an ending.");

      await runPaletteCommand(page, "Insert greeting");
      // The refused call is reported, and the editor is left as it was.
      await expect(
        page.getByRole("status").filter({ hasText: "Fixture insert greeting refused: permission-denied" })
      ).toBeVisible({ timeout: 5_000 });
      await expect(text).not.toContainText("Hello from the Plugin");
      await expect(text).toContainText("The author wrote an ending.");
    });
  });
});
