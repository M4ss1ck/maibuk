import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// A resting Text Node's Links (issue #716, stage 2): the node's Link entries in
// its Item Menu, and the editing paths that must keep the editor's menu and the
// selection bubble. Pointer activation stays with the Vitest suites.

test.use({ library: "canvasWithNodes" });

const flowNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const textEditor = (page: Page) => page.locator(".react-flow__node-text .ProseMirror");

async function openMap(page: Page) {
  await page.goto("/canvas");
  const grid = page.getByRole("grid", { name: "Canvases" });
  const row = grid.getByRole("row", { name: /Map/ });
  await tabTo(page, grid.getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
}

async function startEditingStorm(page: Page) {
  await tabTo(page, flowNode(page, "text-storm"), { max: 60 });
  await page.keyboard.press("F2");
  await expect(textEditor(page)).toBeFocused();
}

test.describe("Text Node links @wf:canvas-text-node-links", () => {
  test("Shift+F10 on a resting Text Node lists its Link and opens the dialog", async ({ page }) => {
    await openMap(page);
    await tabTo(page, flowNode(page, "text-storm"), { max: 60 });
    await page.keyboard.press("Shift+F10");

    const menu = page.getByRole("menu", { name: "Node actions" });
    await expect(menu).toBeVisible();
    const openLink = menu.getByRole("menuitem", { name: "Open Link" });
    await expect(openLink).toBeVisible();
    // The keyboard gesture never landed on a Link, so it offers the single
    // Link's entry and no Copy URL.
    await expect(menu.getByRole("menuitem", { name: "Copy URL" })).toHaveCount(0);
    await capture(page, "canvas-text-node-menu");

    await pressUntilFocused(page, "ArrowDown", openLink, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Open Link" })).toBeVisible();
  });

  test("Shift+F10 in an editing Text Node opens the editor menu", async ({ page }) => {
    await openMap(page);
    await startEditingStorm(page);

    await page.keyboard.press("Shift+F10");

    await expect(page.getByRole("menu", { name: "Editor options" })).toBeVisible();
    await expect(page.getByRole("menu", { name: "Node actions" })).toHaveCount(0);
    await capture(page, "canvas-text-node-editor-menu");
    await page.keyboard.press("Escape");
    await expect(textEditor(page)).toBeFocused();
  });

  test("selecting text by keyboard in a Text Node shows the formatting bubble", async ({
    page,
  }) => {
    await openMap(page);
    await startEditingStorm(page);

    await page.keyboard.press("Home");
    await page.keyboard.down("Shift");
    for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");

    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
    await capture(page, "canvas-text-node-format-bubble");
  });

  test("Alt+F10 moves focus into the formatting bubble, and Escape returns it to the text", async ({
    page,
  }) => {
    await openMap(page);
    await startEditingStorm(page);

    await page.keyboard.press("Home");
    await page.keyboard.down("Shift");
    for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Shift");

    const bubble = page.getByRole("toolbar", { name: "Selection formatting" });
    const bold = bubble.getByRole("button", { name: "Bold" });
    await expect(bold).toBeVisible();

    await page.keyboard.press("Alt+F10");
    await expect(bold).toBeFocused();

    // The arrows walk the controls without leaving the bubble.
    await page.keyboard.press("ArrowRight");
    await expect(bold).not.toBeFocused();
    await expect(bubble.locator(":focus")).toHaveCount(1);

    // Escape lands back in the text, still editing the node, with the selection
    // the bubble was acting on (so the bubble stays up).
    await page.keyboard.press("Escape");
    await expect(textEditor(page)).toBeFocused();
    await expect(bold).toBeVisible();
  });
});
