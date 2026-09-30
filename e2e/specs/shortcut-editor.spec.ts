// Shortcut Editor (issue #233): every Command can take the author's own
// Shortcuts, recorded by keyboard alone. Opened from Settings and from the
// shortcut help; Custom Shortcuts stay on this device (ADR 0012).

import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  expectTabContained,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

const editorDialog = (page: Page) => page.getByRole("dialog", { name: "Customize shortcuts" });
const commandRow = (page: Page, name: string) =>
  editorDialog(page).getByRole("row", { name, exact: true });

async function openFromSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const open = page.getByRole("button", { name: "Customize shortcuts" });
  await tabTo(page, open, { max: 90 });
  await page.keyboard.press("Enter");
  await expect(editorDialog(page)).toBeVisible();
  await expectFocusWithin(editorDialog(page));
  return open;
}

/** Filters the list to one Command and puts focus on its row. */
async function focusCommand(page: Page, name: string): Promise<Locator> {
  await tabTo(page, editorDialog(page).getByRole("searchbox"));
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(name);
  const row = commandRow(page, name);
  await tabTo(page, row);
  return row;
}

/** From a focused row, moves right to one of its controls and presses it. */
async function pressRowControl(page: Page, row: Locator, name: RegExp) {
  await pressUntilFocused(page, "ArrowRight", row.getByRole("button", { name }), { max: 8 });
  await page.keyboard.press("Enter");
}

const recorder = (page: Page) =>
  editorDialog(page).getByRole("textbox", { name: /Press the new shortcut/ });

async function closeEditor(page: Page) {
  await page.keyboard.press("Escape");
  await expect(editorDialog(page)).toBeHidden();
}

