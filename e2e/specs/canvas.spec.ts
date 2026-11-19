import type { Locator, Page } from "@playwright/test";
import {
  expectFocusWithin,
  expectTabContained,
  pressUntilFocused,
  tabTo,
  tabToEither,
} from "../support/keyboard";
import { capture } from "../support/capture";
import { writeClipboard } from "../support/clipboard";
import { dropFiles } from "../support/file-drop";
import { hitAtOwnCenter } from "../support/layout";
import { expect, test } from "../support/test";

// The Canvas editor (issue #210): tools, Text Nodes, Canvas References, Canvas
// Images, moving and connecting nodes, node colors, delete/undo, zoom/lock,
// Save Status, rename/back, and the missing/corrupt paths — all by keyboard
// alone, over the seeded `canvasWithNodes` Library.

test.use({ library: "canvasWithNodes" });

// React Flow's node wrapper exposes a stable `data-testid` (`rf__node-<id>`)
// but carries no accessible name, so a specific seeded node can only be
// located by its id. The type class locates the node sets the same way.
const flowNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const nodeBody = (page: Page, id: string) => flowNode(page, id).locator(":scope > div").first();
const textNodes = (page: Page) => page.locator(".react-flow__node-text");
const references = (page: Page) => page.locator(".react-flow__node-reference");
const imageNodes = (page: Page) => page.locator(".react-flow__node-image");

/** Opens a Canvas from the gallery the way an author would: Tab in, arrows, Enter. */
/**
 * The URL changes while the Canvas is still loading, and its shortcuts bind
 * only once it is ready; the tool toolbar renders at that same moment. A key
 * pressed before it was dropped (WebKit, 1 of 40 runs).
 */
async function expectCanvasReady(page: Page) {
  await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
  await expect(page.getByRole("toolbar", { name: "Tools" })).toBeVisible();
}

// `ready: false` for a Canvas that never loads, which renders no toolbar.
async function openCanvas(page: Page, name: RegExp, { ready = true } = {}) {
  await page.goto("/canvas");
  const grid = page.getByRole("grid", { name: "Canvases" });
  const row = grid.getByRole("row", { name });
  // Tab presses sent before the gallery renders land on an empty body.
  await expect(row).toBeVisible();
  await tabTo(page, grid.getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
  await page.keyboard.press("Enter");
  if (ready) await expectCanvasReady(page);
  else await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
}

const openMap = (page: Page) => openCanvas(page, /Map/);

/** Tabs to a node and selects it with Space (React Flow's keyboard select). */
/** A Book card is taller than the default viewport leaves below it, so the shot grows the page first. */
async function captureTallCard(page: Page, name: string, card: Locator) {
  const viewport = page.viewportSize();
  if (viewport) await page.setViewportSize({ width: viewport.width, height: 1200 });
  await capture(page, name, { around: [card] });
  if (viewport) await page.setViewportSize(viewport);
}

async function selectNode(page: Page, node: Locator) {
  await tabTo(page, node, { max: 60 });
  await page.keyboard.press(" ");
}

/**
 * Tabs to an edge and selects it. React Flow replaces the focused edge wrapper
 * once on the focus render, so a second Tab (a no-op when focus held) lands on
 * the settled element the key press must reach.
 */
async function selectEdge(page: Page, name: string | RegExp) {
  const edge = page.getByRole("group", { name });
  // After a reload, Tab presses sent before the Canvas renders land on an empty body.
  await expect(edge).toBeVisible();
  await tabTo(page, edge, { max: 60 });
  await page.waitForTimeout(200);
  await tabTo(page, edge, { max: 5 });
  await expect(edge).toBeFocused();
  await page.keyboard.press(" ");
  return edge;
}

test.describe("tools @wf:canvas-tools @sc:canvas.toolSelect @sc:canvas.toolPen @sc:canvas.toolEraser", () => {
  test("V, P, and E switch the active tool @palette-entry", async ({ page }) => {
    await openMap(page);
    const select = page.getByRole("button", { name: "Select", exact: true });
    const pen = page.getByRole("button", { name: "Pen", exact: true });
    const eraser = page.getByRole("button", { name: "Eraser", exact: true });
    await expect(select).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("p");
    await expect(pen).toHaveAttribute("aria-pressed", "true");
    await expect(select).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("e");
    await expect(eraser).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.press("v");
    await expect(select).toHaveAttribute("aria-pressed", "true");

    // The floating tool column ends with the Command Palette entry point.
    await capture(page, "palette-entry-canvas-tools");
  });

  test("the tool panel moves focus with the arrow keys", async ({ page }) => {
    await openMap(page);
    const select = page.getByRole("button", { name: "Select", exact: true });
    await tabTo(page, select, { max: 60 });
    await expect(select).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "Pen", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(select).toBeFocused();
  });

  test("the pen color picker accepts a precise keyboard choice", async ({ page }) => {
    await openMap(page);
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    const color = page.getByRole("button", { name: "Pen color" });
    await tabTo(page, color, { max: 60 });
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Pen color" });
    await expectFocusWithin(picker);
    await expectTabContained(page, picker);
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await tabTo(page, hex, { max: 25 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("#123456");
    await page.keyboard.press("Enter");
    await expect(color.locator("span")).toHaveAttribute("style", /18, 52, 86|#123456/i);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(color).toBeFocused();
  });
});

test.describe("adding nodes @wf:canvas-tools @sc:canvas.addTextNode @sc:canvas.addReference @sc:canvas.placeArmedTool", () => {
  test("T arms a Text Node and Enter places it, whose editor takes the keys, so letters type text", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);

    await page.keyboard.press("t");
    await capture(page, "canvas-text-tool-armed");
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("Enter");
    await expect(textNodes(page)).toHaveCount(3);

    const editor = page.locator(".react-flow__node-text .ProseMirror");
    await expect(editor).toBeFocused();
    await capture(page, "canvas-new-text-node");
    // "pen" would switch tools anywhere else; inside the node it is text.
    await page.keyboard.type("pen");
    await expect(editor).toContainText("pen");
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Escape");
  });

  test("N arms a Canvas Reference, Enter opens the picker, and choosing a Note adds it", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);

    await page.keyboard.press("n");
    await expect(references(page)).toHaveCount(2);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
    // The picker opens on its Notes tab, the only source the Canvas has today.
    await expect(dialog.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.keyboard.type("Keeper");
    const option = dialog.getByRole("option", { name: "Keeper's Log" });
    await expect(option).toHaveCount(1);
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(3);
  });

  test("Enter places an armed Text Node at the view's center, and a second one steps 24px away from a taken spot @sc:canvas.placeArmedTool", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);

    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Lumen");
    await page.keyboard.press("Escape");
    await expect(textNodes(page)).toHaveCount(3);

    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Quill");
    await page.keyboard.press("Escape");
    await expect(textNodes(page)).toHaveCount(4);

    const surface = await page.getByRole("main").boundingBox();
    const first = await textNodes(page).filter({ hasText: "Lumen" }).boundingBox();
    const second = await textNodes(page).filter({ hasText: "Quill" }).boundingBox();
    if (!surface || !first || !second) throw new Error("placed Text Nodes are not visible");

    // Placed with its top-left at the center of the view, within 3px.
    expect(Math.abs(first.x - (surface.x + surface.width / 2))).toBeLessThanOrEqual(3);
    expect(Math.abs(first.y - (surface.y + surface.height / 2))).toBeLessThanOrEqual(3);

    // The offset is 24 Canvas units, which is 24 * zoom on screen.
    const viewport = (await page.locator(".react-flow__viewport").getAttribute("style")) ?? "";
    const zoom = Number(/scale\(([\d.]+)\)/.exec(viewport)?.[1] ?? "NaN");
    expect(Number.isFinite(zoom)).toBe(true);
    expect(Math.abs(second.x - first.x - 24 * zoom)).toBeLessThanOrEqual(3);
    expect(Math.abs(second.y - first.y - 24 * zoom)).toBeLessThanOrEqual(3);
  });

  test("Escape cancels an armed Text Node: the tool returns to Select and Enter places nothing @sc:canvas.clearSelection", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);
    const select = page.getByRole("button", { name: "Select", exact: true });
    const addText = page.getByRole("button", { name: "Add text node", exact: true });

    await page.keyboard.press("t");
    await expect(addText).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(addText).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("Enter");
    await expect(textNodes(page)).toHaveCount(2);
  });

  test("L while a Text Node is armed returns the tool to Select and places nothing @sc:canvas.lock", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("t");
    await page.keyboard.press("l");
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Enter");
    await expect(textNodes(page)).toHaveCount(2);
  });

  test("an armed Text Node left empty removes itself, and Control+z does not bring it back @sc:common.undo", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);

    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    await expect(textNodes(page)).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(textNodes(page)).toHaveCount(2);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(textNodes(page)).toHaveCount(2);
  });
});

