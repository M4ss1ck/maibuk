// Command Palette (issue #353): find and run anything by name, keyboard-only.
// Every test opens the palette with F1 and drives the search field, the
// virtual-focus list, and the nested pages with the keyboard alone.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, expectTabContained, tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS, SHELF_BOOKS } from "../support/seed/names";
import { expect, test } from "../support/test";

test.use({ library: "paletteLibrary" });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const searchbox = (page: Page) =>
  dialog(page).getByRole("searchbox", { name: "Find by name" });
const option = (page: Page, name: string) =>
  dialog(page).getByRole("option", { name, exact: true });

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press("F1");
  await expect(dialog(page)).toBeVisible();
  await expect(searchbox(page)).toBeFocused();
}

/**
 * Types a query and waits for React Aria to settle the active result: it moves
 * the input's aria-activedescendant 500 ms after typing, so arrows pressed
 * before that land on a stale row.
 */
async function search(page: Page, query: string): Promise<void> {
  await page.keyboard.type(query);
  await expect
    .poll(async () => searchbox(page).getAttribute("aria-activedescendant"))
    .toBeTruthy();
}

/** The item key of the active result, read off the input's active descendant. */
async function activeKey(page: Page): Promise<string> {
  return (await searchbox(page).getAttribute("aria-activedescendant")) ?? "";
}

/**
 * Arrows until the item with key `key` (e.g. `command:global.toggleTheme`,
 * `settingsRow:theme`) is the active result. The first ArrowDown after typing
 * is swallowed while the list settles, so this re-reads after every press
 * instead of counting presses.
 */
async function arrowTo(page: Page, key: string, { max = 30 } = {}): Promise<void> {
  for (let i = 0; i < max; i++) {
    if ((await activeKey(page)).includes(`option-${key}`)) return;
    await page.keyboard.press("ArrowDown");
    // A beat for React Aria to move virtual focus; a swallowed press just
    // costs one more loop.
    await page.waitForTimeout(250);
  }
  throw new Error(`arrowTo never reached ${key}; still on ${await activeKey(page)}`);
}

async function openBookEditorOnArrival(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "My Books", level: 1 })
  ).toBeVisible();
  await openPalette(page);
  await search(page, SEED_CHAPTERS[0].title);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/book\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })
  ).toBeVisible();
}

test.describe("Command Palette open and close @wf:command-palette", () => {
  test("F1 opens with focus in the field, Tab stays inside, Escape restores focus @sc:global.openCommandPalette", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Books", level: 1 })
    ).toBeVisible();
    const trigger = page.getByRole("button", { name: "Open command palette" }).first();
    await tabTo(page, trigger, { max: 60 });

    await page.keyboard.press("F1");
    await expect(dialog(page)).toBeVisible();
    await expect(searchbox(page)).toBeFocused();

    // Escape on an empty field closes and restores focus to the opener.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("F1");
    await expect(dialog(page)).toBeVisible();
    // "light" matches a Command, a Book, and a Settings row: all three
    // sections fit in one frame for the screenshot.
    await search(page, "light");
    await expect(option(page, "Light")).toBeVisible();
    await expect(option(page, SEED_BOOK.title)).toBeVisible();
    await expect(option(page, "Theme")).toBeVisible();
    await expectTabContained(page, dialog(page));
    await capture(page, "palette-open");

    // One Escape closes the palette whatever the query, restoring focus.
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("Command Palette commands @wf:command-palette", () => {
  test("typing a Command and pressing Enter runs it and closes the palette", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Books", level: 1 })
    ).toBeVisible();

    await openPalette(page);
    await search(page, "go to notes");
    await page.keyboard.press("Enter");

    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  });

  test.describe("with an empty Library", () => {
    test.use({ library: "empty" });

    test("a disabled Command is reachable but Enter keeps the palette open", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "Your stories begin here" })
      ).toBeVisible();

      await openPalette(page);
      await search(page, "next book");
      const next = option(page, "Next book");
      await expect(next).toBeVisible();
      await expect(next).toHaveAttribute("aria-disabled", "true");

      await arrowTo(page, "command:bookList.moveSelectionNext");
      await page.keyboard.press("Enter");
      await expect(dialog(page)).toBeVisible();
      await expect(searchbox(page)).toBeFocused();
    });
  });
});

