import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { SEED_CHAPTERS } from "../support/seed/names";
import { expect, test } from "../support/test";

// The editor Commands a Canvas Text Node and a Quick Note share with the
// Chapter editor (issue #717): Find and Replace docked to each surface's own
// viewport and the Link dialog from the text. The pointers, and the Commands
// that reach a page rather than a bar, stay with the Vitest suites.

test.use({ library: "canvasWithNodes" });

// React Flow's node wrapper carries no accessible name, so a seeded node is
// located by its id; the node's text lives in its `.ProseMirror`.
const flowNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const textEditor = (page: Page) => page.locator(".react-flow__node-text .ProseMirror");
const findField = (page: Page) => page.getByRole("textbox", { name: "Find..." });
const flowPane = (page: Page) => page.locator(".react-flow");
const panel = (page: Page) => page.getByRole("complementary", { name: "Book side panel" });
const panelTab = (page: Page, name: string) => panel(page).getByRole("tab", { name, exact: true });
const quickNote = (page: Page) => page.getByRole("textbox", { name: "Book note" });

/** How far the find bar's field sits from the top of the surface it docks to. */
async function dockedOffset(bar: Locator, surface: Locator): Promise<number> {
  const barBox = await bar.boundingBox();
  const surfaceBox = await surface.boundingBox();
  if (!barBox || !surfaceBox) return Number.POSITIVE_INFINITY;
  return Math.abs(barBox.y - surfaceBox.y);
}

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

/** Enters the seeded Book through the Gallery and opens the Book side panel. */
async function openBookPanel(page: Page) {
  await page.goto("/");
  const card = page.getByRole("grid", { name: "Books" }).getByRole("row");
  await expect(card).toHaveCount(1);
  await page.keyboard.press("1");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: `Text of ${SEED_CHAPTERS[2].title}` })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  const trigger = page.getByRole("button", { name: "Book Notes" });
  // The title bar sits above the Chapter list in document order, so from the
  // Chapter list Shift+Tab walks back into the header.
  await tabTo(page, trigger, { max: 40, backwards: true });
  await page.keyboard.press("Enter");
  await expect(panelTab(page, "Notes")).toBeFocused();
}

test.describe("Text Node editor Commands @wf:canvas-text-node-editor-commands", () => {
  test("@wf:canvas-text-node-editor-commands @sc:canvas.editTextNode @sc:common.find @sc:common.zoomIn Mod+F docks Find and Replace at the top of the Canvas, and Escape returns to the text then leaves the node", async ({
    page,
  }) => {
    await openMap(page);
    await startEditingStorm(page);

    await page.keyboard.press("ControlOrMeta+f");

    const find = findField(page);
    await expect(find).toBeFocused();
    await capture(page, "canvas-text-node-find-bar", { around: [find] });

    // The bar belongs to the Canvas viewport, not to the node: a node sits
    // under the flow's zoom transform, so a bar inside it would scale and move
    // with the node instead of staying at the top of the Canvas.
    await expect.poll(() => dockedOffset(find, flowPane(page))).toBeLessThanOrEqual(40);

    // Zoom with the bar open. The zoom shortcut is suppressed in a text field,
    // so focus steps onto the bar's own first switch, where the Canvas still
    // hears it; the bar must stay where it was while the node moves.
    const viewport = page.locator(".react-flow__viewport");
    const before = (await viewport.getAttribute("style")) ?? "";
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Match Case" })).toBeFocused();
    await page.keyboard.press("Control+=");
    await expect.poll(async () => (await viewport.getAttribute("style")) ?? "").not.toBe(before);
    await expect.poll(() => dockedOffset(find, flowPane(page))).toBeLessThanOrEqual(40);

    await page.keyboard.press("Shift+Tab");
    await expect(find).toBeFocused();
    await page.keyboard.type("watch");
    await expect(page.getByText("1 of 1")).toBeVisible();

    // The first Escape closes the bar and puts the caret back in the node.
    await page.keyboard.press("Escape");
    await expect(find).toHaveCount(0);
    await expect(textEditor(page)).toBeFocused();

    // The second Escape commits the text and leaves the node editing state.
    await page.keyboard.press("Escape");
    await expect(textEditor(page)).toHaveCount(0);
    await expect(flowNode(page, "text-storm")).toContainText("Storm watch");

    await page.reload();
    await expect(flowNode(page, "text-storm")).toContainText("Storm watch");
  });

  test("@wf:canvas-text-node-editor-commands @sc:canvas.editTextNode @sc:editor.insertLink Mod+K opens the Link dialog, and Escape returns to the caret with the node still editing", async ({
    page,
  }) => {
    await openMap(page);
    await startEditingStorm(page);

    // The caret opens at the end of "lamp", the node's Link, so the word
    // selects as a Link and the dialog edits it rather than inserting.
    for (let index = 0; index < 4; index++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("ControlOrMeta+k");

    const dialog = page.getByRole("dialog", { name: /Link/ });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(textEditor(page)).toBeFocused();
    await expect(page.locator(".react-flow__node-text")).toHaveCount(2);
  });
});

test.describe("Quick Note editor Commands @wf:canvas-text-node-editor-commands", () => {
  test.use({ library: "oneBookThreeChapters" });

  test("@wf:canvas-text-node-editor-commands @sc:canvas.editTextNode @sc:common.find Mod+F docks the Find bar at the top of the Quick Note, and Escape returns to the note", async ({
    page,
  }) => {
    await openBookPanel(page);
    await tabTo(page, quickNote(page), { max: 10 });
    await page.keyboard.type("hello world");

    await page.keyboard.press("ControlOrMeta+f");

    const find = findField(page);
    await expect(find).toBeFocused();
    // The bar is the Quick Note's own: the Chapter editor behind it opened none.
    await expect(panel(page).getByRole("textbox", { name: "Find..." })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Find..." })).toHaveCount(1);
    await capture(page, "quick-note-find-bar", { around: [find] });

    // Docked to the Quick Note editor, outside its scrolling area.
    await expect.poll(() => dockedOffset(find, quickNote(page))).toBeLessThanOrEqual(40);

    await page.keyboard.press("Escape");
    await expect(find).toHaveCount(0);
    // The bar owns that Escape: the side panel it docks in stays open.
    await expect(panel(page)).toBeVisible();
    await expect(quickNote(page)).toBeFocused();
  });
});