test.describe("Canvas Image @wf:canvas-image @sc:canvas.addImage @sc:canvas.placeArmedTool", () => {
  // A 96x64 opaque PNG, inline so the URL field needs no network: the dialog
  // fetches it once and embeds the picture as a data URL, like any other URL.
  // Both edges sit well over the 48-unit minimum, so the 10% size steps show.
  const IMAGE_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAaUlEQVR42u3QMQ0AAAgDsHnBDZJQjwNujiZV0FQPhygQJEiQIEGCBAlCkCBBggQJEiQIQYIECRIkSJAgBAkSJEiQIEGCBCFIkCBBggQJEoQgQYIECRIkSBCCBAkSJEiQIEGCECRIkKB/FvlmqTxsqxNeAAAAAElFTkSuQmCC";

  /** Arms Image, Enter places it at the view's center, and the dialog adds a picture there. */
  async function insertImage(page: Page, alt: string) {
    await page.keyboard.press("i");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add image" });
    await expect(dialog).toBeVisible();

    await tabTo(page, dialog.getByRole("textbox", { name: "Image URL" }), { max: 10 });
    await page.keyboard.type(IMAGE_PNG);
    await tabTo(page, dialog.getByRole("textbox", { name: "Alt Text (optional)" }), { max: 5 });
    await page.keyboard.type(alt);

    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
  }

  test("I arms Image, Enter opens the dialog, and a pasted image URL is embedded with its alt text", async ({
    page,
  }) => {
    await openMap(page);
    // The Canvas shortcuts bind only once the stored doc has loaded.
    await expect(textNodes(page)).toHaveCount(2);
    await expect(imageNodes(page)).toHaveCount(0);
    await capture(page, "canvas-image-toolbar");

    await page.keyboard.press("i");
    await expect(page.getByRole("button", { name: "Add image", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Add image" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("textbox", { name: "Image URL" }), { max: 10 });
    await page.keyboard.type(IMAGE_PNG);
    await tabTo(page, dialog.getByRole("textbox", { name: "Alt Text (optional)" }), { max: 5 });
    await page.keyboard.type("A lighthouse");
    await tabTo(page, dialog.getByRole("button", { name: "Insert", exact: true }), { max: 10 });
    await page.keyboard.press("Enter");

    // The URL is fetched once and stored embedded, never hotlinked.
    await expect(dialog).toBeHidden();
    await expect(imageNodes(page)).toHaveCount(1);
    const picture = page.getByRole("img", { name: "A lighthouse" });
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute("src", /^data:image\//);
    await capture(page, "canvas-image-placed");

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("img", { name: "A lighthouse" })).toHaveAttribute(
      "src",
      /^data:image\//
    );
  });

  test("Escape in the image dialog places nothing @sc:canvas.clearSelection", async ({ page }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("i");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add image" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(imageNodes(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("= and - resize a focused Canvas Image, and its menu edits the alt text @sc:canvasNode.imageLarger @sc:canvasNode.imageSmaller @sc:canvasNode.editAltText @sc:canvasNode.replaceImage", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);
    await insertImage(page, "A lighthouse");

    const node = imageNodes(page);
    await expect(node).toHaveCount(1);
    await tabTo(page, node, { max: 60 });
    await expect(node).toBeFocused();

    const width = async () => (await node.boundingBox())?.width ?? 0;
    const placed = await width();
    await page.keyboard.press("=");
    await expect.poll(width).toBeGreaterThan(placed);
    const larger = await width();
    await page.keyboard.press("-");
    await expect.poll(width).toBeLessThan(larger);

    // Shift+F10 opens the focused node's Item Menu, the keyboard route to the
    // actions no Shortcut reaches. A resize re-renders the node, so the node
    // is tabbed to again first (a no-op while it still holds focus).
    await tabTo(page, node, { max: 60 });
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu", { name: "Node actions" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Replace image" })).toBeVisible();

    const editAltText = menu.getByRole("menuitem", { name: "Edit alt text" });
    await pressUntilFocused(page, "ArrowDown", editAltText, { max: 8 });
    await page.keyboard.press("Enter");

    // What a screen reader hears is the alt text the dialog saves.
    const altDialog = page.getByRole("dialog", { name: "Edit alt text" });
    await expect(altDialog).toBeVisible();
    const altField = altDialog.getByRole("textbox", { name: "Alt text" });
    await expect(altField).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("The harbour lamp");
    await page.keyboard.press("Enter");

    await expect(altDialog).toBeHidden();
    await expect(page.getByRole("img", { name: "The harbour lamp" })).toBeVisible();
    await expect(page.getByRole("img", { name: "A lighthouse" })).toHaveCount(0);
  });
});

