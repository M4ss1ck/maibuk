// Plugin contributions (issue #437): a seeded tracer Plugin declares one of
// every surface. A sidebar entry opens its page (announced by the title), and
// a global Command it declares runs from its Shortcut and reaches the
// Plugin's Worker, whose notification proves the round trip. Keyboard only.
// @no-webkit: the seed needs OPFS, which the webkit project does not carry.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS, SEED_NOTES } from "../support/seed/names";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

test.use({ plugins: ["tracer"] });

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const toasts = (page: Page) => page.getByRole("status");
const galleryGrid = (page: Page) => page.getByRole("grid", { name: "Notes" });
const notesListPane = (page: Page) => page.getByRole("region", { name: "Notes list" });
const notesListRow = (page: Page, title: string) =>
  page.getByRole("row", { name: title, exact: true }).first();

/** Opens a seeded Note by keyboard the way an author reaches it (Gallery → Enter). */
async function openNoteFromGallery(page: Page, title: string): Promise<void> {
  await page.goto("/notes");
  await expect(galleryGrid(page).getByRole("row").first()).toBeVisible();
  await tabTo(page, galleryGrid(page).getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", galleryGrid(page).getByRole("row", { name: title }), {
    max: 10,
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/.+/);
}

test.describe("Plugin contributions @wf:plugins-contributions @no-webkit", () => {
  test("the sidebar entry opens the Plugin page and announces its title", async ({ page }) => {
    await page.goto("/");
    // The Plugin is scanned after the first render; its entry appears then.
    await capture(page, "plugins-sidebar");
    await expect(navOption(page, "Tracer report")).toBeVisible({ timeout: 15_000 });

    // The navigation is one Tab stop; arrows move between its entries.
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Tracer report"), { max: 10 });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/plugin\/tracer\/report$/);
    await expect(page.getByRole("heading", { name: "Tracer report", level: 1 })).toBeVisible();
    await capture(page, "plugins-page");
    // The route announcer reads the page's heading, so the navigation is heard.
    await expect(toasts(page).filter({ hasText: "Tracer report" })).toBeVisible();
  });

  test("the Plugin page shows loading while the launch scan is pending", async ({ page }) => {
    // The lifecycle installs in idle time after the first render; delaying that
    // idle callback holds the page's loading copy deterministically so both
    // shots catch it. Once it releases, the page settles on the Plugin's title.
    await page.addInitScript(() => {
      const original = window.requestIdleCallback?.bind(window);
      if (!original) return;
      // Delaying the install idle callback five seconds keeps the page's
      // loading copy up long enough for both shots; it is not cancelled here.
      window.requestIdleCallback = ((callback: IdleRequestCallback, options?: IdleRequestOptions) =>
        window.setTimeout(
          () => original(callback, options),
          5_000
        )) as typeof window.requestIdleCallback;
    });

    await page.goto("/plugin/tracer/report");
    await expect(page.getByRole("heading", { name: /Loading Plugin/ })).toBeVisible({
      timeout: 5_000,
    });
    await capture(page, "plugins-page-loading");
    await expect(page.getByRole("heading", { name: "Tracer report", level: 1 })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a global Plugin Command runs from its Shortcut and reaches the Plugin", async ({
    page,
  }) => {
    await page.goto("/");
    // The Plugin's Worker answered the health check (the tracer reports the
    // refused fetch once it is up).
    await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({ timeout: 15_000 });
    // `notifications.show` admits one call per 5 s, and the startup report holds
    // that slot; the Command's own toast can only land after the window passes.
    await page.waitForTimeout(5_200);

    await page.keyboard.press("ControlOrMeta+Alt+r");

    await expect(toasts(page).filter({ hasText: "tracer ran report" })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("a page-scoped Command runs from its Shortcut on the Plugin page", async ({ page }) => {
    await page.goto("/");
    await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(5_200);
    // Open the Plugin page: its Commands live in the page's own Context.
    await tabTo(page, navOption(page, "Books"));
    await pressUntilFocused(page, "ArrowDown", navOption(page, "Tracer report"), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Tracer report", level: 1 })).toBeVisible();

    await page.keyboard.press("ControlOrMeta+Alt+j");

    await expect(toasts(page).filter({ hasText: "tracer ran insights" })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("the Settings Plugins accordion opens its rows from the keyboard @wf:plugins-contributions @no-webkit", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
      timeout: 15_000,
    });
    const accordion = page.getByRole("button", { name: "Tracer Fixture" });
    await expect(accordion).toBeVisible();
    await tabTo(page, accordion, { max: 100 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Report threshold" })).toBeVisible();
    await capture(page, "plugins-settings-accordion");
  });

  test.describe("with a Book", () => {
    test.use({ library: "oneBookThreeChapters", plugins: ["tracer"] });

    test("a Chapter Item Menu entry runs with its item as the target @wf:plugins-contributions @no-webkit", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
        timeout: 15_000,
      });
      // Open the seeded Book from the keyboard, then wait out the notification
      // throttle so the entry's own toast can land.
      const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
      await expect(card).toHaveCount(1);
      await page.keyboard.press("1");
      await expect(card).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
      // Leave the editor for the Chapter list.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(5_200);

      const grid = page.getByRole("grid", { name: "Chapters" });
      const row = grid.getByRole("row", { name: SEED_CHAPTERS[1].title });
      await expect(row).toBeVisible();
      // Tabs into the grid (it stops on the current Chapter) and arrows to the row.
      await tabTo(page, grid.getByRole("row", { selected: true }));
      await pressUntilFocused(page, "ArrowUp", row);

      // Shift+F10 opens the row's Item Menu with the keyboard.
      await page.keyboard.press("Shift+F10");
      const menu = page.getByRole("menu", {
        name: `More actions for ${SEED_CHAPTERS[1].title}`,
      });
      await expect(menu).toBeVisible();
      await capture(page, "plugins-chapter-menu");
      await pressUntilFocused(
        page,
        "ArrowDown",
        menu.getByRole("menuitem", { name: "Tag chapter" }),
        {
          max: 15,
        }
      );
      await page.keyboard.press("Enter");

      await expect(
        toasts(page).filter({ hasText: "tracer ran tagChapter on chapter" })
      ).toBeVisible({ timeout: 5_000 });
    });

    test("an editor toolbar button runs its Command from the keyboard @wf:plugins-contributions @no-webkit", async ({
      page,
    }) => {
      await seedSettings(page, { toolbarExpanded: true });
      await page.goto("/");
      await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
        timeout: 15_000,
      });
      const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
      await expect(card).toHaveCount(1);
      await page.keyboard.press("1");
      await expect(card).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
      // Opening the Book also opens its last Chapter in the editor.
      const textbox = page.getByRole("textbox", { name: /^Text of / });
      await expect(textbox).toBeVisible();
      await page.waitForTimeout(5_200);

      const toolbar = page.getByRole("toolbar", { name: "Toolbar" });
      const button = toolbar.getByRole("button", { name: "Run report" });
      await expect(button).toBeVisible();
      // Leave the editor for the Chapter list, then Tab until inside the toolbar.
      await page.keyboard.press("Escape");
      await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
      for (let i = 0; i < 40; i++) {
        if (await isFocusWithin(toolbar)) break;
        await page.keyboard.press("Tab");
      }
      await pressUntilFocused(page, "ArrowRight", button, { max: 100 });
      // Focused, so the button scrolled into view for its screenshot.
      await capture(page, "plugins-editor-toolbar");
      await page.keyboard.press("Enter");

      await expect(toasts(page).filter({ hasText: "tracer ran report" })).toBeVisible({
        timeout: 5_000,
      });
    });
  });

  test.describe("with a seeded Note", () => {
    test.use({ library: "notesWithLinksAndTags", plugins: ["tracer"] });

    test("a Note list Item Menu entry runs with its item as the target @wf:plugins-contributions @no-webkit", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
        timeout: 15_000,
      });
      await openNoteFromGallery(page, SEED_NOTES.keeperLog);
      // Into the Notes list pane, and wait out the notification throttle the
      // startup report holds so the entry's toast can land.
      for (let i = 0; i < 6; i++) {
        if (await isFocusWithin(notesListPane(page))) break;
        await page.keyboard.press("F6");
      }
      await expectFocusWithin(notesListPane(page));
      await page.waitForTimeout(5_200);

      const row = notesListRow(page, SEED_NOTES.keeperLog);
      await expect(row).toBeFocused();
      await page.keyboard.press("Shift+F10");
      const menu = page.getByRole("menu", { name: `More actions for ${SEED_NOTES.keeperLog}` });
      await expect(menu).toBeVisible();
      await capture(page, "plugins-note-list-menu");
      await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Tag note" }), {
        max: 15,
      });
      await page.keyboard.press("Enter");

      await expect(toasts(page).filter({ hasText: "tracer ran tagNote on note" })).toBeVisible({
        timeout: 5_000,
      });
    });
  });

  test.describe("touch", () => {
    test.use({ library: "oneBookThreeChapters", plugins: ["tracer"] });

    test("a tap on the sidebar entry opens the Plugin page @wf:plugins-contributions @no-webkit @touch", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
      // The Plugin is scanned after the first render; its entry appears then.
      // The ready toast proves the scan and warm-start finished.
      await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
        timeout: 15_000,
      });
      // The desktop sidebar folds into the navigation menu on a phone.
      await page.getByRole("button", { name: "Open navigation menu" }).tap();
      const dialog = page.getByRole("dialog", { name: "Primary navigation" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("option", { name: "Tracer report" }).tap();

      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/plugin\/tracer\/report$/);
      await expect(page.getByRole("heading", { name: "Tracer report", level: 1 })).toBeVisible();
    });

    test("a tap on a Chapter Item Menu entry runs with its item @wf:plugins-contributions @no-webkit @touch", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
        timeout: 15_000,
      });
      // Open the seeded Book by tapping its card, then its Chapters drawer.
      await page.getByRole("grid", { name: "Books" }).getByRole("row").tap();
      await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Chapters", exact: true }).tap();
      const grid = page.getByRole("grid", { name: "Chapters" });
      await expect(grid.getByRole("row")).toHaveCount(SEED_CHAPTERS.length);
      await page.waitForTimeout(5_200);

      const row = grid.getByRole("row", { name: SEED_CHAPTERS[1].title });
      // On touch the row's hover actions hide and its Item Menu button shows.
      await row.getByRole("button", { name: `More actions for ${SEED_CHAPTERS[1].title}` }).tap();
      const menu = page.getByRole("menu", {
        name: `More actions for ${SEED_CHAPTERS[1].title}`,
      });
      await expect(menu).toBeVisible();
      await menu.getByRole("menuitem", { name: "Tag chapter" }).tap();

      await expect(
        toasts(page).filter({ hasText: "tracer ran tagChapter on chapter" })
      ).toBeVisible({ timeout: 5_000 });
    });

    test("a tap on the editor toolbar button runs its Command @wf:plugins-contributions @no-webkit @touch", async ({
      page,
    }) => {
      await seedSettings(page, { toolbarExpanded: true });
      await page.goto("/");
      await expect(toasts(page).filter({ hasText: "tracer ready" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("grid", { name: "Books" }).getByRole("row").tap();
      await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Chapters", exact: true }).tap();
      const grid = page.getByRole("grid", { name: "Chapters" });
      await grid
        .getByRole("row", { name: SEED_CHAPTERS[0].title })
        .getByText(SEED_CHAPTERS[0].title)
        .tap();
      const textbox = page.getByRole("textbox", { name: /^Text of / });
      await expect(textbox).toBeVisible();
      await page.waitForTimeout(5_200);

      await page
        .getByRole("toolbar", { name: "Toolbar" })
        .getByRole("button", { name: "Run report" })
        .tap();

      await expect(toasts(page).filter({ hasText: "tracer ran report" })).toBeVisible({
        timeout: 5_000,
      });
    });
  });
});
