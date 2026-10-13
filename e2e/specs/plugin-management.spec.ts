// Plugin management in Settings (issue #443): the list, the status filter, Add
// Plugin from a .zip, removal with and without data, reinstalling a Built-in,
// and restarting a Plugin stopped by a lifecycle limit. Keyboard only, plus the
// touch paths on the phone project (tap).
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { capture } from "../support/capture";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { expect, test } from "../support/test";

const main = (page: Page) => page.getByRole("main", { name: "Main content" });
const pluginsHeading = (page: Page) => main(page).getByRole("heading", { name: "Plugins" });

/** The one required Plugin Permission the added-zip fixture declares. */
const ADDED_REQUIRED = "Read your Library · Required to enable this Plugin";

/** The .zip the Add Plugin spec feeds the file chooser; built once per worker. */
const ADDED_ZIP = resolve(import.meta.dirname, "..", ".output", "plugin-management-added.zip");

test.beforeAll(() => {
  const manifest = {
    manifestVersion: 1,
    id: "e2e-added",
    name: "Added Fixture",
    description: "The E2E fixture installed from a .zip by the Plugin management spec (#443).",
    author: "Maibuk",
    version: "1.0.0",
    apiVersion: "^0.1",
    entry: "index.js",
    platforms: ["web"],
    lifecycle: "persistent",
    defaultLanguage: "en",
    permissions: { required: ["library:read"], optional: [] },
  };
  const zip = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "index.js": strToU8("export const added = 1;"),
  });
  mkdirSync(resolve(import.meta.dirname, "..", ".output"), { recursive: true });
  writeFileSync(ADDED_ZIP, zip);
});

/** The Settings outline treegrid. */
const outline = (page: Page) =>
  page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });

/**
 * With Settings open, walks the outline to the Plugins section and enters it,
 * leaving its heading focused. The outline is the page's last focusable region,
 * so Shift+Tab reaches it; Home lands on the first section whatever row had
 * focus, then ArrowDown walks to Plugins.
 */
async function jumpToPlugins(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = outline(page);
  await expect(tree).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await expectFocusWithin(tree);
  await page.keyboard.press("Home");
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(pluginsHeading(page)).toBeFocused();
}

/** Opens Settings by URL and lands on the Plugins section. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await jumpToPlugins(page);
}

/** Tabs to a Plugin's row trigger and expands it, leaving the trigger focused. */
async function expandRow(page: Page, name: string): Promise<Locator> {
  const row = main(page).getByRole("button", { name, exact: true });
  await tabTo(page, row, { max: 30 });
  await page.keyboard.press("Enter");
  return row;
}

/** Opens the status filter popover from the keyboard, leaving its listbox open. */
async function openFilter(page: Page): Promise<Locator> {
  const trigger = main(page).getByRole("button", { name: "Filter by status", exact: true });
  await tabTo(page, trigger, { max: 20 });
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox", { name: "Filter by status" });
  await expect(listbox).toBeVisible();
  return listbox;
}

test.describe("Plugin management: empty list @wf:plugin-management-empty @no-webkit", () => {
  test.use({ library: "empty" });

  test("zero Plugins renders the empty state copy", async ({ page }) => {
    await openPluginsSection(page);
    await expect(main(page).getByText("No Plugins yet")).toBeVisible();
    await expect(
      main(page).getByText("Plugins you install appear here, each with its own settings.")
    ).toBeVisible();
    await capture(page, "plugin-management-empty");
  });
});

test.describe("Plugin management: list and filters @wf:plugin-management-list-filters @no-webkit", () => {
  test.use({
    library: "oneBookThreeChapters",
    plugins: ["tracer", "approvals"],
    // The approvals fixture starts disabled, so it matches Installed + Disabled
    // while the tracer matches Installed alone.
    pluginApprovals: [{ pluginId: "approvals", enabled: false }],
  });

  test("lists Plugins alphabetically with counts", async ({ page }) => {
    await openPluginsSection(page);
    const rows = main(page).getByRole("button", { name: /Fixture$/ });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAccessibleName("Approvals Fixture");
    await expect(rows.nth(1)).toHaveAccessibleName("Tracer Fixture");

    // The filter shows one count per category across every known Plugin.
    const listbox = await openFilter(page);
    await expect(listbox.getByRole("option", { name: /^Installed\b/ })).toContainText("2");
    await expect(listbox.getByRole("option", { name: /^Disabled\b/ })).toContainText("1");
    await capture(page, "plugin-management-filters");
    await page.keyboard.press("Escape");
  });

  test("deselecting a category hides only the rows in no remaining category", async ({ page }) => {
    await openPluginsSection(page);
    const listbox = await openFilter(page);
    const installed = listbox.getByRole("option", { name: /^Installed\b/ });
    await pressUntilFocused(page, "ArrowDown", installed, { max: 6 });
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");

    // The tracer matched only Installed, so it is gone; the approvals copy still
    // matches the still-selected Disabled category.
    await expect(main(page).getByRole("button", { name: "Tracer Fixture", exact: true })).toHaveCount(
      0
    );
    await expect(
      main(page).getByRole("button", { name: "Approvals Fixture", exact: true })
    ).toBeVisible();
  });

  test("deselecting every category shows the empty-result copy", async ({ page }) => {
    await openPluginsSection(page);
    const listbox = await openFilter(page);
    const options = listbox.getByRole("option");
    await pressUntilFocused(page, "ArrowDown", options.first(), { max: 6 });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Space");
      if (i < 5) await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Escape");
    await expect(main(page).getByText("No Plugins match these filters.")).toBeVisible();
  });
});

