// History: Versions, Checkpoints, Compare, Restore (issue #212). An author
// drives Version history by keyboard alone over the seed Library: the Named
// Version save, the History panel and its list/paging, the idle and
// close Checkpoints, preview, Compare, Restore (with the pre-restore
// Checkpoint that keeps typed-but-unsaved text), rename and delete.
//
// The visible names mirror e2e/support/seed/checkpoint-history.ts; specs never
// import that builder because it pulls app code with `import.meta.env`.

import type { Page } from "@playwright/test";
import {
  expectFocusWithin,
  expectTabContained,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";

test.use({ library: "checkpointHistory" });

const HISTORY = {
  book: "The Lighthouse Keeper",
  firstDraft: "First draft",
  withPrologue: "With prologue",
  currentDraft: "Current draft",
  named: "Draft two",
  renamed: "Revised draft",
  storm: "The storm came in from the west without warning.",
  stormInserted: "The lamp held through the night.",
  unsaved: "Unsaved tail.",
} as const;

const bookCard = (page: Page) => page.getByRole("grid", { name: "Books" }).getByRole("row");
const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });
const panel = (page: Page) => page.getByRole("dialog", { name: "Version history" });
const row = (page: Page, name: string) => panel(page).getByRole("listitem", { name, exact: true });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/** Enters the seeded Book from the Gallery and leaves focus in the editor. */
async function openEditor(page: Page) {
  await page.goto("/");
  await enterBook(page);
}

async function enterBook(page: Page) {
  await expect(bookCard(page)).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(bookCard(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: HISTORY.book, level: 1 })).toBeVisible();
  await expect(editorText(page)).toBeFocused();
}

/** Esc from the editor hands focus to the Chapter list on the next frame. */
async function focusChapterList(page: Page) {
  for (let i = 0; i < 3 && !(await isFocusWithin(chapterList(page))); i++) {
    await page.keyboard.press("Escape");
  }
  await expectFocusWithin(chapterList(page));
}

/** Opens Version history from the keyboard with `g v`. */
async function openHistory(page: Page) {
  // Escape leaves the editor text (a typing target) for the Chapter list, so
  // the `g v` sequence is allowed to start.
  await focusChapterList(page);
  await page.keyboard.press("g");
  await page.keyboard.press("v");
  await expect(panel(page)).toBeVisible();
}

/** Moves down the list to a named Version row. */
async function focusVersion(page: Page, name: string) {
  await pressUntilFocused(page, "ArrowDown", row(page, name), { max: 8 });
  await expect(row(page, name)).toBeFocused();
}

/** Selects a Chapter inside the preview or compare view and asserts the pane. */
async function selectChapter(page: Page, name: RegExp) {
  await tabTo(page, panel(page).getByRole("button", { name }), { max: 12 });
  await page.keyboard.press("Enter");
}

test.describe("opening Version history @wf:versions-open-history @sc:editor.versionHistory", () => {
  test("g v opens the panel on the first row and arrows move between rows", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);

    // Newest first: the current draft sits on top.
    await expect(row(page, HISTORY.currentDraft)).toBeFocused();

    await focusVersion(page, HISTORY.firstDraft);
    await pressUntilFocused(page, "ArrowUp", row(page, HISTORY.currentDraft), { max: 8 });
    await expect(row(page, HISTORY.currentDraft)).toBeFocused();
  });

  test("the header History button opens the panel and Esc returns focus to it", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("Escape");
    const trigger = page.getByRole("button", { name: "Open version history" });
    await tabTo(page, trigger, { max: 60 });
    await page.keyboard.press("Enter");

    await expect(panel(page)).toBeVisible();
    await expect(row(page, HISTORY.currentDraft)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("PageDown and PageUp page the list", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);

    await expect(panel(page).getByText("Page 1 of 2")).toBeVisible();
    const previous = panel(page).getByRole("button", { name: "Previous" });
    await expect(previous).toBeDisabled();

    await page.keyboard.press("PageDown");
    await expect(panel(page).getByText("Page 2 of 2")).toBeVisible();
    await expect(previous).toBeEnabled();

    await page.keyboard.press("PageUp");
    await expect(panel(page).getByText("Page 1 of 2")).toBeVisible();
  });

  test.describe("empty state", () => {
    test.use({ library: "oneBookThreeChapters" });

    test("a Book with no Versions shows the empty state", async ({ page }) => {
      await openEditor(page);
      await openHistory(page);

      await expect(
        panel(page).getByText("No versions yet. Save one with Ctrl+Alt+S.")
      ).toBeVisible();
      await expectFocusWithin(panel(page));
    });
  });
});

