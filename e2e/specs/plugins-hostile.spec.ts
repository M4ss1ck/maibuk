// The fixture-hostile Plugin (issue #446): one Command per escape attempt, run
// from the Command Palette by keyboard. Every escape must fail safely — the
// Plugin reports a typed refusal, or the host stops it with a reason — and no
// request or WebSocket may leave the sandbox. That last half is asserted
// Node-side: the escape targets the recording server the E2E global setup
// starts (`e2e/support/request-log.ts`), and `loggedRequests()` — read with
// Node fs, never `evaluate` — must stay empty. Tagged @sandbox so the lane runs
// on Chromium, WebKit, and Firefox.

import type { Locator, Page } from "@playwright/test";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { loggedRequests } from "../support/request-log";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

const PLUGIN_ID = "fixture-hostile";

/** The non-terminal escapes: each reports a typed refusal from its own Command. */
const REFUSALS: { label: string; report: string }[] = [
  { label: "Hostile fetch", report: "hostile escapeFetch refused" },
  { label: "Hostile XHR", report: "hostile escapeXhr refused" },
  { label: "Hostile WebSocket", report: "hostile escapeWebSocket refused" },
  { label: "Hostile EventSource", report: "hostile escapeEventSource refused" },
  { label: "Hostile sendBeacon", report: "hostile escapeSendBeacon refused" },
  { label: "Hostile importScripts", report: "hostile escapeImportScripts refused" },
  { label: "Hostile dynamic import", report: "hostile escapeDynamicImport refused" },
  { label: "Hostile eval", report: "hostile escapeEval refused" },
  { label: "Hostile data Worker", report: "hostile escapeDataWorker refused" },
  { label: "Hostile IndexedDB", report: "hostile escapeIndexedDb refused" },
  { label: "Hostile caches", report: "hostile escapeCaches refused" },
  { label: "Hostile localStorage", report: "hostile escapeLocalStorage refused" },
  { label: "Hostile Tauri IPC", report: "hostile escapeTauriIpc refused" },
  {
    label: "Hostile oversized payload",
    report: "hostile escapeOversized refused: message-too-large",
  },
  {
    label: "Hostile unknown method",
    report: "hostile escapeUnknownMethod refused: unknown-method",
  },
  { label: "Hostile write", report: "hostile escapeWrite refused: permission-denied" },
];

const status = (page: Page) => page.getByRole("status");

/**
 * The Node-side half of the pass rule: the recording server logged nothing.
 * The escape targets it (its origin is 127.0.0.1, the one origin the hermetic
 * network lets through), so an escape that reaches the network is recorded
 * here. Read from Node, never `page.evaluate`.
 */
const leakCount = async (): Promise<number> => (await loggedRequests()).length;

/**
 * Asserts the log gained nothing while the Command ran. The file runs serial
 * and no other spec targets the recorder, so the count is the whole log; the
 * per-Command marker the parallel case would need is absent from the fixture's
 * URLs.
 */
async function expectNoLeak(before: number): Promise<void> {
  const after = await loggedRequests();
  expect(after.length, "a request or WebSocket left the sandbox").toBe(before);
  expect(after, "the request log must stay empty").toEqual([]);
}

/**
 * Waits for the Plugin to be ready by opening its page: the route only renders
 * the Plugin's tree once its Worker answered the handshake. `lastPath` is seeded
 * null so a later return to Home sticks.
 */
async function waitForReady(page: Page): Promise<void> {
  await seedSettings(page, { lastPath: null });
  await page.goto(`/plugin/${PLUGIN_ID}/panel`);
  await expect(page.getByText("Sandbox escape fixture.")).toBeVisible({ timeout: 15_000 });
}

/** Runs one Plugin Command from the Command Palette, by keyboard. */
async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(label);
  const option = dialog.getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** Jumps to the Plugins section through the Settings outline, by keyboard. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/** Tabs to the Plugin's row and expands it. */
async function expandPluginRow(page: Page): Promise<Locator> {
  const row = page.getByRole("button", { name: /^Fixture Hostile/ });
  await tabTo(page, row, { max: 30 });
  await page.keyboard.press("Enter");
  return row;
}