test.describe("pasting a Canvas Image @wf:canvas-image-paste @chromium-only", () => {
  // WebKit cannot grant the clipboard permission a real paste needs, so this
  // row runs in Chromium only. The clipboard holds a solid 96x60 PNG, drawn in
  // the page by the clipboard helper.
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Ctrl+V places a Canvas Image at the view center, and it persists", async ({ page }) => {
    await openMap(page);
    // The Canvas paste listener binds only once the stored doc has loaded.
    await expect(textNodes(page)).toHaveCount(2);
    await expect(imageNodes(page)).toHaveCount(0);

    await writeClipboard(page, { image: { width: 96, height: 60 } });
    await page.keyboard.press("ControlOrMeta+v");

    // The picture is under the 320-unit fit box, so it keeps its own size, and
    // the zoom-scaled node keeps its landscape shape.
    const pasted = imageNodes(page);
    await expect(pasted).toHaveCount(1);
    const picture = pasted.getByRole("img");
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAttribute("src", /^data:image\//);
    const box = await pasted.boundingBox();
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(96 / 60, 1);
    await capture(page, "canvas-image-pasted");

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expectCanvasReady(page);
    await expect(imageNodes(page)).toHaveCount(1);
    await expect(imageNodes(page).getByRole("img")).toHaveAttribute("src", /^data:image\//);
  });

  test("a picture pasted into a Text Node keeps its own size, at the left", async ({ page }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    const editor = page.locator(".react-flow__node-text .ProseMirror");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Lamp room with a long line of text");
    await page.keyboard.press("Enter");

    await writeClipboard(page, { image: { width: 64, height: 64 } });
    await page.keyboard.press("ControlOrMeta+v");

    const figure = editor.locator("figure.editor-image-figure");
    await expect(figure).toHaveCount(1);
    // A stretched picture would span the node's text width; a 64px one stays
    // well inside it, at any zoom, while editing and once the node rests.
    const node = textNodes(page).last();
    const textWidth = async () => (await node.locator("p").first().boundingBox())?.width ?? 0;
    const pictureWidth = async () => (await node.locator("img").boundingBox())?.width ?? 0;
    expect(await pictureWidth()).toBeLessThan((await textWidth()) / 2);
    await expect(figure).toHaveAttribute("data-alignment", "left");
    await capture(page, "canvas-text-node-image-pasted");

    await page.keyboard.press("Escape");
    await expect(page.locator(".react-flow__node-text .ProseMirror")).toHaveCount(0);
    await expect(node.locator("figure.editor-image-figure")).toHaveClass(/natural-width/);
    expect(await pictureWidth()).toBeLessThan((await textWidth()) / 2);
  });
});

