import type { Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// A resting Text Node's Links (issue #716, stage 2): keyboard activation, the
// node's Link entries in its Item Menu, and the editing paths that must keep
// the editor's menu and the selection bubble.

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
  test("Enter on a resting Text Node's Link opens its Link dialog", async ({ page }) => {
    await openMap(page);
    const link = page.getByRole("link", { name: "lamp" });

    await tabTo(page, link, { max: 80 });
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Open Link" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("https://example.com/lamp")).toBeVisible();
    // The browser never navigated away from the Canvas.
    await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

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
  });
});
