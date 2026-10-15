// Echoes' editor Commands (#451): its Default Shortcuts toggle nearby-echo
// highlights in an open Chapter, Next/Previous echo step the caret through the
// Plugin's own range list and wrap at both ends with an announcement, highlights
// off makes Next announce that and move nothing, the editor toolbar button
// toggles the same highlights, and a Note editor toggles too.
//
// The Plugin announces a step with `notifications.show`, which the broker
// otherwise allows at most once every 5 seconds (`api-table.ts`). A step
// announcement answers the author's own Command run, so the broker exempts it
// from that limit and back-to-back Next/Previous assertions need no wait.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import type { Page } from "@playwright/test";
import {
  caretText,
  expectFocusWithin,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { SEED_BOOK, SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";

/** The echoes Book's first Chapter, where the repeated words first appear. */
const ECHO_CHAPTER = "Arrival";
const PLUGIN_NAME = "Echoes";
/** Echoes' required Plugin Permissions, in manifest order. */
const REQUIRED_PERMISSIONS = ["library:read", "editor:read", "editor:decorate"];
/** Echoes' nearby echoes in the Chapter: four "harbor", two "keeper", six short words. */
const ECHO_COUNT = 12;

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });

/**
 * The labelled highlight decorations the Plugin paints. `role=mark` is the
 * accessible role of each decorated range (`role=mark` is not in Playwright's
 * `getByRole` union, but the role selector engine knows it), so a spec asserts
 * them by role and accessible description, never by CSS class.
 */
const marks = (page: Page) => page.locator("role=mark");

/** A toast (the Plugin's announcement) carrying `text`. */
const toast = (page: Page, text: string) =>
  page.getByRole("status").filter({ hasText: text }).first();

/**
 * Opens the seeded Book and the named Chapter, leaving the caret at the end of
 * its text so a Next/Previous echo starts from a known place. The Book opens its
 * last Chapter (The Lamp), so the Chapter list reaches back to the named one.
 */
async function openChapter(page: Page, title: string): Promise<void> {
  await page.goto("/");
  // The on-demand Built-in warm-starts at launch (its Open Echoes Command is
  // global); its sidebar entry appearing means its Commands are live.
  await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 60_000 });

  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();

  const grid = page.getByRole("grid", { name: "Chapters" });
  const row = grid.getByRole("row", { name: title });
  await page.keyboard.press("Escape");
  await tabTo(page, grid.getByRole("row", { selected: true }));
  await pressUntilFocused(page, "ArrowUp", row);
  await page.keyboard.press("Enter");

  const text = page.getByRole("textbox", { name: `Text of ${title}` });
  await expect(text).toBeVisible();
  await tabTo(page, text, { max: 20 });
  await page.keyboard.press("ControlOrMeta+End");
}

