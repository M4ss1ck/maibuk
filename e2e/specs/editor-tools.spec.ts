import type { Locator, Page } from "@playwright/test";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// The editor tools slice (issue #206): Find & Replace, Symbols (dialog and `:`
// autocomplete), Text Case, and the code block language control.
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const chapterList = (page: Page) => page.getByRole("complementary", { name: "Chapter list" });

async function openEditor(page: Page) {
  await seedSettings(page, { toolbarExpanded: true });
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "The Lighthouse Keeper", level: 1 })
  ).toBeVisible();
  await expect(editorText(page)).toBeFocused();
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
}

async function saveNow(page: Page) {
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function focusToolbarControl(page: Page, target: Locator) {
  await page.keyboard.press("Escape");
  await expectFocusWithin(chapterList(page));
  for (let i = 0; i < 40; i++) {
    if (await isFocusWithin(toolbar(page))) break;
    await page.keyboard.press("Tab");
  }
  if (!(await isFocusWithin(toolbar(page)))) throw new Error("Tab never reached the toolbar");
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", target, { max: 120 });
}

test.describe("find and replace @wf:editor-find-replace @sc:editor.findReplace @sc:editor.findNext @sc:editor.findPrevious @sc:editor.closeFindReplace", () => {
  test("Mod+F finds, Enter and Shift+Enter step, and a replacement persists", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+f");

    const find = page.getByPlaceholder("Find...");
    await expect(find).toBeFocused();
    await page.keyboard.type("the");
    await expect(page.getByText("1 of 2")).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page.getByText("2 of 2")).toBeVisible();

    await page.keyboard.press("Shift+Enter");
    await expect(page.getByText("1 of 2")).toBeVisible();

    const replace = page.getByPlaceholder("Replace with...");
    await tabTo(page, replace);
    await page.keyboard.type("a");
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 of 1")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder("Find...")).toBeHidden();
    await expect(editorText(page)).toBeFocused();
    await expect(editorText(page)).toContainText("a storm came in from the west");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toContainText("a storm came in from the west");
  });

  test("Replace All replaces every match", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("warning");
    await expect(page.getByText("1 of 1")).toBeVisible();
    await tabTo(page, page.getByPlaceholder("Replace with..."));
    await page.keyboard.type("notice");
    await tabTo(page, page.getByRole("button", { name: "Replace All" }));
    await page.keyboard.press("Enter");

    await page.keyboard.press("Escape");
    await expect(editorText(page)).toContainText("notice");
    await expect(editorText(page)).not.toContainText("warning");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toContainText("notice");
  });

  test("No matches says so", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("zzzz");

    await expect(page.getByText("No results")).toBeVisible();
  });

  test("the Close button closes the panel and returns focus to the editor", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+f");
    await expect(page.getByPlaceholder("Find...")).toBeFocused();

    await tabTo(page, page.getByRole("button", { name: "Close" }));
    await page.keyboard.press("Enter");

    await expect(page.getByPlaceholder("Find...")).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });
});

test.describe("symbols @wf:editor-symbols @sc:editor.insertSymbol", () => {
  test("Mod+Shift+O searches, arrows to a symbol, and Enter inserts it", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.press("Control+Shift+o");

    const dialog = page.getByRole("dialog", { name: "Insert symbol" });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "Search symbols" });
    await expect(search).toBeFocused();
    await page.keyboard.type("arrow");
    const grid = dialog.getByRole("listbox", { name: "Symbols" });
    await expect(grid.getByRole("option").first()).toBeVisible();

    await pressUntilFocused(page, "ArrowDown", grid.getByRole("option").first());
    await page.keyboard.press("Enter");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toContainText("⤴");
  });

  test("Esc closes the dialog and returns focus to the editor", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("Control+Shift+o");
    const dialog = page.getByRole("dialog", { name: "Insert symbol" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("typing a colon shows the autocomplete list and Enter inserts the glyph", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" :smile");

    const listbox = page.getByRole("listbox", { name: "Symbols" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(listbox.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Enter");
    await expect(listbox).toBeHidden();
    await expect(editorText(page)).not.toContainText(":smile");

    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).not.toContainText(":smile");
  });
});

test.describe("text case @wf:editor-text-case", () => {
  test("uppercase, lowercase and the mirrored menu transform a selection", async ({ page }) => {
    await openEditor(page);
    // Select the first word "The" of the seeded sentence.
    await page.keyboard.press("Home");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");

    await focusToolbarControl(page, page.getByRole("button", { name: "Uppercase" }));
    await page.keyboard.press("Enter");
    await expect(editorText(page)).toContainText("THE storm");

    await focusToolbarControl(page, page.getByRole("button", { name: "Lowercase" }));
    await page.keyboard.press("Enter");
    await expect(editorText(page)).toContainText("the storm");

    await focusToolbarControl(page, page.getByRole("button", { name: "Text Case", exact: true }));
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Text Case" });
    await expect(menu).toBeVisible();
    await pressUntilFocused(
      page,
      "ArrowDown",
      menu.getByRole("menuitem", { name: "Horizontal mirror" })
    );
    await page.keyboard.press("Enter");

    await expect(editorText(page)).toContainText("ɘht storm");
    await page.keyboard.press("Escape");
    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toContainText("ɘht storm");
  });
});

test.describe("code blocks @wf:editor-code-block @sc:editor.codeBlock", () => {
  test("Tab reaches the language control and the chosen language persists", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type("const x = 1;");
    await page.keyboard.press("Control+Alt+c");

    const editor = editorText(page);
    await expect(editor.getByRole("code")).toHaveText("const x = 1;");
    await expect(page.getByRole("button", { name: "Edit code block language" })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Edit code block language" })).toBeFocused();
    await page.keyboard.press("Enter");

    const input = page.getByRole("textbox", { name: "Code block language" });
    await expect(input).toBeFocused();
    await page.keyboard.type("javascript");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Edit code block language" })).toHaveText(
      "javascript"
    );

    await saveNow(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit code block language" })).toHaveText(
      "javascript"
    );
  });
});

test.describe("HTML view @wf:editor-html-view", () => {
  test("open, edit the HTML, Esc returns to the editor, and the change persists", async ({
    page,
  }) => {
    await openEditor(page);
    await focusToolbarControl(page, page.getByRole("button", { name: "View HTML" }));
    await page.keyboard.press("Enter");
    await expect(page.getByText("HTML Source")).toBeVisible();

    // Tab through the panel header into CodeMirror.
    const cm = page.locator(".cm-content");
    await tabTo(page, cm);
    await expect(cm).toContainText("The storm came in from the west");

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("<p>Rewritten by hand</p>");
    await expect(editorText(page)).toContainText("Rewritten by hand");

    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();
    await saveNow(page);
    await page.reload();
    await expect(editorText(page)).toContainText("Rewritten by hand");
  });

  test("unclosed HTML shows the validation warning and Esc returns to the editor", async ({
    page,
  }) => {
    await openEditor(page);
    await focusToolbarControl(page, page.getByRole("button", { name: "View HTML" }));
    await page.keyboard.press("Enter");
    const cm = page.locator(".cm-content");
    await tabTo(page, cm);

    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("<div>");
    // closeBrackets auto-closes the tag; removing it leaves the unclosed tag.
    for (let i = 0; i < 6; i++) await page.keyboard.press("Delete");

    await expect(page.getByText("1 warning")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();
  });
});