/** The startup route remembers Settings, so return through the keyboard navigation. */
async function goToBooks(page: Page) {
  const nav = page.getByRole("listbox", { name: "Primary navigation" });
  await tabTo(page, nav.getByRole("option", { name: /^Books/ }), { max: 100 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
}

test.describe("Shortcut Editor @wf:shortcut-editor", () => {
  test("opens from Settings with focus inside, keeps Tab inside, and Escape returns to the button", async ({
    page,
  }) => {
    const open = await openFromSettings(page);
    await expect(editorDialog(page).getByText("Common", { exact: true })).toBeVisible();
    await capture(page, "shortcut-editor-open");
    await expectTabContained(page, editorDialog(page));

    await closeEditor(page);
    await expect(open).toBeFocused();
  });

  test("lists the Focus Commands with their fixed keys", async ({ page }) => {
    await openFromSettings(page);
    const search = editorDialog(page).getByRole("searchbox");
    await tabTo(page, search);
    await page.keyboard.type("press t");
    const row = commandRow(page, "Press Tab");
    await expect(row).toBeVisible();
    await expect(row.getByText("Tab", { exact: true })).toBeVisible();
    await capture(page, "shortcut-editor-focus-section", {
      around: [editorDialog(page).getByRole("grid")],
    });
  });

  test("keeps the current section's header pinned to the top of the list while scrolling", async ({
    page,
  }) => {
    await openFromSettings(page);
    const dialog = editorDialog(page);
    const grid = dialog.getByRole("grid");
    await tabTo(page, commandRow(page, "Save"));
    // End moves focus to the last Command and scrolls deep into the Focus section, the last one.
    await page.keyboard.press("End");
    await expect(grid.getByRole("row").last()).toBeFocused();

    const header = dialog.getByRole("row", { name: "Focus", exact: true });
    // toBeInViewport's IntersectionObserver misreports inside the Virtualizer's
    // `contain: size` wrappers, so the position is measured against the grid.
    await expect(header).toBeVisible();
    const gridBox = await grid.boundingBox();
    const headerBox = await header.boundingBox();
    // The header's own padding box sits a border's width below the grid's edge.
    expect(Math.abs((headerBox?.y ?? 0) - (gridBox?.y ?? 0))).toBeLessThan(12);
    await capture(page, "shortcut-editor-sticky-section", { around: [grid] });

    // Arrowing up past the top edge scrolls the focused row in below the header.
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
    const focused = grid.locator("[role=row]:focus");
    await expect(focused).toBeVisible();
    // The Virtualizer re-lays out after the scroll, so wait for the row to settle.
    await expect
      .poll(async () => {
        const pinned = await header.boundingBox();
        const row = await focused.boundingBox();
        return (row?.y ?? 0) - ((pinned?.y ?? 0) + (pinned?.height ?? 0));
      })
      .toBeGreaterThanOrEqual(-1);
  });

  test("opens from the shortcut help's Customize button @sc:global.showHelp", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await tabTo(page, help.getByRole("button", { name: "Customize shortcuts" }));
    await page.keyboard.press("Enter");

    await expect(help).toBeHidden();
    await expect(editorDialog(page)).toBeVisible();
    await expectFocusWithin(editorDialog(page));
    await expectTabContained(page, editorDialog(page));
    await closeEditor(page);
    await expect(help).toBeVisible();
    await expectFocusWithin(help);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });

  test("records a new key for a Command; the new key works and the old one no longer does", async ({
    page,
  }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Show shortcuts help");
    await pressRowControl(page, row, /^Change \? for Show shortcuts help/);
    await expect(recorder(page)).toBeFocused();
    await page.keyboard.press("Alt+k");
    await page.keyboard.press("Enter");
    await expect(row).toContainText("K");
    await expect(page.getByRole("status").filter({ hasText: "Show shortcuts help" })).toHaveText(
      /Show shortcuts help: Alt\+K/
    );
    await capture(page, "shortcut-editor-recorded", { around: [row] });
    await closeEditor(page);

    await goToBooks(page);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await page.keyboard.press("Alt+k");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Device-local, and it survives a reload (ADR 0012).
    await page.reload();
    await expect(page.getByRole("heading", { name: "My Books", level: 1 })).toBeVisible();
    await page.keyboard.press("Alt+k");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });

  test("records a two-key sequence and runs it", async ({ page }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Go to Metrics");
    await pressRowControl(page, row, /^Change G M for Go to Metrics/);
    await page.keyboard.press("g");
    await page.keyboard.press("x");
    await closeEditor(page);

    await goToBooks(page);
    await page.keyboard.press("g");
    await page.keyboard.press("x");
    await expect(page).toHaveURL(/\/metrics$/);
  });

  test("Escape cancels recording without binding Escape or closing the editor", async ({
    page,
  }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Show shortcuts help");
    await pressRowControl(page, row, /^Change \?/);
    await page.keyboard.press("Escape");

    await expect(recorder(page)).toHaveCount(0);
    await expect(editorDialog(page)).toBeVisible();
    await expect(
      row.getByRole("button", { name: /^Change \? for Show shortcuts help/ })
    ).toBeFocused();
  });

  test("gives a Command a key that has none, and runs it on its screen", async ({ page }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Create note");
    await expect(row).toContainText("No shortcut");
    await pressRowControl(page, row, /^Add a shortcut to Create note/);
    await page.keyboard.press("Alt+j");
    await page.keyboard.press("Enter");
    await closeEditor(page);

    await page.goto("/ephemeral");
    await expect(page.getByRole("heading", { name: "Ephemeral", level: 1 })).toBeVisible();
    const editorText = page.getByRole("textbox", { name: "Text", exact: true });
    await tabTo(page, editorText, { max: 50 });
    await page.keyboard.type("A note from Ephemeral");
    await expect(page.getByText("4 words", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Create note" })).toBeFocused();
    await page.keyboard.press("Alt+j");
    await expect(page).toHaveURL(/\/notes\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Untitled note", level: 1 })).toBeVisible();
  });

  test("asks before taking a key from another Command; Replace moves only that key", async ({
    page,
  }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Cycle theme");
    await pressRowControl(page, row, /^Change G T for Cycle theme/);
    await page.keyboard.press("?");
    await page.keyboard.press("Enter");

    const alert = editorDialog(page).getByRole("alert");
    await expect(alert).toContainText("? is already used by Show shortcuts help");
    const replace = alert.getByRole("button", { name: "Replace" });
    await expect(replace).toBeFocused();
    await capture(page, "shortcut-editor-conflict", { around: [row] });
    await page.keyboard.press("Enter");

    await focusCommand(page, "Show shortcuts help");
    await expect(commandRow(page, "Show shortcuts help")).toContainText("No shortcut");
  });

  test("blocks a Fixed key and keeps recording", async ({ page }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Cycle theme");
    await pressRowControl(page, row, /^Change G T/);
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("Enter");

    await expect(recorder(page)).toBeFocused();
    await expect(
      editorDialog(page)
        .getByText(/is Undo and cannot be reassigned/)
        .first()
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Reset restores one Command; Reset all asks first and restores every one", async ({
    page,
  }) => {
    await openFromSettings(page);
    let row = await focusCommand(page, "Show shortcuts help");
    await pressRowControl(page, row, /^Remove \? from Show shortcuts help/);
    await expect(row).toContainText("No shortcut");
    await pressRowControl(page, row, /^Reset Show shortcuts help/);
    await expect(row).toContainText("?");

    row = await focusCommand(page, "Cycle theme");
    await pressRowControl(page, row, /^Remove G T from Cycle theme/);
    const resetAll = editorDialog(page).getByRole("button", { name: "Reset all shortcuts" });
    await tabTo(page, resetAll, { max: 40, backwards: true });
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: "Reset all shortcuts?" });
    await expect(confirm).toBeVisible();
    await expectFocusWithin(confirm);
    await tabTo(page, confirm.getByRole("button", { name: "Reset all shortcuts" }));
    await page.keyboard.press("Enter");
    await expect(confirm).toBeHidden();

    await focusCommand(page, "Cycle theme");
    await expect(commandRow(page, "Cycle theme")).toContainText("G");
  });

  test("turns single-key Shortcuts off", async ({ page }) => {
    await openFromSettings(page);
    const toggle = editorDialog(page).getByRole("switch", { name: "Single-key shortcuts" });
    await tabTo(page, toggle);
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();
    await closeEditor(page);

    await goToBooks(page);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });

  test("saves Custom Shortcuts to a file and loads them back after a reset", async ({ page }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Show shortcuts help");
    await pressRowControl(page, row, /^Change \?/);
    await page.keyboard.press("Alt+k");
    await page.keyboard.press("Enter");

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Save to file" }), {
      max: 40,
      backwards: true,
    });
    const download = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const file = await download;
    expect(file.suggestedFilename()).toBe("maibuk-shortcuts.json");
    const path = await file.path();
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved).toMatchObject({ app: "maibuk", kind: "shortcuts", version: 2 });
    expect(saved.custom["global.showHelp"]).toEqual([["Alt+k"]]);

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Reset all shortcuts" }));
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: "Reset all shortcuts?" });
    await tabTo(page, confirm.getByRole("button", { name: "Reset all shortcuts" }));
    await page.keyboard.press("Enter");

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Load from file" }), {
      backwards: true,
    });
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles(path);
    const preview = page.getByRole("dialog", { name: "Load shortcuts from file" });
    await expect(preview).toBeVisible();
    await expectFocusWithin(preview);
    await tabTo(page, preview.getByRole("button", { name: "Replace my shortcuts" }));
    await page.keyboard.press("Enter");

    await focusCommand(page, "Show shortcuts help");
    await expect(commandRow(page, "Show shortcuts help")).toContainText("K");
  });

  test("rejects an invalid Shortcut File without changing existing keys", async ({ page }) => {
    await openFromSettings(page);
    const row = await focusCommand(page, "Show shortcuts help");
    await pressRowControl(page, row, /^Change \?/);
    await page.keyboard.press("Alt+k");
    await page.keyboard.press("Enter");

    await tabTo(page, editorDialog(page).getByRole("button", { name: "Load from file" }), {
      backwards: true,
    });
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({
      name: "invalid-shortcuts.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ app: "maibuk", kind: "shortcuts", version: 1 })),
    });

    await expect(page.getByText("This file is not a Maibuk shortcut file.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Load shortcuts from file" })).toHaveCount(0);
    await focusCommand(page, "Show shortcuts help");
    await expect(commandRow(page, "Show shortcuts help")).toContainText("K");
  });

  test("previews a conflicting Shortcut File and drops the later key", async ({ page }) => {
    await openFromSettings(page);
    await tabTo(page, editorDialog(page).getByRole("button", { name: "Load from file" }), {
      max: 40,
      backwards: true,
    });
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({
      name: "conflicting-shortcuts.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          app: "maibuk",
          kind: "shortcuts",
          version: 1,
          custom: {
            "global.gotoProjects": [["Alt+k"]],
            "global.gotoNotes": [["Alt+k"]],
          },
        })
      ),
    });

    const preview = page.getByRole("dialog", { name: "Load shortcuts from file" });
    await expect(preview).toContainText("Go to Notes: Alt+k is already used");
    await tabTo(page, preview.getByRole("button", { name: "Replace my shortcuts" }));
    await page.keyboard.press("Enter");
    await expect(preview).toBeHidden();
    await focusCommand(page, "Go to Books");
    await expect(commandRow(page, "Go to Books")).toContainText("K");
    await focusCommand(page, "Go to Notes");
    await expect(commandRow(page, "Go to Notes")).toContainText("G");
  });
});

test.describe("Shortcut Editor at phone width @wf:shortcut-editor", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits a phone-width screen: every header control and a row's keys stay on screen", async ({
    page,
  }) => {
    await openFromSettings(page);
    const dialog = editorDialog(page);
    const row = commandRow(page, "Save");
    await expect(row).toBeVisible();
    await capture(page, "shortcut-editor-narrow");

    for (const control of [
      // The switch role sits on a visually hidden input, and its screen-reader name
      // comes first in the DOM; the visible label beside it is what must fit.
      dialog.getByText("Single-key shortcuts", { exact: true }).last(),
      dialog.getByRole("button", { name: "Save to file" }),
      dialog.getByRole("searchbox"),
      row.getByRole("button", { name: /^Change/ }).first(),
    ]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await expectTabContained(page, dialog);
  });
});