test.describe(
  "Echoes editor Commands @wf:plugins-echoes-editor @sc:plugin.maibuk-echoes.toggleHighlights @sc:plugin.maibuk-echoes.nextEcho @sc:plugin.maibuk-echoes.previousEcho @no-webkit",
  () => {
    test.describe("Chapter editor", () => {
      test.use({
        library: "echoesBook",
        plugins: ["maibuk-echoes"],
        pluginApprovals: [{ pluginId: "maibuk-echoes", granted: [...REQUIRED_PERMISSIONS] }],
        builtInPlugins: [{ id: "maibuk-echoes" }],
      });

      test("its Default Shortcut toggles labelled highlights off and on", async ({ page }) => {
        await openChapter(page, ECHO_CHAPTER);
        await expect(marks(page)).toHaveCount(0);

        await page.keyboard.press("Alt+F7");
        // One mark per occurrence of a nearby echo; the first is the first
        // "harbor", labelled by the distance to the next one.
        await expect(marks(page)).toHaveCount(ECHO_COUNT);
        await expect(marks(page).first()).toHaveAccessibleDescription(
          "harbor, repeated 4 words later"
        );

        await page.keyboard.press("Alt+F7");
        await expect(marks(page)).toHaveCount(0);
      });

      test("Next and Previous move the caret, announce, and wrap at both ends", async ({
        page,
      }) => {
        await openChapter(page, ECHO_CHAPTER);
        await page.keyboard.press("Alt+F7");
        await expect(marks(page)).toHaveCount(ECHO_COUNT);

        // The caret started at the end, so the first Next enters at Echo 1.
        await page.keyboard.press("Alt+F8");
        await expect(toast(page, "Echo 1 of 12: harbor, repeated 4 words later")).toBeVisible();
        await expect.poll(async () => (await caretText(page)).startsWith("harbor")).toBe(true);

        // Previous from the first wraps to the last.
        await page.keyboard.press("Alt+Shift+F8");
        await expect(toast(page, "Echo 12 of 12: night, repeated 6 words earlier")).toBeVisible();
        await expect.poll(async () => (await caretText(page)).startsWith("night")).toBe(true);

        // Next from the last wraps back to the first.
        await page.keyboard.press("Alt+F8");
        await expect(toast(page, "Echo 1 of 12: harbor, repeated 4 words later")).toBeVisible();
        await expect.poll(async () => (await caretText(page)).startsWith("harbor")).toBe(true);
      });

      test("with highlights off, Next announces they are off and moves nothing", async ({
        page,
      }) => {
        await openChapter(page, ECHO_CHAPTER);
        await page.keyboard.press("Alt+F7");
        await expect(marks(page)).toHaveCount(ECHO_COUNT);
        await page.keyboard.press("Alt+F7");
        await expect(marks(page)).toHaveCount(0);

        // Highlights off is the first announcement here, so it is not throttled.
        const before = await caretText(page);
        await page.keyboard.press("Alt+F8");
        await expect(toast(page, "Echo highlights are off")).toBeVisible();
        await expect(marks(page)).toHaveCount(0);
        await expect.poll(async () => caretText(page)).toBe(before);
      });

      test("the editor toolbar button toggles the same highlights", async ({ page }) => {
        // The toolbar's Start lane clips its trailing entries when collapsed,
        // and the Plugin's button is appended there: expand it, like an author.
        await seedSettings(page, { toolbarExpanded: true });
        await openChapter(page, ECHO_CHAPTER);

        const toolbar = page.getByRole("toolbar", { name: "Toolbar" });
        const button = toolbar.getByRole("button", { name: "Toggle echo highlights", exact: true });
        await expect(button).toBeEnabled();

        // Leave the editor for the Chapter list, then Tab until the toolbar has
        // focus and arrow onto the Plugin's button (a roving group).
        await page.keyboard.press("Escape");
        await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
        for (let i = 0; i < 40; i++) {
          if (await isFocusWithin(toolbar)) break;
          await page.keyboard.press("Tab");
        }
        await pressUntilFocused(page, "ArrowRight", button, { max: 200 });
        await expect(button).toBeFocused();

        // It is a Toggle Button: it shows on while the highlights are on.
        await expect(marks(page)).toHaveCount(0);
        await expect(button).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.press("Enter");
        await expect(marks(page)).toHaveCount(ECHO_COUNT);
        await expect(
          toolbar.getByRole("button", { name: "Toggle echo highlights", pressed: true })
        ).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(marks(page)).toHaveCount(0);
        await expect(
          toolbar.getByRole("button", { name: "Toggle echo highlights", pressed: false })
        ).toBeVisible();
      });
    });

    test.describe("Note editor", () => {
      test.use({
        library: "notesWithLinksAndTags",
        plugins: ["maibuk-echoes"],
        pluginApprovals: [{ pluginId: "maibuk-echoes", granted: [...REQUIRED_PERMISSIONS] }],
        builtInPlugins: [{ id: "maibuk-echoes" }],
      });

      test("a Note editor toggles highlights for its own content", async ({ page }) => {
        await page.goto("/notes");
        await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 60_000 });

        const grid = page.getByRole("grid", { name: "Notes" });
        const card = grid.getByRole("row", { name: new RegExp(SEED_NOTES.keeperLog) });
        await expect(card).toHaveCount(1);
        await tabTo(page, grid.getByRole("row").first(), { max: 40 });
        await page.keyboard.press("Home");
        await pressUntilFocused(page, "ArrowRight", card, { max: 10 });
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/notes\/.+/);

        const text = page.getByRole("textbox", { name: "Text", exact: true });
        await tabTo(page, text, { max: 80 });
        await expect(text).toBeFocused();
        // Type a nearby echo, then toggle highlights on the Note's own text.
        await page.keyboard.press("ControlOrMeta+End");
        await page.keyboard.press("Enter");
        await page.keyboard.type("The door opened. The door closed.");
        await expect(marks(page)).toHaveCount(0);

        await page.keyboard.press("Alt+F7");
        await expect(marks(page)).toHaveCount(2);
        await expect(marks(page).first()).toHaveAccessibleDescription(
          "door, repeated 3 words later"
        );
      });
    });
  }
);
