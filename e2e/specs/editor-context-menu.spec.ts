import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  expectTabContained,
  fieldCaret,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
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
  // Each press carries its own modifier: a held Shift can be released by the
  // engine while the next press is still being dispatched under load, which
  // leaves a shorter selection than the test asked for.
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+ArrowRight");
}

/** The chapter text's HTML, decoration spans included: the bytes a field must not touch. */
const editorHtml = (page: Page) => page.locator(".ProseMirror").first().innerHTML();

test.describe("context menu @wf:editor-context-menu", () => {
  for (const width of [1280, 760]) {
    test(`the menu is positioned beside the editor caret at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openEditor(page);
      await page.keyboard.press("End");
      await page.keyboard.press("Shift+F10");
      const menu = page.getByRole("menu", { name: "Editor options" });
      await expect(menu).toBeVisible();
      await capture(page, `editor-menu-position-${width}`);
      const textBox = await editorText(page).boundingBox();
      expect(textBox).not.toBeNull();
      await expect.poll(async () => (await menu.boundingBox())?.x).toBeGreaterThan(textBox!.x);
      await expect.poll(async () => (await menu.boundingBox())?.y).toBeGreaterThan(textBox!.y);
      const menuBox = await menu.boundingBox();
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(800);
      await page.keyboard.press("Escape");
      await expect(editorText(page)).toBeFocused();
    });
  }

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
    await expect(editorText(page).locator("mark")).toHaveText("The s");
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
    // The open dialog hides the page from assistive technology (aria-hidden),
    // so the text is found with includeHidden while the range stays painted.
    await expect(
      page
        .getByRole("textbox", { name: /^Text of /, includeHidden: true })
        .locator(".selection-kept")
    ).toHaveText("The s");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();
    await expect(editorText(page).locator(".selection-kept")).toHaveCount(0);
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

  test("Align can be added from the List switch and applied from the bubble @sc:editor.alignRight", async ({
    page,
  }) => {
    await openEditor(page);

    await page.keyboard.press("Control+Shift+,");
    const dialog = page.getByRole("dialog", { name: "Customize toolbar" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("radio", { name: "Toolbar" }));
    await pressUntilFocused(page, "ArrowRight", dialog.getByRole("radio", { name: "List" }), {
      max: 3,
    });
    await page.keyboard.press("Space");
    await expect(dialog.getByRole("grid", { name: "Start" })).toBeVisible();

    const alignRow = dialog.getByRole("row", { name: /^Alignment$/ });
    await tabTo(page, dialog.getByRole("row").first());
    await pressUntilFocused(page, "ArrowDown", alignRow, { max: 40 });
    await capture(page, "toolbar-settings-align-row", { around: [alignRow] });
    const addToSelection = alignRow.getByRole("switch", { name: "Show in selection menu" });
    await expect(addToSelection).not.toBeChecked();
    await pressUntilFocused(page, "ArrowRight", addToSelection, { max: 8 });
    await page.keyboard.press("Space");
    await expect(addToSelection).toBeChecked();
    await capture(page, "toolbar-settings-align-enabled", { around: [alignRow] });
    await pressUntilFocused(page, "Tab", dialog.getByRole("button", { name: "Close" }).last(), {
      max: 20,
    });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();

    // A phone-width editor scrolls the bubble instead of letting it spill.
    await page.setViewportSize({ width: 360, height: 800 });
    await selectFirstWords(page, 5);
    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    const box = await floating.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);

    await page.keyboard.press("Alt+F10");
    const alignRight = floating.getByRole("button", { name: "Align Right" });
    await pressUntilFocused(page, "ArrowRight", alignRight, { max: 20 });
    await expect(alignRight).toBeVisible();
    const buttonBox = await alignRight.boundingBox();
    expect(buttonBox!.x).toBeGreaterThanOrEqual(box!.x);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    await page.keyboard.press("Enter");

    await expect(alignRight).toHaveAttribute("aria-pressed", "true");
    await expect(alignRight).toBeFocused();
    await expect(editorText(page).locator("p").first()).toHaveCSS("text-align", "right");
    await capture(page, "selection-toolbar-align-phone", { around: [floating] });
  });
});

// The Selection Toolbar's Font and Line Height fields (#720). Everything here
// is reached and driven by real keys; the phone's tap paths live in
// editor-selection-toolbar-touch.spec.ts, and the Canvas bubble in
// canvas-text-node-links.spec.ts.

const sizeField = (page: Page) => floatingToolbar(page).getByRole("combobox", { name: "Size" });
const familyField = (page: Page) => floatingToolbar(page).getByRole("combobox", { name: "Font" });
const lineHeightField = (page: Page) =>
  floatingToolbar(page).getByRole("combobox", { name: "Line height" });
/** A field's list button: no accessible name, so the field's container holds it. */
const chevronOf = (field: Locator) => field.locator("xpath=..").getByRole("button");

/**
 * The config the List switch builds from the default one: Font inserts before
 * Basic formatting and Line Height lands between Headings and Highlight,
 * because each joins at its own place in the editor toolbar's order.
 */
const comboboxesConfig = {
  start: [
    { kind: "group", id: "font", toolbarVisible: true },
    { kind: "group", id: "basic-marks", toolbarVisible: true },
    { kind: "group", id: "headings", toolbarVisible: true },
    { kind: "group", id: "line-height", toolbarVisible: true },
  ],
  end: [],
  selectionToolbar: ["font", "basic-marks", "headings", "line-height", "highlight", "link-code"],
};

/** The controls after the Size field, in that order: one arrow press per control. */
function controlsAfterSize(page: Page): Locator[] {
  const floating = floatingToolbar(page);
  return [
    familyField(page),
    floating.getByRole("button", { name: "Bold", exact: true }),
    floating.getByRole("button", { name: "Italic", exact: true }),
    floating.getByRole("button", { name: "Underline", exact: true }),
    floating.getByRole("button", { name: "Strikethrough", exact: true }),
    floating.getByRole("button", { name: "Heading 1", exact: true }),
    floating.getByRole("button", { name: "Heading 2", exact: true }),
    floating.getByRole("button", { name: "Heading 3", exact: true }),
    lineHeightField(page),
    floating.getByRole("button", { name: "Highlight", exact: true }),
    floating.getByRole("button", { name: "Highlight options", exact: true }),
    floating.getByRole("button", { name: "Insert Link", exact: true }),
    floating.getByRole("button", { name: "Inline Code", exact: true }),
    floating.getByRole("button", { name: "Code Block", exact: true }),
  ];
}

/** Switches one List row's Show in selection menu from its keyboard path. */
async function showInSelectionMenu(page: Page, row: Locator) {
  const toggle = row.getByRole("switch", { name: "Show in selection menu" });
  await expect(toggle).not.toBeChecked();
  await pressUntilFocused(page, "ArrowRight", toggle, { max: 8 });
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
}

test.describe("selection toolbar fields @wf:editor-selection-toolbar-comboboxes @sc:editor.focusSelectionToolbar", () => {
  test("the List switch adds Font and Line Height, and Alt+F10 lands in the Size field", async ({
    page,
  }) => {
    await openEditor(page);

    await page.keyboard.press("Control+Shift+,");
    const dialog = page.getByRole("dialog", { name: "Customize toolbar" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("radio", { name: "Toolbar" }));
    await pressUntilFocused(page, "ArrowRight", dialog.getByRole("radio", { name: "List" }), {
      max: 3,
    });
    await page.keyboard.press("Space");
    await expect(dialog.getByRole("grid", { name: "Start" })).toBeVisible();

    const fontRow = dialog.getByRole("row", { name: /^Font$/ });
    await tabTo(page, dialog.getByRole("row").first());
    await pressUntilFocused(page, "ArrowDown", fontRow, { max: 40 });
    await showInSelectionMenu(page, fontRow);

    const lineHeightRow = dialog.getByRole("row", { name: /^Line height$/ });
    await pressUntilFocused(page, "ArrowDown", lineHeightRow, { max: 40 });
    await showInSelectionMenu(page, lineHeightRow);

    await pressUntilFocused(page, "Tab", dialog.getByRole("button", { name: "Close" }).last(), {
      max: 20,
    });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(editorText(page)).toBeFocused();

    await selectFirstWords(page, 5);
    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();
    await expect(sizeField(page)).toBeVisible();
    await expect(familyField(page)).toBeVisible();
    await expect(lineHeightField(page)).toBeVisible();
    await capture(page, "selection-toolbar-font-and-line-height", { around: [floating] });

    // Font joins first, so the Command already puts the caret in the Size field.
    await page.keyboard.press("Alt+F10");
    await expect(sizeField(page)).toBeFocused();
    await expect(chevronOf(sizeField(page))).not.toBeFocused();
    await expect(floating).toBeVisible();
  });

  test("one arrow per control crosses the bubble and never stops on a chevron", async ({
    page,
  }) => {
    await openEditor(page, { toolbarConfig: comboboxesConfig });
    await selectFirstWords(page, 5);
    const floating = floatingToolbar(page);
    await expect(floating).toBeVisible();

    await page.keyboard.press("Alt+F10");
    await expect(sizeField(page)).toBeFocused();

    // The bubble's buttons are the twelve controls plus one chevron per field:
    // the walk visits the controls only, one press each, and no chevron.
    const fields = await floating.getByRole("combobox").count();
    const buttons = await floating.getByRole("button").count();
    expect(fields).toBe(3);
    expect(buttons).toBe(15);

    const stops = controlsAfterSize(page);
    expect(stops.length).toBe(14);
    for (const stop of stops) {
      await page.keyboard.press("ArrowRight");
      await expect(stop).toBeFocused();
    }
    // The last control has nowhere further right to go.
    await page.keyboard.press("ArrowRight");
    await expect(stops[stops.length - 1]).toBeFocused();

    // A field is one press in and one press out, both ways: Left walks the same
    // fourteen stops back to the Size field.
    for (let press = 0; press < stops.length; press++) await page.keyboard.press("ArrowLeft");
    await expect(sizeField(page)).toBeFocused();
    await expect(chevronOf(sizeField(page))).not.toBeFocused();
  });

  test("Home, End and Left move a field's caret and never leave it", async ({ page }) => {
    await openEditor(page, { toolbarConfig: comboboxesConfig });
    await selectFirstWords(page, 5);
    await expect(floatingToolbar(page)).toBeVisible();
    await page.keyboard.press("Alt+F10");
    await expect(sizeField(page)).toBeFocused();
    await expect(sizeField(page)).toHaveValue("18");

    // The field owns Home and End: focus stays and the caret moves.
    await page.keyboard.press("End");
    expect(await fieldCaret(sizeField(page))).toEqual({ start: 2, end: 2 });
    await expect(sizeField(page)).toBeFocused();
    await page.keyboard.press("Home");
    expect(await fieldCaret(sizeField(page))).toEqual({ start: 0, end: 0 });
    await expect(sizeField(page)).toBeFocused();

    // Right walks into the family field, leaving the caret past its last
    // character, and the next Right walks out of it in that one press.
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowRight");
    await expect(familyField(page)).toBeFocused();
    const familyLength = (await familyField(page).inputValue()).length;
    expect(await fieldCaret(familyField(page))).toEqual({
      start: familyLength,
      end: familyLength,
    });
    await page.keyboard.press("ArrowRight");
    await expect(
      floatingToolbar(page).getByRole("button", { name: "Bold", exact: true })
    ).toBeFocused();

    // Walking left is symmetric: one press in with the caret at the start, one
    // press out to the field before it.
    await page.keyboard.press("ArrowLeft");
    await expect(familyField(page)).toBeFocused();
    expect(await fieldCaret(familyField(page))).toEqual({ start: 0, end: 0 });
    await page.keyboard.press("ArrowLeft");
    await expect(sizeField(page)).toBeFocused();
    expect(await fieldCaret(sizeField(page))).toEqual({ start: 0, end: 0 });

    // A typed value opens the list; Left moves the caret inside it and the
    // field keeps focus.
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type("24");
    await expect(sizeField(page)).toHaveValue("24");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    expect(await fieldCaret(sizeField(page))).toEqual({ start: 1, end: 1 });
    await expect(sizeField(page)).toBeFocused();
  });

  test("one Escape closes the list and restores the value; the next returns to the text", async ({
    page,
  }) => {
    // Spell check is off so its decorations cannot move between the two reads
    // of the text below.
    await openEditor(page, { spellCheckEnabled: false, toolbarConfig: comboboxesConfig });
    await selectFirstWords(page, 5);
    await expect(floatingToolbar(page)).toBeVisible();
    await page.keyboard.press("Alt+F10");
    await expect(sizeField(page)).toBeFocused();
    const before = await editorHtml(page);

    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type("24");
    await expect(sizeField(page)).toHaveValue("24");
    await expect(page.getByRole("listbox")).toBeVisible();

    // The first Escape is the list's: it closes, the field shows its held value
    // again, focus stays and the text is byte-identical.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(sizeField(page)).toBeFocused();
    await expect(sizeField(page)).toHaveValue("18");
    expect(await editorHtml(page)).toBe(before);

    // The next one is the toolbar's: back to the text with the same selection.
    await page.keyboard.press("Escape");
    await expect(editorText(page)).toBeFocused();
    await page.keyboard.type("X");
    await expect(editorText(page)).toHaveText("Xtorm came in from the west without warning.");
  });

  test("a typed size applies on Enter and keeps focus and the paint", async ({ page }) => {
    // Spell check is off so its decorations cannot move between the two reads
    // of the text below.
    await openEditor(page, { spellCheckEnabled: false, toolbarConfig: comboboxesConfig });
    await selectFirstWords(page, 5);
    await expect(floatingToolbar(page)).toBeVisible();
    await page.keyboard.press("Alt+F10");
    await expect(sizeField(page)).toBeFocused();

    const prose = page.locator(".ProseMirror").first();
    const kept = prose.locator(".selection-kept");
    await expect(kept).toHaveText("The s");

    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.type("24");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(sizeField(page)).toBeFocused();
    const sized = prose.locator('[style*="font-size"]');
    await expect(sized).toHaveText("The s");
    await expect(sized).toHaveAttribute("style", /font-size:\s*24px/);
    // The range stays painted across the commit.
    await expect.poll(async () => (await kept.allTextContents()).join("")).toBe("The s");
    await capture(page, "selection-toolbar-size-applied", { around: [floatingToolbar(page)] });
  });

  test("a Font pick applies from the list and keeps focus in the field", async ({ page }) => {
    await openEditor(page, { toolbarConfig: comboboxesConfig });
    await selectFirstWords(page, 5);
    await expect(floatingToolbar(page)).toBeVisible();
    await page.keyboard.press("Alt+F10");
    await expect(sizeField(page)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(familyField(page)).toBeFocused();
    await expect(familyField(page)).toHaveValue("Literata, serif");

    // Down opens on the held family, the next Down moves to the following one.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(familyField(page)).toBeFocused();
    await expect(familyField(page)).toHaveValue("Inter, sans-serif");
    const styled = editorText(page).locator('[style*="font-family"]');
    await expect(styled).toHaveText("The s");
    await expect(styled).toHaveAttribute("style", /font-family:\s*Inter, sans-serif/);
  });
});
