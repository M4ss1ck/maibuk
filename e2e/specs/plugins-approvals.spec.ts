// Plugin approvals (issue #442): the install, enable, and permission flow,
// driven from Settings → Plugins by keyboard alone. The fixtures are seeded
// into the web Plugin Directory (OPFS) with the approval records the runtime
// reads, so the spec proves approve, revoke, the changed-files review, a
// permission that became required, and the Built-in Keep my copy path.
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
const ran = (page: Page) => page.getByRole("status").filter({ hasText: "approvals fixture running" });
/** The changed-files notice the store lists for a copy that no longer matches its pin. */
const changedNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "files changed" });
/** The built-in update notice. */
const updateNotice = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Update available" });

const pluginRow = (page: Page) => page.getByRole("button", { name: ROW_NAME, exact: true });

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
  // Home lands on the first section whatever row had focus first (a changed
  // copy's notice sits after the outline and shifts the backward order), then
  // ArrowDown walks the tree to Plugins.
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/** Tabs to the Plugin's row and expands it, leaving its toggle button focused. */
async function expandPluginRow(page: Page): Promise<Locator> {
  const row = pluginRow(page);
  await tabTo(page, row, { max: 30 });
  await page.keyboard.press("Enter");
  return row;
}

const nowRequiredManifest = JSON.stringify({
  manifestVersion: 1,
  id: "approvals",
  name: ROW_NAME,
  description: "The E2E approvals fixture with editor:read promoted to a required Plugin Permission.",
  author: "Maibuk",
  version: "1.1.0",
  apiVersion: "^0.1",
  entry: "index.js",
  platforms: ["web"],
  lifecycle: "persistent",
  defaultLanguage: "en",
  permissions: { required: ["library:read", "editor:read"], optional: [] },
  contributes: {
    commands: [
      {
        id: "readEditor",
        label: "Approvals read editor",
        contexts: ["global"],
        defaults: [["Mod+Alt+e"]],
      },
    ],
    settingsRows: [{ id: "kept", label: "Approvals kept data" }],
  },
});

const REQUIRED_LABEL = "Read your Library · Required to enable this Plugin";
const OPTIONAL_LABEL = "Read the focused editor · Optional";
const APPROVE = "Approve this copy and enable";