test.describe("Plugin management: add zip @wf:plugin-management-add-zip @no-webkit", () => {
  test.use({ library: "empty" });

  test("adds a Plugin from a .zip and opens its approval dialog", async ({ page }) => {
    await openPluginsSection(page);
    const add = main(page).getByRole("button", { name: "Add Plugin", exact: true });
    // The file chooser is the one allowed bypass: open it with a key, then set
    // the file the way an author picks it (e2e/README.md, "Driving the app by
    // keyboard").
    const chooser = page.waitForEvent("filechooser");
    await tabTo(page, add, { max: 20 });
    await page.keyboard.press("Enter");
    await (await chooser).setFiles(ADDED_ZIP);

    const dialog = page.getByRole("dialog", { name: "Review access" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("checkbox", { name: ADDED_REQUIRED, exact: true })
    ).toBeVisible();
    await capture(page, "plugin-management-add-zip");
  });
});

test.describe("Plugin management: remove @wf:plugin-management-remove @no-webkit", () => {
  test.use({ library: "pluginData", plugins: ["tracer"] });

  test("keeps the row and its data when Also delete is not ticked", async ({ page }) => {
    await openPluginsSection(page);
    await expandRow(page, "Tracer Fixture");
    const remove = main(page).getByRole("button", { name: "Remove", exact: true });
    await tabTo(page, remove, { max: 12 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog", { name: "Remove Tracer Fixture?" });
    await expect(dialog).toBeVisible();
    await capture(page, "plugin-management-remove-dialog");
    const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
    await tabTo(page, confirm, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    // The row stays, now Removed, still holding its Library data: the size
    // shows and Delete data is offered.
    await expect(main(page).getByRole("button", { name: "Tracer Fixture", exact: true })).toBeVisible();
    await expect(main(page).getByText("Removed", { exact: true })).toBeVisible();
    await expect(main(page).getByText("Library data")).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Delete data", exact: true })).toBeVisible();
    await capture(page, "plugin-management-removed");
  });

  test("erases the retained data when Also delete is ticked", async ({ page }) => {
    await openPluginsSection(page);
    await expandRow(page, "Tracer Fixture");
    const remove = main(page).getByRole("button", { name: "Remove", exact: true });
    await tabTo(page, remove, { max: 12 });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog", { name: "Remove Tracer Fixture?" });
    await expect(dialog).toBeVisible();
    const also = dialog.getByRole("checkbox", { name: "Also delete this Plugin’s data" });
    await tabTo(page, also, { max: 12 });
    await page.keyboard.press("Space");
    await expect(also).toBeChecked();
    const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
    await tabTo(page, confirm, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    // The row stays Removed, its data gone: no Delete data is offered.
    await expect(main(page).getByRole("button", { name: "Tracer Fixture", exact: true })).toBeVisible();
    await expect(main(page).getByText("Removed", { exact: true })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Delete data", exact: true })).toHaveCount(0);
  });
});

test.describe("Plugin management: reinstall a Built-in @wf:plugin-management-reinstall @no-webkit", () => {
  // The seeded folder is also the shipped copy (the hash defaults to the
  // folder's own), so the untouched Built-in starts installed and enabled and a
  // Reinstall restores exactly it.
  test.use({ library: "empty", plugins: ["approvals"], builtInPlugins: [{ id: "approvals" }] });

  test("removes a Built-in and reinstalls the bundled copy", async ({ page }) => {
    await openPluginsSection(page);
    await expandRow(page, "Approvals Fixture");
    await expect(main(page).getByText("Built-in", { exact: true })).toBeVisible();
    await expect(main(page).getByText("Enabled", { exact: true })).toBeVisible();

    const remove = main(page).getByRole("button", { name: "Remove", exact: true });
    await tabTo(page, remove, { max: 12 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog", { name: "Remove Approvals Fixture?" });
    await expect(dialog).toBeVisible();
    // A Built-in carries no third-party warning.
    await expect(dialog.getByText(/cannot recover this third-party Plugin/)).toHaveCount(0);
    const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
    await tabTo(page, confirm, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    // The row stays, now Removed, offering Reinstall.
    await expect(main(page).getByText("Removed", { exact: true })).toBeVisible();
    const reinstall = main(page).getByRole("button", { name: "Reinstall", exact: true });
    await expect(reinstall).toBeVisible();
    await capture(page, "plugin-management-removed-builtin");

    await tabTo(page, reinstall, { max: 12 });
    await page.keyboard.press("Enter");
    const reinstallDialog = page.getByRole("alertdialog", { name: "Reinstall" });
    await expect(reinstallDialog).toBeVisible();
    const confirmReinstall = reinstallDialog.getByRole("button", {
      name: "Reinstall",
      exact: true,
    });
    await tabTo(page, confirmReinstall, { max: 12 });
    await page.keyboard.press("Enter");

    // The shipped copy is written again: the row is installed and enabled.
    await expect(main(page).getByText("Removed", { exact: true })).toHaveCount(0);
    await expect(main(page).getByText("Enabled", { exact: true })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Reinstall", exact: true })).toHaveCount(0);
    await capture(page, "plugin-management-reinstalled");
  });
});

test.describe("Plugin management: restart a stopped Plugin @wf:plugin-management-restart @no-webkit", () => {
  test.use({ library: "empty", plugins: ["remote-ui"] });

  test("shows Stopped with its reason and restarts it", async ({ page }) => {
    // Reach the remote-ui fixture's page and make it declare an interface the
    // host kit never carries, which stops it with `remote-ui-limit` (#438).
    await page.goto("/");
    const nav = page.getByRole("listbox", { name: "Primary navigation" });
    const navOption = nav.getByRole("option", { name: /^UI fixture/ });
    await expect(navOption).toBeVisible({ timeout: 15_000 });
    await tabTo(page, nav.getByRole("option", { name: /^Books/ }));
    await pressUntilFocused(page, "ArrowDown", navOption, { max: 10 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plugin\/remote-ui\/panel$/);

    const breakButton = page.getByRole("button", { name: "Break", exact: true });
    await expect(breakButton).toBeVisible({ timeout: 15_000 });
    await tabTo(page, breakButton);
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "declared an interface Maibuk could not accept and was stopped." })
    ).toBeVisible();

    // Settings by the `g s` sequence: no reload, so this launch's lifecycle
    // keeps the stopped state the row must show.
    await page.keyboard.press("Escape");
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await jumpToPlugins(page);

    const row = await expandRow(page, "Remote UI Fixture");
    await expect(main(page).getByText("Stopped", { exact: true })).toBeVisible();
    await expect(
      main(page).getByText("Remote UI Fixture declared an interface Maibuk could not accept and was stopped.")
    ).toBeVisible();
    await capture(page, "plugin-management-stopped");

    const restart = main(page).getByRole("button", { name: "Restart", exact: true });
    await tabTo(page, restart, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(main(page).getByText("Stopped", { exact: true })).toHaveCount(0);
    await expect(main(page).getByText("Enabled", { exact: true })).toBeVisible();
    await expect(row).toBeVisible();
  });
});

test.describe("Plugin management by touch @touch", () => {
  /** Opens Settings on a phone and taps into the Plugins section. */
  async function tapPluginsSection(page: Page): Promise<void> {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    // On a phone the outline is replaced by the sticky section bar. The menu is
    // labelled by its trigger, so its name starts with "Jump to section".
    await page.getByRole("button", { name: /^Jump to section/ }).tap();
    const menu = page.getByRole("menu", { name: /^Jump to section/ });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Plugins" }).tap();
    await expect(pluginsHeading(page)).toBeVisible();
  }

  test.describe("list and filters", () => {
    test.use({
      library: "oneBookThreeChapters",
      plugins: ["tracer", "approvals"],
      pluginApprovals: [{ pluginId: "approvals", enabled: false }],
    });

    test("taps through the list and a filter @wf:plugin-management-list-filters @no-webkit", async ({
      page,
    }) => {
      await tapPluginsSection(page);
      const rows = main(page).getByRole("button", { name: /Fixture$/ });
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveAccessibleName("Approvals Fixture");

      await main(page).getByRole("button", { name: "Filter by status", exact: true }).tap();
      const listbox = page.getByRole("listbox", { name: "Filter by status" });
      await expect(listbox).toBeVisible();
      await expect(listbox.getByRole("option", { name: /^Installed\b/ })).toContainText("2");
      await listbox.getByRole("option", { name: /^Installed\b/ }).tap();
      await page.keyboard.press("Escape");

      await expect(
        main(page).getByRole("button", { name: "Tracer Fixture", exact: true })
      ).toHaveCount(0);
      await expect(
        main(page).getByRole("button", { name: "Approvals Fixture", exact: true })
      ).toBeVisible();
    });
  });

  test.describe("add zip", () => {
    test.use({ library: "empty" });

    test("taps Add Plugin and picks a .zip @wf:plugin-management-add-zip @no-webkit", async ({
      page,
    }) => {
      await tapPluginsSection(page);
      const chooser = page.waitForEvent("filechooser");
      await main(page).getByRole("button", { name: "Add Plugin", exact: true }).tap();
      await (await chooser).setFiles(ADDED_ZIP);
      const dialog = page.getByRole("dialog", { name: "Review access" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("checkbox", { name: ADDED_REQUIRED, exact: true })
      ).toBeVisible();
    });
  });

  test.describe("remove", () => {
    test.use({ library: "pluginData", plugins: ["tracer"] });

    test("taps Remove and erases the retained data @wf:plugin-management-remove @no-webkit", async ({
      page,
    }) => {
      await tapPluginsSection(page);
      await main(page).getByRole("button", { name: "Tracer Fixture", exact: true }).tap();
      await main(page).getByRole("button", { name: "Remove", exact: true }).tap();
      const dialog = page.getByRole("alertdialog", { name: "Remove Tracer Fixture?" });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("checkbox", { name: "Also delete this Plugin’s data" })
        .locator("xpath=ancestor::label")
        .tap();
      await dialog.getByRole("button", { name: "Confirm", exact: true }).tap();
      await expect(dialog).toBeHidden();

      await expect(main(page).getByText("Removed", { exact: true })).toBeVisible();
      await expect(
        main(page).getByRole("button", { name: "Delete data", exact: true })
      ).toHaveCount(0);
    });
  });

  test.describe("reinstall a Built-in", () => {
    test.use({ library: "empty", plugins: ["approvals"], builtInPlugins: [{ id: "approvals" }] });

    test("taps Remove then Reinstall @wf:plugin-management-reinstall @no-webkit", async ({
      page,
    }) => {
      await tapPluginsSection(page);
      await main(page).getByRole("button", { name: "Approvals Fixture", exact: true }).tap();
      await main(page).getByRole("button", { name: "Remove", exact: true }).tap();
      const dialog = page.getByRole("alertdialog", { name: "Remove Approvals Fixture?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Confirm", exact: true }).tap();
      await expect(dialog).toBeHidden();

      await expect(main(page).getByText("Removed", { exact: true })).toBeVisible();
      await main(page).getByRole("button", { name: "Reinstall", exact: true }).tap();
      const reinstallDialog = page.getByRole("alertdialog", { name: "Reinstall" });
      await expect(reinstallDialog).toBeVisible();
      await reinstallDialog.getByRole("button", { name: "Reinstall", exact: true }).tap();

      await expect(main(page).getByText("Removed", { exact: true })).toHaveCount(0);
      await expect(main(page).getByText("Enabled", { exact: true })).toBeVisible();
    });
  });

  test.describe("restart a stopped Plugin", () => {
    test.use({ library: "empty", plugins: ["remote-ui"] });

    test("taps Restart on a stopped Plugin @wf:plugin-management-restart @no-webkit", async ({
      page,
    }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Open navigation menu" }).tap();
      const dialog = page.getByRole("dialog", { name: "Primary navigation" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("option", { name: "UI fixture" }).tap();
      await expect(page).toHaveURL(/\/plugin\/remote-ui\/panel$/);

      const breakButton = page.getByRole("button", { name: "Break", exact: true });
      await expect(breakButton).toBeVisible({ timeout: 15_000 });
      await breakButton.tap();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "declared an interface Maibuk could not accept and was stopped." })
      ).toBeVisible();

      await page.keyboard.press("Escape");
      await page.keyboard.press("g");
      await page.keyboard.press("s");
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      await page.getByRole("button", { name: /^Jump to section/ }).tap();
      const menu = page.getByRole("menu", { name: /^Jump to section/ });
      await expect(menu).toBeVisible();
      await menu.getByRole("menuitem", { name: "Plugins" }).tap();

      await main(page).getByRole("button", { name: "Remote UI Fixture", exact: true }).tap();
      await expect(main(page).getByText("Stopped", { exact: true })).toBeVisible();
      await main(page).getByRole("button", { name: "Restart", exact: true }).tap();
      await expect(main(page).getByText("Stopped", { exact: true })).toHaveCount(0);
    });
  });
});
