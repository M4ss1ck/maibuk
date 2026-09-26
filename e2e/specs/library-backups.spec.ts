import type { Page } from "@playwright/test";
import { expectTabContained, pressUntilFocused, tabTo } from "../support/keyboard";
import { tamperBackupChecksums } from "../support/fault";
import { BACKUPS_CANVAS } from "../support/seed/backups-present";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

// Backups (issue #213): create, list, select, bulk delete, prune, and restore
// from Settings, by keyboard alone. The web adapter keeps Backups in IndexedDB.
// Every device also creates one "Daily" Backup on launch, a beat after boot, so
// openBackups settles that row before a spec acts.
test.use({ library: "backupsPresent" });

const daily = (page: Page) => page.getByRole("row").filter({ hasText: "Daily" });
const manual = (page: Page) => page.getByRole("row").filter({ hasText: "Manual" });
const rowCount = (page: Page) => page.locator("tbody tr");
const createButton = (page: Page) => page.getByRole("button", { name: "Create Backup Now" });
const statusText = (page: Page) => page.getByRole("status").filter({ hasText: "selected" });

/**
 * Opens Settings > Backups and waits for the settled list. The launch "Daily"
 * Backup is created a beat after the app boots while the section lists once per
 * mount, so a reload is what makes the row visible (the reload's own launch is
 * a no-op because today's Daily already exists).
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

/**
 * Opens a React Aria Select by keyboard and picks `option`. The listbox opens
 * on the current value, so the caller says which way to move (`ArrowUp` from
 * the last option, `ArrowDown` otherwise).
 */
async function chooseOption(
  page: Page,
  select: ReturnType<Page["getByRole"]>,
  option: string,
  key = "ArrowDown"
) {
  await tabTo(page, select, { max: 30 });
  await page.keyboard.press("Enter");
  await pressUntilFocused(page, key, page.getByRole("option", { name: option, exact: true }), {
    max: 8,
  });
  await page.keyboard.press("Enter");
}

test.describe("Create and list a Backup @wf:backup-create-list", () => {
  test("Create Backup Now adds a Manual row with a localized date, kept after reload", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-03-04T08:00:00Z"));
    await openBackups(page);
    await expect(daily(page)).toHaveCount(1);

    await focusCreate(page);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("status").filter({ hasText: "Backup created" })).toBeVisible();
    await expect(manual(page)).toHaveCount(1);
    await expect(manual(page)).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2} [AP]M/);

    // The table's controls are reachable: Tab reaches the row's Restore button.
    await tabTo(page, manual(page).getByRole("button", { name: "Restore" }), { max: 12 });

    // Persists in IndexedDB across a reload.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(manual(page)).toHaveCount(1);
    await expect(daily(page)).toHaveCount(1);
  });
});