/** Expands the nested Permissions accordion inside an open card. */
async function openPermissions(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /Plugin permissions/ });
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

test.describe("fixture-hostile escapes @wf:plugins-sandbox @sandbox", () => {
  // The leak assertion reads one shared log, so the tests in this file run one
  // at a time: a concurrent test's recorder traffic would otherwise look like
  // this test's leak.
  test.describe.configure({ mode: "serial" });

  test.use({
    plugins: [PLUGIN_ID],
    pluginApprovals: [{ pluginId: PLUGIN_ID, granted: ["library:read"] }],
  });

  for (const attempt of REFUSALS) {
    test(`${attempt.label} fails safely with a typed refusal`, async ({ page }) => {
      const before = await leakCount();
      await waitForReady(page);
      await runCommand(page, attempt.label);
      await expect(status(page).filter({ hasText: attempt.report })).toBeVisible({
        timeout: 15_000,
      });
      await expectNoLeak(before);
    });
  }

  test("Hostile spoofed reply is ignored and the Plugin stays ready", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    await runCommand(page, "Hostile spoofed reply");
    await expect(
      status(page).filter({ hasText: "hostile escapeSpoofedReply ignored" })
    ).toBeVisible({ timeout: 15_000 });
    // Still answering: a second Command runs.
    await runCommand(page, "Hostile unknown method");
    await expect(
      status(page).filter({ hasText: "hostile escapeUnknownMethod refused: unknown-method" })
    ).toBeVisible({ timeout: 15_000 });
    await expectNoLeak(before);
  });

  test("Hostile message flood is refused as rate-limited", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    await runCommand(page, "Hostile message flood");
    await expect(
      status(page).filter({ hasText: "hostile escapeFlood refused: rate-limited" })
    ).toBeVisible({ timeout: 20_000 });
    await expectNoLeak(before);
  });

  test("Hostile busy loop stops the Plugin as unresponsive", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    await runCommand(page, "Hostile busy loop");
    await expect(
      status(page).filter({ hasText: "stopped responding and was closed." })
    ).toBeVisible({ timeout: 20_000 });
    await expectNoLeak(before);
  });

  test("Hostile allocation stops the Plugin with a memory reason", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    await runCommand(page, "Hostile allocation");
    // The Worker dies of memory pressure: the host reports out-of-memory, or,
    // when the engine gives no message, a crash or an unanswered heartbeat.
    await expect(
      status(page).filter({
        hasText: /used too much memory and was stopped|stopped unexpectedly|stopped responding/,
      })
    ).toBeVisible({ timeout: 30_000 });
    await expectNoLeak(before);
  });

  test("Hostile UI violation stops the Plugin with remote-ui-limit", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    await runCommand(page, "Hostile UI violation");
    await expect(
      status(page).filter({ hasText: "declared an interface Maibuk could not accept" })
    ).toBeVisible({ timeout: 15_000 });
    await expectNoLeak(before);
  });

  test("Hostile UI flood stops the Plugin with remote-ui-limit", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    await runCommand(page, "Hostile UI flood");
    await expect(
      status(page).filter({ hasText: "declared an interface Maibuk could not accept" })
    ).toBeVisible({ timeout: 15_000 });
    await expectNoLeak(before);
  });

  test("Hostile after revoke is refused once library:read is revoked", async ({ page }) => {
    const before = await leakCount();
    await waitForReady(page);
    // Revoke the optional grant in Settings; the Plugin stays enabled.
    await openPluginsSection(page);
    await expandPluginRow(page);
    await openPermissions(page);
    const read = page.getByRole("checkbox", {
      name: "Read your Library · Optional",
      exact: true,
    });
    await tabTo(page, read, { max: 20 });
    await page.keyboard.press("Space");
    await expect(read).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Enable Fixture Hostile" })
    ).toBeChecked();

    // Reload with the revoked grant and run the Command: the read is refused.
    await waitForReady(page);
    await runCommand(page, "Hostile after revoke");
    await expect(
      status(page).filter({ hasText: "hostile escapeAfterRevoke refused: permission-denied" })
    ).toBeVisible({ timeout: 15_000 });
    await expectNoLeak(before);
  });
});
