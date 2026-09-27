import type { Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
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

test.describe("F6 pane cycle in the Note editor @wf:shell-cycle-panes @sc:global.cyclePanesForward @sc:global.cyclePanesBackward", () => {
  test("in the Note editor, F6 cycles the title bar, the notes list, and the note editor and wraps", async ({
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
  });
});
