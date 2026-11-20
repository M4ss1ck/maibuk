// Clock's Timer (issue #871), on the Built-in Plugin that ships off by default:
// turning it on from Settings → Plugins by keyboard, opening its page from the
// Command Palette on the Timer tab, setting a 5-second length from the length
// fields, starting it, pausing and resuming it from its Plugin Command, and its
// end — the live region's announcement and the Alert, which reaches the author
// as Maibuk's own in-window notice here because headless Chromium never grants
// the Notification permission. Keyboard only: every control is reached by Tab
// and pressed with Enter or Space.

import type { Page } from "@playwright/test";
import { capture } from "../support/capture";
import { expectFocusWithin, isFocusWithin, pressUntilFocused, tabTo } from "../support/keyboard";
import { runPaletteCommand } from "../support/palette";
import { expect, test } from "../support/test";

const PLUGIN_NAME = "Clock";
const PLUGIN_ID = "maibuk-clock";
const PAGE_ID = "clock";

/** The card's description, which only the expanded panel shows. */
const DESCRIPTION = "Time your work with a Pomodoro cycle, a Timer, a Stopwatch, and Alarms.";

/** The Plugin Command that toggles the one Timer, as the Command Palette lists it. */
const TOGGLE_COMMAND = "Start or pause the Timer";

/** What a device that never granted System Notifications draws in the Timer tab. */
const NOTIFICATIONS_OFF = "Notifications are off, so Alerts show only inside Maibuk.";

/** The length the Timer runs for here: 0 hours, 0 minutes, 5 seconds. */
const LENGTH = "0:05";

/** What the end announces, once, in the page's polite live region. */
const ENDED = "Timer ended";

/** The Alert as Maibuk's own notice: "<Plugin>: <title>. <body>". */
const ALERT = "Clock: Timer. Your 0:05 Timer ended.";

const primaryNav = (page: Page) => page.getByRole("listbox", { name: "Primary navigation" });
const navOption = (page: Page, name: string) =>
  primaryNav(page).getByRole("option", { name: new RegExp(`^${name}`) });
const enableSwitch = (page: Page) =>
  page.getByRole("switch", { name: `Enable ${PLUGIN_NAME}`, exact: true });
/** The Clock card's disclosure trigger: the button named after the Plugin. */
const cardTrigger = (page: Page) =>
  page.getByRole("button", { name: new RegExp(`^${PLUGIN_NAME}`) });
/** One length field of the Timer, by its localized label. */
const lengthField = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

/**
 * The drawn remaining time while it is not the whole length: the length's quick
 * pick prints the same "0:05" the Timer starts from, so a value that has fallen
 * names the drawn line alone.
 */
const drawnTime = (page: Page) => page.getByText(/^0:0[0-4]$/);

