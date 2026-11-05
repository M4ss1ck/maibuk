// The Selection Toolbar's Font and Line Height fields by finger (#720). The
// keyboard path lives in editor-context-menu.spec.ts; a tap on a field, its
// chevron and an item applies, while a tap away drops a half-typed value.
// Runs only in the `phone` project.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

/** Font joins before Basic formatting and Line Height follows it. */
const comboboxesConfig = {
  start: [
    { kind: "group", id: "font", toolbarVisible: true },
    { kind: "group", id: "basic-marks", toolbarVisible: true },
    { kind: "group", id: "line-height", toolbarVisible: true },
  ],
  end: [],
  selectionToolbar: ["font", "basic-marks", "line-height", "highlight", "link-code"],
};

const floatingToolbar = (page: Page) => page.getByRole("toolbar", { name: "Selection formatting" });
const sizeField = (page: Page) => floatingToolbar(page).getByRole("combobox", { name: "Size" });
const lineHeightField = (page: Page) =>
  floatingToolbar(page).getByRole("combobox", { name: "Line height" });
// The chevron leaves the accessibility tree while its list is open, so the
// field's own container is the handle on it.
const chevronOf = (field: Locator) => field.locator("xpath=..").locator("button");
const editorText = (page: Page) => page.getByRole("textbox", { name: /^Text of / });
const editorHtml = (page: Page) => page.locator(".ProseMirror").first().innerHTML();

async function openStormOnPhone(page: Page) {
  await seedSettings(page, {
    toolbarExpanded: false,
    toolbarConfig: comboboxesConfig,
    spellCheckEnabled: false,
  });
  await page.goto("/");
  await page.getByRole("row", { name: "The Lighthouse Keeper" }).tap();
  await expect(editorText(page)).toContainText("The storm came in from the west without warning.");
  await editorText(page).tap();
  // Home stops at the start of the wrapped line on a phone; the chapter start
  // is the document start.
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(floatingToolbar(page)).toBeVisible();
}

test.describe("phone selection toolbar fields @touch @wf:editor-selection-toolbar-comboboxes", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("tapping a field, its chevron and an item applies to the selection @touch", async ({
    page,
  }) => {
    await openStormOnPhone(page);
    const kept = page.locator(".ProseMirror").first().locator(".selection-kept");
    const floating = floatingToolbar(page);

    await sizeField(page).tap();
    await expect(sizeField(page)).toBeFocused();
    await expect(floating).toBeVisible();
    await expect(kept).toHaveText("The s");

    // A tap on the field opens its list on touch; the chevron closes and opens
    // it again, so both controls are exercised before the pick.
    await expect(sizeField(page)).toHaveAttribute("aria-expanded", "true");
    await chevronOf(sizeField(page)).tap();
    await expect(sizeField(page)).toHaveAttribute("aria-expanded", "false");
    await chevronOf(sizeField(page)).tap();
    await expect(sizeField(page)).toHaveAttribute("aria-expanded", "true");

    const listbox = page.getByRole("listbox", { includeHidden: true });
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: "24", exact: true, includeHidden: true }).tap();

    await expect(page.getByRole("listbox", { includeHidden: true })).toBeHidden();
    await expect(editorText(page)).toBeFocused();
    const sized = editorText(page).locator('[style*="font-size"]');
    await expect(sized).toHaveText("The s");
    await expect(sized).toHaveAttribute("style", /font-size:\s*24px/);
    await expect(floating).toBeVisible();
  });

  test("the bubble scrolls sideways to reach Line Height @touch", async ({ page }) => {
    await openStormOnPhone(page);
    const field = lineHeightField(page);

    // The bubble is wider than the phone: Line Height starts out of view and a
    // tap on it scrolls the control into reach.
    const viewport = page.viewportSize();
    const before = await field.boundingBox();
    expect(before).not.toBeNull();
    expect(before!.x + before!.width).toBeGreaterThan(viewport!.width);
    await field.tap();
    await expect(field).toBeInViewport({ ratio: 1 });
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-expanded", "true");

    const listbox = page.getByRole("listbox", { includeHidden: true });
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: "1.5", exact: true, includeHidden: true }).tap();

    await expect(page.getByRole("listbox", { includeHidden: true })).toBeHidden();
    // Line height belongs to the paragraph the selection sits in.
    const styled = editorText(page).locator('p[style*="line-height"]');
    await expect(styled).toHaveAttribute("style", /line-height:\s*1\.5/);
    await expect(editorText(page)).toBeFocused();
    await capture(page, "selection-toolbar-line-height-phone", {
      around: [floatingToolbar(page)],
    });
  });

  test("tapping away from a half-typed value leaves the text unchanged @touch", async ({
    page,
  }) => {
    await openStormOnPhone(page);
    const before = await editorHtml(page);

    await sizeField(page).tap();
    await expect(sizeField(page)).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("9");
    await expect(sizeField(page)).toHaveValue("9");

    // The open list marks the rest of the page aria-hidden, so the editor is
    // reached by its own handle rather than by its accessible name.
    await page.getByRole("textbox", { name: /^Text of /, includeHidden: true }).tap();

    expect(await editorHtml(page)).toBe(before);
    expect(await editorHtml(page)).not.toContain("font-size");
    await expect(editorText(page)).toBeFocused();
  });
});