test.describe("Plugin approvals @wf:plugins-approvals @no-webkit", () => {
  test.describe("an installed but unapproved Plugin", () => {
    test.use({ unapprovedPlugins: ["approvals"] });

    test("approves it from the permission dialog and it runs", async ({ page }) => {
      await openPluginsSection(page);
      await expandPluginRow(page);

      const review = page.getByRole("button", { name: "Review and enable", exact: true });
      await tabTo(page, review, { max: 12 });
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", { name: "Review access" });
      await expect(dialog).toBeVisible();
      await expectFocusWithin(dialog);
      // The required Plugin Permission is checked and locked; the optional one
      // is granted by default and can be toggled.
      const required = dialog.getByRole("checkbox", { name: REQUIRED_LABEL, exact: true });
      await expect(required).toBeChecked();
      await expect(required).toBeDisabled();
      const optional = dialog.getByRole("checkbox", { name: OPTIONAL_LABEL, exact: true });
      await expect(optional).toBeChecked();
      await expect(optional).toBeEnabled();
      await capture(page, "plugins-approvals-permission");

      // Escape closes the dialog and returns focus to the action that opened it.
      await expectTabContained(page, dialog);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(review).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      const approve = dialog.getByRole("button", { name: APPROVE, exact: true });
      await tabTo(page, approve, { max: 12 });
      await page.keyboard.press("Enter");

      await expect(dialog).toBeHidden();
      // The Worker ran, and the Plugin's contributed Settings row is installed.
      await expect(ran(page)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("textbox", { name: "Approvals kept data" })).toBeVisible();
    });
  });

  test.describe("an enabled Plugin", () => {
    test.use({
      plugins: ["approvals"],
      pluginApprovals: [{ pluginId: "approvals", granted: ["library:read", "editor:read"] }],
    });

    test("revoking an optional grant keeps it enabled and refuses the next call", async ({
      page,
    }) => {
      await openPluginsSection(page);
      await expandPluginRow(page);
      // The Worker is up: its start report landed.
      await expect(ran(page)).toBeVisible({ timeout: 15_000 });

      const optional = page.getByRole("checkbox", { name: OPTIONAL_LABEL, exact: true });
      await tabTo(page, optional, { max: 12 });
      await page.keyboard.press("Space");
      await expect(optional).not.toBeChecked();
      // Revoking an optional grant leaves the Plugin enabled.
      await expect(page.getByText("Enabled", { exact: true })).toBeVisible();

      // The next call to that permission is refused (the fixture reports it).
      // Leave the checkbox (a typing target suppresses global Commands), and let
      // the startup report's 5 s notification slot pass.
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(5_200);
      await page.keyboard.press("ControlOrMeta+Alt+e");
      await expect(
        page.getByRole("status").filter({ hasText: "approvals editor refused: permission-denied" })
      ).toBeVisible({ timeout: 5_000 });
    });

    test("revoking a required grant disables the Plugin and unregisters its surfaces", async ({
      page,
    }) => {
      await openPluginsSection(page);
      await expandPluginRow(page);
      // Its contributed Settings row is present while it is installed.
      await expect(page.getByRole("textbox", { name: "Approvals kept data" })).toBeVisible();

      const revoke = page.getByRole("button", {
        name: "Disable Plugin and revoke access",
        exact: true,
      });
      await tabTo(page, revoke, { max: 12 });
      await page.keyboard.press("Enter");

      // The required grant is gone: the Plugin is off, needs review again, and
      // its contributed surfaces are unregistered.
      await expect(page.getByText("Off", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Required access is missing. Review and approve it to enable this Plugin.")
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Review and enable", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Approvals kept data" })).toHaveCount(0);
    });
  });

  test.describe("a copy whose files changed", () => {
    test.use({
      plugins: ["approvals"],
      pluginApprovals: [
        {
          pluginId: "approvals",
          pinnedHash: "h1:e2e-approved-older",
          enabled: false,
          changedFile: "index.js",
        },
      ],
    });

    test("never runs before review, notifies once, and starts after the diff is approved", async ({
      page,
    }) => {
      await openPluginsSection(page);
      // One notice, with a Review action, and the row reads Review required.
      await expect(changedNotice(page)).toBeVisible({ timeout: 15_000 });
      await expect(changedNotice(page).getByRole("button", { name: "Review", exact: true })).toBeVisible();
      await expect(page.getByText("Review required", { exact: true })).toBeVisible();
      // The copy never ran: no Worker reported.
      await expect(ran(page)).toHaveCount(0);

      const row = await expandPluginRow(page);
      const review = page.getByRole("button", { name: "Review and enable", exact: true });
      await tabTo(page, review, { max: 12 });
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", { name: "Review required" });
      await expect(dialog).toBeVisible();
      await expectFocusWithin(dialog);
      // The per-file diff names the changed file.
      await expect(dialog.getByText("Changed", { exact: true })).toBeVisible();
      await expect(dialog.getByText("index.js", { exact: true })).toBeVisible();
      await capture(page, "plugins-approvals-diff");

      // Escape closes it and returns focus to the row's action.
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(review).toBeFocused();

      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      const approve = dialog.getByRole("button", { name: APPROVE, exact: true });
      await tabTo(page, approve, { max: 12 });
      await page.keyboard.press("Enter");

      await expect(dialog).toBeHidden();
      await expect(ran(page)).toBeVisible({ timeout: 15_000 });
      await expect(row).toBeVisible();
    });
  });

  test.describe("a copy where an optional permission became required", () => {
    test.use({
      plugins: [{ name: "approvals", files: { "manifest.json": nowRequiredManifest } }],
      pluginApprovals: [
        {
          pluginId: "approvals",
          pinnedHash: "h1:e2e-approved-older",
          enabled: false,
          granted: ["library:read", "editor:read"],
          approvedPermissions: { required: ["library:read"], optional: ["editor:read"] },
        },
      ],
    });

    test("shows Now required, locked", async ({ page }) => {
      await openPluginsSection(page);
      await expandPluginRow(page);
      const review = page.getByRole("button", { name: "Review and enable", exact: true });
      await tabTo(page, review, { max: 12 });
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", { name: "Review required" });
      await expect(dialog).toBeVisible();
      // editor:read is now required: the dialog labels it Now required and locks it.
      const locked = dialog.getByRole("checkbox", {
        name: "Read the focused editor · Required to enable this Plugin · Now required",
        exact: true,
      });
      await expect(dialog.getByText(/Now required/)).toBeVisible();
      await expect(locked).toBeChecked();
      await expect(locked).toBeDisabled();
      await capture(page, "plugins-approvals-now-required");
    });
  });

  test.describe("a modified Built-in with a newer shipped hash", () => {
    test.use({
      plugins: ["approvals"],
      pluginApprovals: [
        {
          pluginId: "approvals",
          enabled: false,
          granted: ["library:read"],
          builtIn: { shippedHash: "h1:e2e-shipped-older" },
        },
      ],
      builtInPlugins: [{ id: "approvals", hash: "h1:e2e-shipped-newer" }],
    });

    test("offers Update available and Keep my copy, which never prompts again", async ({ page }) => {
      await openPluginsSection(page);
      // The Built-in is modified and an update is offered, with one notice.
      await expect(page.getByText("Modified Built-in copy", { exact: true })).toBeVisible();
      await expect(page.getByText("Update available", { exact: true })).toBeVisible();
      await expect(updateNotice(page)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Built-in", { exact: true })).toBeVisible();

      await expandPluginRow(page);
      const keep = page.getByRole("button", { name: "Keep my copy", exact: true });
      await tabTo(page, keep, { max: 15 });
      await page.keyboard.press("Enter");

      // The badge stays; the offer is not withdrawn.
      await expect(page.getByText("Update available", { exact: true })).toBeVisible();

      // A reload never prompts again for the kept shipped hash.
      await openPluginsSection(page);
      await expect(page.getByText("Update available", { exact: true })).toBeVisible();
      await expect(updateNotice(page)).toHaveCount(0);
    });
  });
});
