// Phone placement on a Canvas (@touch): a tap arms Add text node and a tap on
// the pane places it, a tap on the armed button cancels, and a one-finger swipe
// sets the width of a Text Node. Runs only in the `phone` project, driven by touch.
// Pointer placement (mouse click, drag, double-click) is owned by the Vitest
// placement-capture-overlay tests; this spec is the phone path.

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/test";
import { longPress, swipe } from "../support/touch";

test.use({ library: "canvasWithNodes" });

const textNodes = (page: Page) => page.locator(".react-flow__node-text");
const addTextNode = (page: Page) =>
  page.getByRole("button", { name: "Add text node", exact: true });
// The placement overlay covers the pane only while a placement tool is armed,
// and it has no accessible name, so its test id is the one handle on it.
const placementOverlay = (page: Page) => page.getByTestId("canvas-placement-overlay");

async function openMapOnPhone(page: Page): Promise<void> {
  await page.goto("/canvas");
  await page.getByRole("grid", { name: "Canvases" }).getByRole("row", { name: /Map/ }).tap();
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
  await expect(textNodes(page)).toHaveCount(2);
}

async function centerOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`not visible: ${target}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("phone placement @touch @wf:canvas-tools @sc:canvas.addTextNode @sc:canvas.placeArmedTool", () => {
  test("a tap arms Add text node and a tap on the pane places a Text Node there @touch", async ({
    page,
  }) => {
    await openMapOnPhone(page);
    await addTextNode(page).tap();
    await expect(addTextNode(page)).toHaveAttribute("aria-pressed", "true");

    const at = await centerOf(placementOverlay(page));
    await placementOverlay(page).tap();
    await expect(textNodes(page)).toHaveCount(3);
    await expect(addTextNode(page)).toHaveAttribute("aria-pressed", "false");

    // The new node opens in its editor; typing and Escape keep it.
    await page.keyboard.type("Phone");
    await page.keyboard.press("Escape");
    const placed = textNodes(page).filter({ hasText: "Phone" });
    await expect(placed).toHaveCount(1);
    const box = await placed.boundingBox();
    if (!box) throw new Error("placed Text Node is not visible");
    expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(3);
  });

  test("tapping the armed Add text node button again cancels without placing @touch", async ({
    page,
  }) => {
    await openMapOnPhone(page);
    await addTextNode(page).tap();
    await expect(addTextNode(page)).toHaveAttribute("aria-pressed", "true");
    await addTextNode(page).tap();
    await expect(addTextNode(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(textNodes(page)).toHaveCount(2);
  });

  test("a one-finger swipe on the armed pane sets the Text Node's width to the distance swiped @touch", async ({
    page,
  }) => {
    await openMapOnPhone(page);
    await addTextNode(page).tap();
    await expect(addTextNode(page)).toHaveAttribute("aria-pressed", "true");

    // The swipe runs from the pane center to the armed button, which sits in the
    // tool column on the right of the phone: a horizontal travel past the minimum.
    const start = await centerOf(placementOverlay(page));
    const end = await centerOf(addTextNode(page));
    expect(Math.abs(end.x - start.x)).toBeGreaterThan(160);
    await swipe(page, placementOverlay(page), addTextNode(page));

    await expect(textNodes(page)).toHaveCount(3);
    const placed = textNodes(page).filter({ has: page.locator(".ProseMirror") });
    const box = await placed.boundingBox();
    if (!box) throw new Error("swiped Text Node is not visible");
    expect(Math.abs(box.width - Math.abs(end.x - start.x))).toBeLessThanOrEqual(3);
  });
});

// The phone route to a resting Text Node's Item Menu, and through it to its
// Links: a long press on the node, since a phone has no right click.
test.describe("phone Text Node menu @touch @wf:canvas-text-node-links", () => {
  test("a long press opens the node's menu with its Link entry @touch", async ({ page }) => {
    await openMapOnPhone(page);
    const storm = page.getByTestId("rf__node-text-storm");

    await longPress(page, storm);

    const menu = page.getByRole("menu", { name: "Node actions" });
    await expect(menu).toBeVisible();
    // The gesture never landed on a Link, so the menu lists the Link plainly,
    // without the pointer gesture's Copy URL pair.
    const openLink = menu.getByRole("menuitem", { name: "Open Link" });
    await expect(openLink).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy URL" })).toHaveCount(0);

    await openLink.tap();
    await expect(page.getByRole("dialog", { name: "Open Link" })).toBeVisible();
  });
});
