import type { Page } from "@playwright/test";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// The Embed route (issue #209): a bare editor whose theme comes from the query
// string, with no Library, app shell, or persistence. It is keyboard-operable
// and TipTap's formatting shortcuts work; nothing survives a reload.

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const editor = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });
const html = (page: Page) => page.locator("html");

test.describe("the /embed editor @wf:embed-editor", () => {
  test("the dark theme applies, the editor is keyboard-operable, and nothing persists", async ({
    page,
  }) => {
    await page.goto("/embed?theme=dark");
    await expect(html(page)).toHaveClass(/dark/);

    await tabTo(page, editor(page), { max: 50 });
    await expect(editor(page)).toBeFocused();
    await page.keyboard.press("Control+b");
    await page.keyboard.type("Embed text");

    await expect(editor(page)).toContainText("Embed text");
    await expect(editor(page).locator("strong")).toHaveText("Embed text");
    await expect(toolbar(page).getByRole("button", { name: "Bold", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.reload();

    await expect(editor(page)).toBeVisible();
    await expect(editor(page)).not.toContainText("Embed text");
  });
});

test.describe("the light theme @wf:embed-editor", () => {
  test("theme=light does not apply dark", async ({ page }) => {
    await page.goto("/embed?theme=light");

    await expect(html(page)).not.toHaveClass(/dark/);
  });
});

test.describe("the system theme @wf:embed-editor", () => {
  test.describe("when the color scheme prefers dark", () => {
    test.use({ colorScheme: "dark" });

    test("theme=system applies dark", async ({ page }) => {
      await page.goto("/embed?theme=system");

      await expect(html(page)).toHaveClass(/dark/);
    });
  });

  test.describe("when the color scheme prefers light", () => {
    test.use({ colorScheme: "light" });

    test("theme=system stays light", async ({ page }) => {
      await page.goto("/embed?theme=system");

      await expect(html(page)).not.toHaveClass(/dark/);
    });
  });
});
