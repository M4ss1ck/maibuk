import type { Locator, Page } from "@playwright/test";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

// The Canvas editor (issue #210): tools, Text Nodes, Note References, moving
// and connecting nodes, node colors, delete/undo, zoom/lock, Save Status,
// rename/back, and the missing/corrupt paths — all by keyboard alone, over the
// seeded `canvasWithNodes` Library.

test.use({ library: "canvasWithNodes" });

// React Flow's node wrapper exposes a stable `data-testid` (`rf__node-<id>`)
// but carries no accessible name, so a specific seeded node can only be
// located by its id. The type class locates the node sets the same way.
const flowNode = (page: Page, id: string) => page.getByTestId(`rf__node-${id}`);
const nodeBody = (page: Page, id: string) => flowNode(page, id).locator(":scope > div").first();
const textNodes = (page: Page) => page.locator(".react-flow__node-text");
const noteRefs = (page: Page) => page.locator(".react-flow__node-noteRef");

/** Opens a Canvas from the gallery the way an author would: Tab in, arrows, Enter. */
async function openCanvas(page: Page, name: RegExp) {
  await page.goto("/canvas");
  const grid = page.getByRole("grid", { name: "Canvases" });
  const row = grid.getByRole("row", { name });
  await tabTo(page, grid.getByRole("row").first(), { max: 40 });
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowRight", row, { max: 12 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);
}

const openMap = (page: Page) => openCanvas(page, /Map/);

/** Tabs to a node and selects it with Space (React Flow's keyboard select). */
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
  await tabTo(page, edge, { max: 60 });
  await page.waitForTimeout(200);
  await tabTo(page, edge, { max: 5 });
  await expect(edge).toBeFocused();
  await page.keyboard.press(" ");
  return edge;
}

test.describe("tools @wf:canvas-tools @sc:canvas.toolSelect @sc:canvas.toolPen @sc:canvas.toolEraser", () => {
  test("V, P, and E switch the active tool", async ({ page }) => {
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
});

test.describe("adding nodes @wf:canvas-tools @sc:canvas.addTextNode @sc:canvas.addNoteRef", () => {
  test("T adds a Text Node whose editor takes the keys, so letters type text", async ({ page }) => {
    await openMap(page);
    await expect(textNodes(page)).toHaveCount(2);

    await page.keyboard.press("t");
    await expect(textNodes(page)).toHaveCount(3);

    const editor = page.locator(".react-flow__node-text .ProseMirror");
    await expect(editor).toBeFocused();
    // "pen" would switch tools anywhere else; inside the node it is text.
    await page.keyboard.type("pen");
    await expect(editor).toContainText("pen");
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.keyboard.press("Escape");
  });

  test("N opens the note picker and Enter adds a Note Reference", async ({ page }) => {
    await openMap(page);
    await expect(noteRefs(page)).toHaveCount(2);

    await page.keyboard.press("n");
    const dialog = page.getByRole("dialog", { name: "Add note reference" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Search notes…")).toBeFocused();

    await page.keyboard.type("Keeper");
    const option = dialog.getByRole("option", { name: "Keeper's Log" });
    await expect(option).toHaveCount(1);
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(noteRefs(page)).toHaveCount(3);
  });
});

test.describe("Text Node @wf:canvas-text-node @sc:canvas.editTextNode", () => {
  test("T adds a Text Node, typing persists through Escape, and F2 reopens it", async ({
    page,
  }) => {
    await openMap(page);
    // The Canvas shortcuts bind only once the stored doc has loaded; wait for
    // the seeded nodes to render so T is not pressed during the loading state
    // and silently dropped.
    await expect(textNodes(page)).toHaveCount(2);
    await page.keyboard.press("t");
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
});

test.describe("Note Reference @wf:canvas-note-ref @sc:canvas.addNoteRef", () => {
  test("N searches notes and adds a reference that opens its Note", async ({ page }) => {
    await openMap(page);
    // Wait for the loaded Canvas (and its seeded Note References) before the N
    // shortcut, which is unbound until then.
    await expect(noteRefs(page)).toHaveCount(2);
    await page.keyboard.press("n");
    const dialog = page.getByRole("dialog", { name: "Add note reference" });
    // Wait for the picker and its search input to be ready before typing, so
    // the query lands in the input instead of the Canvas.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("Search notes…")).toBeFocused();
    await page.keyboard.type("Keeper");

    const option = dialog.getByRole("option", { name: "Keeper's Log" });
    await expect(option).toHaveCount(1);
    await tabTo(page, option, { max: 5 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(noteRefs(page)).toHaveCount(3);

    // Enter on the seeded reference opens its Note.
    const refLog = flowNode(page, "ref-log");
    await tabTo(page, refLog, { max: 60 });
    await tabTo(page, refLog.getByRole("button", { name: "Open note" }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/[\w-]+$/);
    await expect(page.getByRole("heading", { name: "Keeper's Log", level: 1 })).toBeVisible();
  });

  test("a reference whose Note is gone reads Missing note and cannot open", async ({ page }) => {
    await openMap(page);
    const missing = flowNode(page, "ref-missing");
    await expect(missing).toContainText("Missing note");
    await tabTo(page, missing, { max: 60 });
    await expect(missing.getByRole("button", { name: "Open note" })).toBeDisabled();
  });
});

test.describe("no notes @wf:canvas-note-ref", () => {
  test.use({ library: "empty" });

  test("N on a Canvas with no Notes says there are none", async ({ page }) => {
    await page.goto("/canvas");
    await tabTo(page, page.getByRole("button", { name: "New canvas" }).first(), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);

    await page.keyboard.press("n");
    await expect(page.getByRole("dialog", { name: "Add note reference" })).toBeVisible();
    await expect(page.getByText("No notes available")).toBeVisible();
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

    // Tab moves focus to the next node in the collection.
    const second = flowNode(page, "text-second");
    await tabTo(page, second, { max: 10 });
    await expect(second).toBeFocused();

    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    const moved = await flowNode(page, "text-storm").boundingBox();
    expect(moved?.x ?? 0).toBeGreaterThan(before?.x ?? 0);
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
    await tabTo(page, page.getByRole("button", { name: "New canvas" }).first(), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/canvas\/[\w-]+$/);

    await page.keyboard.press("t");
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

  test("Delete connection removes the Connection", async ({ page }) => {
    await openMap(page);
    await selectEdge(page, /Edge from text-storm/);

    await tabTo(page, page.getByRole("button", { name: "Delete connection" }), { max: 5 });
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

    const transparent = dialog.getByRole("button", {
      name: "Transparent background",
      exact: true,
    });
    await tabTo(page, transparent, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(nodeBody(page, "text-storm")).not.toHaveAttribute("style", /254, 226, 226/);

    // The custom pickers are reachable by keyboard even though the native
    // color chooser itself needs a pointer.
    const custom = dialog.getByLabel("Custom background color");
    await tabTo(page, custom, { max: 20 });
    await expect(custom).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The color change is saved by the debounced Edit Session; reload only
    // once it has landed, as the other persistence specs do.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(nodeBody(page, "text-storm")).not.toHaveAttribute("style", /254, 226, 226/);
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

test.describe("Zoom, fit, and lock @wf:canvas-zoom-fit-lock @sc:canvas.zoomIn @sc:canvas.zoomOut @sc:canvas.fitView @sc:canvas.lock", () => {
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
    await openCanvas(page, /Broken map/);
    await expect(page.getByText("This canvas could not be read")).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: "Replace with empty canvas" }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("This canvas could not be read")).toBeHidden();
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
  });
});
