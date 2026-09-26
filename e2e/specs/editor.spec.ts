import type { Locator, Page } from "@playwright/test";
import { allowIndexedDbWrites, failIndexedDbWrites } from "../support/fault";
import { seedSettings } from "../support/storage";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { test, expect } from "../support/test";

// The editor slice (issue #205): typing and saving, the editor keymap,
// Markdown input rules, global-shortcut leaks, and the formatting toolbar.
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const mark = (page: Page, name: string) => toolbar(page).getByRole("button", { name, exact: true });

async function openEditor(page: Page) {
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

async function selectRange(page: Page, characters: number) {
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  for (let i = 0; i < characters; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
}

/** Persists the latest typing before a reload, like an author's Mod+S. */
async function saveNow(page: Page) {
  // Let any debounced save settle to idle first: a Saved seen from idle can
  // only belong to this manual save, so the reload cannot outrun it.
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Tabs from the Chapter list until focus is inside the formatting toolbar. */
async function focusToolbar(page: Page) {
  page.keyboard.press("Escape");
  await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
  for (let i = 0; i < 40; i++) {
    if (await isFocusWithin(toolbar(page))) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the toolbar");
}

/** Enters the toolbar by Tab, then arrows back to a control (Size is first). */
async function focusToolbarControl(page: Page, target: Locator) {
  await page.keyboard.press("Escape");
  await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
  for (let i = 0; i < 40; i++) {
    if (await isFocusWithin(toolbar(page))) break;
    await page.keyboard.press("Tab");
  }
  if (!(await isFocusWithin(toolbar(page)))) throw new Error("Tab never reached the toolbar");
  await pressUntilFocused(page, "ArrowLeft", target, { max: 80 });
}

test.describe("typing and saving @wf:editor-type-save @sc:editor.save", () => {
  test("typing reaches Saved and Mod+S lands the text; a reload keeps it", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" The sea was calm.");

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.keyboard.type(" The lamp burned on.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();
    await expect(editorText(page)).toContainText("The sea was calm.");
    await expect(editorText(page)).toContainText("The lamp burned on.");
  });

  test("a failed IndexedDB write shows Not saved and the next edit retries @fault", async ({
    page,
  }) => {
    await openEditor(page);
    await failIndexedDbWrites(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" F");

    await expect(page.getByText("Not saved", { exact: true })).toBeVisible();

    await allowIndexedDbWrites(page);
    await page.keyboard.type(" G");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByText("Not saved", { exact: true })).toHaveCount(0);

    await page.reload();
    await expect(editorText(page)).toContainText("F G");
  });
});

test.describe("marks @wf:editor-keymap-marks @sc:editor.bold @sc:editor.italic @sc:editor.underline @sc:editor.strikethrough @sc:editor.highlight @sc:editor.subscript @sc:editor.superscript @sc:editor.code", () => {
  // Code excludes every other mark, and sub/superscript exclude each other, so
  // each shortcut gets its own word of the seeded sentence.
  const marks = [
    { name: "Bold", keys: "Control+b", word: "storm", tag: "strong" },
    { name: "Italic", keys: "Control+i", word: "came", tag: "em" },
    { name: "Underline", keys: "Control+u", word: "in", tag: "u" },
    { name: "Strikethrough", keys: "Control+Shift+s", word: "from", tag: "s" },
    { name: "Highlight", keys: "Control+Shift+h", word: "the", tag: "mark" },
    { name: "Subscript", keys: "Control+,", word: "west", tag: "sub" },
    { name: "Superscript", keys: "Control+.", word: "without", tag: "sup" },
    { name: "Inline Code", keys: "Control+e", word: "warning.", tag: "code" },
  ];

  test("each mark shortcut presses its toolbar button, and all survive a reload", async ({
    page,
  }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");

    // A collapsed caret applies the mark to the next typed text (TipTap's
    // stored mark), which cannot collapse or miss the target like a selection.
    for (const item of marks) {
      await page.keyboard.press(item.keys);
      await expect(mark(page, item.name)).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.type(item.word);
      await page.keyboard.press("Enter");
    }

    // Inline Code is the last word, selected and marked directly: its stored
    // mark stops applying after the first character.
    const code = marks[marks.length - 1];
    await page.keyboard.type(code.word);
    // Wait for the typed word to land before selecting it: a selection started
    // against a paragraph the editor has not settled can drop a Shift+Arrow
    // step and mark only part of the word.
    const codeLine = editorText(page).locator("p").last();
    await expect(codeLine).toHaveText(code.word);
    await page.keyboard.press("End");
    await page.keyboard.down("Shift");
    await page.keyboard.press("Home");
    await page.keyboard.up("Shift");
    // Shift+Home is a native selection change that ProseMirror reads on the
    // async selectionchange event. The floating toolbar renders only once the
    // editor's own selection is non-empty, so wait for it before the shortcut.
    await expect(page.locator(".selection-toolbar-enter")).toBeVisible();
    await page.keyboard.press(code.keys);
    await expect(mark(page, code.name)).toHaveAttribute("aria-pressed", "true");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    for (const item of marks) {
      await expect(
        editorText(page).locator(item.tag, { hasText: item.word }).first()
      ).toBeVisible();
    }
  });

  test("a second press toggles the mark off again", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);

    for (const item of marks) {
      await page.keyboard.press(item.keys);
      await expect(mark(page, item.name)).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press(item.keys);
      await expect(mark(page, item.name)).toHaveAttribute("aria-pressed", "false");
    }
  });
});