test.describe("Select and delete Backups @wf:backup-select-delete", () => {
  test("Space selects a row and Select all counts the page", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50, backupListPageSize: 50 });
    await page.clock.setFixedTime(new Date("2026-04-01T10:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 6, new Date("2026-04-01T10:00:10Z"));

    // Shrink the page so Select all means five rows.
    await chooseOption(page, page.getByRole("button", { name: "Items per page" }), "5", "ArrowUp");
    await expect(rowCount(page)).toHaveCount(5);

    const firstRowCheckbox = page.getByRole("checkbox", { name: /Select backup from/ }).first();
    await tabTo(page, firstRowCheckbox, { max: 60, backwards: true });
    await page.keyboard.press("Space");
    await expect(firstRowCheckbox).toBeChecked();
    await expect(statusText(page)).toHaveText("1 item is selected");

    const selectAll = page.getByRole("checkbox", { name: "Select all backups on this page" });
    await tabTo(page, selectAll, { max: 6, backwards: true });
    await page.keyboard.press("Space");
    await expect(statusText(page)).toHaveText("5 items are selected");
    await expect(page.getByRole("checkbox", { name: /Select backup from/ })).toHaveCount(5);
    for (const box of await page.getByRole("checkbox", { name: /Select backup from/ }).all()) {
      await expect(box).toBeChecked();
    }
  });

  test("bulk delete confirms, removes the rows, and survives a reload", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50, backupListPageSize: 50 });
    await page.clock.setFixedTime(new Date("2026-04-02T10:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 6, new Date("2026-04-02T10:00:10Z"));
    await chooseOption(page, page.getByRole("button", { name: "Items per page" }), "5", "ArrowUp");

    const selectAll = page.getByRole("checkbox", { name: "Select all backups on this page" });
    await tabTo(page, selectAll, { max: 60, backwards: true });
    await page.keyboard.press("Space");
    await expect(statusText(page)).toHaveText("5 items are selected");

    const deleteSelected = page.getByRole("button", { name: "Delete", exact: true }).first();
    await tabTo(page, deleteSelected, { max: 6, backwards: true });
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Delete backups" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Delete 5 backups? This cannot be undone.")).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "Delete", exact: true }), { max: 4 });
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "5 backups deleted" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    // Seven existed (6 Manual + 1 Daily); five Manuals were deleted, leaving 2.
    await expect(rowCount(page)).toHaveCount(2);
    await expect(daily(page)).toHaveCount(1);
  });

  test("Cancel in the delete dialog keeps every row", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50, backupListPageSize: 50 });
    await page.clock.setFixedTime(new Date("2026-04-03T10:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 6, new Date("2026-04-03T10:00:10Z"));
    await chooseOption(page, page.getByRole("button", { name: "Items per page" }), "5", "ArrowUp");
    await expect(rowCount(page)).toHaveCount(5);

    await tabTo(page, page.getByRole("checkbox", { name: "Select all backups on this page" }), {
      max: 60,
      backwards: true,
    });
    await page.keyboard.press("Space");
    await tabTo(page, page.getByRole("button", { name: "Delete", exact: true }).first(), {
      max: 6,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Delete backups" });
    await expect(dialog).toBeVisible();
    await expectTabContained(page, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(rowCount(page)).toHaveCount(5);
    await expect(statusText(page)).toHaveText("5 items are selected");
  });

  test("Page and Items per page move through the list by keyboard", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50, backupListPageSize: 50 });
    await page.clock.setFixedTime(new Date("2026-04-04T10:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 6, new Date("2026-04-04T10:00:10Z"));

    await chooseOption(page, page.getByRole("button", { name: "Items per page" }), "5", "ArrowUp");
    await expect(rowCount(page)).toHaveCount(5);

    // Widen and shrink the page again while the Select keeps focus, then page.
    await chooseOption(page, page.getByRole("button", { name: "Items per page" }), "10");
    await expect(rowCount(page)).toHaveCount(7);
    await chooseOption(page, page.getByRole("button", { name: "Items per page" }), "5", "ArrowUp");
    await expect(rowCount(page)).toHaveCount(5);

    await tabTo(page, page.getByRole("button", { name: "Next page" }), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(rowCount(page)).toHaveCount(2);

    await tabTo(page, page.getByRole("button", { name: "Previous page" }), {
      max: 6,
      backwards: true,
    });
    await page.keyboard.press("Enter");
    await expect(rowCount(page)).toHaveCount(5);
  });
});

test.describe("Restore a Backup @wf:backup-restore", () => {
  test("Restore replaces the Library and brings a deleted Canvas back", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50 });
    await page.clock.setFixedTime(new Date("2026-05-01T09:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 1, new Date("2026-05-01T09:00:10Z"));

    // Lose the Canvas after the Backup was taken.
    await page.goto("/canvas");
    const card = page.getByRole("grid", { name: "Canvases" }).getByRole("row", {
      name: BACKUPS_CANVAS,
    });
    await expect(card).toHaveCount(1);
    await tabTo(page, card, { max: 40 });
    await tabTo(page, card.getByRole("button", { name: "Delete canvas" }), { max: 6 });
    await page.keyboard.press("Enter");
    await tabTo(page, card.getByRole("button", { name: "Delete canvas", exact: true }), {
      max: 60,
    });
    await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);

    // Restore the Backup taken before the deletion.
    await openBackups(page);
    await tabTo(page, manual(page).getByRole("button", { name: "Restore" }), { max: 40 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Restore" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("This replaces all books");
    await tabTo(page, dialog.getByRole("button", { name: "Restore", exact: true }), { max: 4 });
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("status").filter({ hasText: "Backup restored successfully" })
    ).toBeVisible();
    // Restoring first takes a safety "Pre-restore" Backup.
    await expect(page.getByRole("row").filter({ hasText: "Pre-restore" })).toHaveCount(1);

    await page.goto("/canvas");
    await expect(
      page.getByRole("grid", { name: "Canvases" }).getByRole("row", { name: BACKUPS_CANVAS })
    ).toHaveCount(1);
    await page.reload();
    await expect(
      page.getByRole("grid", { name: "Canvases" }).getByRole("row", { name: BACKUPS_CANVAS })
    ).toHaveCount(1);
  });

  test("a corrupt Backup is refused and the Library is untouched", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50 });
    await page.clock.setFixedTime(new Date("2026-05-02T09:00:00Z"));
    await openBackups(page);
    await focusCreate(page);
    await createBackups(page, 1, new Date("2026-05-02T09:00:10Z"));

    await tamperBackupChecksums(page);
    await tabTo(page, manual(page).getByRole("button", { name: "Restore" }), { max: 40 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Restore" });
    await tabTo(page, dialog.getByRole("button", { name: "Restore", exact: true }), { max: 4 });
    await page.keyboard.press("Enter");

    const error = page.getByRole("dialog", { name: "Backups" });
    await expect(error.getByText("Backup is corrupted and cannot be restored.")).toBeVisible();
    await tabTo(page, error.getByRole("button", { name: "OK", exact: true }), { max: 4 });
    await page.keyboard.press("Enter");

    // Nothing changed: the Book is still there.
    await page.keyboard.press("g");
    await page.keyboard.press("p");
    await expect(page.getByRole("grid", { name: "Books" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "Books" }).getByRole("row")).toHaveCount(1);
  });
});

