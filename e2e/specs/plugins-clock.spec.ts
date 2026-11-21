// Clock's Timer (issue #871), Pomodoro, and Stopwatch (issue #873), on the
// Built-in Plugin that ships off by default: turning it on from Settings →
// Plugins by keyboard, opening its page from the Command Palette on the Timer
// tab, setting a 5-second length from the length fields, starting it, pausing
// and resuming it from its Plugin Command, and its end: the live region's
// announcement and the Alert, which reaches the author as Maibuk's own
// in-window notice here because headless Chromium never grants the Notification
// permission. The Pomodoro tab is reached by keyboard from the Timer tab, and
// its Cycle starts there, pauses and resumes from its Command, skips to the
// Short break from its other Command, and resets to the first Pomodoro. The
// Stopwatch tab is one ArrowRight further on: its Stopwatch starts, marks a Lap
// from its button and a second from its other Command, pauses and resumes from
// its Command, and resets to zero. The Alarms tab is one ArrowRight past that:
// the form adds an Alarm a couple of minutes ahead with a label and a weekday,
// Edit moves its minute, its switch turns it off and back on, and Delete
// returns the tab to its empty message (issue #874). No phase is waited out:
// the Pomodoro's 25 minutes are the unit suites'.
// The page is the Plugin's whole-page Frame (#886): the section tabs, every
// panel, the notification banner, and the live region are inside the iframe, so
// every step below reaches them through the Frame. Only the Command Palette and
// Maibuk's own Alert notice are host UI. Keyboard only: every control is
// reached by Tab and pressed with Enter or Space, and a host Command takes the
// keys back from the Frame first.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  leaveFrame,
  pressUntilFocused,
  tabTo,
  tabToEither,
} from "../support/keyboard";
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

/** The page itself: the Plugin's whole-page Frame, and the iframe around it. */
const clockFrame = (page: Page): FrameLocator =>
  page.frameLocator('[data-plugin-frame="page"] iframe');
const frameElement = (page: Page) => page.locator('[data-plugin-frame="page"] iframe');

/** The panel of one section tab, named by its tab. */
const tabPanel = (page: Page, name: string) =>
  clockFrame(page).getByRole("tabpanel", { name: new RegExp(`^${name}`) });

/** One length field of the Timer, by its localized label. */
const lengthField = (page: Page, name: string) =>
  clockFrame(page).getByRole("spinbutton", { name, exact: true });

/**
 * The Timer's drawn remaining time, which stays empty until it runs: the Frame
 * keeps the length in the fields, not in a second reading.
 */
const timerTime = (page: Page) => clockFrame(page).locator("#timer-time");

/** The seconds the drawn time shows; Infinity until it has fallen below the length. */
async function secondsShown(page: Page): Promise<number> {
  const text = await timerTime(page).textContent();
  return text === null || text === "" ? Number.POSITIVE_INFINITY : secondsOf(text);
}

