import { SEED_BOOK, SEED_NOTES } from "../../support/seed/names";
import {
  bookCard,
  chooseSyncOption,
  expect,
  logEntries,
  openHome,
  signIn,
  signInAndSync,
  syncFromSettings,
  syncSection,
  test,
} from "../../support/sync";

// Sync Scope and Sync Direction (issue #222): what a run covers and which way
// it moves changes, chosen in Settings > Sync before pressing Sync.
test.use({ library: "notesWithLinksAndTags" });

const pushedBook = `Pushed book ${SEED_BOOK.title}`;

test.describe("Choose a Sync Scope and Direction @wf:sync-scope-direction", () => {
  test("Scope Books pushes the Book and no Note", async ({ page, syncUrl, account }) => {
    await signIn(page, syncUrl, account);
    await chooseSyncOption(page, "Scope", "Books");
    await syncFromSettings(page, { passphrase: account.passphrase, until: pushedBook });
    await expect(logEntries(syncSection(page)).filter({ hasText: /note/i })).toHaveCount(0);

    // Scope All then carries the Notes.
    await chooseSyncOption(page, "Scope", "All");
    await syncFromSettings(page, { until: `Pushed note ${SEED_NOTES.tideTables}` });
  });

  test("Pull only skips a local-only Book", async ({ page, syncUrl, account }) => {
    await signIn(page, syncUrl, account);
    await chooseSyncOption(page, "Direction", "Pull only");
    await syncFromSettings(page, {
      passphrase: account.passphrase,
      until: `Skipped local-only book ${SEED_BOOK.title} in pull-only sync`,
    });
    await expect(logEntries(syncSection(page)).filter({ hasText: /^Pushed/ })).toHaveCount(0);
  });

  test("Push only does not pull another device's Book", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await signInAndSync(page, syncUrl, account, pushedBook);

    const deviceB = await openDevice();
    await signIn(deviceB, syncUrl, account);
    await chooseSyncOption(deviceB, "Direction", "Push only");
    await syncFromSettings(deviceB, { passphrase: account.passphrase });
    await expect(logEntries(syncSection(deviceB)).filter({ hasText: /^Pulled/ })).toHaveCount(0);
    await openHome(deviceB);
    await expect(bookCard(deviceB, SEED_BOOK.title)).toHaveCount(0);
  });
});
