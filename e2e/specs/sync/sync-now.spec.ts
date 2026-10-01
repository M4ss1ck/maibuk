import { SEED_BOOK, SEED_CHAPTERS } from "../../support/seed/names";
import { tabTo } from "../../support/keyboard";
import {
  appendAndSave,
  chapterText,
  gotoSettingsInApp,
  expect,
  logEntries,
  openFirstBook,
  openHome,
  signInAndSync,
  syncFromSettings,
  syncSection,
  test,
} from "../../support/sync";

// Sync Now (issue #222): device A Pushes its Book, device B Pulls it, by the
// Settings button and by Mod+Shift+Y. Two browser contexts, one Sync Account.
test.use({ library: "oneBookThreeChapters" });

const STORM = SEED_CHAPTERS[2].text;
const pushed = `Pushed book ${SEED_BOOK.title}`;
const pulled = new RegExp(`Pulled (remote-only )?book ${SEED_BOOK.title}`);

test.describe("Sync Now pushes and pulls a Book @wf:sync-now", () => {
  test("A pushes its Book; B pulls it, with its chapter text", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await signInAndSync(page, syncUrl, account, pushed);
    await expect(
      logEntries(syncSection(page)).filter({ hasText: "Created pre-sync safety backup" })
    ).toHaveCount(1);

    const deviceB = await openDevice();
    await signInAndSync(deviceB, syncUrl, account, pulled);
    await openFirstBook(deviceB, SEED_BOOK.title, STORM);
    await expect(chapterText(deviceB)).toContainText(STORM);
  });

  test("A second Sync with nothing changed logs Skipped unchanged book", async ({
    page,
    syncUrl,
    account,
  }) => {
    await signInAndSync(page, syncUrl, account, pushed);
    await syncFromSettings(page, { until: `Skipped unchanged book ${SEED_BOOK.title}` });
    await expect(logEntries(syncSection(page)).filter({ hasText: pushed })).toHaveCount(1);
  });

  test("Mod+Shift+Y on Home runs a full sync @sc:global.syncNow", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    // The Passphrase is set once in Settings; the shortcut uses it from then on.
    await signInAndSync(page, syncUrl, account, pushed);
    const deviceB = await openDevice();
    await signInAndSync(deviceB, syncUrl, account, pulled);

    await openFirstBook(page, SEED_BOOK.title, STORM);
    await appendAndSave(page, " The keeper wrote it down.");
    await openHome(page);
    await page.keyboard.press("ControlOrMeta+Shift+Y");
    // g s moves inside the app; a reload would drop this launch's Sync log.
    await gotoSettingsInApp(page);
    await expect(logEntries(syncSection(page)).filter({ hasText: pushed })).toHaveCount(1);

    await openHome(deviceB);
    await deviceB.keyboard.press("ControlOrMeta+Shift+Y");
    await gotoSettingsInApp(deviceB);
    await expect(logEntries(syncSection(deviceB)).filter({ hasText: /^Pulled book/ })).toHaveCount(
      1
    );
    await openFirstBook(deviceB, SEED_BOOK.title, "The keeper wrote it down.");
  });

  test("Mod+Shift+Y in the Book Editor syncs that Book @sc:global.syncNow", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await signInAndSync(page, syncUrl, account, pushed);
    const deviceB = await openDevice();
    await signInAndSync(deviceB, syncUrl, account, pulled);

    await openFirstBook(page, SEED_BOOK.title, STORM);
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Oil for one more night.");
    // Pressed while typing: the shortcut works in the text and lands the
    // unsaved words before it Pushes.
    await page.keyboard.press("ControlOrMeta+Shift+Y");
    const status = page.getByRole("button", { name: "Sync status" });
    // Escape leaves the text for the Chapter list; the title bar is above it.
    await page.keyboard.press("Escape");
    await tabTo(page, status, { max: 80, backwards: true });
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Sync status" });
    await expect(logEntries(panel).filter({ hasText: pushed })).toHaveCount(1);
    // The Book Editor's run covers this Book only: no Note or Canvas scope line.
    await expect(logEntries(panel).filter({ hasText: /note|canvas/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(status).toBeFocused();

    await syncFromSettings(deviceB, { until: /^Pulled book/ });
    await openFirstBook(deviceB, SEED_BOOK.title, "Oil for one more night.");
  });
});
