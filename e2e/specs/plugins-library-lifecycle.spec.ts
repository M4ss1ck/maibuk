// Plugin Library lifecycle (issue #445): a running persistent Plugin across the
// Tutorial's Library boundary and a Restore, driven from Settings by keyboard
// alone. The fixture's Worker reports its activation's `startReason` in the run
// report it toasts at start, and reports every `library.availabilityChanged`,
// so the spec sees the Plugin live through the Tutorial boundary and restart
// with `startReason` `restore` on a Restore.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md).

import type { Locator, Page } from "@playwright/test";
import { tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

const CARD = "[data-tutorial-card]";

/** The Worker's run report, naming the startReason it was activated with. */
const startReport = (page: Page) => page.getByRole("status").filter({ hasText: "started:" });
/** The Worker's run report for one activation reason. */
const startedWith = (page: Page, reason: string) =>
  page.getByRole("status").filter({ hasText: `started: ${reason}` });
/** The Worker's report that the Library became unavailable (the Tutorial). */
const unavailable = (page: Page) =>
  page.getByRole("status").filter({ hasText: "library available: false" });
/** The Worker's report that the Library became available again. */
const available = (page: Page) =>
  page.getByRole("status").filter({ hasText: "library available: true" });

const daily = (page: Page) => page.getByRole("row").filter({ hasText: "Daily" });
const manual = (page: Page) => page.getByRole("row").filter({ hasText: "Manual" });
const rowCount = (page: Page) => page.locator("tbody tr");
const createButton = (page: Page) => page.getByRole("button", { name: "Create Backup Now" });

function card(page: Page): Locator {
  return page.locator(CARD);
}

/** Opens Settings and returns its Tutorial controls, reached by Tab alone. */
async function openSettingsTutorial(page: Page): Promise<Locator> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const startAll = page.getByRole("button", { name: "Start from the beginning" });
  // The way there passes the Dictation section's Spoken punctuation list.
  await tabTo(page, startAll, { max: 200 });
  return startAll;
}

/**
 * Opens Settings > Backups and waits for the settled list, exactly as
 * library-backups.spec.ts does: the launch "Daily" Backup lands a beat after
 * boot, so a reload is what makes the row visible.
 */
async function openBackups(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(createButton(page)).toBeEnabled();
  await expect
    .poll(
      async () => {
        if ((await daily(page).count()) > 0) return true;
        await page.reload();
        await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
        return (await daily(page).count()) > 0;
      },
      { timeout: 20_000 }
    )
    .toBe(true);
}

/** Tabs to "Create Backup Now" and leaves focus there. */
async function focusCreate(page: Page): Promise<void> {
  await tabTo(page, createButton(page), { max: 40 });
  await expect(createButton(page)).toBeFocused();
}

/** Creates `count` Backups at one-second-apart fixed times, so names differ. */
async function createBackups(page: Page, count: number, start: Date): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.clock.setFixedTime(new Date(start.getTime() + i * 1000));
    const before = await rowCount(page).count();
    await page.keyboard.press("Enter");
    await expect.poll(() => rowCount(page).count(), { timeout: 10_000 }).toBeGreaterThan(before);
  }
}

test.describe("Plugin Library lifecycle @wf:plugins-tutorial-boundary @no-webkit", () => {
  test.use({
    library: "oneBookThreeChapters",
    plugins: ["approvals"],
    pluginApprovals: [{ pluginId: "approvals", granted: ["library:read"] }],
  });

  test("a running persistent Plugin stays alive across the Tutorial boundary and reports it", async ({
    page,
  }) => {
    // The Worker is up and reports the reason it was activated for.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(startedWith(page, "launch")).toBeVisible({ timeout: 15_000 });

    // Enter the Tutorial from Settings, as tutorial.spec.ts does.
    await openSettingsTutorial(page);
    await page.keyboard.press("Enter");
    await card(page).waitFor({ state: "visible", timeout: 20_000 });

    // The Plugin reports the Library went away. Only a Worker that was already
    // subscribed when the Tutorial started receives this event (availability is
    // not replayed), so seeing it is itself the proof it did not restart.
    await expect(unavailable(page)).toBeVisible({ timeout: 20_000 });
    await expect(startReport(page)).toHaveCount(0);

    // Esc skips the run, returning to the author's Library.
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);

    // The same Worker reports the Library came back, so it lived through both
    // sides of the boundary; a restart would have missed one of the events.
    await expect(available(page)).toBeVisible({ timeout: 20_000 });
    // No second run report: the Worker was never restarted.
    await expect(startReport(page)).toHaveCount(0);
  });
});

test.describe("Plugin across a Restore @wf:plugins-restore-indication @no-webkit", () => {
  test.use({
    library: "backupsPresent",
    plugins: ["approvals"],
    pluginApprovals: [{ pluginId: "approvals", granted: ["library:read"] }],
  });

  test("a Restore restarts the running Plugin with startReason restore", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50, backupListPageSize: 50 });
    await page.clock.setFixedTime(new Date("2026-05-01T09:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 1, new Date("2026-05-01T09:00:10Z"));

    // Restore the Backup taken just before.
    await openBackups(page);
    await tabTo(page, manual(page).getByRole("button", { name: "Restore" }), { max: 40 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Restore" });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "Restore", exact: true }), { max: 4 });
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("status").filter({ hasText: "Backup restored successfully" })
    ).toBeVisible({ timeout: 15_000 });

    // The running Plugin stopped before the replacement and restarted against
    // the restored Library, and its Worker reports the new activation.
    await expect(startedWith(page, "restore")).toBeVisible({ timeout: 20_000 });
  });
});
