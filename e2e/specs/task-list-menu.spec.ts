import type { Locator, Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { runPaletteCommand } from "../support/palette";
import { expect, test } from "../support/test";

// Task List order (issue #691): the checked items of a Task List move to the
// top or bottom from the Command Palette and from Shift+F10 (the Editor options
// menu's Task List section). Ephemeral is never saved, so each test starts from
// an empty buffer on a fresh device.

const editor = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const items = (page: Page): Locator => editor(page).getByRole("listitem");
const editorOptions = (page: Page) => page.getByRole("menu", { name: "Editor options" });

async function openEphemeral(page: Page) {
  // Through the app: a direct load of /ephemeral is blank (also on main).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(page.getByRole("heading", { name: "Ephemeral", level: 1 })).toBeVisible();
}

/** Tabs from the top of the screen until the editor has focus. */
async function focusEditor(page: Page) {
  await tabTo(page, editor(page), { max: 50 });
  await expect(editor(page)).toBeFocused();
}

/** Types a checked item, then two unchecked items: [x] c1, [ ] u1, [ ] u2. Caret ends in u2. */
async function typeList(page: Page) {
  await focusEditor(page);
  await page.keyboard.type("[x] c1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("u1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("u2");
  await expect(items(page)).toHaveText(["c1", "u1", "u2"]);
}

test.describe("Task List menu @wf:editor-task-list-menu @sc:editor.moveCheckedToTop @sc:editor.moveCheckedToBottom", () => {
  test("the Command Palette moves checked items to the bottom, and the caret stays in the moved item", async ({
    page,
  }) => {
    await openEphemeral(page);
    await typeList(page);
    // Caret from u2 up to c1.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");

    await runPaletteCommand(page, "Move checked to bottom");

    await expect(items(page)).toHaveText(["u1", "u2", "c1"]);
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("!");
    await expect(items(page).nth(2)).toHaveText("c1!");
  });

  test("one Undo restores the original order after a move", async ({ page }) => {
    await openEphemeral(page);
    await typeList(page);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await runPaletteCommand(page, "Move checked to bottom");
    await expect(items(page)).toHaveText(["u1", "u2", "c1"]);

    await page.keyboard.press("ControlOrMeta+z");

    await expect(items(page)).toHaveText(["c1", "u1", "u2"]);
  });

  test("Shift+F10 opens Editor options, and its Move checked to bottom item moves the items and returns focus to the text", async ({
    page,
  }) => {
    await openEphemeral(page);
    await typeList(page);

    await page.keyboard.press("Shift+F10");
    const menu = editorOptions(page);
    await expect(menu).toBeVisible();
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu.getByRole("menuitem", { name: "Move checked to bottom", exact: true })
    );
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect(items(page)).toHaveText(["u1", "u2", "c1"]);
    await expect(editor(page)).toBeFocused();
  });

  test("Move checked to top is disabled when the checked item is already on top, and Escape leaves the order alone", async ({
    page,
  }) => {
    await openEphemeral(page);
    await focusEditor(page);
    await page.keyboard.type("[x] c1");
    await page.keyboard.press("Enter");
    await page.keyboard.type("u1");
    await expect(items(page)).toHaveText(["c1", "u1"]);
    // Caret from u1 up to c1.
    await page.keyboard.press("ArrowUp");

    await page.keyboard.press("Shift+F10");
    const menu = editorOptions(page);
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Move checked to top", exact: true })
    ).toHaveAttribute("aria-disabled", "true");

    await page.keyboard.press("Escape");

    await expect(menu).toBeHidden();
    await expect(editor(page)).toBeFocused();
    await expect(items(page)).toHaveText(["c1", "u1"]);
  });
});
