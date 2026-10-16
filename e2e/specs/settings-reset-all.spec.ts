// Reset settings (issue #442): the app-wide Reset that returns settings,
// Custom Shortcuts, Plugin approvals, and saved Plugin credentials to their
// shipped defaults, driven from Settings > Advanced by keyboard alone. The spec
// proves Escape cancels without changing anything, and that a confirm clears an
// approved third-party Plugin's approval: the Plugin needs review again and
// stops (its contributed surfaces are gone), while a changed setting returns to
// its default.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

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

const ROW_NAME = "Approvals Fixture";
/** The fixture reports that its Worker ran through a toast naming the Plugin. */
const ran = (page: Page) =>
  page.getByRole("status").filter({ hasText: "approvals fixture running" });
/** The Development mode switch: a changed setting the reset must return to default. */
const devMode = (page: Page) => page.getByRole("switch", { name: "Development mode" });
const pluginRow = (page: Page) => page.getByRole("button", { name: ROW_NAME, exact: true });
/** The Plugin card's enable switch, whose state the reset changes. */
const enableSwitch = (page: Page) =>
  page.getByRole("switch", { name: `Enable ${ROW_NAME}`, exact: true });

/** Jumps to the Plugins section through the Settings outline, leaving its heading focused. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // Instant section jumps: the jump animates otherwise.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  // The outline is the page's last focusable region: Shift+Tab reaches it.
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await expectFocusWithin(tree);
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/** Expands the Plugin's row and leaves its toggle button focused. */
async function expandPluginRow(page: Page): Promise<Locator> {
  const row = pluginRow(page);
  await tabTo(page, row, { max: 30 });
  await page.keyboard.press("Enter");
  return row;
}

/** Expands the nested Permissions accordion inside an open card. */
async function openPermissions(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /Plugin permissions/ });
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

/** Expands the Advanced section and returns it; its buttons are now visible. */
async function openAdvanced(page: Page): Promise<Locator> {
  // Exact: the Settings outline's chevron is "Expand Advanced". `last()` skips
  // Paste Cleanup's own Advanced toggle, which comes first.
  const toggle = page.getByRole("button", { name: "Advanced", exact: true }).last();
  // The way there passes the Dictation section's Spoken punctuation list.
  await tabTo(page, toggle, { max: 200 });
  await page.keyboard.press("Enter");
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("button", { name: "Export", exact: true }) });
  await expect(section.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  return section;
}

const RESET_SETTINGS = "Reset settings";
const CONFIRM = "Reset settings and delete credentials";

test.describe("Reset settings @wf:settings-reset-all @no-webkit", () => {
  test.use({
    plugins: ["approvals"],
    pluginApprovals: [{ pluginId: "approvals", granted: ["library:read", "editor:read"] }],
  });

  test("Escape cancels; confirming needs approval again and returns a setting to default", async ({
    page,
  }) => {
    // An approved third-party Plugin is running.
    await openPluginsSection(page);
    await expect(ran(page)).toBeVisible({ timeout: 15_000 });
    await expect(enableSwitch(page)).toBeChecked();

    // Change a setting the reset must return to its default.
    await tabTo(page, devMode(page), { max: 12 });
    await page.keyboard.press("Space");
    await expect(devMode(page)).toBeChecked();

    // Reach Settings > Advanced and open Reset settings.
    const section = await openAdvanced(page);
    const reset = section.getByRole("button", { name: RESET_SETTINGS, exact: true });
    await tabTo(page, reset, { max: 8 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog", { name: "Reset all settings?" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectTabContained(page, dialog);
    await capture(page, "settings-reset-all");

    // Escape cancels: nothing changed, the Plugin still runs, the setting stays.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reset).toBeFocused();

    await openPluginsSection(page);
    await expect(ran(page)).toBeVisible({ timeout: 15_000 });
    await expect(enableSwitch(page)).toBeChecked();
    await expect(devMode(page)).toBeChecked();

    // Reopen and confirm.
    const sectionAgain = await openAdvanced(page);
    await tabTo(page, sectionAgain.getByRole("button", { name: RESET_SETTINGS, exact: true }), {
      max: 8,
    });
    await page.keyboard.press("Enter");
    const confirmDialog = page.getByRole("alertdialog", { name: "Reset all settings?" });
    await expect(confirmDialog).toBeVisible();
    await tabTo(page, confirmDialog.getByRole("button", { name: CONFIRM, exact: true }), { max: 8 });
    await page.keyboard.press("Enter");
    await expect(confirmDialog).toBeHidden();

    // The third-party Plugin needs approval again and does not run.
    await openPluginsSection(page);
    await expect(enableSwitch(page)).not.toBeChecked();
    await expandPluginRow(page);
    // The open card flags the never-approved copy; its Permissions accordion
    // (collapsed by default) offers the Review action.
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
    await openPermissions(page);
    await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
    // Its contributed Settings row is unregistered.
    await expect(page.getByRole("textbox", { name: "Approvals kept data" })).toHaveCount(0);
    // It did not start: no run report.
    await expect(ran(page)).toHaveCount(0);
    // The changed setting is back to its default.
    await expect(devMode(page)).not.toBeChecked();
  });
});
