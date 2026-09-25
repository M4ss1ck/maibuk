import { expect, test } from "../support/test";
import { expectTabContained, pressUntilFocused, tabTo } from "../support/keyboard";

// First harness journey: an empty Library, Mod+N, a Book, a Chapter, text,
// Mod+S, reload. The edges each get their own test (matrix row books-create).

test.describe("books-create @wf:books-create", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  });

  test("Mod+N opens New Book with focus in Book Title and Tab kept inside", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+n");

    const dialog = page.getByRole("dialog", { name: "New Book" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
    await expectTabContained(page, dialog);
  });

  test("⌘N opens New Book and the button shows ⌘ @mac-platform", async ({ page, mod }) => {
    const toolbar = page.getByRole("toolbar", { name: "Book actions" });
    await expect(toolbar.getByRole("button", { name: /New Book/ })).toHaveAccessibleName(
      mod === "Meta" ? "New Book ⌘ N" : "New Book Ctrl N"
    );

    await page.keyboard.press(`${mod}+n`);
    await expect(
      page.getByRole("dialog", { name: "New Book" }).getByRole("textbox", { name: "Book Title" })
    ).toBeFocused();
  });

  test("Esc cancels and returns focus to the New Book button that opened it", async ({ page }) => {
    // "Book actions" is one Tab stop; arrows move inside it.
    const toolbar = page.getByRole("toolbar", { name: "Book actions" });
    const trigger = toolbar.getByRole("button", { name: /New Book/ });
    await tabTo(page, toolbar.getByRole("button").first());
    await pressUntilFocused(page, "ArrowRight", trigger);
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "New Book" });
    await expect(dialog.getByRole("textbox", { name: "Book Title" })).toBeFocused();
    await page.keyboard.type("Never created");
    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText("Never created")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your stories begin here" })).toBeVisible();
  });

  test("an empty title keeps the dialog open with focus on Book Title", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+n");
    const dialog = page.getByRole("dialog", { name: "New Book" });
    const title = dialog.getByRole("textbox", { name: "Book Title" });

    await page.keyboard.press("Tab");
    await page.keyboard.type("Ada Marsh");
    await page.keyboard.press("Enter");

    await expect(title).toHaveAccessibleDescription("Title is required");
    await expect(title).toBeFocused();
    await expect(dialog).toBeVisible();
  });

  test("an empty Author Name keeps the dialog open with focus on it", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+n");
    const dialog = page.getByRole("dialog", { name: "New Book" });
    const author = dialog.getByRole("textbox", { name: "Author Name" });

    await page.keyboard.type("The Tide Clock");
    await page.keyboard.press("Enter");

    await expect(author).toHaveAccessibleDescription("Author name is required");
    await expect(author).toBeFocused();
    await expect(dialog).toBeVisible();
  });

  test("create a Book, write a Chapter, Mod+S, reload: the text persists", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+n");
    await page.keyboard.type("The Tide Clock");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Ada Marsh");
    await page.keyboard.press("Enter");

    // Lands in the Book Editor with focus on the next step: Add Chapter.
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: "The Tide Clock", level: 1 })).toBeVisible();
    const addChapter = page.getByRole("button", { name: "Add Chapter" });
    await expect(addChapter).toBeFocused();

    await page.keyboard.press("Enter");
    await page.keyboard.type("Low Water");
    await page.keyboard.press("Enter");

    // The new Chapter opens with the caret in its text.
    const text = page.getByRole("textbox", { name: "Text of Low Water" });
    await expect(text).toBeFocused();
    await page.keyboard.type("The clock ran on tides, not hours.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "The Tide Clock", level: 1 })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Text of Low Water" })).toContainText(
      "The clock ran on tides, not hours."
    );
  });
});