test.describe("Command Palette entities @wf:command-palette", () => {
  test("a Chapter of another Book opens in its Book", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Books", level: 1 })
    ).toBeVisible();

    await openPalette(page);
    await search(page, SEED_CHAPTERS[2].title);
    await expect(option(page, SEED_CHAPTERS[2].title)).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/book\/[^/]+$/);
    await expect(
      page.getByRole("heading", { name: SHELF_BOOKS[0].title, level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` })
    ).toBeVisible();
  });

  test("a nested page narrows with a chip and Backspace goes back", async ({ page }) => {
    await openBookEditorOnArrival(page);

    await openPalette(page);
    await search(page, "open chapter");
    await page.keyboard.press("Enter");

    const chip = dialog(page).getByText("Open Chapter", { exact: true });
    await expect(chip).toBeVisible();
    // The page lists only this Book's Chapters: the other Book's is gone.
    await expect(option(page, SEED_CHAPTERS[0].title)).toBeVisible();
    await expect(option(page, SEED_CHAPTERS[2].title)).toHaveCount(0);
    await capture(page, "palette-nested-page");

    await page.keyboard.press("Backspace");
    await expect(chip).toBeHidden();
    await expect(dialog(page)).toBeVisible();
  });
});

test.describe("Command Palette settings @wf:command-palette", () => {
  test("a Settings result lands on its row's control", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Books", level: 1 })
    ).toBeVisible();

    await openPalette(page);
    await search(page, "theme");
    // The query also matches Commands (Cycle theme first), so arrow to the
    // Theme Settings row before choosing it.
    await arrowTo(page, "settingsRow:theme");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/settings$/);
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 })
    ).toBeVisible();
    await expectFocusWithin(page.locator('[data-settings-row="theme"]'));
  });
});

test.describe("Command Palette recent @wf:command-palette", () => {
  test("Shift+Delete removes the active Recent row @sc:commandPalette.removeRecent", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "My Books", level: 1 })
    ).toBeVisible();

    // Choosing a Command once records it in Recent. A navigating Command
    // leaves the theme alone, so the capture below can emulate both schemes.
    await openPalette(page);
    await search(page, "go to notes");
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeHidden();
    await expect(page).toHaveURL(/\/notes$/);

    await page.keyboard.press("F1");
    await expect(dialog(page)).toBeVisible();
    const recent = option(page, "Go to Notes");
    await expect(recent).toBeVisible();
    await capture(page, "palette-recent");

    await arrowTo(page, "command:global.gotoNotes");
    await page.keyboard.press("Shift+Delete");
    await expect(recent).toHaveCount(0);
    await expect(dialog(page).getByRole("status")).toContainText("Removed from recent");
  });
});

test.describe("Command Palette formatting @wf:command-palette", () => {
  test("a formatting Command applies to the kept selection and focus returns", async ({
    page,
  }) => {
    await openBookEditorOnArrival(page);
    const text = page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[0].title}` });
    await expect(text).toBeVisible();
    await tabTo(page, text, { max: 30 });

    // Select the last word with the real keyboard gesture. The stats only
    // report the selection once the editor has processed every press, so the
    // palette never opens on a half-made selection.
    await page.keyboard.press("End");
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await expect(page.getByText("1 words / 5 chars")).toBeVisible();

    await page.keyboard.press("F1");
    await expect(dialog(page)).toBeVisible();
    await search(page, "bold");
    await page.keyboard.press("Enter");

    await expect(dialog(page)).toBeHidden();
    await expect(text.locator("strong")).toHaveText("dusk.");
    await expect(text).toBeFocused();
  });
});
