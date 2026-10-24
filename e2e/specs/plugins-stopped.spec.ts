// The Stopped Plugin surfaces (issue #618), on the `fixture-stopped` Plugin: an
// on-demand Plugin whose Worker throws an uncaught error when the Command
// Palette runs "Crash stopped fixture". The host stops it with reason `crashed`
// and never restarts an on-demand Plugin stopped by a limit on its own, so it
// stays a Stopped Plugin until the author acts.
//
// Two surfaces say so: the sidebar entry in the Primary navigation listbox is
// marked, tooltipped, and named "<title>, stopped. <reason>", and the page
// replaces its body with a panel that names the reason, offers Try again (which
// reads Starting… and renders the body again once the Plugin is ready), and
// opens the Plugin's card in Settings. Keyboard only, as everywhere in this
// suite: the page opens from its sidebar entry, the Command runs from the
// palette, and both panel actions are reached by Tab and pressed with Enter.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { runPaletteCommand } from "../support/palette";
import { expect, test } from "../support/test";

const PLUGIN_ID = "fixture-stopped";
/** The page's title, which is also the sidebar entry's label while it runs. */
const PAGE_TITLE = "Stopped fixture report";
/** The Remote UI Heading the Plugin draws on its page. */
const BODY_HEADING = "Stopped fixture body";
/** The sidebar entry's accessible name once the Plugin has stopped. */
const STOPPED_NAME = `${PAGE_TITLE}, stopped. Stopped Fixture stopped unexpectedly.`;
/** The reason copy the panel's alert carries. */
const REASON = "Stopped Fixture stopped unexpectedly.";
/** The crashing Command, by its palette label. */
const CRASH = "Crash stopped fixture";

/** The Primary navigation listbox. */
const nav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });

/** One navigation entry, by its exact accessible name. */
const navEntry = (page: Page, name: string) => nav(page).getByRole("option", { name, exact: true });

/** The Plugin's entry while it runs: its plain label, with no shortcut hint. */
const runningEntry = (page: Page) => navEntry(page, PAGE_TITLE);

/** The same entry once the Plugin has stopped: its `aria-label` replaces the label. */
const stoppedEntry = (page: Page) => navEntry(page, STOPPED_NAME);

/** The Books entry, which Tab reaches first; it carries its Shortcut hint. */
const booksEntry = (page: Page) => nav(page).getByRole("option", { name: /^Books/ });

/**
 * Opens the fixture's page the way an author reaches it: Home, Tab into the
 * navigation listbox, ArrowDown to the Plugin's entry, Enter. The launch scan
 * registers the entry after the first render, so the entry is awaited.
 */
async function openReport(page: Page): Promise<void> {
  await page.goto("/");
  await expect(runningEntry(page)).toBeVisible({ timeout: 15_000 });
  await tabTo(page, booksEntry(page));
  await pressUntilFocused(page, "ArrowDown", runningEntry(page), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/plugin/${PLUGIN_ID}/report$`));
  await expect(page.getByRole("heading", { name: BODY_HEADING })).toBeVisible({ timeout: 15_000 });
}

/** Crashes the Plugin from the palette and waits for both surfaces to say so. */
async function crash(page: Page): Promise<void> {
  await runPaletteCommand(page, CRASH);
  // The Worker died of its own uncaught error: the panel replaces the body and
  // names the reason.
  await expect(page.getByRole("alert")).toHaveText(REASON, { timeout: 15_000 });
  await expect(page.getByText("Stopped Fixture stopped", { exact: true })).toBeVisible();
}

test.describe("Stopped Plugin surfaces", () => {
  // The historic seed shape: approved, enabled, and granted nothing (the
  // fixture declares no Plugin Permissions).
  test.use({ plugins: [PLUGIN_ID], pluginApprovals: [{ pluginId: PLUGIN_ID }] });

  test("a crash is named in the sidebar and the page comes back from Try again @wf:plugins-stopped", async ({
    page,
  }) => {
    await openReport(page);
    await runPaletteCommand(page, CRASH);
    // The body goes on every build, so the "before" screenshot run (a build
    // without the panel) still reaches the captures below.
    await expect(page.getByRole("heading", { name: BODY_HEADING })).toBeHidden({
      timeout: 15_000,
    });
    await capture(page, "stopped-plugin-page");
    await capture(page, "stopped-plugin-sidebar", { around: [nav(page)] });
    await expect(page.getByRole("alert")).toHaveText(REASON, { timeout: 15_000 });
    await expect(page.getByText("Stopped Fixture stopped", { exact: true })).toBeVisible();

    // The sidebar entry carries the stopped name, and the page keeps its title.
    await expect(stoppedEntry(page)).toBeVisible();
    // The warning mark on the entry's icon corner, which the collapsed sidebar shows too.
    await expect(stoppedEntry(page).locator("[data-plugin-stopped-mark]")).toBeVisible();
    await expect(page.getByRole("heading", { name: PAGE_TITLE, level: 1 })).toBeVisible();

    // Try again starts it and the body replaces the panel once it is ready. An
    // on-demand Plugin stopped by a limit gets no automatic restart, so this is
    // the only way back.
    await tabTo(page, page.getByRole("button", { name: "Try again" }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: BODY_HEADING })).toBeVisible({
      timeout: 15_000,
    });
    // A running Plugin's entry goes back to its plain label.
    await expect(runningEntry(page)).toBeVisible();
    await expect(stoppedEntry(page)).toBeHidden();
    await expect(nav(page).locator("[data-plugin-stopped-mark]")).toHaveCount(0);
  });

  test("Plugin settings opens the Plugin's card in Settings @wf:plugins-stopped", async ({
    page,
  }) => {
    await openReport(page);
    await crash(page);

    await tabTo(page, page.getByRole("button", { name: "Plugin settings" }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });
});
