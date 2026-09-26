import type { Locator, Page } from "@playwright/test";
import {
  expectFocusWithin,
  expectTabContained,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { DOT_PNG, IMAGE_FIXTURE_DIR } from "../support/fixtures/images";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// The editor inserts slice (issue #206): dialogs and structure the author adds
// from the keyboard — Link, image, Footnote, Scene Break, Outline, tables —
// plus following a Link without a mouse.
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });

async function openEditor(page: Page, settings: Record<string, unknown> = {}) {
  await seedSettings(page, { toolbarExpanded: true, ...settings });
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "The Lighthouse Keeper", level: 1 })
  ).toBeVisible();
  await expect(editorText(page)).toBeFocused();
  // Wait for the Chapter's stored text, so a late content load cannot replace it.
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
}

/** Persists the latest typing before a reload, like an author's Mod+S. */
async function saveNow(page: Page) {
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Tabs from the Chapter list into the toolbar, then arrows to a control. */
async function focusToolbarControl(page: Page, target: Locator) {
  await page.keyboard.press("Escape");
  await expectFocusWithin(chapterList(page));
  for (let i = 0; i < 40; i++) {
    if (await isFocusWithin(toolbar(page))) break;
    await page.keyboard.press("Tab");
  }
  if (!(await isFocusWithin(toolbar(page)))) throw new Error("Tab never reached the toolbar");
  await pressUntilFocused(page, "ArrowRight", target, { max: 120 });
}

/** Focuses a Chapter row in the grid (the grid is one Tab stop plus arrows). */
async function focusChapterRow(page: Page, title: string): Promise<Locator> {
  const grid = page.getByRole("grid", { name: "Chapters" });
  const row = grid.getByRole("row", { name: title });
  await tabTo(page, grid.getByRole("row", { selected: true }));
  if (!(await isFocusWithin(row))) {
    await pressUntilFocused(page, "ArrowDown", row, { max: 6 }).catch(() =>
      pressUntilFocused(page, "ArrowUp", row, { max: 6 })
    );
  }
  return row;
}

/** Opens the Link dialog and inserts one of the three seeded Chapters. */
async function insertChapterLink(page: Page, chapterTitle: string) {
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Insert Link" });
  await expect(dialog).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "In this book" }), { backwards: true });
  await page.keyboard.press("Enter");
  await tabTo(page, dialog.getByRole("button", { name: new RegExp(`^${chapterTitle}`) }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** Shift+F10 opens the image menu for the inserted (selected) image. */
async function openImageMenu(page: Page) {
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Image options" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Inserts an image from the URL field and leaves the caret after it. */
async function insertImageByUrl(page: Page, alt: string) {
  const insertImage = page.getByRole("button", { name: "Insert Image" });
  await focusToolbarControl(page, insertImage);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Insert Image" });
  await expect(dialog).toBeVisible();
  const url = dialog.getByRole("textbox", { name: "Image URL" });
  await tabTo(page, url);
  await page.keyboard.type(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFAB0kAgH02W5zAAAAAElFTkSuQmCC"
  );
  const altField = dialog.getByRole("textbox", { name: "Alt Text (optional)" });
  await tabTo(page, altField);
  await page.keyboard.type(alt);
  await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }));
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(editorText(page)).toBeFocused();
}

test.describe("link dialog @wf:editor-link-dialog @sc:editor.insertLink", () => {
  test("Mod+K inserts an external link and it survives a reload", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "URL" })).toBeFocused();

    await page.keyboard.type("example.com");
    await tabTo(page, dialog.getByRole("textbox", { name: "Display Text (optional)" }));
    await page.keyboard.type("Tide charts");
    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }));
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
    await expect(editorText(page).getByRole("link", { name: "Tide charts" })).toBeVisible();

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await expect(editorText(page).getByRole("link", { name: "Tide charts" })).toBeVisible();
  });

  test("an internal target inserts a Link to the seeded Chapter", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await insertChapterLink(page, "Arrival");

    await expect(editorText(page)).toBeFocused();
    await expect(editorText(page).getByRole("link", { name: "Arrival" })).toBeVisible();

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).getByRole("link", { name: "Arrival" })).toBeVisible();
  });

  test("Esc cancels without touching the text and returns focus to the editor", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    const before = await editorText(page).innerText();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
    expect(await editorText(page).innerText()).toBe(before);
  });

  test("an empty URL shows the required error and keeps the dialog open", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Insert Link" });

    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }));
    await page.keyboard.press("Enter");

    await expect(dialog.getByText("URL is required")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("Tab stays inside the dialog", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await expect(dialog).toBeVisible();

    await expectTabContained(page, dialog);

    await page.keyboard.press("Escape");
  });
});

