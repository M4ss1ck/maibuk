import type { Page } from "@playwright/test";
import {
  expectFocusWithin,
  expectTabContained,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { capture } from "../support/capture";
import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

// App shell: primary navigation, g sequences, F6 regions, theme and hint
// toggles, the shortcuts help, and reopening at the last visited path.

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}

/** Opens the seeded Book from the Gallery; focus lands in its last Chapter's text. */
async function openSeedBook(page: Page) {
  await openHome(page);
  const card = page.getByRole("row", { name: SEED_BOOK.title });
  await expect(card).toBeVisible();
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  await expect(lastChapterText(page)).toBeFocused();
}

const lastChapterText = (page: Page) =>
  page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` });

/** Esc leaves the Chapter text for the chapter list, where global keys work again. */
async function leaveChapterText(page: Page) {
  await page.keyboard.press("Escape");
  await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
}

async function openHelp(page: Page) {
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The shortcut groups (level-4 headings) listed under "On this screen". */
async function groupsOnThisScreen(page: Page): Promise<string[]> {
  const dialog = await openHelp(page);
  const names = await dialog
    .getByRole("region", { name: "On this screen" })
    .getByRole("heading", { level: 4 })
    .allTextContents();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return names;
}

async function newNoteByKeyboard(page: Page) {
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "Notes", level: 1 })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "New note" }).first());
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
}

test.describe("primary navigation @wf:shell-nav-sidebar", () => {
  test("Tab into the navigation, arrows move, Enter goes there and announces it", async ({
    page,
  }) => {
    await openHome(page);
    const nav = page.getByRole("listbox", { name: "Primary navigation" });
    const option = (name: string) => nav.getByRole("option", { name: new RegExp(`^${name}`) });
    const announcer = page.getByRole("status").first();
    await expect(announcer).toHaveText("My Books");

    await tabTo(page, option("Books"));
    for (const name of ["Notes", "Canvas", "Ephemeral", "Metrics", "Settings"]) {
      await page.keyboard.press("ArrowDown");
      await expect(option(name)).toBeFocused();
    }
    await page.keyboard.press("ArrowUp");
    await expect(option("Metrics")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/metrics$/);
    await expect(page.getByRole("heading", { name: "Metrics", level: 1 })).toBeVisible();
    await expect(announcer).toHaveText("Metrics");

    await pressUntilFocused(page, "ArrowUp", option("Notes"));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes$/);
    await expect(announcer).toHaveText("Notes");
  });
});

test.describe("main sidebar keyboard resize @wf:shell-nav-sidebar-resize", () => {
  const sidebar = (page: Page) => page.getByRole("complementary", { name: "Navigation sidebar" });
  const handle = (page: Page) => sidebar(page).getByRole("separator", { name: "Resize sidebar" });
  const sidebarWidth = async (page: Page) => (await sidebar(page).boundingBox())?.width;

  async function expectWidth(page: Page, width: number) {
    await expect(handle(page)).toHaveAttribute("aria-valuenow", String(width));
    await expect(handle(page)).toHaveAttribute("aria-valuetext", `${width} pixels`);
    await expect.poll(() => sidebarWidth(page)).toBe(width);
  }

  async function press(page: Page, key: string, times: number) {
    for (let i = 0; i < times; i++) await page.keyboard.press(key);
  }

  test("arrows resize the sidebar from its separator within the limits, Escape leaves it, and the width persists", async ({
    page,
  }) => {
    await openHome(page);
    await capture(page, "main-sidebar-resize", { around: [sidebar(page)] });

    await tabTo(page, handle(page));
    await expect(handle(page)).toBeFocused();
    await capture(page, "main-sidebar-resize-focused", { around: [sidebar(page)] });
    await expectWidth(page, 280);

    // Tab and Shift+Tab leave and return without resizing.
    await page.keyboard.press("Tab");
    await expect(handle(page)).not.toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(handle(page)).toBeFocused();
    await expectWidth(page, 280);

    // The sidebar sits on the left, so ArrowRight widens it.
    await page.keyboard.press("ArrowRight");
    await expectWidth(page, 296);
    await press(page, "ArrowLeft", 2);
    await expectWidth(page, 264);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowDown");
    await expectWidth(page, 264);
    await expect(handle(page)).toBeFocused();

    await press(page, "ArrowRight", 16);
    await expectWidth(page, 480);
    await press(page, "ArrowLeft", 20);
    await expectWidth(page, 200);
    await expect(handle(page)).toBeFocused();

    await press(page, "ArrowRight", 3);
    await expectWidth(page, 248);

    // Escape leaves the separator for the sidebar control used before it.
    const palette = sidebar(page).getByRole("button", { name: "Open command palette" });
    await page.keyboard.press("Shift+Tab");
    await expect(palette).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(handle(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeFocused();
    await expectWidth(page, 248);

    await page.reload();
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await expectWidth(page, 248);
  });

  test.describe("narrow viewport", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("the hidden sidebar's separator is not a Tab stop", async ({ page }) => {
      await openHome(page);
      await capture(page, "main-sidebar-resize-narrow");
      // The desktop sidebar is display: none here, so only includeHidden finds it.
      const hiddenHandle = page.getByRole("separator", {
        name: "Resize sidebar",
        includeHidden: true,
      });
      await expect(hiddenHandle).toHaveCount(1);
      await expect(hiddenHandle).toBeHidden();

      const menu = page.getByRole("button", { name: "Open navigation menu" });
      await tabTo(page, menu);
      // A full cycle through the page never lands on the separator.
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        await expect(hiddenHandle).not.toBeFocused();
        if (await isFocusWithin(menu)) break;
      }

      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Close navigation menu" })).toBeFocused();
      await expect(page.getByRole("dialog").getByRole("separator")).toHaveCount(0);
    });
  });
});

test.describe("g sequences @wf:shell-goto-sequences", () => {
  test("g p, g n, g c, g e, g m, g s go to each screen @sc:global.gotoProjects @sc:global.gotoNotes @sc:global.gotoCanvas @sc:global.gotoEphemeral @sc:global.gotoMetrics @sc:global.gotoSettings @palette-entry", async ({
    page,
  }) => {
    await openHome(page);
    const screens: [string, RegExp, string][] = [
      ["n", /\/notes$/, "Notes"],
      ["c", /\/canvas$/, "Canvas"],
      ["e", /\/ephemeral$/, "Ephemeral"],
      ["m", /\/metrics$/, "Metrics"],
      ["s", /\/settings$/, "Settings"],
      ["p", /\/$/, "My Books"],
    ];
    for (const [key, url, heading] of screens) {
      await page.keyboard.press("g");
      await page.keyboard.press(key);
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
    // Home again: the sidebar footer carries the Command Palette entry point.
    await capture(page, "palette-entry-sidebar-footer");
  });

  test("g n typed in a text field is text, not navigation", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("Alt+n");
    const title = page.getByRole("textbox", { name: "Book Title" });
    await expect(title).toBeFocused();

    await page.keyboard.type("gn");

    await expect(title).toHaveValue("gn");
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("F6 regions @wf:shell-cycle-panes @sc:global.cyclePanesForward @sc:global.cyclePanesBackward", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("on Home, F6 and Shift+F6 cycle the navigation sidebar and main content", async ({
    page,
  }) => {
    await openHome(page);
    const sidebar = page.getByRole("complementary", { name: "Navigation sidebar" });
    const main = page.getByRole("main", { name: "Main content" });

    // F6 lands inside each Pane, on a control, so arrows act at once (ADR 0025).
    await page.keyboard.press("F6");
    await expectFocusWithin(sidebar);
    await page.keyboard.press("F6");
    await expectFocusWithin(main);
    await page.keyboard.press("F6");
    await expectFocusWithin(sidebar);
    await page.keyboard.press("Shift+F6");
    await expectFocusWithin(main);
    await page.keyboard.press("Shift+F6");
    await expectFocusWithin(sidebar);
  });

  test("in the Book Editor, F6 cycles the title bar, the chapter list, and the editor and wraps", async ({
    page,
  }) => {
    await openSeedBook(page);
    const titleBar = page.getByRole("banner", { name: "Book title bar" });
    const chapters = page.getByRole("complementary", { name: "Chapter list" });
    const editor = page.getByRole("main", { name: "Editor" });
    const where = async () =>
      (await isFocusWithin(titleBar))
        ? "titleBar"
        : (await isFocusWithin(chapters))
          ? "chapters"
          : (await isFocusWithin(editor))
            ? "editor"
            : "elsewhere";

    // openSeedBook leaves focus in the last Chapter's text, inside the editor.
    // Forward cycling follows document order: title bar -> chapters -> editor.
    const visited: string[] = [];
    for (let i = 0; i < 6; i++) {
      const before = await where();
      await page.keyboard.press("F6");
      await expect.poll(where).not.toBe(before);
      visited.push(await where());
    }
    expect(visited).toEqual(["titleBar", "chapters", "editor", "titleBar", "chapters", "editor"]);

    await page.keyboard.press("Shift+F6");
    await expect.poll(where).toBe("chapters");
  });
});

test.describe("theme @wf:shell-toggle-theme @sc:global.toggleTheme", () => {
  test("g t switches dark and light, the Settings control agrees, and a reload keeps it", async ({
    page,
  }) => {
    await openHome(page);
    const sidebarTheme = (name: string) =>
      page
        .getByRole("complementary", { name: "Navigation sidebar" })
        .getByRole("button", { name, exact: true });

    await expect(sidebarTheme("System")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("g");
    await page.keyboard.press("t");
    await expect(sidebarTheme("Dark")).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const settings = page.getByRole("main");
    await expect(settings.getByRole("button", { name: "Dark", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.keyboard.press("g");
    await page.keyboard.press("t");
    await expect(settings.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.reload();
    await expect(sidebarTheme("Light")).toHaveAttribute("aria-pressed", "true");
    await expect(settings.getByRole("button", { name: "Light", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

test.describe("shortcut hints @wf:shell-shortcut-hints @sc:global.toggleShortcutHints", () => {
  test("g h hides and shows the hints, and a reload keeps the choice", async ({ page }) => {
    await openHome(page);
    const nav = page.getByRole("listbox", { name: "Primary navigation" });
    const withHint = nav.getByRole("option", { name: "Books G P", exact: true });
    const withoutHint = nav.getByRole("option", { name: "Books", exact: true });
    await expect(withHint).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(withoutHint).toBeVisible();

    await page.reload();
    await expect(withoutHint).toBeVisible();

    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(withHint).toBeVisible();
  });
});

test.describe("shortcuts help @wf:shell-help-dialog @sc:global.showHelp", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("? opens help with focus inside, Tab contained, Esc returns focus", async ({ page }) => {
    await openHome(page);
    const row = page.getByRole("row", { name: SEED_BOOK.title });
    await expect(row).toBeVisible();
    await page.keyboard.press("1");
    await expect(row).toBeFocused();

    const dialog = await openHelp(page);
    await expectFocusWithin(dialog);
    await expect(dialog.getByRole("region", { name: "On this screen" })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "On other screens" })).toBeVisible();
    await expectTabContained(page, dialog);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();
  });

  test("? typed in the Chapter text is a question mark, not help", async ({ page }) => {
    await openSeedBook(page);
    const text = lastChapterText(page);

    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Why?");

    await expect(text).toContainText(`${SEED_CHAPTERS[2].text} Why?`);
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });

  test("Mod labels read ⌘ and ⌥ on a Mac @mac-platform", async ({ page, mod }) => {
    await openHome(page);
    const dialog = await openHelp(page);
    const item = (text: string) => dialog.getByRole("listitem").filter({ hasText: text }).first();

    if (mod === "Meta") {
      await expect(item("Sync now")).toContainText("⌘");
      await expect(item("Sync now")).not.toContainText("Ctrl");
      await expect(item("Save version")).toContainText("⌥");
    } else {
      await expect(item("Sync now")).toContainText("Ctrl");
      await expect(item("Save version")).toContainText("Alt");
    }
  });
});

test.describe("help lists this screen's shortcuts @wf:shell-help-bound-per-screen", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("Home lists Books; the Book Editor lists Editor", async ({ page }) => {
    await openHome(page);
    const home = await groupsOnThisScreen(page);
    expect(home).toContain("Books");
    expect(home).not.toContain("Editor");

    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    await expect(lastChapterText(page)).toBeFocused();
    await leaveChapterText(page);
    const editor = await groupsOnThisScreen(page);
    expect(editor).toContain("Editor");
    expect(editor).not.toContain("Books");
  });

  test("the Canvas gallery lists no Canvas tools; a Canvas does", async ({ page }) => {
    await openHome(page);
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page.getByRole("heading", { name: "Canvas", level: 1 })).toBeVisible();
    expect(await groupsOnThisScreen(page)).not.toContain("Canvas");

    await tabTo(page, page.getByRole("button", { name: "New canvas" }).first());
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
    const canvas = await groupsOnThisScreen(page);
    expect(canvas).toContain("Canvas");
    expect(canvas).not.toContain("Books");
  });

  test("the Cover Designer lists Cover Designer shortcuts", async ({ page }) => {
    await openSeedBook(page);
    // The title bar is its own pane above the row; F6 from the editor reaches it.
    await page.keyboard.press("F6");
    await expectFocusWithin(page.getByRole("banner", { name: "Book title bar" }));
    await tabTo(page, page.getByRole("button", { name: "Design Cover" }), { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cover$/);

    const cover = await groupsOnThisScreen(page);
    expect(cover).toContain("Cover Designer");
    expect(cover).not.toContain("Books");
  });

  test("a Note lists Editor shortcuts, not Books", async ({ page }) => {
    await openHome(page);
    await newNoteByKeyboard(page);
    const note = await groupsOnThisScreen(page);
    expect(note).toContain("Editor");
    expect(note).not.toContain("Books");
  });
});

test.describe("Tutorial from help @wf:shell-help-start-tutorial", () => {
  test("Tutorial for this screen starts it with focus on the card's Next", async ({ page }) => {
    await openHome(page);
    const dialog = await openHelp(page);
    await tabTo(page, dialog.getByRole("button", { name: "Tutorial for this screen" }));
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    const card = page.getByRole("dialog", { name: "Your Books" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Next" })).toBeFocused();
  });
});

test.describe("last visited path @wf:shell-restore-last-path", () => {
  test("reopening the app at / lands back on the Note last open", async ({ page }) => {
    await openHome(page);
    await newNoteByKeyboard(page);
    const notePath = new URL(page.url()).pathname;

    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`${notePath}$`));
    await expect(page.getByRole("heading", { name: "Untitled note", level: 1 })).toBeVisible();
  });
});