test.describe("phone Canvas text bubble fields @touch @wf:editor-selection-toolbar-comboboxes", () => {
  test.use({ library: "canvasWithNodes" });

  const textEditor = (page: Page) => page.locator(".react-flow__node-text .ProseMirror");
  const stormNode = (page: Page) => page.getByTestId("rf__node-text-storm");
  const bubble = (page: Page) => page.getByRole("toolbar", { name: "Selection formatting" });

  async function openMapOnPhone(page: Page) {
    await seedSettings(page, { toolbarConfig: comboboxesConfig });
    await page.goto("/canvas");
    await page.getByRole("grid", { name: "Canvases" }).getByRole("row", { name: /Map/ }).tap();
    await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
  }

  async function editStorm(page: Page) {
    await stormNode(page).tap();
    await page.keyboard.press("F2");
    await expect(textEditor(page)).toBeFocused();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
    await expect(bubble(page)).toBeVisible();
  }

  test("a list tap keeps the bubble and applies the value in a Text Node @touch", async ({
    page,
  }) => {
    await openMapOnPhone(page);
    await editStorm(page);

    const size = bubble(page).getByRole("combobox", { name: "Size" });
    await chevronOf(size).tap();
    await expect(size).toHaveAttribute("aria-expanded", "true");
    const listbox = page.getByRole("listbox", { includeHidden: true });
    await expect(listbox).toBeVisible();
    await listbox.getByRole("option", { name: "24", exact: true, includeHidden: true }).tap();

    // The node keeps editing: its bubble stays up and the selection is styled.
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(bubble(page)).toBeVisible();
    const sized = textEditor(page).locator('[style*="font-size"]');
    await expect(sized).toHaveText("Storm");
    await expect(sized).toHaveAttribute("style", /font-size:\s*24px/);
  });

  test("typing then tapping the canvas keeps the Text Node's text @touch", async ({ page }) => {
    await openMapOnPhone(page);
    await editStorm(page);

    // Replace the node's text, then reach for its Size field with the text
    // still uncommitted; the tap on the empty canvas must commit it.
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Canvas edit");
    await bubble(page).getByRole("combobox", { name: "Size" }).tap();
    await expect(bubble(page).getByRole("combobox", { name: "Size" })).toBeFocused();

    await page.locator(".react-flow__pane").tap({
      position: { x: 8, y: 8 },
    });
    await expect(bubble(page)).toBeHidden();

    await stormNode(page).tap();
    await page.keyboard.press("F2");
    await expect(textEditor(page)).toContainText("Canvas edit");
    await page.keyboard.press("Escape");
  });
});
