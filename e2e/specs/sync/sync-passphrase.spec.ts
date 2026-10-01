import { expectTabContained, tabTo } from "../../support/keyboard";
import { SEED_BOOK } from "../../support/seed/names";
import { countBackupsByTrigger } from "../../support/storage";
import {
  bookCard,
  enterPassphrase,
  expect,
  logEntries,
  logHeader,
  openHome,
  passphraseDialog,
  signIn,
  signInAndSync,
  syncButton,
  syncFromSettings,
  syncSection,
  test,
} from "../../support/sync";

// The Passphrase (issue #222): asked for on the first Sync of a session, it
// encrypts on this device; the server never sees it.
test.use({ library: "oneBookThreeChapters" });

const pushed = `Pushed book ${SEED_BOOK.title}`;

test.describe("Enter the Passphrase @wf:sync-passphrase", () => {
  test("The first Sync asks for the Passphrase; Enter confirms and Close runs the sync", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    await tabTo(page, syncButton(page), { max: 80 });
    await page.keyboard.press("Enter");

    const dialog = passphraseDialog(page);
    await expect(dialog.getByLabel("Encryption Passphrase")).toBeFocused();
    await expectTabContained(page, dialog);
    await tabTo(page, dialog.getByLabel("Encryption Passphrase"), { max: 10 });
    await enterPassphrase(page, account.passphrase);

    await expect(logEntries(syncSection(page)).filter({ hasText: pushed })).toHaveCount(1);
  });

  test("Show passphrase toggles the field between hidden and visible", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    await tabTo(page, syncButton(page), { max: 80 });
    await page.keyboard.press("Enter");

    const dialog = passphraseDialog(page);
    const field = dialog.getByLabel("Encryption Passphrase");
    await expect(field).toBeFocused();
    await page.keyboard.type(account.passphrase);
    await expect(field).toHaveAttribute("type", "password");

    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Show passphrase" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toHaveAttribute("type", "text");
    await expect(dialog.getByRole("button", { name: "Hide passphrase" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(field).toHaveAttribute("type", "password");
    await expect(field).toHaveValue(account.passphrase);
  });

  test("Escape before confirming runs no sync and takes no Backup", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signIn(page, syncUrl, account);
    await tabTo(page, syncButton(page), { max: 80 });
    await page.keyboard.press("Enter");
    await expect(passphraseDialog(page)).toBeVisible();
    await page.keyboard.type(account.passphrase);
    await page.keyboard.press("Escape");

    await expect(passphraseDialog(page)).toBeHidden();
    await expect(syncButton(page)).toBeFocused();
    await expect(syncButton(page)).toHaveText("Sync");
    await expect(logHeader(syncSection(page))).toHaveCount(0);
    expect(await countBackupsByTrigger(page, "pre-sync")).toBe(0);

    // Not kept: the next Sync asks again.
    await page.keyboard.press("Enter");
    await expect(passphraseDialog(page)).toBeVisible();
  });

  test("A device with a different Passphrase does not get the Book", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await signInAndSync(page, syncUrl, account, pushed);

    const deviceB = await openDevice();
    await signIn(deviceB, syncUrl, account);
    await syncFromSettings(deviceB, { passphrase: `${account.passphrase}-wrong` });
    await expect(
      logEntries(syncSection(deviceB)).filter({ hasText: /decrypt|passphrase/i }).first()
    ).toBeVisible();
    await openHome(deviceB);
    await expect(bookCard(deviceB, SEED_BOOK.title)).toHaveCount(0);
  });
});
