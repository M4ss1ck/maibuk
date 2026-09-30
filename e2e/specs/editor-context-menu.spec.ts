import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, expectTabContained, pressUntilFocused } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// The editor context menu and the floating selection toolbar (issue #207),
// the selection toolbar driven by keyboard alone (issue #218).
test.use({ library: "oneBookThreeChapters" });

const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const mainToolbar = (page: Page) => page.getByRole("toolbar", { name: "Toolbar" });
const floatingToolbar = (page: Page) => page.getByRole("toolbar", { name: "Selection formatting" });

async function openEditor(page: Page, settings: Record<string, unknown> = {}) {
  await seedSettings(page, { toolbarExpanded: true, ...settings });
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
    await capture(page, "selection-toolbar-shown", { around: [floating] });
    await expect(floating.getByRole("button", { name: "Bold" })).toBeVisible();
  });

  test("Alt+F10 focuses it; arrows, Home and End move; Esc returns to the text @sc:editor.focusSelectionToolbar", async ({
    page,
  }) => {
    await openEditor(page);
    await selectFirstWords(page, 5);

    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();

    await page.keyboard.press("Alt+F10");
    await expect(floating.getByRole("button").first()).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(floating.getByRole("button", { name: "Italic" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(floating.getByRole("button").last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(floating.getByRole("button").first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();
    // The 5 selected characters ("The s") are the ones replaced, so the
    // selection survived the round trip through the toolbar.
    await page.keyboard.type("X");
    await expect(editorText(page)).toHaveText("Xtorm came in from the west without warning.");
  });

  test("Enter on Bold bolds the selection and keeps the toolbar focused @sc:editor.focusSelectionToolbar", async ({
    page,
  }) => {
    await openEditor(page);
    await selectFirstWords(page, 5);

    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    await page.keyboard.press("Alt+F10");
    const bold = floating.getByRole("button", { name: "Bold" });
    await pressUntilFocused(page, "ArrowRight", bold);
    await page.keyboard.press("Enter");
    await capture(page, "selection-toolbar-focused");

    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await expect(bold).toBeFocused();
    await expect(floating).toBeVisible();
    await expect(editorText(page).locator("strong")).toHaveText("The s");
  });

  // The browser stops painting ::selection once focus leaves the text, so the
  // range the toolbar acts on is painted by a decoration (issue #306).
  test("selection stays visible while the toolbar has focus @sc:editor.focusSelectionToolbar", async ({
    page,
  }) => {
    await openEditor(page);
    await selectFirstWords(page, 5);

    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    // Native selection while the text has focus: no second, decoration paint.
    const kept = editorText(page).locator(".selection-kept");
    await expect(kept).toHaveCount(0);

    await page.keyboard.press("Alt+F10");
    await expect(kept).toBeVisible();
    await expect(kept).toHaveText("The s");
    await capture(page, "selection-toolbar-kept", { around: [floating] });

    const bold = floating.getByRole("button", { name: "Bold" });
    await pressUntilFocused(page, "ArrowRight", bold);
    await page.keyboard.press("Enter");

    // The decoration may now be split around the <strong>.
    await expect(editorText(page).locator(".selection-kept").first()).toBeVisible();
    await expect.poll(async () => (await kept.allTextContents()).join("")).toBe("The s");

    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();
    await expect(kept).toHaveCount(0);
  });

  test("the highlight picker opened from the bubble keeps the selection painted @sc:editor.focusSelectionToolbar", async ({
    page,
  }) => {
    await openEditor(page);
    await selectFirstWords(page, 5);

    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    await page.keyboard.press("Alt+F10");
    const kept = editorText(page).locator(".selection-kept");
    await expect(kept).toHaveText("The s");

    const trigger = floating.getByRole("button", { name: "Highlight options" });
    await pressUntilFocused(page, "ArrowRight", trigger);
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Highlight options" });
    await expectFocusWithin(picker);
    await expect(kept).toHaveText("The s");
    await capture(page, "selection-toolbar-color-picker", { around: [picker, kept] });

    // A keyboard step on the hue is one adjustment, committed as it ends
    // (ADR 0011), so the color lands on the painted range.
    await pressUntilFocused(page, "Tab", picker.getByRole("slider", { name: "Hue" }));
    await page.keyboard.press("ArrowRight");
    await expect(editorText(page).locator("mark")).toHaveText("The s");
    await expect.poll(async () => (await kept.allTextContents()).join("")).toBe("The s");

    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(async () => (await kept.allTextContents()).join("")).toBe("The s");

    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();
    await expect(kept).toHaveCount(0);
  });

  test("Link from the bubble: Esc closes the dialog and returns to the text @sc:editor.focusSelectionToolbar", async ({
    page,
  }) => {
    await openEditor(page);
    await selectFirstWords(page, 5);

    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    await page.keyboard.press("Alt+F10");
    await pressUntilFocused(
      page,
      "ArrowRight",
      floating.getByRole("button", { name: "Insert Link" })
    );
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Insert Link" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectTabContained(page, dialog);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
  });

  test("a group hidden from the main toolbar stays reachable in the bubble @sc:editor.focusSelectionToolbar", async ({
    page,
  }) => {
    // basic-marks off in the main toolbar, on in the bubble: Bold lives only there.
    await openEditor(page, {
      toolbarConfig: {
        start: [{ kind: "group", id: "basic-marks", toolbarVisible: false, floatingVisible: true }],
        end: [],
      },
    });
    await expect(mainToolbar(page).getByRole("button", { name: "Bold" })).toHaveCount(0);

    await selectFirstWords(page, 5);
    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    await page.keyboard.press("Alt+F10");
    const bold = floating.getByRole("button", { name: "Bold" });
    await pressUntilFocused(page, "ArrowRight", bold);
    await page.keyboard.press("Enter");

    await expect(bold).toBeFocused();
    await expect(editorText(page).locator("strong")).toHaveText("The s");
  });
});