test.describe("following a link @wf:editor-follow-link @sc:editor.followLink", () => {
  test("Mod+Enter on an internal Link opens its Chapter", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await insertChapterLink(page, "Arrival");
    await expect(editorText(page)).toBeFocused();
    await saveNow(page);

    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(
      page.getByRole("heading", { name: "The Lighthouse Keeper", level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Text of Arrival" })).toBeFocused();
  });

  test("Mod+Enter on an external Link asks before opening", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await dialog.getByRole("textbox", { name: "URL" }).waitFor();
    await page.keyboard.type("example.com");
    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }));
    await page.keyboard.press("Enter");
    await expect(editorText(page)).toBeFocused();

    await page.keyboard.press("ControlOrMeta+Enter");

    const confirm = page.getByRole("dialog", { name: "Open Link" });
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("Mod+Enter on a Link whose Chapter was deleted returns to the Gallery", async ({ page }) => {
    await openEditor(page);
    // Create a Chapter to link to.
    await page.keyboard.press("Escape");
    await tabTo(page, page.getByRole("button", { name: "Add Chapter" }), { max: 40 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Tidewatch");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Text of Tidewatch" })).toBeFocused();

    // Link to it from Storm.
    await page.keyboard.press("Escape");
    await focusChapterRow(page, "Storm");
    await page.keyboard.press("Enter");
    await tabTo(page, editorText(page), { max: 150 });
    await insertChapterLink(page, "Tidewatch");

    // Delete the linked Chapter through its Item actions.
    await page.keyboard.press("Escape");
    const row = await focusChapterRow(page, "Tidewatch");
    await tabTo(page, row.getByRole("button", { name: "Delete Chapter" }), { max: 6 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "No", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(row).toHaveCount(0);

    // Back to Storm, where the Link now points at nothing. The Link sits at
    // the start of the paragraph.
    await focusChapterRow(page, "Storm");
    await page.keyboard.press("Enter");
    await tabTo(page, editorText(page), { max: 150 });
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
  });
});

test.describe("image insert @wf:editor-image-insert", () => {
  test("the URL field inserts an image and it survives a reload", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await insertImageByUrl(page, "A lamp");

    const figure = editorText(page).locator("figure[data-image]");
    await expect(figure).toHaveCount(1);
    await expect(figure.locator("img")).toHaveAttribute("alt", "A lamp");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("figure[data-image]")).toHaveCount(1);
  });

  test("Choose from Computer opens the file picker and inserts the file", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    const insertImage = page.getByRole("button", { name: "Insert Image" });
    await focusToolbarControl(page, insertImage);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Insert Image" });
    await expect(dialog).toBeVisible();

    const choose = dialog.getByRole("button", { name: "Choose from Computer" });
    await tabTo(page, choose);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(`${IMAGE_FIXTURE_DIR}/${DOT_PNG}`);

    await expect(dialog.getByRole("textbox", { name: "Image URL" })).not.toHaveValue("");
    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }));
    await page.keyboard.press("Enter");

    await expect(editorText(page).locator("figure[data-image]")).toHaveCount(1);
    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("figure[data-image]")).toHaveCount(1);
  });

  test("Esc cancels the dialog without inserting", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    const insertImage = page.getByRole("button", { name: "Insert Image" });
    await focusToolbarControl(page, insertImage);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Insert Image" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Insert Image" })).toBeFocused();
    await expect(editorText(page).locator("figure[data-image]")).toHaveCount(0);
  });
});

test.describe("image menu @wf:editor-image-menu", () => {
  test("Shift+F10 aligns the selected image; the menu closes and persists", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await insertImageByUrl(page, "A lamp");

    const menu = await openImageMenu(page);
    await pressUntilFocused(page, "ArrowDown", menu.getByRole("menuitem", { name: "Align Right" }));
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect(editorText(page).locator("figure[data-image]")).toHaveAttribute(
      "data-alignment",
      "right"
    );

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("figure[data-image]")).toHaveAttribute(
      "data-alignment",
      "right"
    );
  });

  test("Edit Alt Text updates the image and persists", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await insertImageByUrl(page, "A lamp");

    await openImageMenu(page);
    await pressUntilFocused(
      page,
      "ArrowDown",
      page.getByRole("menuitem", { name: "Edit Alt Text" })
    );
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Edit Alt Text" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Alt Text" })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("The lamp at dusk");
    await tabTo(page, dialog.getByRole("button", { name: "Save", exact: true }));
    await page.keyboard.press("Enter");

    await expect(editorText(page).locator("figure[data-image] img")).toHaveAttribute(
      "alt",
      "The lamp at dusk"
    );
    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("figure[data-image] img")).toHaveAttribute(
      "alt",
      "The lamp at dusk"
    );
  });

  test("Delete removes the image and persists", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await insertImageByUrl(page, "A lamp");

    await openImageMenu(page);
    await pressUntilFocused(page, "ArrowDown", page.getByRole("menuitem", { name: "Delete" }));
    await page.keyboard.press("Enter");

    await expect(editorText(page).locator("figure[data-image]")).toHaveCount(0);
    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("figure[data-image]")).toHaveCount(0);
  });
});

