import type { Page } from "@playwright/test";
import { tabTo } from "../../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../../support/seed/names";
import {
  appendAndSave,
  bookCard,
  deleteOpenBook,
  expect,
  logEntries,
  openFirstBook,
  openHome,
  openSettings,
  signInAndSync,
  syncButton,
  syncFromSettings,
  syncSection,
  test,
  type SyncAccount,
} from "../../support/sync";

// Deleting a Synced Item (issue #222): a Delete waits in a Deletion Review on
// each device until the author confirms it; the Tombstone keeps it gone.
test.use({ library: "oneBookThreeChapters" });

const STORM = SEED_CHAPTERS[2].text;
const TITLE = SEED_BOOK.title;
const pulled = /Pulled (remote-only )?book/;

const reviewGroup = (page: Page, title: string) =>
  syncSection(page).locator("div").filter({ has: page.getByText(title, { exact: true }) }).last();

/** A and B share the Book; A deletes it, confirms its review, and syncs. Returns B. */
async function deleteOnA(
  page: Page,
  syncUrl: string,
  account: SyncAccount,
  openDevice: () => Promise<Page>
): Promise<Page> {
  await signInAndSync(page, syncUrl, account, `Pushed book ${TITLE}`);
  const deviceB = await openDevice();
  await signInAndSync(deviceB, syncUrl, account, pulled);

  await openFirstBook(page, TITLE, STORM);
  await deleteOpenBook(page);
  await openSettings(page);
  await syncFromSettings(page, { until: `Deletion needs confirmation: ${TITLE}` });
  await expect(syncSection(page).getByText("Deletions made on this device", { exact: true })).toBeVisible();
  await expect(reviewGroup(page, "Deletions made on this device")).toContainText(TITLE);
  await tabTo(page, syncSection(page).getByRole("button", { name: "Delete remote copies" }), {
    max: 40,
  });
  await page.keyboard.press("Enter");
  await expect(
    logEntries(syncSection(page)).filter({ hasText: `Deleted remote book: ${TITLE}` })
  ).toHaveCount(1);
  await expect(syncSection(page).getByText("Deletions made on this device", { exact: true })).toHaveCount(0);
  return deviceB;
}

test.describe("Deleted Elsewhere and the Deletion Review @wf:sync-deleted-elsewhere", () => {
  test("A's Delete reaches B after each device confirms its review", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    const deviceB = await deleteOnA(page, syncUrl, account, openDevice);

    await openSettings(deviceB);
    await syncFromSettings(deviceB, { until: `Deleted on another device, needs confirmation: ${TITLE}` });
    await expect(reviewGroup(deviceB, "Deleted on another device")).toContainText(TITLE);
    await tabTo(deviceB, syncSection(deviceB).getByRole("button", { name: "Delete from this device" }), {
      max: 40,
    });
    await deviceB.keyboard.press("Enter");
    await expect(syncSection(deviceB).getByText("Deleted on another device", { exact: true })).toHaveCount(0);
    await expect(syncButton(deviceB)).toHaveText("Sync", { timeout: 20_000 });

    await openHome(deviceB);
    await expect(bookCard(deviceB, TITLE)).toHaveCount(0);
  });

  test("An unconfirmed Deletion Review leaves the Book on B", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    const deviceB = await deleteOnA(page, syncUrl, account, openDevice);
    await openSettings(deviceB);
    await syncFromSettings(deviceB, { until: `Deleted on another device, needs confirmation: ${TITLE}` });

    await openHome(deviceB);
    await expect(bookCard(deviceB, TITLE)).toBeVisible();
  });

  test("B edited it meanwhile: Keep & Push keeps it on the server", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    const deviceB = await deleteOnA(page, syncUrl, account, openDevice);
    await openFirstBook(deviceB, TITLE, STORM);
    await appendAndSave(deviceB, " Kept on purpose.");

    await openSettings(deviceB);
    await tabTo(deviceB, syncButton(deviceB), { max: 80 });
    await deviceB.keyboard.press("Enter");
    const dialog = deviceB.getByRole("dialog", { name: "Deleted on Another Device" });
    await expect(dialog).toContainText(TITLE);
    await tabTo(deviceB, dialog.getByRole("button", { name: "Keep & Push", exact: true }), {
      max: 10,
    });
    await deviceB.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(syncButton(deviceB)).toHaveText("Sync", { timeout: 20_000 });
    await expect(
      logEntries(syncSection(deviceB)).filter({ hasText: `Pushed book ${TITLE}` })
    ).toHaveCount(1);

    // A third device signing in now gets the kept Book with B's text.
    const deviceC = await openDevice();
    await signInAndSync(deviceC, syncUrl, account, pulled);
    await openFirstBook(deviceC, TITLE, "Kept on purpose.");
  });

  test("After confirming, A's next Sync never re-creates the Book", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await deleteOnA(page, syncUrl, account, openDevice);
    await syncFromSettings(page);
    await expect(logEntries(syncSection(page)).filter({ hasText: /^Pulled/ })).toHaveCount(0);
    await openHome(page);
    await expect(bookCard(page, TITLE)).toHaveCount(0);
  });
});