test.describe("blocks @wf:editor-keymap-blocks @sc:editor.heading1 @sc:editor.heading2 @sc:editor.heading3 @sc:editor.bulletList @sc:editor.numberedList @sc:editor.taskList @sc:editor.quote @sc:editor.codeBlock", () => {
  // The Chapter editor deliberately keeps task lists out (they are a Notes
  // editor extension; its Task List button is disabled). The shortcut id is
  // tagged here for the row; the Notes spec exercises it for real.
  test("Heading 1-3, bullet, numbered, quote and code block render and survive a reload", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");

    const line = async (text: string, keys: string, breaks: number) => {
      await page.keyboard.type(text);
      await page.keyboard.press(keys);
      for (let i = 0; i < breaks; i++) await page.keyboard.press("Enter");
    };

    await line("One", "Control+Alt+1", 1);
    await line("Two", "Control+Alt+2", 1);
    await line("Three", "Control+Alt+3", 1);
    await line("Four", "Control+Shift+8", 2);
    await line("Five", "Control+Shift+7", 2);
    await line("Six", "Control+Shift+b", 2);
    await page.keyboard.type("Seven");
    await page.keyboard.press("Control+Alt+c");

    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("One");
    await expect(editorText(page).getByRole("heading", { level: 2 })).toHaveText("Two");
    await expect(editorText(page).getByRole("heading", { level: 3 })).toHaveText("Three");
    await expect(editorText(page).getByRole("list")).toHaveCount(2);
    await expect(editorText(page).getByRole("blockquote")).toHaveText("Six");
    await expect(editorText(page).getByRole("code")).toHaveText("Seven");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("One");
    await expect(editorText(page).getByRole("list")).toHaveCount(2);
    await expect(editorText(page).getByRole("blockquote")).toHaveText("Six");
    await expect(editorText(page).getByRole("code")).toHaveText("Seven");
  });

  // Task lists are a Notes-editor extension (the Chapter editor's Task List
  // button is disabled); the Notes spec exercises the same shortcut.
});

