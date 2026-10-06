import type { Page } from "@playwright/test";
import { failBackupWrites } from "../../support/fault";
import { tabTo } from "../../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../../support/seed/names";
import { countBackupsByTrigger } from "../../support/storage";
import {
  bookCard,
  chapterText,
  countObjectsRequests,
  enterPassphrase,
  expect,
  failObjectsApi,
  holdObjectsApi,
  logEntries,
  openSettings,
  signIn,
  syncButton,
  syncFromSettings,
  syncSection,
  test,
} from "../../support/sync";

// Faults during a manual Sync (issue #222, CODING_STANDARDS.md feature-critical gate):
// the author reads what went wrong, a pre-sync Backup exists before anything
// is read from the server, and local data is untouched.
test.use({ library: "oneBookThreeChapters" });

const STORM = SEED_CHAPTERS[2].text;
const pushed = `Pushed book ${SEED_BOOK.title}`;
const BACKUP_ABORT =
  "Could not create a safety backup. Sync aborted. Free up disk space and try again.";

/** From Settings to the open Book's editor without a reload, so this launch's sync state stays. */
async function openBookInApp(page: Page): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(bookCard(page, SEED_BOOK.title)).toBeVisible();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  await expect(chapterText(page)).toBeFocused();
  await expect(chapterText(page)).toContainText(STORM);
}

test.describe("Sync faults @wf:sync-faults", () => {
  test("Offline: No internet connection, no Backup, nothing reaches the server", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    const requests = countObjectsRequests(page, syncUrl);
    await page.context().setOffline(true);
    await syncFromSettings(page, { passphrase: account.passphrase });

    await expect(logEntries(syncSection(page)).first()).toHaveText("No internet connection");
    expect(await countBackupsByTrigger(page, "pre-sync")).toBe(0);
    expect(requests()).toBe(0);
  });

  test("5xx: the error in the Sync log and panel, a Pre-sync Backup, the Book unchanged", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    await failObjectsApi(page, syncUrl, 503);
    await syncFromSettings(page, { passphrase: account.passphrase });

    // The PocketBase SDK's own copy for a response without a JSON message.
    const message = "Something went wrong.";
    await expect(logEntries(syncSection(page)).first()).toHaveText(message);
    await expect(
      logEntries(syncSection(page)).filter({ hasText: "Created pre-sync safety backup" })
    ).toHaveCount(1);
    expect(await countBackupsByTrigger(page, "pre-sync")).toBe(1);

    await openBookInApp(page);
    const status = page.getByRole("button", { name: "Sync status" });
    await page.keyboard.press("Escape");
    await tabTo(page, status, { max: 80, backwards: true });
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Sync status" });
    await expect(panel.getByText(message, { exact: true }).first()).toBeVisible();

    // Settings > Backups lists it for the author (the list loads on mount).
    await openSettings(page);
    await expect(page.getByRole("row").filter({ hasText: "Pre-sync" })).toHaveCount(1);
  });

  test("Slow response: Syncing... while held, the Backup already exists, Mod+Shift+Y starts no second run", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    const slow = await holdObjectsApi(page, syncUrl);
    await tabTo(page, syncButton(page), { max: 80 });
    await page.keyboard.press("Enter");
    await enterPassphrase(page, account.passphrase);

    await slow.held;
    await expect(syncButton(page)).toHaveText("Syncing...");
    await expect(syncButton(page)).toBeDisabled();
    expect(await countBackupsByTrigger(page, "pre-sync")).toBe(1);
    await page.keyboard.press("ControlOrMeta+Shift+Y");

    await slow.release();
    await expect(syncButton(page)).toHaveText("Sync", { timeout: 20_000 });
    const section = syncSection(page);
    await expect(logEntries(section).filter({ hasText: pushed })).toHaveCount(1);
    await expect(
      logEntries(section).filter({ hasText: "Created pre-sync safety backup" })
    ).toHaveCount(1);
  });

  test("Backup failure: the exact abort copy and nothing reaches the server", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    const requests = countObjectsRequests(page, syncUrl);
    await failBackupWrites(page);
    await syncFromSettings(page, { passphrase: account.passphrase });

    await expect(logEntries(syncSection(page)).first()).toHaveText(BACKUP_ABORT);
    expect(requests()).toBe(0);
    expect(await countBackupsByTrigger(page, "pre-sync")).toBe(0);
    // Aborted before anything was read or written: the Book is as it was.
    await openBookInApp(page);
  });
});
