import type { Page } from "@playwright/test";
import { expectFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { test, expect } from "../support/test";

// Toolbar view controls and reading position (issue #205).
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const zoomButton = (page: Page) => toolbar(page).getByRole("button", { name: /^\d+%$/ });

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

/** Persists the latest typing before a reload, like an author's Mod+S. */
async function saveNow(page: Page) {
  // Let any debounced save settle to idle first: a Saved seen from idle can
  // only belong to this manual save, so the reload cannot outrun it.
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function tabIntoToolbar(page: Page) {
  await page.keyboard.press("Escape");
  await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
  for (let i = 0; i < 40; i++) {
    if (await toolbar(page).locator(":focus").count()) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the toolbar");
}

test.describe("zoom and width @wf:editor-zoom-width @sc:editor.zoomIn @sc:editor.zoomOut @sc:editor.zoomReset", () => {
  test("zoom shortcuts change the percentage and it survives a reload", async ({ page }) => {
    await openEditor(page);
    await expect(zoomButton(page)).toHaveText("100%");

    await page.keyboard.press("Control+=");
    await expect(zoomButton(page)).toHaveText("110%");

    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await expect(zoomButton(page)).toHaveText("110%");

    await page.keyboard.press("Control+0");
    await expect(zoomButton(page)).toHaveText("100%");
  });

  test("content width and page padding are set by keyboard and survive a reload", async ({
    page,
  }) => {
    await openEditor(page);
    await tabIntoToolbar(page);
    const widthTrigger = toolbar(page).getByRole("button", { name: "Content width" });
    await pressUntilFocused(page, "ArrowRight", widthTrigger, { max: 40 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Content width" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);

    await tabTo(page, dialog.getByRole("button", { name: /Narrow/ }));
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Content width px" })).toHaveText("600px");

    await tabTo(page, dialog.getByRole("slider", { name: "Page padding" }));
    await page.keyboard.press("Tab");
    await page.keyboard.type("64");
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Page padding px" })).toHaveText("64px");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(editorText(page)).toBeVisible();
    await tabIntoToolbar(page);
    await pressUntilFocused(page, "ArrowRight", widthTrigger, { max: 40 });
    await page.keyboard.press("Enter");
    const reopened = page.getByRole("dialog", { name: "Content width" });
    await expect(reopened.getByRole("button", { name: "Content width px" })).toHaveText("600px");
    await expect(reopened.getByRole("button", { name: "Page padding px" })).toHaveText("64px");
  });
});

test.describe("focus mode @wf:editor-focus-mode @sc:editor.focusMode", () => {
  test("F11 hides the chrome with focus in the text; Esc brings it back", async ({ page }) => {
    await openEditor(page);
    await expect(toolbar(page)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "The Lighthouse Keeper", level: 1 })
    ).toBeVisible();

    await page.keyboard.press("F11");

    await expect(toolbar(page)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "The Lighthouse Keeper", level: 1 })
    ).toHaveCount(0);
    await expect(editorText(page)).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(toolbar(page)).toBeVisible();
    await expect(editorText(page)).toBeFocused();
  });
});

test.describe("reading position @wf:editor-reading-position", () => {
  test("the caret is restored after leaving and reopening the Chapter, and across a reload", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("Home");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type("X");
    await expect(editorText(page)).toContainText("The Xstorm");
    await page.waitForTimeout(1300);

    // Leave for another Chapter and come back.
    await page.keyboard.press("Escape");
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    await tabTo(
      page,
      page.getByRole("grid", { name: "Chapters" }).getByRole("row", { name: "Storm" })
    );
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByRole("grid", { name: "Chapters" }).getByRole("row", { name: "The Lamp" })
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Text of The Lamp" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    await tabTo(
      page,
      page.getByRole("grid", { name: "Chapters" }).getByRole("row", { selected: true })
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const storm = page.getByRole("textbox", { name: "Text of Storm" });
    await expect(storm).toBeVisible();
    // Opening a Chapter keeps focus on its row; Tab into the text to type.
    await tabTo(page, storm, { max: 80 });
    await page.keyboard.type("Y");
    await expect(storm).toContainText("The XYstorm");

    // The caret offset is device-local: a reload restores it too.
    await saveNow(page);
    await page.waitForTimeout(1300);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Text of Storm" })).toBeFocused();
    await page.keyboard.type("Z");
    await expect(page.getByRole("textbox", { name: "Text of Storm" })).toContainText(
      "The XYZstorm"
    );
  });
});
