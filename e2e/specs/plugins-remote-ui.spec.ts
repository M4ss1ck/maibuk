// Host-rendered Plugin UI (issue #438): the remote-ui fixture Plugin draws a
// page through the SDK's Worker Remote UI entry, and Maibuk renders the tree
// with its own React Aria controls. Keyboard only: typing into the Plugin's
// text field stays host-owned, its button runs from the keyboard, and a
// declaration the UI kit never carries stops the Plugin with the
// remote-ui-limit copy. Each matrix edge gets its own test.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
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
