import type { Page } from "@playwright/test";
import { tabTo } from "../../support/keyboard";
import { SEED_BOOK, SEED_CHAPTERS } from "../../support/seed/names";
import {
  appendAndSave,
  expect,
  logEntries,
  openFirstBook,
  openSettings,
  signInAndSync,
  syncButton,
  syncSection,
  test,
} from "../../support/sync";

// Auto Sync (issue #222): a local Change on the Change Feed schedules a sync
// 30 s after the author stops editing. The clock is fast-forwarded, never
// waited out. An item changed on both devices is Deferred, never prompted.
test.use({ library: "oneBookThreeChapters", autoSync: true });

const STORM = SEED_CHAPTERS[2].text;
const TITLE = SEED_BOOK.title;
const pulled = /Pulled (remote-only )?book/;
const QUIET_MS = 31_000;

/** Opens the Book Editor's Sync status panel by keyboard. */
async function openStatusPanel(page: Page) {
  const status = page.getByRole("button", { name: "Sync status" });
  await page.keyboard.press("Escape");
  await tabTo(page, status, { max: 80, backwards: true });
  await page.keyboard.press("Enter");
  return page.getByRole("dialog", { name: "Sync status" });
}

test.describe("Auto Sync after an edit @wf:sync-auto", () => {
  test("30 s after an edit the Change is pushed with no key pressed; B pulls it", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await page.clock.install();
    await signInAndSync(page, syncUrl, account, `Pushed book ${TITLE}`);
    const deviceB = await openDevice();
    await signInAndSync(deviceB, syncUrl, account, pulled);

    await openFirstBook(page, TITLE, STORM);
    await appendAndSave(page, " Written, then left alone.");
    await page.clock.fastForward(QUIET_MS);
    const panel = await openStatusPanel(page);
    await expect(logEntries(panel).filter({ hasText: "Automatic sync" }).first()).toBeVisible();
    await expect(logEntries(panel).filter({ hasText: `Pushed book ${TITLE}` })).toHaveCount(1);

    await openSettings(deviceB);
    await tabTo(deviceB, syncButton(deviceB), { max: 80 });
    await deviceB.keyboard.press("Enter");
    await expect(logEntries(syncSection(deviceB)).filter({ hasText: /^Pulled book/ })).toHaveCount(
      1
    );
    await openFirstBook(deviceB, TITLE, "Written, then left alone.");
  });

  test("With Sync automatically off, the same quiet pushes nothing", async ({
    page,
    syncUrl,
    account,
  }) => {
    await page.clock.install();
    await signInAndSync(page, syncUrl, account, `Pushed book ${TITLE}`);
    const toggle = syncSection(page).getByRole("switch", { name: "Sync automatically" });
    await tabTo(page, toggle, { max: 40, backwards: true });
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();

    await openFirstBook(page, TITLE, STORM);
    await appendAndSave(page, " Not sent on its own.");
    await page.clock.fastForward(QUIET_MS);
    const panel = await openStatusPanel(page);
    await expect(panel.getByRole("button", { name: /^Sync log/ })).toHaveCount(0);

    // The edit was there to push: a manual sync from the open panel sends it.
    await tabTo(page, panel.getByRole("button", { name: "Sync", exact: true }), { max: 10 });
    await page.keyboard.press("Enter");
    await expect(logEntries(panel).filter({ hasText: `Pushed book ${TITLE}` })).toHaveCount(1);
  });

  test("Changed on both devices: Auto Sync defers it with no dialog; the next manual Sync asks", async ({
    page,
    syncUrl,
    account,
    openDevice,
  }) => {
    await signInAndSync(page, syncUrl, account, `Pushed book ${TITLE}`);
    const deviceB = await openDevice();
    await deviceB.clock.install();
    await signInAndSync(deviceB, syncUrl, account, pulled);

    await openFirstBook(page, TITLE, STORM);
    await appendAndSave(page, " A's line.");
    await page.keyboard.press("ControlOrMeta+Shift+Y");
    const panelA = await openStatusPanel(page);
    await expect(logEntries(panelA).filter({ hasText: `Pushed book ${TITLE}` })).toHaveCount(1);

    await openFirstBook(deviceB, TITLE, STORM);
    await appendAndSave(deviceB, " B's line.");
    await deviceB.clock.fastForward(QUIET_MS);
    const panelB = await openStatusPanel(deviceB);
    await expect(
      logEntries(panelB).filter({ hasText: "run a manual sync to choose" }).first()
    ).toBeVisible();
    await expect(deviceB.getByRole("dialog", { name: "Sync Conflict" })).toHaveCount(0);

    await deviceB.keyboard.press("Escape");
    await openSettings(deviceB);
    await tabTo(deviceB, syncButton(deviceB), { max: 80 });
    await deviceB.keyboard.press("Enter");
    await expect(deviceB.getByRole("dialog", { name: "Sync Conflict" })).toContainText(TITLE);
  });
});
