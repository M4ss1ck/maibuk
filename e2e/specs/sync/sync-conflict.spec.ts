import type { Page } from "@playwright/test";
import { expectFocusWithin, expectTabContained, tabTo } from "../../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../../support/seed/names";
import {
  appendAndSave,
  chapterText,
  expect,
  logEntries,
  openFirstBook,
  openSettings,
  signInAndSync,
  syncButton,
  syncFromSettings,
  syncSection,
  test,
  type SyncAccount,
} from "../../support/sync";

// Conflicts (issue #222): both devices edit the same chapter after a shared
// sync; the second device to sync must choose which state wins. The product
// offers Keep Local & Push, Use Remote & Pull, and Cancel; there is no
// "keep both".
test.use({ library: "oneBookThreeChapters" });

const STORM = SEED_CHAPTERS[2].text;
const A_EDIT = " Device A saw the lamp go out.";
const B_EDIT = " Device B relit it before dawn.";
const conflictDialog = (page: Page) => page.getByRole("dialog", { name: "Sync Conflict" });

/** A pushes, B pulls, both edit the Storm chapter, A syncs again. Returns B. */
async function makeConflict(
  page: Page,
  syncUrl: string,
  account: SyncAccount,
  openDevice: () => Promise<Page>
): Promise<Page> {
  await signInAndSync(page, syncUrl, account, `Pushed book ${SEED_BOOK.title}`);
  const deviceB = await openDevice();
  await signInAndSync(deviceB, syncUrl, account, /Pulled (remote-only )?book/);

  await openFirstBook(page, SEED_BOOK.title, STORM);
  await appendAndSave(page, A_EDIT);
  await openFirstBook(deviceB, SEED_BOOK.title, STORM);
  await appendAndSave(deviceB, B_EDIT);

  await openSettings(page);
  await syncFromSettings(page, { until: `Pushed book ${SEED_BOOK.title}` });

  await openSettings(deviceB);
  await tabTo(deviceB, syncButton(deviceB), { max: 80 });
  await deviceB.keyboard.press("Enter");
  await expect(conflictDialog(deviceB)).toBeVisible();
  await expect(conflictDialog(deviceB)).toContainText(SEED_BOOK.title);
  return deviceB;
}

async function choose(page: Page, name: string): Promise<void> {
  await tabTo(page, conflictDialog(page).getByRole("button", { name, exact: true }), { max: 10 });
  await page.keyboard.press("Enter");
  await expect(conflictDialog(page)).toBeHidden();
  await expect(syncButton(page)).toHaveText("Sync", { timeout: 20_000 });
}

test.describe("Resolve a Sync Conflict @wf:sync-conflict", () => {
  test("Keep Local & Push: B's text wins and A pulls it", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    const deviceB = await makeConflict(page, syncUrl, account, openDevice);
    const dialog = conflictDialog(deviceB);
    await expectFocusWithin(dialog);
    await expectTabContained(deviceB, dialog);
    await choose(deviceB, "Keep Local & Push");
    await expect(logEntries(syncSection(deviceB)).filter({ hasText: `Pushed book ${SEED_BOOK.title}` })).toHaveCount(1);

    await syncFromSettings(page, { until: /^Pulled book/ });
    await openFirstBook(page, SEED_BOOK.title, B_EDIT.trim());
    await expect(chapterText(page)).not.toContainText(A_EDIT.trim());
  });

  test("Use Remote & Pull: B gets A's text", async ({ page, syncUrl, account, openDevice }) => {
    const deviceB = await makeConflict(page, syncUrl, account, openDevice);
    await choose(deviceB, "Use Remote & Pull");
    await expect(logEntries(syncSection(deviceB)).filter({ hasText: /^Pulled book/ })).toHaveCount(1);

    await openFirstBook(deviceB, SEED_BOOK.title, A_EDIT.trim());
    await expect(chapterText(deviceB)).not.toContainText(B_EDIT.trim());
  });

  test("Escape cancels: nothing changes on either device", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    const deviceB = await makeConflict(page, syncUrl, account, openDevice);
    await deviceB.keyboard.press("Escape");
    await expect(conflictDialog(deviceB)).toBeHidden();
    await expect(syncButton(deviceB)).toHaveText("Sync", { timeout: 20_000 });

    await openFirstBook(deviceB, SEED_BOOK.title, B_EDIT.trim());
    await expect(chapterText(deviceB)).not.toContainText(A_EDIT.trim());
    // A's state is still the server's: A's next Sync has nothing to pull.
    await syncFromSettings(page, { until: `Skipped unchanged book ${SEED_BOOK.title}` });
    await openFirstBook(page, SEED_BOOK.title, A_EDIT.trim());
    await expect(chapterText(page)).not.toContainText(B_EDIT.trim());
  });
});
