// Echoes (issue #450): a seeded Book with echoes renders report rows when the
// Plugin is opened from the Command Palette and from the sidebar entry; keyboard
// switches its tabs, expands a row, and Enter on an occurrence opens the
// Chapter editor. The Chapter Item Menu's Find echoes scopes the report, a row
// Item Menu ignores a word, a Chapter edit marks the report out of date, the
// Settings row changes what is detected, and touch opens and expands by tap.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
import { expect, test } from "../support/test";

/** The echoes Book's first Chapter, where the repeated phrase first appears. */
const ECHO_CHAPTER = "Arrival";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/** A Chapter of the Book the Chapter editor has open, named in the Chapter list. */
const chapterGrid = (page: Page) => page.getByRole("grid", { name: "Chapters" });
const chapterRow = (page: Page, title: string) => chapterGrid(page).getByRole("row", { name: title });

/** The report's active tab's listbox, by its tab name. */
const listbox = (page: Page, name: string) => page.getByRole("listbox", { name });
const nearbyList = (page: Page) => listbox(page, "Nearby echo");

/** Opens the Command Palette and returns its dialog. */
async function openPalette(page: Page) {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens the report through the Command Palette's Open Echoes Command. */
async function openEchoesFromPalette(page: Page) {
  const dialog = await openPalette(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Open Echoes");
  await expect(dialog.getByRole("option", { name: "Open Echoes", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-echoes\/report$/);
  await expect(page.getByRole("heading", { name: "Echoes", level: 1 })).toBeVisible();
}

/** Opens the report from the sidebar entry, the way an author reaches it. */
async function openEchoesFromSidebar(page: Page) {
  await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });
  await tabTo(page, navOption(page, "Books"));
  await pressUntilFocused(page, "ArrowDown", navOption(page, "Echoes"), { max: 12 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/maibuk-echoes\/report$/);
  await expect(page.getByRole("heading", { name: "Echoes", level: 1 })).toBeVisible();
}

/** Opens the seeded Book through the Gallery and leaves focus in the Chapter list. */
async function openBook(page: Page) {
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await tabTo(page, card, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  await page.keyboard.press("Escape");
}

test.use({
  library: "echoesBook",
  plugins: ["maibuk-echoes"],
  pluginApprovals: [
    {
      pluginId: "maibuk-echoes",
      granted: ["library:read", "editor:read", "editor:decorate"],
    },
  ],
  builtInPlugins: [{ id: "maibuk-echoes" }],
});

test.describe("Echoes report @wf:plugins-echoes @no-webkit", () => {
  test("opens from the Command Palette and shows rows for the Book", async ({ page }) => {
    await page.goto("/");
    await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });

    await openEchoesFromPalette(page);
    await expect(nearbyList(page).getByRole("option", { name: /harbor/ }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("opens from the sidebar entry and shows the same page", async ({ page }) => {
    await page.goto("/");
    await openEchoesFromSidebar(page);
    await expect(nearbyList(page).getByRole("option", { name: /harbor/ }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("switches tabs, lists only phrase rows, expands one, and opens the Chapter editor", async ({
    page,
  }) => {
    await page.goto("/");
    await openEchoesFromSidebar(page);
    await expect(nearbyList(page).getByRole("option", { name: /^harbor / })).toBeVisible({
      timeout: 20_000,
    });

    // Arrows move between the kind tabs; the phrase tab is the third.
    const nearbyTab = page.getByRole("tab", { name: "Nearby echo" });
    const phraseTab = page.getByRole("tab", { name: "Repeated phrase" });
    await tabTo(page, nearbyTab);
    await expect(nearbyTab).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(phraseTab).toBeFocused();

    // The phrase tab lists one row per phrase and nothing else: no single-word
    // row from another kind leaks in (the stale-row guard).
    const phrases = listbox(page, "Repeated phrase");
    await expect(phrases.getByRole("option")).toHaveCount(3);
    await expect(phrases.getByRole("option", { name: /^dark / })).toHaveCount(0);
    await expect(phrases.getByRole("option", { name: /^night / })).toHaveCount(0);
    await expect(phrases.getByRole("option", { name: /^harbor / })).toHaveCount(0);

    // The listbox is one Tab stop that focus enters on its first row; Enter on
    // the row expands it and its occurrences render under it.
    const firstRow = phrases.getByRole("option").first();
    await tabTo(page, firstRow, { max: 20 });
    await expect(firstRow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(phrases.getByRole("option")).toHaveCount(9);

    // ArrowDown moves onto the first occurrence; Enter hands its Chapter to the
    // host, which opens the Chapter editor on it.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/book\/[^/]+$/);
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
    await expect(chapterRow(page, ECHO_CHAPTER)).toBeVisible();
    await expect(page.getByRole("textbox", { name: `Text of ${ECHO_CHAPTER}` })).toBeVisible();
  });

  test("Find echoes from a Chapter Item Menu opens the report scoped to that Chapter", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(navOption(page, "Echoes")).toBeVisible({ timeout: 60_000 });
    await openBook(page);

    const row = chapterRow(page, ECHO_CHAPTER);
    await expect(row).toBeVisible();
    // The grid's Tab stop starts on the open Chapter; arrows reach the row.
    await tabTo(page, chapterGrid(page).getByRole("row", { selected: true }));
    await pressUntilFocused(page, "ArrowUp", row);
    await page.keyboard.press("Shift+F10");

    const menu = page.getByRole("menu", { name: `More actions for ${ECHO_CHAPTER}` });
    await expect(menu).toBeVisible();
    await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Find echoes" }));
    await page.keyboard.press("Enter");

    // The report lands scoped to the Chapter: the scope select shows it and the
    // rows come only from it (the other Chapter's "lamp" is absent).
    await expect(page).toHaveURL(/\/plugin\/maibuk-echoes\/report$/);
    await expect(page.getByRole("button", { name: /Arrival/ }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(nearbyList(page).getByRole("option", { name: /^harbor / })).toBeVisible({
      timeout: 20_000,
    });
    await expect(nearbyList(page).getByRole("option", { name: /^lamp / })).toHaveCount(0);
  });

  test("Ignore this word removes the row and it stays gone after reopening", async ({ page }) => {
    await page.goto("/");
    await openEchoesFromSidebar(page);

    const harbor = nearbyList(page).getByRole("option", { name: /^harbor / });
    await expect(harbor).toBeVisible({ timeout: 20_000 });
    await tabTo(page, nearbyList(page).getByRole("option").first(), { max: 20 });
    await pressUntilFocused(page, "ArrowDown", harbor, { max: 6 });

    // Enter expands the row, so its Item Menu opens with the context-menu
    // gesture (Shift+F10), the same key Maibuk's own lists use.
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu.getByRole("menuitem", { name: "Ignore this word" }),
      { max: 4 }
    );
    await page.keyboard.press("Enter");
    await expect(harbor).toHaveCount(0);

    // Leaving and reopening the page reads the stored ignore list.
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/$/);
    await openEchoesFromPalette(page);
    await expect(nearbyList(page).getByRole("option", { name: /^dark / })).toBeVisible({
      timeout: 20_000,
    });
    await expect(nearbyList(page).getByRole("option", { name: /^harbor / })).toHaveCount(0);
  });

  test("a Chapter edit marks the report out of date; Refresh updates it", async ({ page }) => {
    await page.goto("/");
    await openEchoesFromSidebar(page);
    const harbor = nearbyList(page).getByRole("option", { name: /^harbor / });
    await expect(harbor).toBeVisible({ timeout: 20_000 });
    await expect(harbor).toContainText("4 times");

    // Add two more "harbor" to the Book's last Chapter, then return to the
    // report at once (before the editor's 1s autosave): the editor's flush on
    // leaving emits the Change that touches the Book.
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page).toHaveURL(/\/$/);
    const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
    await expect(card).toHaveCount(1);
    await tabTo(page, card, { max: 40 });
    await page.keyboard.press("Enter");
    const text = page.getByRole("textbox", { name: /^Text of / });
    await expect(text).toBeFocused();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" harbor harbor");
    await openEchoesFromPalette(page);

    // The touching Change marked the report out of date; it does not recompute
    // (and so never reorders) on its own.
    const stale = page.getByText("This report is out of date. Refresh to update it.");
    await expect(stale).toBeVisible({ timeout: 20_000 });
    const rows = await nearbyList(page).getByRole("option").allTextContents();
    await page.waitForTimeout(600);
    await expect(nearbyList(page).getByRole("option")).toHaveText(rows);

    // Refresh by keyboard recomputes: the notice goes and the count updates.
    const refresh = page.getByRole("button", { name: "Refresh" });
    await tabTo(page, refresh);
    await page.keyboard.press("Enter");
    await expect(stale).toHaveCount(0);
    await expect(nearbyList(page).getByRole("option", { name: /^harbor / })).toContainText(
      "6 times"
    );
  });

  test("Settings change what the report detects", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const accordion = page.getByRole("button", { name: "Echoes" });
    await expect(accordion).toBeVisible({ timeout: 20_000 });
    await tabTo(page, accordion, { max: 250 });
    await page.keyboard.press("Enter");

    // Turn the repeated-phrase kind off.
    const phraseSwitch = page.getByRole("switch", { name: "Repeated phrase" });
    await expect(phraseSwitch).toBeVisible({ timeout: 15_000 });
    await tabTo(page, phraseSwitch);
    await page.keyboard.press("Space");
    await expect(phraseSwitch).not.toBeChecked();

    // Narrow the nearby window so "keeper" (13 words apart) no longer echoes.
    const windowField = page.getByRole("textbox", { name: "Nearby window" });
    await tabTo(page, windowField);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("10");
    await page.keyboard.press("Enter");
    await expect(windowField).toHaveValue("10");

    // Add an ignore word.
    const ignore = page.getByRole("combobox", { name: "Ignore list" });
    await tabTo(page, ignore, { max: 30 });
    await page.keyboard.type("harbor");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Remove harbor" })).toBeVisible();

    // The report reflects each: the phrase kind is gone, and so are the
    // ignored "harbor" and the now-too-distant "keeper".
    await openEchoesFromPalette(page);
    await expect(page.getByRole("tab", { name: "Repeated phrase" })).toHaveCount(0);
    await expect(nearbyList(page).getByRole("option", { name: /^dark / })).toBeVisible({
      timeout: 20_000,
    });
    await expect(nearbyList(page).getByRole("option", { name: /^harbor / })).toHaveCount(0);
    await expect(nearbyList(page).getByRole("option", { name: /^keeper / })).toHaveCount(0);
  });

  test("opens Echoes by tap and expands a row by tap @touch", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();

    // On a phone the desktop sidebar folds into the navigation menu; the
    // Plugin's entry appears once its launch scan registers it.
    await page.getByRole("button", { name: "Open navigation menu" }).tap();
    const dialog = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(dialog).toBeVisible();
    const entry = dialog.getByRole("option", { name: "Echoes" });
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await entry.tap();

    await expect(page).toHaveURL(/\/plugin\/maibuk-echoes\/report$/);
    await expect(page.getByRole("heading", { name: "Echoes", level: 1 })).toBeVisible();

    // A tap on a row expands it: its occurrences render under it, each labelled
    // with its own context around the echo (the echoed word alone would repeat).
    const harbor = nearbyList(page).getByRole("option", { name: /^harbor / });
    await expect(harbor).toBeVisible({ timeout: 20_000 });
    await harbor.tap();
    await expect(
      nearbyList(page)
        .getByRole("option", { name: /The harbor was calm\. The harbor was empty/ })
        .first()
    ).toBeVisible();
  });
});