test.describe("Backup retention @wf:backup-retention", () => {
  test("creating beyond the limit prunes the oldest Backups", async ({ page }) => {
    await seedSettings(page, { backupRetention: 50 });
    await page.clock.setFixedTime(new Date("2026-06-01T09:00:00Z"));
    await openBackups(page);
    await expect(daily(page)).toHaveCount(1);

    // Four Manuals under a generous limit: five Backups with the Daily.
    await focusCreate(page);
    await createBackups(page, 4, new Date("2026-06-01T09:00:10Z"));
    await expect(rowCount(page)).toHaveCount(5);

    // Tighten the limit; the next creation prunes down to it.
    const retention = page.getByRole("spinbutton", { name: "Maximum backups to keep" });
    await tabTo(page, retention, { max: 40, backwards: true });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("3");
    await expect(retention).toHaveValue("3");

    await focusCreate(page);
    await page.clock.setFixedTime(new Date("2026-06-01T09:00:30Z"));
    await page.keyboard.press("Enter");

    // Limit is 3: the newest three survive; the oldest Backups were pruned.
    await expect(rowCount(page)).toHaveCount(3);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    await expect(rowCount(page)).toHaveCount(3);
  });

  test("an invalid retention value falls back to one", async ({ page }) => {
    await openBackups(page);

    const retention = page.getByRole("spinbutton", { name: "Maximum backups to keep" });
    await tabTo(page, retention, { max: 40 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type("0");
    await expect(retention).toHaveValue("1");
  });
});
