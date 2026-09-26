import type { Page } from "@playwright/test";
import { pressUntilFocused } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// The editor context menu and the floating selection toolbar (issue #207).
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });

async function openEditor(page: Page) {
  await seedSettings(page, { toolbarExpanded: true });
  await page.goto("/");
  await page.getByRole("grid", { name: "Books" }).getByRole("row").waitFor();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
  await expect(editorText(page)).toBeFocused();
}

async function selectFirstWords(page: Page, count: number) {
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < count; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
}

test.describe("context menu @wf:editor-context-menu", () => {
  test("Shift+F10 opens it at the caret; arrows move; Esc returns to the text", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+F10");

    const menu = page.getByRole("menu", { name: "Editor options" });
    await expect(menu).toBeVisible();
    // React Aria focuses the menu itself first; the first ArrowDown enters the items.
    await expect(menu).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();

    await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Inspect" }));
    await page.keyboard.press("Escape");

    await expect(menu).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("Enter on Inspect opens the HTML panel for the block", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+F10");

    const menu = page.getByRole("menu", { name: "Editor options" });
    await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Inspect" }));
    await page.keyboard.press("Enter");

    await expect(page.getByText("HTML Source")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("The storm came in from the west");
  });
});

test.describe("selection toolbar @wf:editor-selection-toolbar", () => {
  test("a Shift+Arrow selection shows the floating formatting toolbar", async ({ page }) => {
    await openEditor(page);
    await selectFirstWords(page, 5);

    const floating = page.locator(".selection-toolbar-enter");
    await expect(floating).toBeVisible();
    await expect(floating.getByRole("button", { name: "Bold" })).toBeVisible();
  });

  test.fail(
    "Tab moves focus into the floating toolbar",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/218",
      },
    },
    async ({ page }) => {
      await openEditor(page);
      await selectFirstWords(page, 5);
      const floating = page.locator(".selection-toolbar-enter");
      await expect(floating).toBeVisible();

      await page.keyboard.press("Tab");

      await expect(floating.getByRole("button").first()).toBeFocused();
    }
  );
});
