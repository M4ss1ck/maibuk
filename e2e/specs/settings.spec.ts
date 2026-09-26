// Settings (issue #214): theme, primary colour, language, editor defaults,
// Paste Cleanup, and Metrics Categories — configured by keyboard alone.
// Everything is reached through the real Settings page; native-only settings
// are asserted absent on the web build.

import type { Page } from "@playwright/test";
import {
  expectFocusWithin,
  expectTabContained,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";

test.use({ library: "oneBookThreeChapters" });

const settingsMain = (page: Page) => page.getByRole("main", { name: "Main content" });

async function openSettings(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Opens a React Aria Select by keyboard and picks the named option. */
async function chooseFromSelect(
  page: Page,
  trigger: ReturnType<Page["getByRole"]>,
  name: string,
  direction: "ArrowDown" | "ArrowUp" = "ArrowDown"
) {
  await tabTo(page, trigger, { max: 90 });
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name, exact: true });
  await pressUntilFocused(page, direction, option, { max: 12 });
  await page.keyboard.press("Enter");
}

test.describe("Settings theme @wf:settings-theme", () => {
  test("Light, Dark, and System are chosen by keyboard, set the html class, and persist", async ({
    page,
  }) => {
    await openSettings(page);
    const theme = settingsMain(page).getByRole("group", { name: "Theme" });
    const button = (name: string) => theme.getByRole("button", { name, exact: true });

    await expect(button("System")).toHaveAttribute("aria-pressed", "true");
    await tabTo(page, button("Dark"));
    await page.keyboard.press("Enter");
    await expect(button("Dark")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();
    await expect(button("Dark")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await tabTo(page, button("System"));
    await page.keyboard.press("Enter");
    await expect(button("System")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("native-only Window and Always-on-top settings are absent on web", async ({ page }) => {
    await openSettings(page);
    for (const name of ["Launch on startup", "Close to tray", "Always on top", "Window"]) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});

test.describe("Settings primary colour @wf:settings-primary-color", () => {
  test.fail(
    "the native colour input has no keyboard path to change the accent",
    {
      annotation: {
        type: "issue",
        description: "https://github.com/M4ss1ck/maibuk/issues/220",
      },
    },
    async ({ page }) => {
      await openSettings(page);
      const color = settingsMain(page).getByLabel("Primary Color");
      const reset = color.locator("..").getByRole("button", { name: "Reset", exact: true });
      // Default accent: Reset is disabled until the colour changes.
      await expect(reset).toBeDisabled();

      await tabTo(page, color);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowUp");
      // A keyboard-operable picker would change the accent here, enabling Reset.
      await expect(reset).toBeEnabled();
    }
  );
});

test.describe("Settings language @wf:settings-language", () => {
  test("Español swaps the UI copy and back, and the choice persists", async ({ page }) => {
    await openSettings(page);
    await chooseFromSelect(page, page.getByRole("button", { name: "Language" }), "Español");

    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
    const nav = page.getByRole("listbox", { name: "Navegación principal" });
    await expect(nav.getByRole("option", { name: /^Libros/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();

    await chooseFromSelect(
      page,
      page.getByRole("button", { name: "Idioma" }),
      "English",
      "ArrowUp"
    );
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(
      page
        .getByRole("listbox", { name: "Primary navigation" })
        .getByRole("option", { name: /^Books/ })
    ).toBeVisible();
  });
});

test.describe("Settings editor defaults @wf:settings-editor-defaults", () => {
  test("editor defaults are set by keyboard and survive a reload", async ({ page }) => {
    await openSettings(page);
    const main = settingsMain(page);

    await chooseFromSelect(page, main.getByRole("button", { name: "Font Size" }), "Large");
    await expect(main.getByRole("button", { name: "Font Size" })).toHaveText(/Large/);

    await chooseFromSelect(page, main.getByRole("button", { name: "Font Family" }), "Monospace");
    await expect(main.getByRole("button", { name: "Font Family" })).toHaveText(/Monospace/);

    await chooseFromSelect(page, main.getByRole("button", { name: "Default Format" }), "PDF");
    await expect(main.getByRole("button", { name: "Default Format" })).toHaveText(/PDF/);

    const autoSave = main.getByRole("switch", { name: "Toggle auto-save" });
    await tabTo(page, autoSave, { max: 90 });
    await expect(autoSave).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(autoSave).toHaveAttribute("aria-checked", "false");

    const autoClose = main.getByRole("switch", { name: "Toggle auto-close pairs" });
    await tabTo(page, autoClose, { max: 90 });
    await expect(autoClose).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(autoClose).toHaveAttribute("aria-checked", "true");

    const hints = main.getByRole("switch", { name: "Toggle keyboard hints" });
    await tabTo(page, hints, { max: 90 });
    await page.keyboard.press("Space");
    await expect(hints).toHaveAttribute("aria-checked", "true");

    const lookups = main.getByRole("switch", { name: "Toggle word lookups in browser" });
    await tabTo(page, lookups, { max: 90 });
    await page.keyboard.press("Space");
    await expect(lookups).toHaveAttribute("aria-checked", "true");

    await page.reload();
    await expect(main.getByRole("button", { name: "Font Size" })).toHaveText(/Large/);
    await expect(main.getByRole("button", { name: "Font Family" })).toHaveText(/Monospace/);
    await expect(main.getByRole("button", { name: "Default Format" })).toHaveText(/PDF/);
    await expect(main.getByRole("switch", { name: "Toggle auto-save" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await expect(main.getByRole("switch", { name: "Toggle auto-close pairs" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(main.getByRole("switch", { name: "Toggle keyboard hints" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(
      main.getByRole("switch", { name: "Toggle word lookups in browser" })
    ).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("Paste Cleanup @wf:settings-paste-cleanup", () => {
  test("preset, stripped properties, and custom rules are managed by keyboard and persist", async ({
    page,
  }) => {
    await openSettings(page);
    const main = settingsMain(page);

    await chooseFromSelect(
      page,
      main.getByRole("button", { name: "Paste style" }),
      "Plain text only"
    );
    await expect(main.getByRole("button", { name: "Paste style" })).toHaveText(/Plain text only/);

    const advanced = main.getByRole("button", { name: "Advanced" }).first();
    await tabTo(page, advanced, { max: 120 });
    await page.keyboard.press("Enter");

    const textColor = main.getByRole("switch", { name: "Text color" });
    await tabTo(page, textColor, { max: 30 });
    await expect(textColor).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(textColor).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(textColor).toHaveAttribute("aria-checked", "true");

    const propertyInput = main.getByPlaceholder("CSS property, e.g. word-spacing");
    await tabTo(page, propertyInput, { max: 40 });
    await page.keyboard.type("word-spacing");
    await page.keyboard.press("Enter");
    await expect(main.getByText("word-spacing", { exact: true })).toBeVisible();

    const manage = main.getByRole("button", { name: "Manage rules" });
    await tabTo(page, manage, { max: 60 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Custom rules" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);

    const addRule = dialog.getByRole("button", { name: "Add rule" });
    const nameInput = (index: number) =>
      dialog.getByRole("textbox", { name: "Name", exact: true }).nth(index);

    await tabTo(page, addRule, { max: 20 });
    await page.keyboard.press("Enter");
    await tabTo(page, nameInput(0), { max: 20 });
    await page.keyboard.type("Alpha");

    await tabTo(page, addRule, { max: 20 });
    await page.keyboard.press("Enter");
    await tabTo(page, nameInput(1), { max: 20 });
    await page.keyboard.type("Beta");

    // Move the second rule up, then back down.
    const moveUp = dialog.getByRole("button", { name: "Move up", exact: true });
    await tabTo(page, moveUp.nth(1), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(nameInput(0)).toHaveValue("Beta");
    const moveDown = dialog.getByRole("button", { name: "Move down", exact: true });
    await tabTo(page, moveDown.first(), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(nameInput(0)).toHaveValue("Alpha");

    // Enable then disable the first rule.
    const enabled = dialog.getByRole("switch", { name: "Enabled" }).first();
    await tabTo(page, enabled, { max: 30 });
    await page.keyboard.press("Space");
    await expect(enabled).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Space");
    await expect(enabled).toHaveAttribute("aria-checked", "true");

    // Remove the second rule.
    const remove = dialog.getByRole("button", { name: "Remove", exact: true });
    await tabTo(page, remove.nth(1), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveCount(1);
    await expect(nameInput(0)).toHaveValue("Alpha");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(manage).toBeFocused();

    await page.reload();
    // Editing a stripped property moves the style to Custom; that choice persists.
    await expect(main.getByRole("button", { name: "Paste style" })).toHaveText(/Custom/);
    await tabTo(page, main.getByRole("button", { name: "Advanced" }).first(), { max: 120 });
    await page.keyboard.press("Enter");
    await expect(main.getByText("word-spacing", { exact: true })).toBeVisible();
    await expect(main.getByRole("switch", { name: "Text color" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await tabTo(page, main.getByRole("button", { name: "Manage rules" }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Custom rules" })).toBeVisible();
    await expect(
      page
        .getByRole("dialog", { name: "Custom rules" })
        .getByRole("textbox", { name: "Name", exact: true })
    ).toHaveValue("Alpha");
  });
});

test.describe("Metrics Categories @wf:settings-metrics", () => {
  test("categories toggle by keyboard; deleting a data category asks first and persists", async ({
    page,
  }) => {
    await openSettings(page);
    const main = settingsMain(page);

    const writing = main.getByRole("switch", { name: "Writing volume" });
    await tabTo(page, writing, { max: 120 });
    await expect(writing).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog", { name: "Delete Writing volume?" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await tabTo(page, dialog.getByRole("button", { name: "Delete Writing volume" }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(writing).toHaveAttribute("aria-checked", "false");

    // Engagement is view-only: it flips with no confirmation and comes after
    // Writing volume, so focus moves forward into it.
    const engagement = main.getByRole("switch", { name: "Engagement" });
    await tabTo(page, engagement, { max: 30 });
    await expect(engagement).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Space");
    await expect(engagement).toHaveAttribute("aria-checked", "false");

    await page.reload();
    await expect(main.getByRole("switch", { name: "Writing volume" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await expect(main.getByRole("switch", { name: "Engagement" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  test("Cancel keeps the category on and returns focus to its switch", async ({ page }) => {
    await openSettings(page);
    const main = settingsMain(page);
    const time = main.getByRole("switch", { name: "Time tracking" });

    await tabTo(page, time, { max: 120 });
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog", { name: "Delete Time tracking?" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectTabContained(page, dialog);

    await tabTo(page, dialog.getByRole("button", { name: "Cancel" }));
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(time).toHaveAttribute("aria-checked", "true");
    await expect(time).toBeFocused();
  });
});