test.describe("footnotes @wf:editor-footnote", () => {
  test("the dialog inserts a Footnote that the Footnotes panel lists, and it persists", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Alt+n");

    const dialog = page.getByRole("dialog", { name: "Add Footnote" });
    await expect(dialog).toBeVisible();
    const content = dialog.getByRole("textbox", { name: "Footnote Content" });
    await expect(content).toBeFocused();
    await page.keyboard.type("The lamp was trimmed at midnight.");
    await tabTo(page, dialog.getByRole("button", { name: "Insert Footnote" }));
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(editorText(page).locator("sup.footnote-ref")).toHaveCount(1);

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("sup.footnote-ref")).toHaveCount(1);
  });

  test("the Footnotes panel lists the inserted Footnote", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Alt+n");
    const dialog = page.getByRole("dialog", { name: "Add Footnote" });
    await expect(dialog).toBeVisible();
    await page.keyboard.type("The lamp was trimmed at midnight.");
    await tabTo(page, dialog.getByRole("button", { name: "Insert Footnote" }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    await page.keyboard.press("Escape");
    await tabTo(page, page.getByRole("button", { name: "More" }), { max: 60 });
    await page.keyboard.press("Enter");
    await tabTo(page, page.getByRole("button", { name: "Book Notes" }), { max: 10 });
    await page.keyboard.press("Enter");

    const panel = page.getByRole("complementary", { name: "Book side panel" });
    await expect(panel).toBeVisible();
    // The panel opens with its active tab (Notes) focused. Its tabs are a
    // React Aria tab list, so an arrow key moves between them and switches the
    // visible panel automatically.
    await expect(panel.getByRole("tab", { name: "Notes", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(panel.getByRole("tab", { name: "Footnotes", exact: true })).toBeFocused();
    await expect(panel).toContainText("The lamp was trimmed at midnight.");
  });

  test("Cancel inserts nothing", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Alt+n");
    await expect(page.getByRole("dialog", { name: "Add Footnote" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog", { name: "Add Footnote" })).toBeHidden();
    await expect(editorText(page).locator("sup.footnote-ref")).toHaveCount(0);
  });

  test.fail(
    "edit and delete a Footnote from the list",
    {
      annotation: {
        type: "issue",
        // Editing and deleting from the list is not built; the interaction is undecided.
        description: "https://github.com/M4ss1ck/maibuk/issues/217",
      },
    },
    async ({ page }) => {
      await openEditor(page);
      await expect(page.getByRole("button", { name: "Edit footnote" })).toBeVisible();
    }
  );
});

test.describe("scene breaks @wf:editor-scene-break", () => {
  test("the direct button inserts the last Scene Break and it persists", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    const sceneBreak = page.getByRole("button", { name: "Scene Break (* * *)" });
    await focusToolbarControl(page, sceneBreak);
    await page.keyboard.press("Enter");

    await expect(editorText(page).locator("[data-scene-break]")).toHaveCount(1);
    await expect(editorText(page).locator(".scene-break-symbols")).toHaveText("* * *");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("[data-scene-break]")).toHaveCount(1);
  });

  test("the options menu inserts a chosen symbol from the keyboard", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    const options = page.getByRole("button", { name: "Scene break options" });
    await focusToolbarControl(page, options);
    await page.keyboard.press("Enter");

    const menu = page.getByRole("dialog", { name: "Scene break options" });
    await expect(menu).toBeVisible();
    await tabTo(page, menu.getByRole("button", { name: "♠ ♥ ♦ ♣" }));
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect(editorText(page).locator("[data-scene-break]")).toHaveCount(1);
    await expect(editorText(page).locator(".scene-break-symbols")).toHaveText("♠ ♥ ♦ ♣");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator(".scene-break-symbols")).toHaveText("♠ ♥ ♦ ♣");
  });

  test("the options menu uploads an image Scene Break", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    const options = page.getByRole("button", { name: "Scene break options" });
    await focusToolbarControl(page, options);
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Scene break options" });
    await expect(menu).toBeVisible();

    await tabTo(page, menu.getByRole("button", { name: "Upload image..." }));
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles(`${IMAGE_FIXTURE_DIR}/${DOT_PNG}`);

    await expect(menu).toBeHidden();
    await expect(editorText(page).locator("[data-scene-break] img")).toHaveCount(1);

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).locator("[data-scene-break] img")).toHaveCount(1);
  });
});

