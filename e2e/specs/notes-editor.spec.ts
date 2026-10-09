import type { Locator, Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, selectedText, tabTo } from "../support/keyboard";
import { boxCenter, firstLineCenter } from "../support/layout";
import { capture } from "../support/capture";
import { SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";

// Editor rows that live in the Notes editor (issue #206): `[[` wikilink
// suggestions and collapsible headings. Both extensions are Notes-only, so the
// rows run on the seeded Notes Library.
test.use({ library: "notesWithLinksAndTags" });

const noteText = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });

async function openNote(page: Page, title: string) {
  await page.goto("/notes");
  const grid = page.getByRole("grid", { name: "Notes" });
  const card = grid.getByRole("row", { name: new RegExp(title) });
  await expect(card).toHaveCount(1);
  await tabTo(page, grid.getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", card, { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notes\/.+/);
  await tabTo(page, noteText(page), { max: 80 });
  await expect(noteText(page)).toBeFocused();
}

test.describe("wikilink suggestions @wf:editor-wikilink-suggest", () => {
  test("typing [[ suggests notes, arrows move the active option, and Enter inserts the Link", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await expect(noteText(page)).toContainText("High water at six.");
    await page.keyboard.press("End");
    await page.keyboard.type(" [[Tide");

    const listbox = page.getByRole("listbox", { name: "Link suggestions" });
    await expect(listbox).toBeVisible();
    const option = listbox.getByRole("option").first();
    await expect(option).toHaveText(/Tide Tables/);
    await expect(option).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(listbox.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(option).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(noteText(page).locator("a.wikilink")).toHaveCount(1);
    await expect(noteText(page).locator("a.wikilink")).toHaveText("Tide Tables");

    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(noteText(page).locator("a.wikilink")).toHaveText("Tide Tables");
  });

  test("a Link just made from [[ is a Link whose text the arrows select", async ({ page }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await page.keyboard.press("End");
    await page.keyboard.type(" [[Tide");
    await expect(page.getByRole("listbox", { name: "Link suggestions" })).toBeVisible();
    await page.keyboard.press("Enter");
    const link = noteText(page).getByRole("link", { name: "Tide Tables" });
    await expect(link).toHaveCount(1);
    await page.keyboard.type(" ok");
    await expect(link).toHaveText("Tide Tables");
    await expect(noteText(page)).toContainText("Tide Tables ok");

    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");

    expect(await selectedText(page)).toBe("es");
  });

  test("a Note made from [[ is suggested next time without reopening the editor", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await page.keyboard.press("End");
    await page.keyboard.type(" [[Driftwood");
    const listbox = page.getByRole("listbox", { name: "Link suggestions" });
    await expect(listbox.getByRole("option").first()).toHaveText(/Driftwood/);
    await page.keyboard.press("Enter");
    await expect(noteText(page).getByRole("link", { name: "Driftwood" })).toHaveCount(1);

    await page.keyboard.type(" and [[Drift");

    await expect(listbox.getByRole("option", { name: /^Driftwood\s*note$/ })).toBeVisible();
  });

  test("Esc closes the suggestion list without inserting", async ({ page }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await page.keyboard.press("End");
    await page.keyboard.type(" [[Tide");
    await expect(page.getByRole("listbox", { name: "Link suggestions" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("listbox", { name: "Link suggestions" })).toBeHidden();
    await expect(noteText(page).locator("a.wikilink")).toHaveCount(0);
  });
});

test.describe("collapsible headings @wf:editor-collapsible-heading @sc:editor.toggleHeadingCollapse", () => {
  test("Mod+Alt+H collapses the caret's section and the state persists", async ({ page }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    await expect(noteText(page)).toContainText("The lamp holds through the gale.");

    // One real edit persists the heading ids the collapse state refers to.
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.keyboard.press("Backspace");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.keyboard.press("Home");
    await page.keyboard.press("Control+Alt+h");

    await expect(page.getByRole("button", { name: "Expand heading" }).first()).toBeVisible();
    await expect(noteText(page).locator(".heading-section-hidden").first()).toBeHidden();

    await page.reload();
    await expect(noteText(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand heading" }).first()).toBeVisible();

    await tabTo(page, noteText(page), { max: 80 });
    await page.keyboard.press("Home");
    await page.keyboard.press("Control+Alt+h");
    await expect(page.getByRole("button", { name: "Collapse heading" }).first()).toBeVisible();
  });
});

test.describe("following a Link to a heading @wf:editor-follow-link @sc:editor.followLink", () => {
  test("Mod+Enter on a Link to a heading in the same Note scrolls to that heading", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.keeperLog);
    const dawn = noteText(page).getByRole("heading", { name: /Dawn/ });
    await expect(dawn).toBeVisible();

    // Link to Dawn from the end of the first paragraph. The seeded headings
    // were stored without ids, as older Notes were.
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await expect(noteText(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "In this book" }), { backwards: true });
    await page.keyboard.press("Enter");
    await tabTo(page, dialog.getByRole("button", { name: `Expand ${SEED_NOTES.keeperLog}` }));
    await page.keyboard.press("Enter");
    await tabTo(page, dialog.getByRole("button", { name: /^Dawn/ }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(noteText(page)).toBeFocused();
    await expect(noteText(page).getByRole("link", { name: "Dawn" })).toBeVisible();

    // Push the heading out of view, then put the caret back inside the Link.
    for (let i = 0; i < 40; i++) await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await expect(dawn).not.toBeInViewport();

    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(dawn).toBeInViewport();
    await expect(page.getByText("The linked heading no longer exists.")).toHaveCount(0);
  });
});

test.describe("Link Preview @wf:editor-link-preview", () => {
  const preview = (page: Page) => page.getByRole("tooltip", { name: "Link preview" });

  /** The type icon sits centered on the card's first line of text. */
  async function expectIconOnFirstLine(page: Page, firstLine: Locator) {
    const icon = await boxCenter(preview(page).locator("svg").first());
    expect(Math.abs(icon - (await firstLineCenter(firstLine)))).toBeLessThanOrEqual(0.5);
  }

  /** Puts the caret inside the seeded Link to Keeper's Log. */
  async function caretInSeededLink(page: Page) {
    await openNote(page, SEED_NOTES.harborNotes);
    await page.keyboard.press("ControlOrMeta+Home");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  }

  test("resting the caret in a Link previews the Note it points to, and leaving hides it", async ({
    page,
  }) => {
    await caretInSeededLink(page);

    await expect(preview(page)).toBeVisible();
    await expect(preview(page)).toContainText(SEED_NOTES.keeperLog);
    await expect(preview(page)).toContainText("The lamp holds through the gale.");
    await expect(noteText(page)).toBeFocused();
    await capture(page, "link-preview-note");
    await expectIconOnFirstLine(
      page,
      preview(page).getByText(SEED_NOTES.keeperLog, { exact: true })
    );

    await page.keyboard.press("End");
    await expect(preview(page)).toBeHidden();
  });

  test("Escape hides it and leaves the caret where it was", async ({ page }) => {
    await caretInSeededLink(page);
    await expect(preview(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(preview(page)).toBeHidden();
    await expect(noteText(page)).toBeFocused();
    await page.keyboard.type("!");
    await expect(noteText(page)).toContainText("Keep!er's Log");
  });

  test("a web address shows its domain", async ({ page }) => {
    await openNote(page, SEED_NOTES.tideTables);
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Charts");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("https://tides.example.com/charts");
    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(noteText(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");

    await expect(preview(page)).toBeVisible();
    await expect(preview(page)).toContainText("tides.example.com");
    await expect(preview(page)).toContainText("https://tides.example.com/charts");
    await capture(page, "link-preview-web");
    await expectIconOnFirstLine(page, preview(page).locator("p").first());
  });
});

test.describe("F6 pane cycle in the Note editor @wf:shell-cycle-panes @sc:global.cyclePanesForward @sc:global.cyclePanesBackward", () => {
  test("in the Note editor, F6 cycles the title bar, the notes list, and the note editor and wraps @palette-entry", async ({
    page,
  }) => {
    await openNote(page, SEED_NOTES.tideTables);

    const titleBar = page.getByRole("banner", { name: "Note title bar" });
    const notesList = page.getByRole("region", { name: "Notes list" });
    const editor = page.getByRole("main", { name: "Note editor" });

    // Focus starts in the editor text, so F6 wraps forward to the title bar
    // and then walks the notes list and the editor in document order.
    await page.keyboard.press("F6");
    await expectFocusWithin(titleBar);
    await page.keyboard.press("F6");
    await expectFocusWithin(notesList);
    await page.keyboard.press("F6");
    await expectFocusWithin(editor);
    await page.keyboard.press("F6");
    await expectFocusWithin(titleBar);

    // Shift+F6 steps back one pane.
    await page.keyboard.press("Shift+F6");
    await expectFocusWithin(editor);

    // The Notes list footer carries the Command Palette entry point.
    await capture(page, "palette-entry-notes-footer");
  });
});
