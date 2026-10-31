// The custom-UI Frame (@sandbox lane, issue #454 unit U6; ADR 0021): a
// whole-page Frame and an embedded kit Frame render the Plugin's own verified
// HTML/CSS/JS from its hashed set inside a `sandbox="allow-scripts"` iframe
// (opaque origin), show no custom-UI notice (it lives only in Settings since
// #657), round-trip a message over `window.maibuk.port`, follow a live theme
// change through the `--maibuk-*` tokens, and cannot reach the network, Tauri
// IPC, or the host DOM. That last half is asserted Node-side: every probe
// targets the recording server the E2E global setup starts
// (`e2e/support/request-log.ts`), and `loggedRequests()` — read with Node fs,
// never `evaluate` — must stay empty, including after the Frame navigates
// itself to a `data:` and to a `blob:` document. Tagged @sandbox so the lane
// runs on Chromium, WebKit, and Firefox.
//
// Frames get no accessibility test of their contents (#402): this spec never
// runs axe on the Frame (the suite has no axe helper at all) and asserts only
// that Tab reaches the Frame element, never anything inside it.

import type { FrameLocator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import { pressUntilFocused, tabTo } from "../support/keyboard";
import { loggedRequests } from "../support/request-log";
import { runPaletteCommand } from "../support/palette";
import { expect, test } from "../support/test";

const PLUGIN_ID = "fixture-frame";

/**
 * The custom-UI notice (en copy), `plugins.management.custom`. Since #657 it
 * shows only in Settings (covered by `PluginsSection.test.tsx`), never on a
 * page that renders a Frame.
 */
const NOTICE = "Custom UI: accessibility not verified by Maibuk";

/** The Frame's isolation probes, each writing "blocked" or "LEAK:<detail>". */
const PROBE_IDS = [
  "probe-fetch",
  "probe-xhr",
  "probe-websocket",
  "probe-eventsource",
  "probe-beacon",
  "probe-image",
  "probe-tauri",
  "probe-parent-dom",
] as const;

/** How long to let every probe settle before reading its verdict (see page.js). */
const PROBE_SETTLE_MS = 700;
/** A short settle after a self-navigation before the Node-side log is read. */
const NAV_SETTLE_MS = 800;

/** The whole-page Frame's iframe, and the embedded kit Frame's own. */
const pageFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="page"] iframe');
const embeddedFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="embedded"] iframe');

const iframeElement = (page: Page, variant: "page" | "embedded") =>
  page.locator(`[data-plugin-frame="${variant}"] iframe`);

/**
 * The Node-side half of the pass rule: the recording server logged nothing. The
 * probes target it (its origin is 127.0.0.1, the one origin the hermetic network
 * lets through), so a Frame that reaches the network is recorded here. Read from
 * Node, never `page.evaluate`.
 */
const leakCount = async (): Promise<number> => (await loggedRequests()).length;

/** Asserts the log gained nothing since `before`. */
async function expectNoLeak(before: number): Promise<void> {
  const after = await loggedRequests();
  expect(after.length, "a request or WebSocket left the Frame").toBe(before);
  expect(after, "the request log must stay empty").toEqual([]);
}

/** Opens the whole-page Frame and waits until its Worker answered the ping. */
async function openFramePage(page: Page): Promise<void> {
  await page.goto(`/plugin/${PLUGIN_ID}/frame`);
  await expect(pageFrame(page).getByTestId("pong")).toHaveText("pong", { timeout: 15_000 });
}

/** Opens a React Aria Select by keyboard and picks the named option. */
async function chooseFromSelect(page: Page, trigger: ReturnType<Page["getByRole"]>, name: string) {
  await tabTo(page, trigger, { max: 90 });
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name, exact: true });
  await pressUntilFocused(page, "ArrowDown", option, { max: 12 });
  await page.keyboard.press("Enter");
}

