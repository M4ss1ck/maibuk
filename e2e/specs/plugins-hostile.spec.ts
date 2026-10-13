// The fixture-hostile Plugin (issue #446): one Command per escape attempt, run
// from the Command Palette by keyboard. Every escape must fail safely — the
// Plugin reports a typed refusal, or the host stops it with a reason — and no
// request may leave the sandbox (asserted Node-side from the request log, never
// with `evaluate`). Tagged @sandbox so the lane runs on Chromium and Firefox.
//
// @no-webkit: seeding the Plugin Directory needs OPFS, which the pinned
// Playwright WebKit build lacks (microsoft/playwright#18235; e2e/README.md). The
// sandbox itself is engine-verified on WebKit by the wire harness
// (`plugins-sandbox.spec.ts`) and the T1 probe.

import type { Locator, Page } from "@playwright/test";
import { isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

const PLUGIN_ID = "fixture-hostile";
/** The host every network escape targets; the hermetic network only aborts it. */
const LEAK_HOST = "hostile.invalid";

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
 * Records every request or WebSocket that reaches the network layer for the
 * leak host. The hermetic network aborts it either way; a CSP-blocked escape
 * never reaches this layer at all, so the log stays empty. This is the
 * Node-side half of the pass criterion.
 */
async function trackLeaks(page: Page): Promise<() => string[]> {
  const leaked: string[] = [];
  await page.route(/hostile\.invalid/, (route) => {
    leaked.push(route.request().url());
    return route.abort();
  });
  page.on("websocket", (socket) => {
    if (socket.url().includes(LEAK_HOST)) leaked.push(socket.url());
  });
  return () => leaked;
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
  const row = page.getByRole("button", { name: "Fixture Hostile", exact: true });
  await tabTo(page, row, { max: 30 });
  await page.keyboard.press("Enter");
  return row;
}

test.describe("fixture-hostile escapes @wf:plugins-sandbox @sandbox @no-webkit", () => {
  test.use({
    plugins: [PLUGIN_ID],
    pluginApprovals: [{ pluginId: PLUGIN_ID, granted: ["library:read"] }],
  });

  for (const attempt of REFUSALS) {
    test(`${attempt.label} fails safely with a typed refusal`, async ({ page }) => {
      const leaked = await trackLeaks(page);
      await waitForReady(page);
      await runCommand(page, attempt.label);
      await expect(status(page).filter({ hasText: attempt.report })).toBeVisible({
        timeout: 15_000,
      });
      expect(leaked()).toEqual([]);
    });
  }

  test("Hostile spoofed reply is ignored and the Plugin stays ready", async ({ page }) => {
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
  });

  test("Hostile message flood is refused as rate-limited", async ({ page }) => {
    await waitForReady(page);
    await runCommand(page, "Hostile message flood");
    await expect(
      status(page).filter({ hasText: "hostile escapeFlood refused: rate-limited" })
    ).toBeVisible({ timeout: 20_000 });
  });

  test("Hostile busy loop stops the Plugin as unresponsive", async ({ page }) => {
    await waitForReady(page);
    await runCommand(page, "Hostile busy loop");
    await expect(
      status(page).filter({ hasText: "stopped responding and was closed." })
    ).toBeVisible({ timeout: 20_000 });
  });

  test("Hostile allocation stops the Plugin with a memory reason", async ({ page }) => {
    await waitForReady(page);
    await runCommand(page, "Hostile allocation");
    // The Worker dies of memory pressure: the host reports out-of-memory, or,
    // when the engine gives no message, a crash or an unanswered heartbeat.
    await expect(
      status(page).filter({
        hasText: /used too much memory and was stopped|stopped unexpectedly|stopped responding/,
      })
    ).toBeVisible({ timeout: 30_000 });
  });

  test("Hostile UI violation stops the Plugin with remote-ui-limit", async ({ page }) => {
    await waitForReady(page);
    await runCommand(page, "Hostile UI violation");
    await expect(
      status(page).filter({ hasText: "declared an interface Maibuk could not accept" })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Hostile UI flood stops the Plugin with remote-ui-limit", async ({ page }) => {
    await waitForReady(page);
    await runCommand(page, "Hostile UI flood");
    await expect(
      status(page).filter({ hasText: "declared an interface Maibuk could not accept" })
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Hostile after revoke is refused once library:read is revoked", async ({ page }) => {
    await waitForReady(page);
    // Revoke the optional grant in Settings; the Plugin stays enabled.
    await openPluginsSection(page);
    await expandPluginRow(page);
    const read = page.getByRole("checkbox", {
      name: "Read your Library · Optional",
      exact: true,
    });
    await tabTo(page, read, { max: 20 });
    await page.keyboard.press("Space");
    await expect(read).not.toBeChecked();
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();

    // Reload with the revoked grant and run the Command: the read is refused.
    await waitForReady(page);
    await runCommand(page, "Hostile after revoke");
    await expect(
      status(page).filter({ hasText: "hostile escapeAfterRevoke refused: permission-denied" })
    ).toBeVisible({ timeout: 15_000 });
  });
});