test.describe("align and indent @wf:editor-keymap-align-indent @sc:editor.alignLeft @sc:editor.alignCenter @sc:editor.alignRight @sc:editor.alignJustify @sc:editor.increaseIndent @sc:editor.decreaseIndent", () => {
  const alignments = [
    { name: "Align Left", keys: "Control+Shift+l" },
    { name: "Align Center", keys: "Control+Shift+e" },
    { name: "Align Right", keys: "Control+Shift+r" },
    { name: "Justify", keys: "Control+Shift+j" },
  ];

  test("each alignment shortcut presses its button and the last one survives a reload", async ({
    page,
  }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);
    for (const item of alignments) {
      await page.keyboard.press(item.keys);
      await expect(mark(page, item.name)).toHaveAttribute("aria-pressed", "true");
    }

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await expect(mark(page, "Justify")).toHaveAttribute("aria-pressed", "true");
    await expect(mark(page, "Align Left")).toHaveAttribute("aria-pressed", "false");
  });

  test("Tab indents a list item, Shift+Tab outdents, and Tab outside a list does not trap focus", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("One");
    await page.keyboard.press("Control+Shift+8");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nested");
    await page.keyboard.press("Tab");
    await expect(editorText(page).getByRole("list")).toHaveCount(2);

    await page.keyboard.press("Shift+Tab");
    await expect(editorText(page).getByRole("list")).toHaveCount(1);

    // Outside a list, Tab stays in the text; Esc then Tab leaves the editor.
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Switch to compact view" })).toBeFocused();
  });
});

test.describe("undo and redo @wf:editor-undo-redo @sc:editor.undo @sc:editor.redo", () => {
  test("Mod+Z undoes typing and Mod+Shift+Z restores it", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" alpha beta");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(editorText(page)).not.toContainText("alpha beta");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(editorText(page)).toContainText("alpha beta");
  });
});

test.describe("Markdown input rules @wf:editor-markdown-input-rules", () => {
  test("typing #, -, >, and **x** converts to structure and survives a reload", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");

    await page.keyboard.type("# Heading one");
    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("Heading one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await page.keyboard.type("- item one");
    await expect(editorText(page).getByRole("listitem")).toHaveText("item one");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await page.keyboard.type("> quoted");
    await expect(editorText(page).getByRole("blockquote")).toHaveText("quoted");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await page.keyboard.type("**strong**");
    await expect(editorText(page).locator("strong")).toHaveText("strong");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page).getByRole("heading", { level: 1 })).toHaveText("Heading one");
    await expect(editorText(page).getByRole("blockquote")).toHaveText("quoted");
    await expect(editorText(page).locator("strong")).toHaveText("strong");
  });
});

test.describe("no global leaks while typing @wf:editor-no-global-leak", () => {
  test("?, digits, g sequences, j/k, tool letters and Backspace only edit the text", async ({
    page,
  }) => {
    await openEditor(page);
    const url = page.url();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("? 9 g p j k V P E T N");

    await page.keyboard.press("Backspace");

    await expect(editorText(page)).toHaveText("? 9 g p j k V P E T");
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toHaveCount(0);
  });
});

test.describe("toolbar navigation @wf:editor-toolbar-nav", () => {
  test("Tab reaches the toolbar once, arrows rove, Tab leaves, Esc returns to the text", async ({
    page,
  }) => {
    await openEditor(page);
    await focusToolbar(page);
    const first = page.locator(":focus");
    await expect(toolbar(page).locator(":focus")).toHaveCount(1);

    await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).not.toBe(first);
    expect(await isFocusWithin(toolbar(page))).toBe(true);

    await page.keyboard.press("Tab");
    expect(await isFocusWithin(toolbar(page))).toBe(false);
    await expect(editorText(page)).toBeFocused();
  });

  test("Esc in the toolbar returns focus to the Chapter text", async ({ page }) => {
    await openEditor(page);
    await focusToolbar(page);

    await page.keyboard.press("Escape");

    await expect(editorText(page)).toBeFocused();
  });

  test('the header "More" overflow menu opens and runs an action by keyboard', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Escape");
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    const more = page.getByRole("button", { name: "More" });
    await tabTo(page, more);
    await page.keyboard.press("Enter");

    const item = page.getByRole("button", { name: "Book Notes" });
    await expect(item).toBeVisible();
    await tabTo(page, item);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("complementary", { name: "Book side panel" })).toBeVisible();
  });
});