test.describe("outline @wf:editor-outline", () => {
  test("lists headings and Scene Breaks, and Enter jumps the caret there", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("Chapter One");
    await page.keyboard.press("Control+Alt+1");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Body text");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const sceneBreak = page.getByRole("button", { name: "Scene Break (* * *)" });
    await focusToolbarControl(page, sceneBreak);
    await page.keyboard.press("Enter");

    // The outline starts open; its toggle shows on the active Chapter.
    await page.keyboard.press("Escape");
    await expectFocusWithin(chapterList(page));
    const outline = chapterList(page).getByRole("button", { name: "Chapter One" });
    await expect(outline).toBeVisible();
    await expect(chapterList(page).getByRole("button", { name: "* * *" })).toBeVisible();

    await tabTo(page, outline);
    await page.keyboard.press("Enter");

    await expect(editorText(page)).toBeFocused();
    await page.keyboard.type("X");
    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("XChapter One");
  });

  test("a Chapter without headings shows an empty outline", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Escape");
    await expectFocusWithin(chapterList(page));
    const row = page.getByRole("grid", { name: "Chapters" }).getByRole("row", { name: "Storm" });
    await tabTo(
      page,
      page.getByRole("grid", { name: "Chapters" }).getByRole("row", { selected: true })
    );
    const toggle = row.getByRole("button", { name: /outline$/ });
    await tabTo(page, toggle, { max: 6 });

    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(chapterList(page).getByRole("button", { name: "Untitled heading" })).toHaveCount(
      0
    );
    await expect(chapterList(page).getByRole("button", { name: "* * *" })).toHaveCount(0);
  });
});

test.describe("tables @wf:editor-table", () => {
  const tableOnlyToolbar = {
    toolbarConfig: {
      start: [{ kind: "group", id: "table", toolbarVisible: true, floatingVisible: false }],
      end: [],
    },
  };

  test("arrows move the picker and Enter inserts the table; it persists", async ({ page }) => {
    await openEditor(page, tableOnlyToolbar);
    await page.keyboard.press("End");
    const insertTable = page.getByRole("button", { name: "Insert Table" });
    await focusToolbarControl(page, insertTable);
    await page.keyboard.press("Enter");

    const picker = page.getByRole("listbox", { name: "Select table size:" });
    await expect(picker).toBeVisible();
    await tabTo(page, page.getByRole("option", { name: "1x1 table" }));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: "2x2 table" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(picker).toBeHidden();
    const table = editorText(page).getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(editorText(page).getByRole("columnheader")).toHaveCount(2);

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).getByRole("table")).toBeVisible();
    await expect(editorText(page).getByRole("row")).toHaveCount(2);
  });

  test("adds a row and a column and deletes the table from the toolbar", async ({ page }) => {
    await openEditor(page, tableOnlyToolbar);
    await page.keyboard.press("End");
    await focusToolbarControl(page, page.getByRole("button", { name: "Insert Table" }));
    await page.keyboard.press("Enter");
    const picker = page.getByRole("listbox", { name: "Select table size:" });
    await expect(picker).toBeVisible();
    await tabTo(page, page.getByRole("option", { name: "1x1 table" }));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(editorText(page).getByRole("table")).toBeVisible();

    // Put the caret in the first cell, then use the enabled row/column actions
    // in toolbar order, so roving focus only ever moves forward.
    await expect(page.getByRole("button", { name: "Add Column After" })).toBeEnabled();
    await focusToolbarControl(page, page.getByRole("button", { name: "Add Column After" }));
    await page.keyboard.press("Enter");
    await expect(editorText(page).getByRole("columnheader")).toHaveCount(3);

    // Each toolbar action hands focus back to the text; the next Escape only
    // reaches the toolbar path once it has.
    await expect(editorText(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Add Row After" })).toBeEnabled();
    await focusToolbarControl(page, page.getByRole("button", { name: "Add Row After" }));
    await page.keyboard.press("Enter");
    await expect(editorText(page).getByRole("row")).toHaveCount(3);

    await expect(editorText(page)).toBeFocused();
    await focusToolbarControl(page, page.getByRole("button", { name: "Delete Table" }));
    await page.keyboard.press("Enter");
    await expect(editorText(page).getByRole("table")).toHaveCount(0);

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).getByRole("table")).toHaveCount(0);
  });
});
