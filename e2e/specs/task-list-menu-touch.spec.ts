// Phone Task List menu (@touch): the ⋯ button is always shown on touch, and a
// tap on its entry moves the checked items. Runs only in the `phone` project.

import { expect, test } from "../support/test";

test.use({ library: "empty" });

test.describe("phone Task List menu @touch @wf:editor-task-list-menu", () => {
  test("tapping ⋯ moves checked items without a pointer hover @touch @wf:editor-task-list-menu", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation menu" }).tap();
    await page
      .getByRole("dialog", { name: "Primary navigation" })
      .getByRole("option", { name: /Ephemeral/ })
      .tap();
    await expect(page.getByRole("heading", { name: "Ephemeral", level: 1 })).toBeVisible();

    const text = page.getByRole("textbox", { name: "Text", exact: true });
    await text.tap();
    await page.keyboard.type("[x] done");
    await page.keyboard.press("Enter");
    await page.keyboard.type("open");
    const items = text.getByRole("listitem");
    await expect(items).toHaveText(["done", "open"]);

    await page.getByRole("button", { name: "Task List actions" }).tap();
    await page.getByRole("menuitem", { name: "Move checked to bottom" }).tap();

    await expect(items).toHaveText(["open", "done"]);
  });
});