test.describe("saving a Named Version @wf:versions-save-named @sc:editor.saveVersion", () => {
  test("Mod+Alt+S names a Version and it shows the Named badge in history", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type(" A new line for the storm.");
    await page.keyboard.press("ControlOrMeta+Alt+s");

    const dialog = page.getByRole("dialog", { name: "Name this version" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toBeFocused();
    await expectTabContained(page, dialog);

    await page.keyboard.type(HISTORY.named);
    await page.keyboard.press("Enter");
    await expect(toast(page, "Save version")).toBeVisible();

    await openHistory(page);
    const named = row(page, HISTORY.named);
    await expect(named).toBeVisible();
    await expect(named.getByText("Named", { exact: true })).toBeVisible();
  });

  test("Esc cancels the name prompt and returns focus to the editor", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+Alt+s");

    const dialog = page.getByRole("dialog", { name: "Name this version" });
    await expect(dialog.getByRole("textbox")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("saving when nothing changed says Already up to date", async ({ page }) => {
    await openEditor(page);
    // Save once so the newest Version matches the current Book exactly.
    await page.keyboard.press("ControlOrMeta+Alt+s");
    await page.keyboard.press("Enter");
    await expect(toast(page, "Save version")).toBeVisible();

    // Nothing changed since: the next save reports Already up to date.
    await page.keyboard.press("ControlOrMeta+Alt+s");
    const dialog = page.getByRole("dialog", { name: "Name this version" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(toast(page, "Already up to date")).toBeVisible();
    await expect(dialog).toBeHidden();
  });
});

test.describe("idle Checkpoint @wf:versions-checkpoint-idle", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("editing then idling past the threshold writes an Auto checkpoint", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-06-15T12:00:00Z") });
    await openEditor(page);

    // Past the word threshold, so the idle timer is armed; then land the save.
    await page.keyboard.insertText("tide ".repeat(320));
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editorText(page)).toContainText("tide tide");
    // The idle timer arms only once the save has landed.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.clock.runFor(121_000);

    await openHistory(page);
    const checkpoint = row(page, "Auto checkpoint");
    await expect(checkpoint).toBeVisible();
  });
});

test.describe("close Checkpoint @wf:versions-checkpoint-close", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("leaving the Book Editor writes an On close checkpoint", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type(" The end.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editorText(page)).toContainText("The end.");

    // Leave the editor: the close trigger saves the Book as a Checkpoint.
    await focusChapterList(page);
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();

    await enterBook(page);
    await openHistory(page);
    await expect(row(page, "Auto checkpoint").getByText("On close", { exact: true })).toBeVisible();
  });
});

test.describe("Version preview @wf:versions-preview", () => {
  test("Preview opens a read-only view with the saved Chapter text", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);
    await focusVersion(page, HISTORY.firstDraft);

    await tabTo(page, row(page, HISTORY.firstDraft).getByRole("button", { name: "Preview" }), {
      max: 6,
    });
    await page.keyboard.press("Enter");

    await expect(panel(page).getByRole("heading", { name: HISTORY.book })).toBeVisible();
    await selectChapter(page, /^Storm/);
    await expect(panel(page).getByText(HISTORY.storm, { exact: false })).toBeVisible();

    // Nothing is written: Back returns to the list with the row focused.
    await page.keyboard.press("Escape");
    await expect(row(page, HISTORY.firstDraft)).toBeFocused();
  });
});