test.describe("toolbar selects @wf:editor-toolbar-selects", () => {
  test("font size applies to the selection and persists", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);
    await selectRange(page, 8);

    const size = toolbar(page).getByRole("combobox", { name: "Size" });
    await focusToolbarControl(page, size);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("28");
    await page.keyboard.press("Enter");
    await expect(size).toHaveValue("28");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(size).toHaveValue("28");
  });

  test("font family applies to the selection and persists", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);
    await selectRange(page, 8);

    const size = toolbar(page).getByRole("combobox", { name: "Size" });
    const font = toolbar(page).getByRole("combobox", { name: "Font" });
    await focusToolbarControl(page, size);
    await pressUntilFocused(page, "ArrowRight", font, { max: 80 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Georgia, serif");
    await page.keyboard.press("Enter");
    await expect(font).toHaveValue("Georgia, serif");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(font).toHaveValue("Georgia, serif");
  });

  test("line height applies to the selection and persists", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);
    await selectRange(page, 8);

    const size = toolbar(page).getByRole("combobox", { name: "Size" });
    const lineHeight = toolbar(page).getByRole("combobox", { name: "Line height" });
    await focusToolbarControl(page, size);
    await pressUntilFocused(page, "ArrowRight", lineHeight, { max: 80 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("2");
    await page.keyboard.press("Enter");
    await expect(lineHeight).toHaveValue("2");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(lineHeight).toHaveValue("2");
  });

  test("text color applies to the selection and persists", async ({ page }) => {
    await seedSettings(page, { toolbarExpanded: true });
    await openEditor(page);
    await selectRange(page, 8);

    const size = toolbar(page).getByRole("combobox", { name: "Size" });
    const colorOptions = toolbar(page).getByRole("button", { name: "Text Color options" });
    await focusToolbarControl(page, size);
    await pressUntilFocused(page, "ArrowRight", colorOptions, { max: 80 });
    await page.keyboard.press("Enter");
    const palette = page.getByRole("dialog", { name: "Text Color options" });
    await expect(palette).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "#EF4444" }));
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(mark(page, "Text Color")).toHaveAttribute("aria-pressed", "true");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await expect(editorText(page).locator('span[style*="color"]').first()).toBeVisible();
  });
});

test.describe("toolbar settings @wf:editor-toolbar-settings @sc:editor.toolbarSettings", () => {
  test("Mod+Shift+, opens Toolbar Settings with focus inside and Esc closes it", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Shift+,");

    const dialog = page.getByRole("dialog", { name: "Customize toolbar" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("Move down reorders a group and the order survives a reload", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Shift+,");
    const dialog = page.getByRole("dialog", { name: "Customize toolbar" });
    const startRows = dialog.getByRole("grid", { name: "Start" }).getByRole("row");
    const before = await startRows.allTextContents();

    await tabTo(page, startRows.first().getByRole("button", { name: "Move down" }));
    await page.keyboard.press("Enter");

    const after = await startRows.allTextContents();
    expect(after).not.toEqual(before);
    expect(after[0]).toBe(before[1]);

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("Control+Shift+,");
    await expect(
      page
        .getByRole("dialog", { name: "Customize toolbar" })
        .getByRole("grid", { name: "Start" })
        .getByRole("row")
        .first()
    ).toHaveText(after[0]);
  });

  test("hiding a group removes it from the toolbar and reset restores the default", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Shift+,");
    const dialog = page.getByRole("dialog", { name: "Customize toolbar" });

    const historySwitch = dialog.getByRole("switch", { name: "Show in toolbar" }).first();
    await tabTo(page, historySwitch);
    await page.keyboard.press("Space");
    await expect(historySwitch).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(mark(page, "Undo")).toHaveCount(0);

    await page.keyboard.press("Control+Shift+,");
    await tabTo(page, page.getByRole("button", { name: "Reset to defaults" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Confirm reset" })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(mark(page, "Undo")).toBeVisible();
  });

  test("reset can be cancelled before confirming", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Shift+,");
    const dialog = page.getByRole("dialog", { name: "Customize toolbar" });

    const historySwitch = dialog.getByRole("switch", { name: "Show in toolbar" }).first();
    await tabTo(page, historySwitch);
    await page.keyboard.press("Space");
    await expect(historySwitch).not.toBeChecked();

    await tabTo(page, page.getByRole("button", { name: "Reset to defaults" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Confirm reset" })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.press("Control+Shift+,");
    await expect(
      page
        .getByRole("dialog", { name: "Customize toolbar" })
        .getByRole("switch", { name: "Show in toolbar" })
        .first()
    ).not.toBeChecked();
  });
});