/** The seconds a "m:ss" reading stands for. */
function secondsOf(text: string): number {
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** The seconds the drawn time shows; Infinity until it has fallen below the length. */
async function secondsShown(page: Page): Promise<number> {
  const drawn = drawnTime(page);
  if ((await drawn.count()) === 0) return Number.POSITIVE_INFINITY;
  const text = await drawn.textContent();
  return text === null ? Number.POSITIVE_INFINITY : secondsOf(text);
}

/** Jumps to the Plugins section through the Settings outline, leaving its heading focused. */
async function openPluginsSection(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // Instant section jumps: the jump animates otherwise.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tree = page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("treegrid", { name: "Settings sections" });
  const pluginsEntry = tree.getByRole("row", { name: /^Plugins(, current)?$/ });
  await expect(tree).toBeVisible();
  // The outline is the page's last focusable region: Shift+Tab reaches it.
  for (let i = 0; i < 12; i++) {
    if (await isFocusWithin(tree)) break;
    await page.keyboard.press("Shift+Tab");
  }
  await expectFocusWithin(tree);
  await page.keyboard.press("Home");
  await pressUntilFocused(page, "ArrowDown", pluginsEntry, { max: 60 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Plugins" })).toBeFocused();
}

/**
 * Turns Clock on from its card by keyboard. An untouched Built-in is pre-granted
 * every Plugin Permission it declares (the required `system-notifications`
 * here), so the switch starts it with no review dialog.
 */
async function turnOn(page: Page): Promise<void> {
  await openPluginsSection(page);
  // The card's disclosure trigger comes first in its header; Enter expands it.
  const trigger = cardTrigger(page);
  await expect(trigger).toBeVisible();
  await tabTo(page, trigger, { max: 40 });
  await page.keyboard.press("Enter");
  // The expanded panel opens with the manifest description, which a collapsed
  // card does not show.
  await expect(page.getByText(DESCRIPTION)).toBeVisible();
  const toggle = enableSwitch(page);
  await tabTo(page, toggle, { max: 12 });
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await expect(page.getByRole("dialog", { name: "Review access" })).toHaveCount(0);
  // Its sidebar entry appears once the Worker is running.
  await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 20_000 });
}

/** Opens the Clock page through its navigating Command, on the Timer tab. */
async function openClockPage(page: Page): Promise<void> {
  await runPaletteCommand(page, "Open Clock");
  await expect(page).toHaveURL(new RegExp(`/plugin/${PLUGIN_ID}/${PAGE_ID}$`));
  await expect(page.getByRole("heading", { name: PLUGIN_NAME, level: 1 })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Clock sections" })).toBeVisible();
  // The Timer is the page's first tab and the one it opens on.
  await expect(page.getByRole("tab", { name: "Timer", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(lengthField(page, "Seconds")).toBeVisible({ timeout: 15_000 });
}

/**
 * Replaces one length field's number from the keyboard and commits it: the
 * field holds the Plugin's default, so Select All and the digits type over it,
 * and Enter parses and clamps what was typed.
 */
async function setLength(page: Page, name: string, value: number): Promise<void> {
  const field = lengthField(page, name);
  await tabTo(page, field, { max: 40 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
}

test.use({
  library: "empty",
  plugins: [PLUGIN_ID],
  builtInPlugins: [{ id: PLUGIN_ID }],
});

test.describe("Clock Timer @wf:plugins-clock-timer @chromium-only", () => {
  test("a 5-second Timer starts, pauses and resumes from its Command, and ends with the announcement and the notice @sc:plugin.maibuk-clock.openClock @sc:plugin.maibuk-clock.toggleTimer", async ({
    page,
  }) => {
    await turnOn(page);
    await openClockPage(page);

    // The device granted no System Notification, so the page says Alerts stay
    // inside Maibuk and offers the banner.
    await expect(page.getByText(NOTIFICATIONS_OFF, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Allow notifications", exact: true })
    ).toBeVisible();
    await capture(page, "clock-timer-page");

    // 0 minutes and 5 seconds, from the 25-minute default the fields hold.
    await setLength(page, "Minutes", 0);
    await setLength(page, "Seconds", 5);
    await expect(page.getByText(LENGTH, { exact: true })).toHaveCount(1);

    const start = page.getByRole("button", { name: "Start", exact: true });
    await tabTo(page, start, { max: 12 });
    await page.keyboard.press("Enter");
    // A second in, the drawn time has fallen.
    await expect(page.getByText("0:04", { exact: true })).toBeVisible({ timeout: 5_000 });
    // The live region names the whole minute left, not every second.
    await expect(page.getByText("1 minute left", { exact: true })).toBeVisible();

    // The Command pauses it: Resume and Reset replace Pause, and the drawn time
    // holds what was left rather than returning to the length.
    await runPaletteCommand(page, TOGGLE_COMMAND);
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
    await expect(page.getByText(ENDED, { exact: true })).toHaveCount(0);
    const paused = await drawnTime(page).textContent();
    expect(paused).toMatch(/^0:0[0-4]$/);

    // The Command again resumes it from that remainder, and the drawn time never
    // goes back to the length.
    await runPaletteCommand(page, TOGGLE_COMMAND);
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const pausedSeconds = secondsOf(paused ?? "");
    await expect
      .poll(() => secondsShown(page), { timeout: 5_000 })
      .toBeLessThanOrEqual(pausedSeconds);

    // The end: the Alert reaches the author as Maibuk's own notice, since the
    // device never granted a System Notification.
    await expect(page.getByRole("status").filter({ hasText: ALERT })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(ENDED, { exact: true })).toBeVisible();
    await expect(page.getByText(NOTIFICATIONS_OFF, { exact: true })).toBeVisible();
    // The drawn time is spent, and the fields and Reset come back.
    await expect(page.getByText("0:00", { exact: true })).toBeVisible();
    await expect(lengthField(page, "Seconds")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
    await capture(page, "clock-timer-ended");
  });
});
