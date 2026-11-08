// Host-rendered Plugin UI (issue #438): the remote-ui fixture Plugin draws a
// page through the SDK's Worker Remote UI entry, and Maibuk renders the tree
// with its own React Aria controls. Keyboard only: typing into the Plugin's
// text field stays host-owned, its button runs from the keyboard, its color
// picker opens from the keyboard, commits a swatch, and dismisses with Escape
// back to its trigger, and a declaration the UI kit never carries stops the
// Plugin with the remote-ui-limit copy. Each matrix edge gets its own test.

import type { Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  expectTabContained,
  isFocusWithin,
  pressUntilFocused,
  tabTo,
} from "../support/keyboard";
import { expect, test } from "../support/test";

const PAGE_TITLE = "UI fixture";
const PLUGIN_HEADING = "Remote UI fixture";

const navOption = (page: Page, name: string) =>
  page.getByRole("listbox", { name: "Primary navigation" }).getByRole("option", {
    name: new RegExp(`^${name}`),
  });

/** Opens the fixture's page the way an author reaches it (Tab, ArrowDown, Enter). */
async function openPanel(page: Page): Promise<void> {
  await page.goto("/");
  // The Plugin is scanned after the first render; its sidebar entry appears then.
  await expect(navOption(page, PAGE_TITLE)).toBeVisible({ timeout: 15_000 });
  await tabTo(page, navOption(page, "Books"));
  await pressUntilFocused(page, "ArrowDown", navOption(page, PAGE_TITLE), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plugin\/remote-ui\/panel$/);
  await expect(page.getByRole("heading", { name: PAGE_TITLE, level: 1 })).toBeVisible();
}

/**
 * Tabs into the picker's preset list. The list is one Tab stop whose entry
 * option is the selected one, so the spec steps in without naming it.
 */
async function tabToPresets(page: Page, presets: Locator): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (await isFocusWithin(presets)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab never reached the picker's preset colors");
}

test.describe("Host-rendered Plugin UI @wf:plugins-remote-ui", () => {
  test.use({ plugins: ["remote-ui"] });

  test("the Plugin page renders the tree its Worker sends", async ({ page }) => {
    await openPanel(page);
    // The Plugin's own Heading and controls, drawn through the host kit.
    await expect(page.getByRole("heading", { name: PLUGIN_HEADING })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Break" })).toBeVisible();
    await capture(page, "plugin-page-open");
  });

  test("a Plugin text field keeps focus and typing on the host", async ({ page }) => {
    await openPanel(page);
    const field = page.getByRole("textbox", { name: "Search" });
    await expect(field).toBeVisible({ timeout: 15_000 });

    await tabTo(page, field);
    await page.keyboard.type("echo");

    // The host owns the value and the focus; the Plugin's echo does not steal it.
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("echo");
    await expect(page.getByText("Searching: echo")).toBeVisible();
    await capture(page, "plugin-page-typed");
  });

  test("a Plugin button runs its handler from the keyboard", async ({ page }) => {
    await openPanel(page);
    const run = page.getByRole("button", { name: "Run" });
    await expect(run).toBeVisible({ timeout: 15_000 });

    await tabTo(page, run);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Runs: 2")).toBeVisible();
  });

  test("the color picker opens from the keyboard, commits a swatch, and the Plugin receives the color", async ({
    page,
  }) => {
    await openPanel(page);
    const trigger = page.getByRole("button", { name: "Accent" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    // The Plugin's own value, echoed before any pick.
    await expect(page.getByText("Accent: #3B82F6")).toBeVisible();
    await capture(page, "plugin-color-picker-panel");

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Accent" });
    await expect(picker).toBeVisible();
    await expectFocusWithin(picker);
    await expectTabContained(page, picker);
    await capture(page, "plugin-color-picker-open");

    // The dialog starts on the Plugin's own value; arrows move between presets.
    const presets = picker.getByRole("listbox", { name: "Preset colors" });
    await tabToPresets(page, presets);
    await pressUntilFocused(
      page,
      "ArrowRight",
      presets.getByRole("option", { name: "Preset color #EF4444" }),
      { max: 4 }
    );
    await page.keyboard.press("Enter");

    // The host committed the swatch and handed the Plugin its hex.
    await expect(page.getByText("Accent: #EF4444")).toBeVisible();
  });

  test("the color picker closes with Escape and returns focus to its trigger", async ({ page }) => {
    await openPanel(page);
    const trigger = page.getByRole("button", { name: "Accent" });
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Accent" });
    await expect(picker).toBeVisible();
    await expectFocusWithin(picker);

    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // A cancelled pick commits nothing: the Plugin still echoes its own value.
    await expect(page.getByText("Accent: #3B82F6")).toBeVisible();
  });

  test("a declaration outside the kit stops the Plugin", async ({ page }) => {
    await openPanel(page);
    const breakButton = page.getByRole("button", { name: "Break" });
    await expect(breakButton).toBeVisible({ timeout: 15_000 });

    await tabTo(page, breakButton);
    await page.keyboard.press("Enter");

    // The host refuses the unknown element and stops the Plugin with its copy
    // (plugins.stopped.remoteUiLimit names the Plugin's manifest).
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "declared an interface Maibuk could not accept and was stopped." })
    ).toBeVisible();
    // The stopped Plugin's tree is gone; the page's own heading stays.
    await expect(page.getByRole("heading", { name: PLUGIN_HEADING })).toHaveCount(0);
  });
});
