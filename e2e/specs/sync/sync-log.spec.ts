import { tabTo } from "../../support/keyboard";
import { SEED_BOOK } from "../../support/seed/names";
import {
  expect,
  failObjectsApi,
  logEntries,
  logHeader,
  signIn,
  signInAndSync,
  syncFromSettings,
  syncSection,
  test,
} from "../../support/sync";

// The Sync Log (issue #222): what each run did to each Synced Item, failures
// included, in Settings.
test.use({ library: "oneBookThreeChapters" });

const pushed = `Pushed book ${SEED_BOOK.title}`;

test.describe("Read the Sync Log @wf:sync-log", () => {
  test("Lists the run; Enter on its header collapses and expands it; Clear empties it", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signInAndSync(page, syncUrl, account, pushed);
    const section = syncSection(page);
    const header = logHeader(section);
    await expect(logEntries(section).filter({ hasText: "Created pre-sync safety backup" })).toHaveCount(1);
    await expect(header).toHaveAttribute("aria-expanded", "true");

    await tabTo(page, header, { max: 40 });
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(logEntries(section)).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(logEntries(section).filter({ hasText: pushed })).toHaveCount(1);

    await tabTo(page, section.getByRole("button", { name: "Clear sync log" }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(header).toHaveCount(0);
  });

  test("A failed run adds an error entry", async ({ page, syncUrl, account }) => {
    await signIn(page, syncUrl, account);
    await failObjectsApi(page, syncUrl, 500);
    await syncFromSettings(page, { passphrase: account.passphrase });
    const section = syncSection(page);
    await expect(logEntries(section).first()).toContainText("Something went wrong");
    await expect(logEntries(section).filter({ hasText: pushed })).toHaveCount(0);
  });
});