test.describe("comparing to the current document @wf:versions-compare", () => {
  test("compares added, removed, and modified Chapters", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);

    // "With prologue" has a Chapter the current Book no longer has.
    await focusVersion(page, HISTORY.withPrologue);
    await page.keyboard.press("Enter");
    await expect(
      panel(page).getByText("Comparing this version to the current document")
    ).toBeVisible();
    await selectChapter(page, /^Prologue/);
    await expect(
      panel(page).getByText("This chapter only exists in the version being compared")
    ).toBeVisible();

    // Back to the list, then "First draft": Storm was edited and Tide is gone.
    await page.keyboard.press("Escape");
    await focusVersion(page, HISTORY.firstDraft);
    await page.keyboard.press("Enter");
    await selectChapter(page, /^Tide/);
    await expect(
      panel(page).getByText("This chapter is not in the version being compared")
    ).toBeVisible();

    await selectChapter(page, /^Storm/);
    await expect(panel(page).getByText(HISTORY.stormInserted, { exact: false })).toBeVisible();
  });

  test("a Version matching the Book reports No changes", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);

    await expect(row(page, HISTORY.currentDraft)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(
      panel(page).getByText("Comparing this version to the current document")
    ).toBeVisible();
    await expect(panel(page).getByText("No changes", { exact: true })).toBeVisible();
  });
});

test.describe("restoring a Version @wf:versions-restore", () => {
  test("Restore writes a pre-restore Checkpoint holding typed-but-unsaved text", async ({
    page,
  }) => {
    await openEditor(page);
    // Typed and left unsaved: Restore must land it in the pre-restore Checkpoint.
    await page.keyboard.type(` ${HISTORY.unsaved}`);
    await openHistory(page);
    await focusVersion(page, HISTORY.firstDraft);

    await page.keyboard.press("r");
    const confirmRow = row(page, HISTORY.firstDraft);
    await expect(panel(page).getByText(/Restore this version\?/)).toBeVisible();
    await expect(confirmRow.getByRole("button", { name: "Restore" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(toast(page, "Version restored")).toBeVisible();

    const preRestore = row(page, `Before restoring "${HISTORY.firstDraft}"`);
    await expect(preRestore).toBeVisible();
    // The restored list refreshes with the pre-restore Checkpoint on top. Walk
    // the roving focus onto that row and open its Preview (the row's own
    // Preview button, not whichever control happened to keep focus).
    await pressUntilFocused(page, "ArrowUp", preRestore, { max: 20 });
    await tabTo(page, preRestore.getByRole("button", { name: "Preview" }), { max: 4 });
    await page.keyboard.press("Enter");
    await selectChapter(page, /^Storm/);
    await expect(panel(page).getByText(HISTORY.unsaved, { exact: false })).toBeVisible();

    // Back out and read the editor: it shows the restored text.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(editorText(page)).toContainText(HISTORY.storm);
    await expect(editorText(page)).not.toContainText(HISTORY.unsaved);
  });

  test("Esc cancels a restore and changes nothing", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);
    await focusVersion(page, HISTORY.firstDraft);

    await page.keyboard.press("r");
    await expect(panel(page).getByText(/Restore this version\?/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel(page).getByText(/Restore this version\?/)).toBeHidden();
    await expect(row(page, HISTORY.firstDraft)).toBeFocused();
    await expect(toast(page, "Version restored")).toHaveCount(0);
  });
});

test.describe("renaming and deleting a Version @wf:versions-rename-delete", () => {
  test("F2 renames a Version and the new name persists", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);
    await focusVersion(page, HISTORY.firstDraft);

    await page.keyboard.press("F2");
    const input = panel(page).getByRole("textbox");
    await expect(input).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(HISTORY.renamed);
    await page.keyboard.press("Enter");
    await expect(row(page, HISTORY.renamed)).toBeVisible();

    await page.keyboard.press("Escape");
    await openHistory(page);
    await expect(row(page, HISTORY.renamed)).toBeVisible();
  });

  test("Delete removes a Version after a confirmation", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);
    await focusVersion(page, HISTORY.withPrologue);

    await page.keyboard.press("Delete");
    const confirmRow = row(page, HISTORY.withPrologue);
    await expect(panel(page).getByText("Delete this version permanently?")).toBeVisible();
    await expect(confirmRow.getByRole("button", { name: "Delete" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(row(page, HISTORY.withPrologue)).toHaveCount(0);
  });

  test("Esc cancels a delete and keeps the Version", async ({ page }) => {
    await openEditor(page);
    await openHistory(page);
    await focusVersion(page, HISTORY.withPrologue);

    await page.keyboard.press("Delete");
    await expect(panel(page).getByText("Delete this version permanently?")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel(page).getByText("Delete this version permanently?")).toBeHidden();
    await expect(row(page, HISTORY.withPrologue)).toBeVisible();
    await expect(row(page, HISTORY.withPrologue)).toBeFocused();
  });
});