test.describe("Frame custom UI @wf:plugins-frame @sandbox", () => {
  // The leak assertion reads one shared log, so the tests in this file run one
  // at a time: a concurrent test's recorder traffic would otherwise look like
  // this test's leak.
  test.describe.configure({ mode: "serial" });

  test.use({ plugins: [PLUGIN_ID] });

  test("the whole-page Frame renders from the hashed set and answers a ping", async ({ page }) => {
    const before = await leakCount();
    await openFramePage(page);
    await expect(page.getByText(NOTICE)).toHaveCount(0);
    const frame = pageFrame(page);
    await expect(frame.getByTestId("css-applied")).toHaveCSS("color", "rgb(12, 34, 56)");
    // The naturalWidth > 0 the Frame writes once the hashed image loaded.
    await expect(frame.getByTestId("image")).toHaveText(/^[1-9]\d*$/);
    await capture(page, "plugin-frame-page");
    await expectNoLeak(before);
  });

  test("every probe from the Frame reports blocked and no request leaves", async ({ page }) => {
    const before = await leakCount();
    await openFramePage(page);
    const frame = pageFrame(page);
    // Each probe starts "pending" and only a confirmed refusal writes
    // "blocked", so the settle window lets every async probe reach its verdict
    // and a probe that never ran fails the assertion rather than reading as one.
    await page.waitForTimeout(PROBE_SETTLE_MS);
    for (const id of PROBE_IDS) {
      await expect(frame.getByTestId(id)).toHaveText("blocked");
    }
    await expectNoLeak(before);
  });

  test("the embedded kit Frame renders without the notice and answers a ping", async ({ page }) => {
    await page.goto(`/plugin/${PLUGIN_ID}/embed`);
    await expect(embeddedFrame(page).getByTestId("pong")).toHaveText("pong", { timeout: 15_000 });
    await expect(page.getByText(NOTICE)).toHaveCount(0);
    await capture(page, "plugin-frame-embedded");
  });

  test("the theme tokens change in the Frame live on a theme switch @sc:global.toggleTheme", async ({
    page,
  }) => {
    await openFramePage(page);
    const frame = pageFrame(page);
    const background = await frame.getByTestId("token-bg").textContent();
    expect(background).toBeTruthy();
    await expect(frame.getByTestId("scheme")).toHaveText("light");

    // The real theme toggle, on the same page: no reload, so the Frame must
    // follow the live `frame-theme` update (U4).
    await page.keyboard.press("g");
    await page.keyboard.press("t");

    await expect(frame.getByTestId("scheme")).toHaveText("dark");
    await expect
      .poll(() => frame.getByTestId("token-bg").textContent(), {
        message: "the Frame background token follows the theme",
      })
      .not.toBe(background);
  });

  test("the UI language reaches the Frame", async ({ page }) => {
    await openFramePage(page);
    await expect(pageFrame(page).getByTestId("lang")).toHaveText("en|Hello from the Frame");

    // Switch the UI to Spanish through the real Settings UI. The Worker sees the
    // change (`language.changed`, D7); the next Frame it mounts is told the new
    // language, so returning to the page proves the forwarded value, not a
    // stale one.
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    const general = page.locator('[data-tutorial~="settings.general"]');
    await chooseFromSelect(page, general.getByRole("button", { name: "Language" }), "Español");
    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();

    await page.goto(`/plugin/${PLUGIN_ID}/frame`);
    await expect(pageFrame(page).getByTestId("lang")).toHaveText("es|Hola desde el Frame", {
      timeout: 15_000,
    });
  });

  test("Tab from the preceding control reaches the Frame", async ({ page }) => {
    await openFramePage(page);
    const iframe = iframeElement(page, "page");
    await tabTo(page, iframe, { max: 80 });
    await expect(iframe).toBeFocused();
  });

  test("the Frame self-navigates to a data: document and logs nothing", async ({ page }) => {
    const before = await leakCount();
    await openFramePage(page);
    await runPaletteCommand(page, "Frame navigate to data");
    await page.waitForTimeout(NAV_SETTLE_MS);
    await expectNoLeak(before);
  });

  test("the Frame self-navigates to a blob: document and logs nothing", async ({ page }) => {
    const before = await leakCount();
    await openFramePage(page);
    await runPaletteCommand(page, "Frame navigate to blob");
    await page.waitForTimeout(NAV_SETTLE_MS);
    await expectNoLeak(before);
  });
});