test.describe("dropping Canvas Images @wf:canvas-image-drop", () => {
  test("two image files make two cascaded Canvas Images and the text file is refused", async ({
    page,
  }) => {
    await openMap(page);
    // The drop listener binds only once the stored doc has loaded.
    await expect(textNodes(page)).toHaveCount(2);
    await expect(imageNodes(page)).toHaveCount(0);

    await dropFiles(page.locator(".react-flow__pane"), [
      { name: "a.png", type: "image/png", image: { width: 96, height: 60 } },
      { name: "b.png", type: "image/png", image: { width: 60, height: 96 } },
      { name: "notes.txt", type: "text/plain", text: "hello" },
    ]);

    const dropped = imageNodes(page);
    await expect(dropped).toHaveCount(2);
    const pictures = dropped.getByRole("img");
    await expect(pictures).toHaveCount(2);
    await expect(pictures.first()).toHaveAttribute("src", /^data:image\//);
    await expect(pictures.last()).toHaveAttribute("src", /^data:image\//);

    // The one file that is no image is named in the toast, not dropped silently.
    // A toast lives 2 s, so it is read before the slower box checks.
    await expect(page.getByRole("status").filter({ hasText: /1 file skipped/ })).toBeVisible();

    // Each drop after the first sits one cascade step down and to the right, so
    // a stack of drops stays readable: whichever node is the further right is
    // also the lower one, whatever order the nodes are painted in.
    const boxes = await Promise.all(
      [dropped.nth(0), dropped.nth(1)].map((node) => node.boundingBox())
    );
    const [one, other] = boxes;
    if (one === null || other === null) throw new Error("a dropped Canvas Image has no box");
    const [left, right] = one.x <= other.x ? [one, other] : [other, one];
    expect(right.x).toBeGreaterThan(left.x);
    expect(right.y).toBeGreaterThan(left.y);
    await capture(page, "canvas-image-dropped");

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expectCanvasReady(page);
    await expect(imageNodes(page)).toHaveCount(2);
    await expect(imageNodes(page).getByRole("img").first()).toHaveAttribute("src", /^data:image\//);
  });
});

test.describe("Text Node @wf:canvas-text-node @sc:canvas.editTextNode @sc:canvas.placeArmedTool", () => {
  test("T arms a Text Node, Enter places it, typing persists through Escape, and F2 reopens it", async ({
    page,
  }) => {
    await openMap(page);
    // The Canvas shortcuts bind only once the stored doc has loaded; wait for
    // the seeded nodes to render so T is not pressed during the loading state
    // and silently dropped.
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    await expect(textNodes(page)).toHaveCount(3);

    const editor = page.locator(".react-flow__node-text .ProseMirror");
    await expect(editor).toBeFocused();
    await page.keyboard.type("Fresh idea");
    await page.keyboard.press("Escape");

    // Escape commits and leaves editing; the node stays selected.
    await expect(page.locator(".react-flow__node-text .ProseMirror")).toHaveCount(0);
    await expect(textNodes(page).last()).toContainText("Fresh idea");
    await expect(page.locator(".react-flow__node-text.selected")).toHaveCount(1);

    // F2 re-edits the node that currently has focus.
    await tabTo(page, flowNode(page, "text-storm"), { max: 60 });
    await page.keyboard.press("F2");
    await expect(page.locator(".react-flow__node-text .ProseMirror")).toBeFocused();
    await page.keyboard.type(" again");
    await page.keyboard.press("Escape");

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(textNodes(page)).toHaveCount(3);
    await expect(page.getByText("Fresh idea")).toBeVisible();
  });

  test("clearing a Text Node leaves an empty node in place", async ({ page }) => {
    await openMap(page);
    const storm = flowNode(page, "text-storm");
    await tabTo(page, storm, { max: 60 });
    await page.keyboard.press("F2");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    await expect(textNodes(page)).toHaveCount(2);
    await expect(storm).not.toContainText("Storm watch");
  });

  test("a Text Node that once had text stays when cleared, and shows its placeholder @sc:canvas.editTextNode", async ({
    page,
  }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Draft");
    await page.keyboard.press("Escape");
    await expect(textNodes(page)).toHaveCount(3);

    // Tab to the new node (its id is random, so it is found by its text), then F2.
    await tabTo(page, textNodes(page).filter({ hasText: "Draft" }), { max: 60 });
    await page.keyboard.press("F2");
    await expect(page.locator(".react-flow__node-text .ProseMirror")).toBeFocused();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Escape");

    await expect(textNodes(page)).toHaveCount(3);
    await expect(page.getByText("Type something…", { exact: true })).toBeVisible();
  });
});

test.describe("Canvas Reference @wf:canvas-note-ref @sc:canvas.addReference @sc:canvas.placeArmedTool", () => {
  test("N searches Notes and adds a Canvas Reference that opens its Note", async ({ page }) => {
    await openMap(page);
    // Wait for the loaded Canvas (and its seeded Canvas References) before the
    // N shortcut, which is unbound until then.
    await expect(references(page)).toHaveCount(2);
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    // Wait for the picker and its search input to be ready before typing, so
    // the query lands in the input instead of the Canvas.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
    await page.keyboard.type("Keeper");

    const option = dialog.getByRole("option", { name: "Keeper's Log" });
    await expect(option).toHaveCount(1);
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(3);

    // Enter on the seeded reference opens its Note.
    const refLog = flowNode(page, "ref-log");
    await tabTo(page, refLog, { max: 60 });
    await tabTo(page, refLog.getByRole("button", { name: "Open Keeper's Log" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: "Keeper's Log", level: 1 })).toBeVisible();
  });

  test("Open answers at once and shows the loading state before the editor", async ({ page }) => {
    await openMap(page);
    const refLog = flowNode(page, "ref-log");
    await expect(refLog.getByRole("button", { name: "Open Keeper's Log" })).toBeEnabled();
    await tabTo(page, refLog, { max: 60 });
    await tabTo(page, refLog.getByRole("button", { name: "Open Keeper's Log" }), { max: 5 });

    // Frozen timers hold the read that follows the first paint, so the loading
    // state stays on screen long enough to assert. React's scheduler is not a timer.
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 60_000);
    await page.keyboard.press("Enter");

    const main = page.getByRole("main", { name: "Note editor" });
    await expect(main).toBeVisible();
    await capture(page, "note-opening-from-canvas");
    const loading = page.getByRole("status").filter({ hasText: "Loading note…" });
    await expect(loading).toBeVisible();
    await expect(main.locator(".ProseMirror")).toHaveCount(0);

    // On a phone the loading state takes the screen, as the Note will.
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(loading).toBeVisible();
    await expect(page.locator('[data-focus-pane="notes-sidebar"]')).toBeHidden();
    await capture(page, "note-opening-from-canvas-narrow");
    if (viewport) await page.setViewportSize(viewport);

    await page.clock.resume();
    await expect(page.getByRole("heading", { name: "Keeper's Log", level: 1 })).toBeVisible();
    await expect(loading).toHaveCount(0);
  });

  test("places, opens, and deletes a Canvas Reference to a Note", async ({ page }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);

    // N, Enter, part of the seeded Note's title, then arrows and Enter: one more card.
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog).toBeVisible();
    await capture(page, "canvas-reference-picker", { around: [dialog] });
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
    await page.keyboard.type("Keep");
    const option = dialog.getByRole("option", { name: "Keeper's Log" });
    await expect(option).toHaveCount(1);
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(3);

    // A placed node's id is random, so the new card is the last one in the list.
    const placed = references(page).last();
    await tabTo(page, placed, { max: 60 });
    await tabTo(page, placed.getByRole("button", { name: "Open Keeper's Log" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: "Keeper's Log", level: 1 })).toBeVisible();

    // The Note's back control leads to the Canvas it was opened from.
    await tabTo(page, page.getByRole("button", { name: "Back to Map" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);

    // Space is React Flow's keyboard select, and Delete removes the selection.
    await selectNode(page, placed);
    await page.keyboard.press("Delete");
    await expect(references(page)).toHaveCount(2);
  });

  test("places, connects, moves, opens, and deletes a Canvas Reference to a Book", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);

    // The picker opens on its first tab; the tab list is one arrow away from Books.
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog).toBeVisible();
    const search = dialog.getByPlaceholder("Search…");
    await expect(search).toBeFocused();
    await tabTo(page, dialog.getByRole("tab", { name: "Notes" }), { max: 5 });
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Books" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await capture(page, "canvas-reference-picker-books", { around: [dialog] });

    // The search field is the tab list's previous Tab stop, so Shift+Tab returns to it.
    await tabTo(page, search, { max: 5, backwards: true });
    await expect(search).toBeFocused();
    await page.keyboard.type("Lighthouse");
    const option = dialog.getByRole("option", { name: "The Lighthouse Keeper" });
    await expect(option).toHaveCount(1);
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(3);

    // The placed card draws the Library Book card's face: title and author.
    const placed = references(page).last();
    await expect(placed).toBeVisible();
    await captureTallCard(page, "canvas-reference-book-card", placed);
    await expect(placed).toContainText("The Lighthouse Keeper");
    await expect(placed).toContainText("Ada Marsh");
    const placedId = ((await placed.getAttribute("data-testid")) ?? "").replace("rf__node-", "");
    expect(placedId).not.toBe("");

    // The Connection ports sit just outside the card's edge; nothing may clip them.
    // A tall viewport keeps the Book card's bottom port on screen, where hit-testing works.
    const viewport = page.viewportSize();
    if (viewport) await page.setViewportSize({ width: viewport.width, height: 1200 });
    for (const card of [placed, flowNode(page, "ref-log")]) {
      const ports = card.locator(".react-flow__handle");
      await expect(ports.first()).toBeAttached();
      const hits = await hitAtOwnCenter(ports);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits).toEqual(hits.map(() => true));
    }
    if (viewport) await page.setViewportSize(viewport);

    // Connect the placed card to the seeded Note Reference.
    await selectNode(page, placed);
    await expect(placed).toHaveClass(/selected/);
    const connect = page.getByRole("button", { name: "Connect to…" });
    await tabTo(page, connect, { max: 40 });
    await page.keyboard.press("Enter");
    const connectDialog = page.getByRole("dialog", {
      name: "Connect “The Lighthouse Keeper” to…",
    });
    await expect(connectDialog).toBeVisible();
    await expect(connectDialog.getByPlaceholder("Search this canvas…")).toBeFocused();
    await page.keyboard.type("Keeper");
    await tabTo(page, connectDialog.getByRole("button", { name: "Keeper's Log" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(connectDialog).toBeHidden();
    await expect(
      page.getByRole("group", { name: new RegExp(`^Edge from ${placedId} `) })
    ).toHaveCount(1);

    // Arrow keys move the selected card, as they do for any node.
    await selectNode(page, placed);
    const before = await placed.boundingBox();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await placed.boundingBox())?.x ?? 0)
      .toBeGreaterThan(before?.x ?? 0);

    // Open reaches the Book itself; its back control returns to this Canvas.
    await tabTo(page, placed.getByRole("button", { name: "Open The Lighthouse Keeper" }), {
      max: 5,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(
      page.getByRole("heading", { name: "The Lighthouse Keeper", level: 1 })
    ).toBeVisible();

    const back = page.getByRole("button", { name: "Back to Map" });
    await expect(back).toBeVisible();
    // Tab inside the Chapter text indents; Escape leaves the text first.
    await page.keyboard.press("Escape");
    await tabTo(page, back, { max: 120, backwards: true });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);

    await selectNode(page, placed);
    await page.keyboard.press("Delete");
    await expect(references(page)).toHaveCount(2);
  });

  test("deleting a referenced Book turns its card Missing and keeps it on the Canvas", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);
    const mapUrl = page.url();
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
    await tabTo(page, dialog.getByRole("tab", { name: "Notes" }), { max: 5 });
    await page.keyboard.press("ArrowRight");
    const option = dialog.getByRole("option", { name: "The Lighthouse Keeper" });
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(references(page)).toHaveCount(3);
    const placed = references(page).last();

    await tabTo(page, placed.getByRole("button", { name: "Open The Lighthouse Keeper" }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(page.getByRole("textbox", { name: /^Text of / })).toBeFocused();
    await page.keyboard.press("Escape");
    await tabTo(page, page.getByRole("button", { name: "Book Settings" }), {
      max: 120,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    const settings = page.getByRole("dialog", { name: "Book Settings" });
    await tabTo(page, settings.getByRole("button", { name: "Danger Zone" }));
    await page.keyboard.press("Enter");
    await tabTo(page, settings.getByRole("button", { name: "Delete Book" }));
    await page.keyboard.press("Enter");
    await tabTo(page, settings.getByRole("button", { name: "Yes, delete book" }), {
      backwards: true,
    });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();

    // The card stays where it was, with its stored label, and cannot open.
    await page.goto(mapUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const missing = references(page).last();
    await expect(missing).toContainText("The Lighthouse Keeper");
    await expect(missing).toContainText("This item no longer exists");
    await expect(
      missing.getByRole("button", { name: "Open The Lighthouse Keeper" })
    ).toBeDisabled();
    await captureTallCard(page, "canvas-reference-book-card-missing", missing);
  });

  test("places, connects, moves, opens, and deletes a Canvas Reference to a Chapter", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);

    // The picker opens on Notes; Chapters is two tabs to its right.
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog).toBeVisible();
    const search = dialog.getByPlaceholder("Search…");
    await expect(search).toBeFocused();
    await tabTo(page, dialog.getByRole("tab", { name: "Notes" }), { max: 5 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Chapters" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await capture(page, "canvas-reference-picker-chapters", { around: [dialog] });

    // The seeded Book's Chapters in order: Arrival, then The Lamp. Arrival is
    // not the Chapter the Book opens on by default (the last), so landing on it proves the deep link.
    const options = dialog.getByRole("option");
    await expect(options).toHaveCount(2);
    await tabTo(page, options.first(), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(3);

    // The placed card draws the Chapter: its title, its Book, its preview, its time.
    const placed = references(page).last();
    await expect(placed).toBeVisible();
    await capture(page, "canvas-reference-chapter-card", { around: [placed] });
    await expect(placed).toContainText("Arrival");
    await expect(placed).toContainText("The Lighthouse Keeper");
    const placedId = ((await placed.getAttribute("data-testid")) ?? "").replace("rf__node-", "");
    expect(placedId).not.toBe("");

    // Connect the placed card to the seeded Note Reference.
    await selectNode(page, placed);
    await expect(placed).toHaveClass(/selected/);
    const connect = page.getByRole("button", { name: "Connect to…" });
    await tabTo(page, connect, { max: 40 });
    await page.keyboard.press("Enter");
    const connectDialog = page.getByRole("dialog", { name: "Connect “Arrival” to…" });
    await expect(connectDialog).toBeVisible();
    await expect(connectDialog.getByPlaceholder("Search this canvas…")).toBeFocused();
    await page.keyboard.type("Keeper");
    await tabTo(page, connectDialog.getByRole("button", { name: "Keeper's Log" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(connectDialog).toBeHidden();
    await expect(
      page.getByRole("group", { name: new RegExp(`^Edge from ${placedId} `) })
    ).toHaveCount(1);

    // Arrow keys move the selected card, as they do for any node.
    await selectNode(page, placed);
    const before = await placed.boundingBox();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await placed.boundingBox())?.x ?? 0)
      .toBeGreaterThan(before?.x ?? 0);

    // Open reaches the Chapter at its Book, not the Book's first Chapter.
    await tabTo(page, placed.getByRole("button", { name: "Open Arrival" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    const chapterGrid = page.getByRole("grid", { name: "Chapters" });
    await expect(page.getByRole("textbox", { name: "Text of Arrival" })).toBeVisible();
    await expect(chapterGrid.getByRole("row", { name: "Arrival" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(chapterGrid.getByRole("row", { name: "The Lamp" })).toHaveAttribute(
      "aria-selected",
      "false"
    );

    // Its back control returns to this Canvas.
    const back = page.getByRole("button", { name: "Back to Map" });
    await expect(back).toBeVisible();
    // Tab inside the Chapter text indents; Escape leaves the text first.
    await page.keyboard.press("Escape");
    await tabTo(page, back, { max: 120, backwards: true });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);

    await selectNode(page, placed);
    await page.keyboard.press("Delete");
    await expect(references(page)).toHaveCount(2);
  });

  test("deleting a referenced Chapter turns its card Missing and keeps it on the Canvas", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);
    const mapUrl = page.url();
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
    await tabTo(page, dialog.getByRole("tab", { name: "Notes" }), { max: 5 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const options = dialog.getByRole("option");
    await expect(options).toHaveCount(2);
    await tabTo(page, options.first(), { max: 5 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(references(page)).toHaveCount(3);
    const placed = references(page).last();

    await tabTo(page, placed.getByRole("button", { name: "Open The Lamp" }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/book\/[\w-]+$/);
    await expect(page.getByRole("textbox", { name: "Text of The Lamp" })).toBeVisible();

    // Leave the text for the Chapter list, then delete The Lamp from its row.
    await page.keyboard.press("Escape");
    await expectFocusWithin(page.getByRole("complementary", { name: "Chapter list" }));
    const chapterGrid = page.getByRole("grid", { name: "Chapters" });
    const lamp = chapterGrid.getByRole("row", { name: "The Lamp" });
    await tabTo(page, chapterGrid.getByRole("row", { selected: true }));
    await pressUntilFocused(
      page,
      "ArrowRight",
      lamp.getByRole("button", { name: "Delete Chapter" }),
      { max: 6 }
    );
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "No", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(lamp).toHaveCount(0);

    // The card stays where it was, with its stored label, and cannot open.
    await page.goto(mapUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const missing = references(page).last();
    await expect(missing).toContainText("The Lamp");
    await expect(missing).toContainText("This item no longer exists");
    await expect(missing.getByRole("button", { name: "Open The Lamp" })).toBeDisabled();
    await capture(page, "canvas-reference-chapter-card-missing", { around: [missing] });
  });

  test("places, connects, moves, opens, and deletes a Canvas Reference to a Canvas", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);

    // The picker opens on Notes; Canvases is the last tab, three to its right.
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog).toBeVisible();
    const search = dialog.getByPlaceholder("Search…");
    await expect(search).toBeFocused();
    await tabTo(page, dialog.getByRole("tab", { name: "Notes" }), { max: 5 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Canvases" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await capture(page, "canvas-reference-picker-canvases", { around: [dialog] });

    // A Canvas is never its own target: Map is missing, the other two are listed.
    const options = dialog.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(dialog.getByRole("option", { name: "Map", exact: true })).toHaveCount(0);
    const ideasOption = dialog.getByRole("option", { name: "Ideas", exact: true });
    await expect(ideasOption).toHaveCount(1);
    await tabTo(page, ideasOption, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(3);

    // The placed card draws the Gallery Canvas card's face: title and counts.
    const placed = references(page).last();
    await expect(placed).toBeVisible();
    await expect(placed).toContainText("Ideas");
    await expect(placed).toContainText("0 nodes");
    await expect(placed).toContainText("0 connections");
    await capture(page, "canvas-reference-canvas-card", { around: [placed] });
    const placedId = ((await placed.getAttribute("data-testid")) ?? "").replace("rf__node-", "");
    expect(placedId).not.toBe("");

    // Connect the placed card to the seeded Note Reference.
    await selectNode(page, placed);
    await expect(placed).toHaveClass(/selected/);
    const connect = page.getByRole("button", { name: "Connect to…" });
    await tabTo(page, connect, { max: 40 });
    await page.keyboard.press("Enter");
    const connectDialog = page.getByRole("dialog", { name: "Connect “Ideas” to…" });
    await expect(connectDialog).toBeVisible();
    await expect(connectDialog.getByPlaceholder("Search this canvas…")).toBeFocused();
    await page.keyboard.type("Keeper");
    await tabTo(page, connectDialog.getByRole("button", { name: "Keeper's Log" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(connectDialog).toBeHidden();
    await expect(
      page.getByRole("group", { name: new RegExp(`^Edge from ${placedId} `) })
    ).toHaveCount(1);

    // Arrow keys move the selected card, as they do for any node.
    await selectNode(page, placed);
    const before = await placed.boundingBox();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await placed.boundingBox())?.x ?? 0)
      .toBeGreaterThan(before?.x ?? 0);

    // Open reaches the referenced Canvas; its back control names this one.
    await tabTo(page, placed.getByRole("button", { name: "Open Ideas" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);
    await expect(page.getByRole("textbox", { name: "Rename canvas" })).toHaveValue("Ideas");

    const back = page.getByRole("button", { name: "Back to Map" });
    await expect(back).toBeVisible();
    // The target Canvas opened with nothing focused, so its header sits either
    // side of focus; the helper tries forward, then back.
    await tabToEither(page, back, { max: 60 });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);

    await selectNode(page, placed);
    await page.keyboard.press("Delete");
    await expect(references(page)).toHaveCount(2);
  });

  test("deleting a referenced Canvas turns its card Missing and keeps it on the Canvas", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);
    const mapUrl = page.url();
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();
    await tabTo(page, dialog.getByRole("tab", { name: "Notes" }), { max: 5 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const ideasOption = dialog.getByRole("option", { name: "Ideas", exact: true });
    await expect(ideasOption).toHaveCount(1);
    await tabTo(page, ideasOption, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(references(page)).toHaveCount(3);
    await expect(references(page).last()).toContainText("Ideas");
    // The placement is written before the page loads the Gallery afresh.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // Delete the Ideas Canvas from the Gallery, as its own card would.
    await page.goto("/canvas");
    const grid = page.getByRole("grid", { name: "Canvases" });
    const ideas = grid.getByRole("row", { name: /Ideas/ });
    // Tab presses sent before the gallery renders land on an empty body.
    await expect(ideas).toBeVisible();
    await tabTo(page, grid.getByRole("row").first(), { max: 40 });
    await page.keyboard.press("Home");
    await pressUntilFocused(page, "ArrowRight", ideas, { max: 12 });
    await tabTo(page, ideas.getByRole("button", { name: "Delete canvas" }), { max: 6 });
    await page.keyboard.press("Enter");
    // The card now holds its confirm buttons; Tab re-enters the grid on it.
    await tabTo(page, ideas, { max: 60 });
    await tabTo(page, ideas.getByRole("button", { name: "Delete canvas", exact: true }), {
      max: 6,
    });
    await page.keyboard.press("Enter");
    await expect(ideas).toHaveCount(0);

    // The card stays where it was, with its stored label, and cannot open.
    await page.goto(mapUrl);
    await expectCanvasReady(page);
    await expect(references(page)).toHaveCount(3);
    const missing = references(page).last();
    await expect(missing).toContainText("Ideas");
    await expect(missing).toContainText("This item no longer exists");
    await expect(missing.getByRole("button", { name: "Open Ideas" })).toBeDisabled();
    await capture(page, "canvas-reference-canvas-card-missing", { around: [missing] });
  });

  test("Escape on the reference picker after an armed Canvas Reference places nothing", async ({
    page,
  }) => {
    await openMap(page);
    await expect(references(page)).toHaveCount(2);
    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog.getByPlaceholder("Search…")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(references(page)).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("a reference whose Note is gone shows This item no longer exists and cannot open", async ({
    page,
  }) => {
    await openMap(page);
    const missing = flowNode(page, "ref-missing");
    const present = flowNode(page, "ref-log");
    await expect(present).toContainText("Keeper's Log");
    await capture(page, "canvas-reference-cards", { around: [present, missing] });
    // The card keeps the label it was stored with — none, so "Untitled".
    await expect(missing).toContainText("Untitled");
    await expect(missing).toContainText("This item no longer exists");
    await tabTo(page, missing, { max: 60 });
    await expect(missing.getByRole("button", { name: "Open Untitled" })).toBeDisabled();
  });
});

test.describe("no notes @wf:canvas-note-ref", () => {
  test.use({ library: "empty" });

  test("N on a Canvas with no Notes says there are none", async ({ page }) => {
    await page.goto("/canvas");
    const newCanvas = page.getByRole("button", { name: "New canvas" }).first();
    await expect(newCanvas).toBeVisible();
    await tabTo(page, newCanvas, { max: 40 });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);

    await page.keyboard.press("n");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add reference" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(dialog.getByText("Nothing to show")).toBeVisible();
  });
});

test.describe("selecting and moving @wf:canvas-node-select-move", () => {
  test("Space selects a node and the arrow keys move it, persisting the position", async ({
    page,
  }) => {
    await openMap(page);
    const storm = flowNode(page, "text-storm");
    await selectNode(page, storm);
    await expect(storm).toHaveClass(/selected/);
    await expect(page.getByRole("button", { name: "Connect to…" })).toBeVisible();

    const before = await storm.boundingBox();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await storm.boundingBox())?.x ?? 0)
      .toBeGreaterThan(before?.x ?? 0);

    // Tab moves focus to the next node in the collection. The storm node holds
    // a Link, which is no Tab stop at rest, so one Tab passes it (#729).
    const second = flowNode(page, "text-second");
    await page.keyboard.press("Tab");
    await expect(second).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(storm).toBeFocused();

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    const moved = await flowNode(page, "text-storm").boundingBox();
    expect(moved?.x ?? 0).toBeGreaterThan(before?.x ?? 0);
  });

  test("Escape clears the node selection and Alt+ArrowLeft returns to the gallery @sc:canvas.clearSelection @sc:canvas.backToGallery", async ({
    page,
  }) => {
    await openMap(page);
    const storm = flowNode(page, "text-storm");
    await selectNode(page, storm);
    await expect(storm).toHaveClass(/selected/);
    await expect(page.getByRole("button", { name: "Connect to…" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(storm).not.toHaveClass(/selected/);
    await expect(page.getByRole("button", { name: "Connect to…" })).toHaveCount(0);

    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page).toHaveURL(/\/canvas$/);
    await expect(page.getByRole("heading", { name: "Canvas", level: 1 })).toBeVisible();
  });
});

test.describe("Connect to @wf:canvas-connect", () => {
  test("the dialog searches targets and Enter creates a Connection; Esc restores focus", async ({
    page,
  }) => {
    await openMap(page);
    const second = flowNode(page, "text-second");
    await selectNode(page, second);

    const connect = page.getByRole("button", { name: "Connect to…" });
    await tabTo(page, connect, { max: 40 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Connect “Second idea” to…" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Search this canvas…")).toBeFocused();
    await page.keyboard.type("Keeper");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(connect).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.type("Keeper");
    await tabTo(page, dialog.getByRole("button", { name: "Keeper's Log" }), { max: 5 });
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("group", { name: /Edge from text-second/ })).toHaveCount(1);
  });
});

test.describe("no connect targets @wf:canvas-connect", () => {
  test.use({ library: "empty" });

  test("the dialog says there is nothing else on the canvas", async ({ page }) => {
    await page.goto("/canvas");
    const newCanvas = page.getByRole("button", { name: "New canvas" }).first();
    await expect(newCanvas).toBeVisible();
    await tabTo(page, newCanvas, { max: 40 });
    await page.keyboard.press("Enter");
    await expectCanvasReady(page);

    // One Text Node with text, so it stays and is the selected node to connect from.
    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Lone");
    await page.keyboard.press("Escape");

    const connect = page.getByRole("button", { name: "Connect to…" });
    await tabTo(page, connect, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Nothing else on this canvas to connect to")).toBeVisible();
  });
});

test.describe("Connection inspector @wf:canvas-edge-inspector", () => {
  test("selecting a Connection opens its inspector; caption, direction, and Esc work", async ({
    page,
  }) => {
    await openMap(page);
    await selectEdge(page, "Edge from text-storm to text-second");
    await capture(page, "canvas-connection-inspector");

    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeFocused();

    const label = page.getByLabel("Connection label");
    await tabTo(page, label, { max: 5 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("flows to");
    await page.keyboard.press("Enter");
    await expect(label).toHaveValue("flows to");

    const directed = page.getByRole("switch", { name: "Directed connection" });
    await tabTo(page, directed, { max: 5 });
    await page.keyboard.press(" ");
    await expect(directed).toBeChecked();

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await selectEdge(page, "Edge from text-storm to text-second");
    await expect(page.getByLabel("Connection label")).toHaveValue("flows to");
    await expect(page.getByRole("switch", { name: "Directed connection" })).toBeChecked();

    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Connection label")).toBeHidden();
  });

  test("color, thickness, and line style are set by keyboard and persist", async ({ page }) => {
    await openMap(page);
    const edgeName = "Edge from text-storm to text-second";
    await selectEdge(page, edgeName);
    // The drawn line has no role or name; React Flow's path class inside the
    // named Connection is the only handle on the color, width, and dashes it shows.
    const edgePath = () =>
      page.getByRole("group", { name: edgeName }).locator(".react-flow__edge-path");
    const path = edgePath();

    const color = page.getByRole("button", { name: "Connection color" });
    await tabTo(page, color, { max: 10 });
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Connection color" });
    await expectFocusWithin(picker);
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await tabTo(page, hex, { max: 25 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("#10B981");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(color).toBeFocused();
    await expect(path).toHaveAttribute("style", /stroke: (#10b981|rgb\(16, 185, 129\))/i);

    const thin = page.getByRole("radio", { name: "Thin" });
    await tabTo(page, thin, { max: 10 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Thick", exact: true })).toBeChecked();
    await expect(path).toHaveAttribute("style", /stroke-width: 4/);

    const solid = page.getByRole("radio", { name: "Solid" });
    await tabTo(page, solid, { max: 10 });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Dashed" })).toBeChecked();
    await capture(page, "canvas-connection-styled");
    await expect(path).toHaveAttribute("style", /stroke-dasharray: 16(px)?,? 12/);

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await selectEdge(page, edgeName);
    await expect(page.getByRole("radio", { name: "Thick", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Dashed" })).toBeChecked();
    await expect(edgePath()).toHaveAttribute("style", /stroke-width: 4/);
    await expect(edgePath()).toHaveAttribute("style", /stroke: (#10b981|rgb\(16, 185, 129\))/i);
  });

  test("Delete connection removes the Connection", async ({ page }) => {
    await openMap(page);
    await selectEdge(page, /Edge from text-storm/);

    await tabTo(page, page.getByRole("button", { name: "Delete connection" }), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: /Edge from text-storm/ })).toHaveCount(0);
  });
});

test.describe("Node colors @wf:canvas-node-colors", () => {
  test("the color panel sets a color pair, then transparent, and Esc closes it", async ({
    page,
  }) => {
    await openMap(page);
    const storm = flowNode(page, "text-storm");
    await selectNode(page, storm);

    const colors = page.getByRole("button", { name: "Node colors", exact: true });
    await tabTo(page, colors, { max: 40 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Node colors" });
    await expect(dialog).toBeVisible();

    const rose = dialog.getByRole("button", { name: "Color combination: Rose", exact: true });
    await tabTo(page, rose, { max: 10 });
    await page.keyboard.press("Enter");
    await expect(nodeBody(page, "text-storm")).toHaveAttribute("style", /254, 226, 226/);

    const textColor = dialog.getByRole("button", { name: "Custom text color" });
    await tabTo(page, textColor, { max: 20 });
    await page.keyboard.press("Enter");
    const textPicker = page.getByRole("dialog", { name: "Custom text color" });
    await expectFocusWithin(textPicker);
    await expectTabContained(page, textPicker);
    const textHex = textPicker.getByRole("textbox", { name: "Hex color" });
    await tabTo(page, textHex, { max: 25 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("#FEE2E2");
    await page.keyboard.press("Enter");
    await expect(textPicker.getByRole("status")).toContainText("low contrast");
    await page.keyboard.press("Escape");
    await expect(textPicker).toBeHidden();
    await expect(textColor).toBeFocused();

    const transparent = dialog.getByRole("button", {
      name: "Transparent background",
      exact: true,
    });
    await tabTo(page, transparent, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(nodeBody(page, "text-storm")).not.toHaveAttribute("style", /254, 226, 226/);

    const custom = dialog.getByRole("button", { name: "Custom background color" });
    await tabTo(page, custom, { max: 20 });
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Custom background color" });
    await expectFocusWithin(picker);
    await expectTabContained(page, picker);
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await tabTo(page, hex, { max: 25 });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("#123456");
    await page.keyboard.press("Enter");
    await expect(nodeBody(page, "text-storm")).toHaveAttribute("style", /18, 52, 86/);
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(custom).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(colors).toBeFocused();

    // The color change is saved by the debounced Edit Session; reload only
    // once it has landed, as the other persistence specs do.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(nodeBody(page, "text-storm")).toHaveAttribute("style", /18, 52, 86/);
  });
});

test.describe("Delete and undo @wf:canvas-delete-undo", () => {
  test("Delete removes the selection, and undo/redo bring it back and forth", async ({ page }) => {
    await openMap(page);
    const second = flowNode(page, "text-second");
    await selectNode(page, second);
    await page.keyboard.press("Delete");
    await expect(second).toHaveCount(0);

    await tabTo(page, page.getByRole("button", { name: "Undo" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(second).toHaveCount(1);

    await tabTo(page, page.getByRole("button", { name: "Redo" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(second).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect(second).toHaveCount(1);
    await page.keyboard.press("Control+Shift+z");
    await expect(second).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(flowNode(page, "text-second")).toHaveCount(1);
  });
});

test.describe("Zoom, fit, and lock @wf:canvas-zoom-fit-lock @sc:common.zoomIn @sc:common.zoomOut @sc:canvas.fitView @sc:canvas.lock", () => {
  test("Mod+=, Mod+-, Shift+1, and L work and the viewport persists", async ({ page }) => {
    await openMap(page);
    const viewport = page.locator(".react-flow__viewport");
    const before = (await viewport.getAttribute("style")) ?? "";

    await page.keyboard.press("Control+=");
    await expect.poll(async () => (await viewport.getAttribute("style")) ?? "").not.toBe(before);

    await page.keyboard.press("Control+-");
    await page.keyboard.press("Shift+1");

    // The lock button is renamed when it toggles, so assert each state's name.
    await page.keyboard.press("l");
    await expect(
      page.getByRole("button", { name: "Unlock interactivity", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("l");
    await expect(
      page.getByRole("button", { name: "Lock interactivity", exact: true })
    ).toHaveAttribute("aria-pressed", "false");

    const zoomed = (await viewport.getAttribute("style")) ?? "";
    await page.reload();
    await expect(page.locator(".react-flow__viewport")).toHaveAttribute("style", zoomed);
  });

  // PR evidence for the WebKit pan fix (issue #553): the watermark must look
  // the same at rest and after the viewport moves. A pointer pan is not
  // expressible in a spec (the keyboard contract forbids `page.mouse`), so the
  // capture moves the viewport with the zoom shortcuts — which change both the
  // zoom and the translation — while the pan frame path itself is measured by
  // `pnpm bench:frames --scenario canvas` and pinned by
  // CanvasBackground.test.tsx. `capture` is a no-op unless E2E_CAPTURE_DIR is
  // set (scripts/pr-screenshots.sh).
  test("the watermark follows a viewport change unchanged", async ({ page }) => {
    await openMap(page);
    await capture(page, "canvas-watermark-default");

    const viewport = page.locator(".react-flow__viewport");
    const before = (await viewport.getAttribute("style")) ?? "";
    await page.keyboard.press("Control+=");
    await page.keyboard.press("Control+=");
    await expect.poll(async () => (await viewport.getAttribute("style")) ?? "").not.toBe(before);
    await capture(page, "canvas-watermark-zoomed");
  });
});

test.describe("Save Status @wf:canvas-save-status", () => {
  test("a canvas edit reads Unsaved changes and then Saved", async ({ page }) => {
    await openMap(page);
    // The header's Save Status is the only role=status span; the sr-only
    // canvas-title live region is also role=status.
    const status = page.locator("header span[role=status]");
    await expect(status).toHaveText("Saved");

    const storm = flowNode(page, "text-storm");
    await selectNode(page, storm);
    await page.keyboard.press("ArrowRight");

    await expect(status).toHaveText("Unsaved changes");
    await expect(status).toHaveText("Saved");
  });
});

test.describe("Rename and back @wf:canvas-rename-back", () => {
  test("the header renames the Canvas and Back returns to the gallery", async ({ page }) => {
    await openMap(page);
    const title = page.getByRole("textbox", { name: "Rename canvas" });
    await tabTo(page, title, { max: 40 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Chart");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chart");

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Rename canvas" })).toHaveValue("Chart");

    await tabTo(page, page.getByRole("button", { name: "Back to canvas gallery" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas$/);
    await expect(
      page.getByRole("grid", { name: "Canvases" }).getByRole("row", { name: /Chart/ })
    ).toHaveCount(1);
  });
});

test.describe("Missing and unreadable Canvas @wf:canvas-missing", () => {
  test("an unknown Canvas URL offers only the way back", async ({ page }) => {
    await page.goto("/canvas/does-not-exist");
    await expect(page.getByText("Canvas not found")).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "Back to canvas gallery" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas$/);
  });

  test("a Canvas that cannot be read can be replaced with an empty one", async ({ page }) => {
    await openCanvas(page, /Broken map/, { ready: false });
    await expect(page.getByText("This canvas could not be read")).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "Replace with empty canvas" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("This canvas could not be read")).toBeHidden();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
  });
});
