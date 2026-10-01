import type { Locator, Page } from "@playwright/test";
import { SEED_BOOK, SEED_CHAPTERS, SEED_NOTES } from "../support/seed/names";
import { expect, test } from "../support/test";
import { longPress, swipe } from "../support/touch";

// Phone: an item's actions are reached without hover, from its ⋯ button or a
// long-press, and a touch drag belongs to the Reorder handle (AGENTS.md
// section 2, item 7). Runs only in the `phone` project, driven by touch.

const [arrival, lamp, storm] = SEED_CHAPTERS;

/** Opens the seeded Book and its Chapters drawer. */
async function openChapters(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("row", { name: SEED_BOOK.title }).tap();
  await expect(page.getByRole("heading", { name: SEED_BOOK.title, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Chapters", exact: true }).tap();
  const list = page.getByRole("grid", { name: "Chapters" });
  await expect(list.getByRole("row")).toHaveCount(SEED_CHAPTERS.length);
  return list;
}

async function openNotesGallery(page: Page): Promise<Locator> {
  await page.goto("/notes");
  const gallery = page.getByRole("grid", { name: "Notes" });
  await expect(gallery.getByRole("row")).toHaveCount(3);
  return gallery;
}

async function expectChapterOrder(list: Locator, titles: readonly string[]) {
  for (const [index, title] of titles.entries()) {
    await expect(list.getByRole("row").nth(index)).toHaveAccessibleName(title);
  }
}

test.describe("phone Item Menu button, Chapters @touch @wf:phone-item-menu-button", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("a Chapter's ⋯ stands in for its hover actions and changes its status", async ({ page }) => {
    const list = await openChapters(page);
    const row = list.getByRole("row", { name: lamp.title });
    // Edit and Delete are revealed on hover, which a phone never has; the ⋯
    // button is the way in. This fails if the row loses its pointer-coarse: classes.
    await expect(row.getByRole("button", { name: "Edit Chapter" })).toBeHidden();
    await expect(row.getByRole("button", { name: "Delete Chapter" })).toBeHidden();
    const more = row.getByRole("button", { name: `More actions for ${lamp.title}` });
    await expect(more).toBeVisible();

    await more.tap();
    const menu = page.getByRole("menu").first();
    await expect(menu.getByRole("menuitem", { name: "Edit Chapter" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete Chapter" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Status" }).tap();
    await page.getByRole("menuitem", { name: "Revised" }).tap();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(row).toContainText("Revised");
  });
});

test.describe("phone Item Menu button, Notes Gallery @touch @wf:phone-item-menu-button", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("a Gallery card's ⋯ opens its Item Menu and duplicates the Note", async ({ page }) => {
    const gallery = await openNotesGallery(page);
    const card = gallery.getByRole("row", { name: SEED_NOTES.harborNotes });
    const more = card.getByRole("button", { name: `More actions for ${SEED_NOTES.harborNotes}` });
    await expect(more).toBeVisible();

    await more.tap();
    await page.getByRole("menu").getByRole("menuitem", { name: "Duplicate note" }).tap();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(gallery.getByRole("row")).toHaveCount(4);
  });
});

test.describe("phone Item Menu long-press, Chapters @touch @wf:phone-item-menu-long-press", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("a long-press on a Chapter opens its Item Menu", async ({ page }) => {
    const list = await openChapters(page);
    await longPress(page, list.getByRole("row", { name: lamp.title }).getByText(lamp.title));
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Edit Chapter" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Edit Chapter" }).tap();
    await expect(list.getByRole("row", { name: lamp.title }).getByRole("textbox")).toHaveValue(
      lamp.title
    );
  });

  test("a tap on a Chapter opens it, not its Item Menu", async ({ page }) => {
    const list = await openChapters(page);
    await list.getByRole("row", { name: arrival.title }).getByText(arrival.title).tap();
    await expect(page.getByRole("banner", { name: "Book title bar" })).toContainText(arrival.title);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("phone Item Menu long-press, Notes Gallery @touch @wf:phone-item-menu-long-press", () => {
  test.use({ library: "notesWithLinksAndTags" });

  test("a long-press on a Gallery card opens its Item Menu", async ({ page }) => {
    const gallery = await openNotesGallery(page);
    await longPress(page, gallery.getByRole("heading", { name: SEED_NOTES.keeperLog }));
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await expect(page).toHaveURL(/\/notes$/);
  });
});

test.describe("phone drag handle @touch @wf:phone-drag-handle", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("a long-press on the Reorder handle is left to dragging, not the Item Menu", async ({
    page,
  }) => {
    const list = await openChapters(page);
    const handle = list
      .getByRole("row", { name: lamp.title })
      .getByRole("button", { name: "Reorder" });
    await expect(handle).toBeVisible();
    await longPress(page, handle);
    await expect(page.getByRole("menu")).toHaveCount(0);
    // The body of the same row still opens it, so the handle is what differs.
    await longPress(page, list.getByRole("row", { name: lamp.title }).getByText(lamp.title));
    await expect(page.getByRole("menu")).toHaveCount(1);
  });

  test("a swipe from a Chapter's body moves nothing", async ({ page }) => {
    const list = await openChapters(page);
    await swipe(
      page,
      list.getByRole("row", { name: storm.title }).getByText(storm.title),
      list.getByRole("row", { name: arrival.title }).getByText(arrival.title)
    );
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expectChapterOrder(list, [arrival.title, lamp.title, storm.title]);
  });
});
