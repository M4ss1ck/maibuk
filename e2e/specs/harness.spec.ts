import { SEED_BOOK, SEED_CHAPTERS } from "../support/seed/names";
import { tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// Self-checks for the setup helpers every other spec relies on. They assert
// only what an author would see; the seeds themselves are never the behavior
// under test elsewhere.

test.describe("harness: seed Libraries", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("oneBookThreeChapters boots with its Book and Chapters, and reload does not re-seed", async ({
    page,
  }) => {
    await page.goto("/");
    const card = page
      .getByRole("grid", { name: "Books" })
      .getByRole("row", { name: SEED_BOOK.title });
    await expect(card).toContainText(SEED_BOOK.authorName);
    await expect(card).toContainText("28 words");

    await page.keyboard.press("1");
    await expect(card).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
    const chapters = page.getByRole("grid", { name: "Chapters" }).getByRole("row");
    await expect(chapters).toHaveText(SEED_CHAPTERS.map((c) => new RegExp(c.title)));

    // Last chapter opens by default; its seeded text is there.
    const text = page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` });
    await expect(text).toHaveText(SEED_CHAPTERS[2].text);
    await tabTo(page, text, { max: 80 });
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Extra.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // A reload keeps the author's edit: the seed is written once, not per load.
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` })
    ).toHaveText(`${SEED_CHAPTERS[2].text} Extra.`);
  });
});

test.describe("harness: Tutorial progress", () => {
  test("empty Library specs start with the offer already answered", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your stories begin here" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Take the Tutorial?" })).toHaveCount(0);
  });

  test.describe("clean progress", () => {
    test.use({ tutorialProgress: "clean" });

    test("a clean device on an empty Library is offered the Tutorial", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("dialog", { name: "Take the Tutorial?" })).toBeVisible();
    });
  });
});