/** The seconds an "h:mm:ss" or "m:ss" reading stands for. */
function secondsOf(text: string): number {
  return text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** The Pomodoro Command that starts, pauses and resumes the Cycle. */
const TOGGLE_POMODORO_COMMAND = "Start or pause the Pomodoro";

/** The Pomodoro Command that moves the Cycle to its next phase. */
const SKIP_POMODORO_COMMAND = "Skip to the next Pomodoro or break";

/** The first Pomodoro of the four the default settings put before a Long break. */
const POMODORO_OF_CYCLE = "Pomodoro 1 of 4";

/** Its 25-minute length, drawn while it is idle. */
const POMODORO_LENGTH = "25:00";

/** The Short break's 5-minute length, drawn while it is idle. */
const SHORT_BREAK_LENGTH = "5:00";

/** Today's count, which nothing here adds to: only a phase that ends counts one. */
const POMODOROS_TODAY = "Pomodoros today: 0";

/** The whole first Pomodoro in seconds, which the drawn time must fall below. */
const POMODORO_SECONDS = 25 * 60;

/** The Cycle step drawn as the current one: its phase name, from the Cycle list. */
const currentPhase = (page: Page) => clockFrame(page).locator(".cycle-step.now .step-label");

/** The Cycle's drawn remaining time: "m:ss", from the 25-minute default down. */
const pomodoroTime = (page: Page) => clockFrame(page).locator("#pomodoro-time");

/** The seconds the Cycle's drawn time shows; Infinity until it draws a time. */
async function secondsLeft(page: Page): Promise<number> {
  const text = await pomodoroTime(page).textContent();
  return text === null ? Number.POSITIVE_INFINITY : secondsOf(text);
}

/** The Stopwatch Command that starts, pauses and resumes the Stopwatch. */
const TOGGLE_STOPWATCH_COMMAND = "Start or pause the Stopwatch";

/** The Stopwatch Command that marks one Lap while it runs. */
const LAP_STOPWATCH_COMMAND = "Mark a Lap";

/** The Laps table the Stopwatch draws once it has Laps, the Frame's only table. */
const lapsTable = (page: Page) => clockFrame(page).getByRole("table");

/** One Laps data row: the table's body rows, the header row holding none. */
const lapRows = (page: Page) => lapsTable(page).locator("tbody tr");

/**
 * The Stopwatch's drawn elapsed time: the Frame's "hh:mm:ss" digits. The Laps
 * table draws times of its own, but each carries hundredths and so cannot match.
 */
const elapsedTime = (page: Page) => clockFrame(page).locator("#stopwatch-digits");

/** The seconds the Stopwatch's drawn elapsed time shows. */
async function elapsedSeconds(page: Page): Promise<number> {
  const text = await elapsedTime(page).textContent();
  return text === null ? 0 : secondsOf(text);
}

/** The weekdays the Alarms list prints, short and Sunday first. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The 12-hour reading en-US gives an Alarm's time: "h:mm AM" or "h:mm PM". */
function clockTime(hour: number, minute: number): string {
  const hours = hour % 12 === 0 ? 12 : hour % 12;
  return `${hours}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** The clock when the spec starts. */
const NOW = new Date();

/** The Alarm's time: a couple of minutes past it. */
const AHEAD = new Date(NOW.getTime() + 2 * 60_000);
const ALARM_HOUR = AHEAD.getHours();
const ALARM_MINUTE = AHEAD.getMinutes();
const ALARM_TIME = clockTime(ALARM_HOUR, ALARM_MINUTE);

/** The minute the edit moves it to, kept off the 60 the field refuses. */
const EDITED_MINUTE = ALARM_MINUTE === 59 ? 58 : ALARM_MINUTE + 1;
const EDITED_TIME = clockTime(ALARM_HOUR, EDITED_MINUTE);

/** A weekday other than today's, so a two-minutes-ahead Alarm cannot fire mid-test. */
const ALARM_WEEKDAY = WEEKDAYS[(NOW.getDay() + 3) % 7];

/** The label the form is given, which the row then shows beside its time. */
const ALARM_LABEL = "Wake up";

/** What an Alarms tab with no Alarm draws. */
const NO_ALARMS = "No alarms yet.";

/** The Alarms tab's Add alarm button, which opens the form. */
const addAlarmButton = (page: Page) =>
  clockFrame(page).getByRole("button", { name: "Add alarm", exact: true });

/** The Alarm form as a dialog, titled for the action that opened it. */
const alarmForm = (page: Page, name: "Add alarm" | `Edit ${string}`) =>
  clockFrame(page).getByRole("dialog", { name, exact: true });

/** One row's switch, which carries the row's drawn time in its name. */
const alarmSwitch = (page: Page, time: string) =>
  clockFrame(page).getByRole("switch", { name: `Alarm ${time}`, exact: true });

/**
 * Replaces one number field of the open form from the keyboard: the field holds
 * the current hour or minute, so Select All types over it, and the Tab out moves
 * on to the next field.
 */
async function setAlarmNumber(page: Page, field: Locator, value: number): Promise<void> {
  await tabToEither(page, field, { max: 20 });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Tab");
}

/**
 * Runs a host Command from the Command Palette. The Frame keeps keyboard focus
 * while it is mounted, so focus leaves it first or F1 would open nothing.
 */
async function runHostCommand(page: Page, label: string): Promise<void> {
  await leaveFrame(page, frameElement(page));
  await runPaletteCommand(page, label);
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
  // The outline is the page's last focusable region: Shift+Tab enters it on its
  // first entry, whatever sits after it in the page.
  await tabTo(page, tree.getByRole("row").first(), { max: 12, backwards: true });
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
  // The page's own heading stays in the host, drawn for screen readers only.
  await expect(page.getByRole("heading", { name: PLUGIN_NAME, level: 1 })).toBeVisible();
  const tabs = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  await expect(tabs).toBeVisible();
  // The Timer is the page's first tab and the one it opens on.
  await expect(tabs.getByRole("tab", { name: "Timer", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(lengthField(page, "Seconds")).toBeVisible({ timeout: 15_000 });
}

/**
 * Moves from the Timer tab to the Pomodoro tab by keyboard: the tab list is one
 * tab stop, so Tab lands on the selected Timer tab, and ArrowLeft moves to the
 * Pomodoro, which selection follows.
 */
async function openPomodoroTab(page: Page): Promise<void> {
  const tabList = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  const timerTab = tabList.getByRole("tab", { name: "Timer", exact: true });
  const pomodoroTab = tabList.getByRole("tab", { name: "Pomodoro", exact: true });
  await tabTo(page, timerTab, { max: 60 });
  await page.keyboard.press("ArrowLeft");
  await expect(pomodoroTab).toHaveAttribute("aria-selected", "true");
  await expect(tabPanel(page, "Pomodoro")).toBeVisible({ timeout: 15_000 });
}

/**
 * Moves from the Timer tab to the Stopwatch tab by keyboard: the tab list is one
 * tab stop, so Tab lands on the selected Timer tab, and ArrowRight moves to the
 * Stopwatch, which selection follows.
 */
async function openStopwatchTab(page: Page): Promise<void> {
  const tabList = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  const timerTab = tabList.getByRole("tab", { name: "Timer", exact: true });
  const stopwatchTab = tabList.getByRole("tab", { name: "Stopwatch", exact: true });
  await tabTo(page, timerTab, { max: 60 });
  await page.keyboard.press("ArrowRight");
  await expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
  // The Stopwatch tab's own panel, from the zero it opens on.
  await expect(tabPanel(page, "Stopwatch")).toBeVisible({ timeout: 15_000 });
  await expect(elapsedTime(page)).toHaveText("00:00:00", { timeout: 15_000 });
}

/**
 * Moves from the Timer tab to the Alarms tab by keyboard: the tab list is one
 * tab stop, so Tab lands on the selected Timer tab, and two ArrowRights pass
 * the Stopwatch to the Alarms, which selection follows.
 */
async function openAlarmsTab(page: Page): Promise<void> {
  const tabList = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  const timerTab = tabList.getByRole("tab", { name: "Timer", exact: true });
  const stopwatchTab = tabList.getByRole("tab", { name: "Stopwatch", exact: true });
  const alarmsTab = tabList.getByRole("tab", { name: "Alarms", exact: true });
  await tabTo(page, timerTab, { max: 60 });
  await page.keyboard.press("ArrowRight");
  await expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(alarmsTab).toHaveAttribute("aria-selected", "true");
  // The Alarms tab's own panel, from the empty list it opens on.
  await expect(tabPanel(page, "Alarms")).toBeVisible({ timeout: 15_000 });
  await expect(clockFrame(page).getByText(NO_ALARMS, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Replaces one length field's number from the keyboard: the field holds the
 * Plugin's default, so Select All types over it, and the field posts the new
 * length on every keystroke.
 */
async function setLength(page: Page, name: string, value: number): Promise<void> {
  const field = lengthField(page, name);
  await tabTo(page, field, { max: 60 });
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
    await expect(clockFrame(page).getByText(NOTIFICATIONS_OFF, { exact: true })).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: "Allow notifications", exact: true })
    ).toBeVisible();
    await capture(page, "clock-timer-page");

    // 0 minutes and 5 seconds, from the 25-minute default the fields hold.
    await setLength(page, "Minutes", 0);
    await setLength(page, "Seconds", 5);
    // Start names the length it will run: 0:05.
    const start = clockFrame(page).getByRole("button", { name: `Start ${LENGTH}`, exact: true });
    await expect(start).toBeVisible();
    await tabTo(page, start, { max: 12 });
    await page.keyboard.press("Enter");
    // A second in, the drawn time has fallen.
    await expect(timerTime(page)).toHaveText("0:04", { timeout: 5_000 });
    // The live region names the whole minute left, not every second.
    await expect(clockFrame(page).getByText("1 minute left", { exact: true })).toBeVisible();

    // The Command pauses it: Resume and Reset replace Pause, and the drawn time
    // holds what was left rather than returning to the length.
    await runHostCommand(page, TOGGLE_COMMAND);
    await expect(
      clockFrame(page).getByRole("button", { name: "Resume", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByText(ENDED, { exact: true })).toHaveCount(0);
    const paused = await timerTime(page).textContent();
    expect(paused).toMatch(/^0:0[0-4]$/);

    // The Command again resumes it from that remainder, and the drawn time never
    // goes back to the length.
    await runHostCommand(page, TOGGLE_COMMAND);
    await expect(
      clockFrame(page).getByRole("button", { name: "Pause", exact: true })
    ).toBeVisible();
    const pausedSeconds = secondsOf(paused ?? "");
    await expect
      .poll(() => secondsShown(page), { timeout: 5_000 })
      .toBeLessThanOrEqual(pausedSeconds);

    // The end: the Alert reaches the author as Maibuk's own notice, since the
    // device never granted a System Notification.
    await expect(page.getByRole("status").filter({ hasText: ALERT })).toBeVisible({
      timeout: 10_000,
    });
    await expect(clockFrame(page).getByText(ENDED, { exact: true })).toBeVisible();
    await expect(clockFrame(page).getByText(NOTIFICATIONS_OFF, { exact: true })).toBeVisible();
    // The Timer is spent and back in its setup: the fields, Start naming the
    // length, and Reset.
    await expect(lengthField(page, "Seconds")).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: `Start ${LENGTH}`, exact: true })
    ).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: "Reset", exact: true })
    ).toBeVisible();
    await capture(page, "clock-timer-ended");
  });
});

test.describe("Clock Pomodoro @wf:plugins-clock-pomodoro @chromium-only", () => {
  test("the Pomodoro runs from its tab and pauses, resumes, skips and resets from its Commands @sc:plugin.maibuk-clock.togglePomodoro @sc:plugin.maibuk-clock.skipPomodoro", async ({
    page,
  }) => {
    await turnOn(page);
    await openClockPage(page);
    await openPomodoroTab(page);

    // Idle on the first Pomodoro: its 25-minute length, the controls of that
    // status, and no Pomodoro counted today.
    await expect(currentPhase(page)).toHaveText("Pomodoro");
    await expect(clockFrame(page).getByText(POMODORO_OF_CYCLE, { exact: true })).toBeVisible();
    await expect(pomodoroTime(page)).toHaveText(POMODORO_LENGTH);
    await expect(clockFrame(page).getByText(POMODOROS_TODAY, { exact: true })).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: "Start", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Skip", exact: true })).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: "Reset Cycle", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Resume", exact: true })).toHaveCount(
      0
    );
    await capture(page, "clock-pomodoro-idle");

    // Start runs it: Pause replaces Start, and the drawn time falls.
    await tabTo(page, clockFrame(page).getByRole("button", { name: "Start", exact: true }), {
      max: 12,
    });
    await page.keyboard.press("Enter");
    await expect(
      clockFrame(page).getByRole("button", { name: "Pause", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Start", exact: true })).toHaveCount(
      0
    );
    await expect.poll(() => secondsLeft(page), { timeout: 5_000 }).toBeLessThan(POMODORO_SECONDS);

    // The Command pauses it: Resume replaces Pause, and the drawn time holds
    // what was left rather than returning to the length.
    await runHostCommand(page, TOGGLE_POMODORO_COMMAND);
    await expect(
      clockFrame(page).getByRole("button", { name: "Resume", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    const paused = await secondsLeft(page);
    expect(paused).toBeLessThan(POMODORO_SECONDS);

    // The Command again resumes it from that remainder.
    await runHostCommand(page, TOGGLE_POMODORO_COMMAND);
    await expect(
      clockFrame(page).getByRole("button", { name: "Pause", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Resume", exact: true })).toHaveCount(
      0
    );
    await expect.poll(() => secondsLeft(page), { timeout: 5_000 }).toBeLessThan(paused);

    // Its other Command moves the Cycle on: the Short break, idle, still the
    // first Pomodoro of the Cycle and none counted.
    await runHostCommand(page, SKIP_POMODORO_COMMAND);
    await expect(currentPhase(page)).toHaveText("Short break");
    await expect(clockFrame(page).getByText(POMODORO_OF_CYCLE, { exact: true })).toBeVisible();
    await expect(pomodoroTime(page)).toHaveText(SHORT_BREAK_LENGTH);
    await expect(clockFrame(page).getByText(POMODOROS_TODAY, { exact: true })).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: "Start", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Resume", exact: true })).toHaveCount(
      0
    );
    await capture(page, "clock-pomodoro-short-break");

    // Reset Cycle returns the Cycle to its first Pomodoro, idle. The palette
    // leaves focus in the host, so the button is reached by entering the Frame.
    const reset = clockFrame(page).getByRole("button", { name: "Reset Cycle", exact: true });
    await tabTo(page, reset, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(currentPhase(page)).toHaveText("Pomodoro");
    await expect(clockFrame(page).getByText(POMODORO_OF_CYCLE, { exact: true })).toBeVisible();
    await expect(pomodoroTime(page)).toHaveText(POMODORO_LENGTH);
    await expect(clockFrame(page).getByText(POMODOROS_TODAY, { exact: true })).toBeVisible();
    await expect(
      clockFrame(page).getByRole("button", { name: "Start", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Resume", exact: true })).toHaveCount(
      0
    );
    await capture(page, "clock-pomodoro-reset");
  });
});

test.describe("Clock Stopwatch @wf:plugins-clock-stopwatch @chromium-only", () => {
  test("the Stopwatch runs from its tab, marks Laps and pauses, resumes and resets from its Commands @sc:plugin.maibuk-clock.toggleStopwatch @sc:plugin.maibuk-clock.lapStopwatch", async ({
    page,
  }) => {
    await turnOn(page);
    await openClockPage(page);
    await openStopwatchTab(page);

    // Idle: nothing has run, so Start is the only control and no Lap is marked.
    const start = clockFrame(page).getByRole("button", { name: "Start", exact: true });
    await expect(elapsedTime(page)).toHaveText("00:00:00");
    await expect(start).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Resume", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Lap", exact: true })).toHaveCount(0);
    await expect(clockFrame(page).getByRole("button", { name: "Reset", exact: true })).toHaveCount(
      0
    );
    await expect(lapsTable(page)).toHaveCount(0);
    await capture(page, "clock-stopwatch-idle");

    // Start runs it: Pause and Lap replace Start, and the elapsed time climbs.
    await tabTo(page, start, { max: 12 });
    await page.keyboard.press("Enter");
    await expect(
      clockFrame(page).getByRole("button", { name: "Pause", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Start", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Lap", exact: true })).toBeVisible();
    await expect.poll(() => elapsedSeconds(page), { timeout: 10_000 }).toBeGreaterThan(0);

    // Lap, pressed on its own button, marks the first one: the table appears and
    // holds one row under its Lap, Lap time, and Total columns. It sits just
    // before the primary button its focus is on, so it is reached going back.
    const lap = clockFrame(page).getByRole("button", { name: "Lap", exact: true });
    await tabTo(page, lap, { max: 4, backwards: true });
    await page.keyboard.press("Enter");
    await expect(lapsTable(page)).toBeVisible();
    await expect(lapRows(page)).toHaveCount(1);

    // The Command pauses it: Resume replaces Pause, Lap is offered only while it
    // runs, and the elapsed time holds rather than climbing.
    await runHostCommand(page, TOGGLE_STOPWATCH_COMMAND);
    await expect(
      clockFrame(page).getByRole("button", { name: "Resume", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Pause", exact: true })).toHaveCount(
      0
    );
    await expect(clockFrame(page).getByRole("button", { name: "Lap", exact: true })).toHaveCount(0);
    const paused = (await elapsedTime(page).textContent()) ?? "";
    expect(secondsOf(paused)).toBeGreaterThan(0);
    await page.waitForTimeout(1_500);
    await expect(elapsedTime(page)).toHaveText(paused);

    // The Command again resumes it, and its other Command adds a second Lap.
    await runHostCommand(page, TOGGLE_STOPWATCH_COMMAND);
    await expect(
      clockFrame(page).getByRole("button", { name: "Pause", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Resume", exact: true })).toHaveCount(
      0
    );
    await runHostCommand(page, LAP_STOPWATCH_COMMAND);
    await expect(lapRows(page)).toHaveCount(2);
    await capture(page, "clock-stopwatch-laps");

    // The Frame offers Reset only while the Stopwatch is paused, so its Command
    // parks it first; the Laps stay until the button drops them.
    await runHostCommand(page, TOGGLE_STOPWATCH_COMMAND);
    const reset = clockFrame(page).getByRole("button", { name: "Reset", exact: true });
    await expect(reset).toBeVisible();
    await tabTo(page, reset, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(elapsedTime(page)).toHaveText("00:00:00");
    await expect(
      clockFrame(page).getByRole("button", { name: "Start", exact: true })
    ).toBeVisible();
    await expect(clockFrame(page).getByRole("button", { name: "Reset", exact: true })).toHaveCount(
      0
    );
    await expect(lapsTable(page)).toHaveCount(0);
    await capture(page, "clock-stopwatch-reset");
  });
});

test.describe("Clock Alarms @wf:plugins-clock-alarms @chromium-only", () => {
  test("an Alarm added from its form, moved by Edit, switched off and on, and deleted returns the tab to empty", async ({
    page,
  }) => {
    await turnOn(page);
    await openClockPage(page);
    await openAlarmsTab(page);

    // No Alarm yet: the empty message above the one button the list offers.
    await expect(addAlarmButton(page)).toBeVisible();
    await capture(page, "clock-alarms-empty");

    // Add alarm opens the form: the current time, no label, and no weekday.
    await tabToEither(page, addAlarmButton(page), { max: 30 });
    await page.keyboard.press("Enter");
    const add = alarmForm(page, "Add alarm");
    await expect(add).toBeVisible();
    await setAlarmNumber(
      page,
      add.getByRole("spinbutton", { name: "Hour", exact: true }),
      ALARM_HOUR
    );
    await setAlarmNumber(
      page,
      add.getByRole("spinbutton", { name: "Minute", exact: true }),
      ALARM_MINUTE
    );
    await tabToEither(page, add.getByRole("textbox", { name: "Label", exact: true }), { max: 20 });
    await page.keyboard.type(ALARM_LABEL);
    const weekday = add.getByRole("checkbox", { name: ALARM_WEEKDAY, exact: true });
    await tabToEither(page, weekday, { max: 20 });
    await page.keyboard.press("Space");
    await expect(weekday).toBeChecked();
    await capture(page, "clock-alarms-form");

    // Save writes it: the row shows the time, the label, and the weekday, its
    // switch is named after the time, and it starts on.
    await tabToEither(page, add.getByRole("button", { name: "Save", exact: true }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(add).toBeHidden();
    await expect(clockFrame(page).getByText(ALARM_TIME, { exact: true })).toBeVisible();
    await expect(clockFrame(page).getByText(ALARM_LABEL, { exact: true })).toBeVisible();
    // The weekday chips are letters on screen; the repeat names the day fully.
    await expect(clockFrame(page).locator(".alarm-repeat")).toHaveAttribute(
      "aria-label",
      ALARM_WEEKDAY
    );
    await expect(clockFrame(page).getByText(NO_ALARMS, { exact: true })).toBeHidden();
    const toggle = alarmSwitch(page, ALARM_TIME);
    await expect(toggle).toBeChecked();
    await capture(page, "clock-alarms-added");

    // Edit <time> reopens the same form holding the Alarm's own fields, and a
    // new minute moves the row to the new time.
    const editButton = clockFrame(page).getByRole("button", {
      name: `Edit ${ALARM_TIME}`,
      exact: true,
    });
    await tabToEither(page, editButton, { max: 30 });
    await page.keyboard.press("Enter");
    const edit = alarmForm(page, `Edit ${ALARM_TIME}`);
    await expect(edit).toBeVisible();
    await expect(edit.getByRole("spinbutton", { name: "Hour", exact: true })).toHaveValue(
      String(ALARM_HOUR).padStart(2, "0")
    );
    await expect(edit.getByRole("spinbutton", { name: "Minute", exact: true })).toHaveValue(
      String(ALARM_MINUTE).padStart(2, "0")
    );
    await expect(edit.getByRole("textbox", { name: "Label", exact: true })).toHaveValue(
      ALARM_LABEL
    );
    await setAlarmNumber(
      page,
      edit.getByRole("spinbutton", { name: "Minute", exact: true }),
      EDITED_MINUTE
    );
    await tabToEither(page, edit.getByRole("button", { name: "Save", exact: true }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(edit).toBeHidden();
    await expect(clockFrame(page).getByText(EDITED_TIME, { exact: true })).toBeVisible();
    await expect(clockFrame(page).getByText(ALARM_TIME, { exact: true })).toHaveCount(0);

    // The switch, renamed with the new time, turns the Alarm off and back on.
    // Saving returned focus to the row's Edit button, so the switch sits before.
    const editedToggle = alarmSwitch(page, EDITED_TIME);
    await expect(editedToggle).toBeChecked();
    await tabTo(page, editedToggle, { max: 4, backwards: true });
    await page.keyboard.press("Space");
    await expect(editedToggle).not.toBeChecked();
    await page.keyboard.press("Space");
    await expect(editedToggle).toBeChecked();
    await capture(page, "clock-alarms-edited");

    // Delete <time> takes the row away, leaving the tab empty again.
    const removeButton = clockFrame(page).getByRole("button", {
      name: `Delete ${EDITED_TIME}`,
      exact: true,
    });
    await tabTo(page, removeButton, { max: 4 });
    await page.keyboard.press("Enter");
    await expect(clockFrame(page).getByText(NO_ALARMS, { exact: true })).toBeVisible();
    await expect(editedToggle).toHaveCount(0);
    await expect(clockFrame(page).getByText(ALARM_LABEL, { exact: true })).toHaveCount(0);
    await capture(page, "clock-alarms-deleted");
  });
});
