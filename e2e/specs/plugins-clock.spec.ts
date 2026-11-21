// Clock's Timer (issue #871), Pomodoro, and Stopwatch (issue #873), on the
// Built-in Plugin that ships off by default: turning it on from Settings →
// Plugins by keyboard, opening its page from the Command Palette on the Pomodoro
// tab, moving to the Timer tab, setting a 5-second length from the length fields, starting it, pausing
// and resuming it from its Plugin Command, and its end: the live region's
// announcement and the Alert, which reaches the author as Maibuk's own
// in-window notice here because headless Chromium never grants the Notification
// permission. The page opens on the Pomodoro tab, and
// its Cycle starts there, pauses and resumes from its Command, skips to the
// Short break from its other Command, and resets to the first Pomodoro. Its
// settings dialog opens by keyboard from the lengths row under the Cycle: Save
// on a 100-minute Pomodoro length raises the range error and keeps focus on the
// field, Save on 30 closes it with the row and the idle drawn time reading 30,
// and the Pomodoro settings Command opens the same dialog on the Pomodoro tab
// until Escape dismisses it. The
// Stopwatch tab is two ArrowRights from the Pomodoro: its Stopwatch starts, marks a Lap
// from its button and a second from its other Command, pauses and resumes from
// its Command, and resets to zero, and a reload reopens the Clock on the
// Stopwatch tab, the one this device last picked. The Alarms tab is End from the Pomodoro:
// the form adds an Alarm a couple of minutes ahead with a label and a weekday,
// Edit moves its minute, its switch turns it off and back on, and Delete
// returns the tab to its empty message (issue #874). No phase is waited out:
// the Pomodoro's 25 minutes are the unit suites'.
// The page is the Plugin's whole-page Frame (#886): the section tabs, every
// panel, the notification banner, and the live region are inside the iframe, so
// every step below reaches them through the Frame. Only the Command Palette and
// Maibuk's own Alert notice are host UI. Keyboard only: every control is
// reached by Tab and pressed with Enter or Space, and a host Command takes the
// keys back from the Frame first. The Alarm editor and the Pomodoro settings
// dialog are dialogs inside the Frame, so their focus entry, Tab containment,
// Escape and restored focus are asserted where they open. The same Frame on a
// phone (#886) stacks its side card below
// the hero and keeps every target thumb-sized: a @touch test opens it from the
// navigation menu and proves both.

import type { FrameLocator, Locator, Page } from "@playwright/test";
import { capture } from "../support/capture";
import {
  expectFocusWithin,
  expectTabContained,
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

/**
 * The Pomodoro settings Command, which opens the Clock page and asks its Frame
 * to show the dialog. Its label is also the dialog's title, so both lookups
 * read the same words.
 */
const POMODORO_SETTINGS_COMMAND = "Pomodoro settings";

/** The settings dialog inside the Frame. */
const settingsDialog = (page: Page) =>
  clockFrame(page).getByRole("dialog", { name: POMODORO_SETTINGS_COMMAND, exact: true });

/** The dialog's Pomodoro length field, by its localized label. */
const pomodoroLengthField = (page: Page) =>
  settingsDialog(page).getByRole("spinbutton", { name: "Pomodoro (minutes)", exact: true });

/** What the field says when a Save finds its number outside 1 to 99. */
const MINUTES_RANGE = "Between 1 and 99 minutes";

/**
 * The lengths row under the Cycle: the button that sums up the three lengths
 * and opens the settings dialog, named "Pomodoro settings, 25 · 5 · 15 min".
 */
const lengthsRow = (page: Page) =>
  clockFrame(page).getByRole("button", { name: /^Pomodoro settings, / });

/** The lengths row's summary for a Pomodoro of `minutes`, the two breaks unchanged. */
const lengthsSummary = (minutes: number) => `${minutes} · 5 · 15 min`;

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

/**
 * An Alarm's drawn time: "HH:mm" while the 24-Hour Clock is on, which it is on
 * a device that never turned it off, and "h:mm AM" or "h:mm PM" once it is off.
 */
function clockTime(hour: number, minute: number, hourCycle: 12 | 24 = 24): string {
  const mm = String(minute).padStart(2, "0");
  if (hourCycle === 24) return `${String(hour).padStart(2, "0")}:${mm}`;
  const hours = hour % 12 === 0 ? 12 : hour % 12;
  return `${hours}:${mm} ${hour < 12 ? "AM" : "PM"}`;
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

/** What the Hour field says when a Save finds it outside 0 to 23. */
const HOUR_RANGE = "Between 0 and 23";

/** The confirmation a row's Delete button opens before anything is deleted. */
const deleteConfirm = (page: Page) =>
  clockFrame(page).getByRole("alertdialog", { name: "Delete this alarm?", exact: true });

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

/**
 * Opens the Clock page through its navigating Command, on the tab `opensOn`:
 * Pomodoro on a device that never picked one, else the tab it last picked.
 * `shot` names a capture of the page as it first draws, taken before the tab is
 * asserted so the base run of `pnpm screenshots` shows the tab it opened on.
 */
async function openClockPage(
  page: Page,
  opensOn = "Pomodoro",
  shot: string | null = null
): Promise<void> {
  await runPaletteCommand(page, "Open Clock");
  await expect(page).toHaveURL(new RegExp(`/plugin/${PLUGIN_ID}/${PAGE_ID}$`));
  // The page's own heading stays in the host, drawn for screen readers only.
  await expect(page.getByRole("heading", { name: PLUGIN_NAME, level: 1 })).toBeVisible();
  const tabs = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  await expect(tabs).toBeVisible();
  if (shot !== null) await capture(page, shot);
  await expect(tabs.getByRole("tab", { name: opensOn, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 15_000 }
  );
  await expect(tabPanel(page, opensOn)).toBeVisible({ timeout: 15_000 });
}

/**
 * Moves from the Pomodoro tab to the Timer tab by keyboard: the tab list is one
 * tab stop, so Tab lands on the selected Pomodoro tab, and ArrowRight moves to
 * the Timer, which selection follows.
 */
async function openTimerTab(page: Page): Promise<void> {
  const tabList = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  const pomodoroTab = tabList.getByRole("tab", { name: "Pomodoro", exact: true });
  const timerTab = tabList.getByRole("tab", { name: "Timer", exact: true });
  await tabTo(page, pomodoroTab, { max: 60 });
  await page.keyboard.press("ArrowRight");
  await expect(timerTab).toHaveAttribute("aria-selected", "true");
  await expect(lengthField(page, "Seconds")).toBeVisible({ timeout: 15_000 });
}

/**
 * Moves from the Pomodoro tab to the Stopwatch tab by keyboard: the tab list is
 * one tab stop, so Tab lands on the selected Pomodoro tab, and two ArrowRights
 * pass the Timer to the Stopwatch, which selection follows.
 */
async function openStopwatchTab(page: Page): Promise<void> {
  const tabList = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  const pomodoroTab = tabList.getByRole("tab", { name: "Pomodoro", exact: true });
  const timerTab = tabList.getByRole("tab", { name: "Timer", exact: true });
  const stopwatchTab = tabList.getByRole("tab", { name: "Stopwatch", exact: true });
  await tabTo(page, pomodoroTab, { max: 60 });
  await page.keyboard.press("ArrowRight");
  await expect(timerTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
  // The Stopwatch tab's own panel, from the zero it opens on.
  await expect(tabPanel(page, "Stopwatch")).toBeVisible({ timeout: 15_000 });
  await expect(elapsedTime(page)).toHaveText("00:00:00", { timeout: 15_000 });
}

/**
 * Moves from the Pomodoro tab to the Alarms tab by keyboard: the tab list is
 * one tab stop, so Tab lands on the selected Pomodoro tab, and End moves to the
 * last tab, the Alarms, which selection follows.
 */
async function openAlarmsTab(page: Page): Promise<void> {
  const tabList = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
  const pomodoroTab = tabList.getByRole("tab", { name: "Pomodoro", exact: true });
  const alarmsTab = tabList.getByRole("tab", { name: "Alarms", exact: true });
  await tabTo(page, pomodoroTab, { max: 60 });
  await page.keyboard.press("End");
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

/** The four section buttons, in the Frame's tab order. */
const SECTIONS = ["Pomodoro", "Timer", "Stopwatch", "Alarms"] as const;

/** The smallest a tap target may be on a phone: 44 by 44 CSS pixels. */
const MIN_TAP = 44;

/** The box an element draws, failing when a hidden or detached one draws none. */
async function boxOf(
  target: Locator,
  name: string
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await target.boundingBox();
  if (box === null) throw new Error(`${name} draws no box, so it is no tap target`);
  return box;
}

/** Asserts one control is at least 44 by 44, the size a fingertip needs. */
async function expectThumbSized(target: Locator, name: string): Promise<void> {
  const box = await boxOf(target, name);
  expect(box.width, `${name} width`).toBeGreaterThanOrEqual(MIN_TAP);
  expect(box.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TAP);
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
    await openTimerTab(page);

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
    await openClockPage(page, "Pomodoro", "clock-opens-on");

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

  test("the Pomodoro settings dialog opens from the lengths row, refuses 100 minutes, saves 30, and reopens from its Command @sc:plugin.maibuk-clock.openPomodoroSettings", async ({
    page,
  }) => {
    await turnOn(page);
    await openClockPage(page);

    // The side card's last control is the lengths row: it sums up the three
    // lengths, and Enter on it opens the dialog.
    await expect(lengthsRow(page)).toContainText(lengthsSummary(25));
    await tabToEither(page, lengthsRow(page), { max: 12 });
    await capture(page, "clock-pomodoro-settings-row");
    await page.keyboard.press("Enter");

    const settings = settingsDialog(page);
    await expect(settings).toBeVisible();
    await capture(page, "clock-pomodoro-settings-dialog");
    // Focus enters on the Pomodoro length field, holding the default, and Tab
    // past the dialog's last control stays inside it.
    const minutes = pomodoroLengthField(page);
    await expect(minutes).toBeFocused();
    await expect(minutes).toHaveValue("25");
    await expectTabContained(page, settings);
    // The containment walk leaves focus somewhere inside; it goes back to the
    // field before typing, the way the author would.
    await tabToEither(page, minutes, { max: 20 });
    await expect(minutes).toBeFocused();

    // 100 minutes is outside 1 to 99: Save raises the error, leaves the dialog
    // open, and puts focus back on the field the error names.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("100");
    const save = settings.getByRole("button", { name: "Save", exact: true });
    await tabToEither(page, save, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(settings.getByText(MINUTES_RANGE, { exact: true })).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(minutes).toBeFocused();
    await capture(page, "clock-pomodoro-settings-error");

    // 30 is inside it: Save closes the dialog and hands focus back to the row,
    // which reads the new length, as does the idle Pomodoro's drawn time.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("30");
    await tabToEither(page, save, { max: 20 });
    await page.keyboard.press("Enter");
    await expect(settings).toBeHidden();
    await expect(lengthsRow(page)).toBeFocused();
    await expect(lengthsRow(page)).toContainText(lengthsSummary(30));
    await expect(pomodoroTime(page)).toHaveText("30:00");

    // From the Timer tab, the Command switches to the Pomodoro tab and opens the
    // same dialog, holding what Save stored; Escape dismisses it back to the row.
    await tabToEither(page, clockFrame(page).getByRole("tab", { name: "Pomodoro", exact: true }));
    await page.keyboard.press("ArrowRight");
    await expect(tabPanel(page, "Pomodoro")).toBeHidden();
    await runHostCommand(page, POMODORO_SETTINGS_COMMAND);
    await expect(tabPanel(page, "Pomodoro")).toBeVisible({ timeout: 15_000 });
    await expect(tabPanel(page, "Timer")).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(minutes).toHaveValue("30");
    await expect(minutes).toBeFocused();
    await capture(page, "clock-pomodoro-settings-command");
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(lengthsRow(page)).toBeFocused();
    await expect(pomodoroTime(page)).toHaveText("30:00");

    // At phone width the dialog still fits, its action row wrapping.
    await page.setViewportSize({ width: 360, height: 760 });
    await page.keyboard.press("Enter");
    await expect(settings).toBeVisible();
    await capture(page, "clock-pomodoro-settings-narrow");
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

    // The tab is kept on this device: a reload reopens the Clock on the
    // Stopwatch, not the Pomodoro a device that never picked one opens on.
    await page.reload();
    await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 20_000 });
    await openClockPage(page, "Stopwatch");
    await expect(elapsedTime(page)).toHaveText("00:00:00", { timeout: 15_000 });
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
    // The dialog takes focus on its Label field, keeps Tab inside past its last
    // control, and Escape dismisses it back to the button that opened it.
    await expectFocusWithin(add);
    await expect(add.getByRole("textbox", { name: "Label", exact: true })).toBeFocused();
    await expectTabContained(page, add);
    // From Save, the last control, Tab lands back on the dialog's first, and one
    // more reaches its second: the Hour field, so focus wrapped inside.
    await tabToEither(page, add.getByRole("button", { name: "Save", exact: true }), { max: 20 });
    await page.keyboard.press("Tab");
    await expectFocusWithin(add);
    await page.keyboard.press("Tab");
    await expect(add.getByRole("spinbutton", { name: "Hour", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(add).toBeHidden();
    await expect(addAlarmButton(page)).toBeFocused();

    // Reopened from the restored focus: an hour of 24 is outside 0 to 23, so
    // Save names the range, keeps the form open, and focuses the Hour field.
    await page.keyboard.press("Enter");
    await expect(add).toBeVisible();
    const hour = add.getByRole("spinbutton", { name: "Hour", exact: true });
    await setAlarmNumber(page, hour, 24);
    await tabToEither(page, add.getByRole("button", { name: "Save", exact: true }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(add.getByText(HOUR_RANGE, { exact: true })).toBeVisible();
    await expect(add).toBeVisible();
    await expect(hour).toBeFocused();
    await expect(hour).toHaveValue("24");
    await capture(page, "clock-alarms-form-error");

    // The form is filled with a valid time and saved.
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

    // Delete <time> asks first: the confirmation names the Alarm and opens on
    // Cancel, and Escape keeps the row with focus back on its Delete button.
    const removeButton = clockFrame(page).getByRole("button", {
      name: `Delete ${EDITED_TIME}`,
      exact: true,
    });
    await tabTo(page, removeButton, { max: 4 });
    await page.keyboard.press("Enter");
    const confirm = deleteConfirm(page);
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(`Alarm ${EDITED_TIME} will be deleted.`);
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await capture(page, "clock-alarms-delete-confirm");
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(removeButton).toBeFocused();
    await expect(editedToggle).toBeVisible();

    // Confirmed, Delete takes the row away, leaving the tab empty again.
    await page.keyboard.press("Enter");
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(confirm.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirm).toBeHidden();
    await expect(clockFrame(page).getByText(NO_ALARMS, { exact: true })).toBeVisible();
    await expect(editedToggle).toHaveCount(0);
    await expect(clockFrame(page).getByText(ALARM_LABEL, { exact: true })).toHaveCount(0);
    await capture(page, "clock-alarms-deleted");

    // A short window makes the form's own column taller than the dialog, so
    // the capture carries its scrollbar.
    await expect(addAlarmButton(page)).toBeFocused();
    await page.setViewportSize({ width: 900, height: 560 });
    await page.keyboard.press("Enter");
    const shortForm = alarmForm(page, "Add alarm");
    await expect(shortForm).toBeVisible();
    await capture(page, "clock-alarms-form-short", { around: [shortForm] });
  });
});

test.describe("Clock 24-hour clock @wf:plugins-clock-alarms @chromium-only", () => {
  test("the 24-hour clock is on by default, its switches turn 12-hour times on in the tab and the editor, and a reload keeps the choice", async ({
    page,
  }) => {
    await turnOn(page);
    await openClockPage(page);
    await openAlarmsTab(page);

    // On by default: the switch sits on the empty tab, and an Alarm reads 24-hour.
    const tabSwitch = clockFrame(page).locator("#alarms-hour-cycle");
    await expect(tabSwitch).toHaveAccessibleName("24-hour clock");
    await expect(tabSwitch).toBeChecked();
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
    const weekday = add.getByRole("checkbox", { name: ALARM_WEEKDAY, exact: true });
    await tabToEither(page, weekday, { max: 20 });
    await page.keyboard.press("Space");
    await tabToEither(page, add.getByRole("button", { name: "Save", exact: true }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(add).toBeHidden();
    const time24 = clockTime(ALARM_HOUR, ALARM_MINUTE, 24);
    const time12 = clockTime(ALARM_HOUR, ALARM_MINUTE, 12);
    await expect(clockFrame(page).getByText(time24, { exact: true })).toBeVisible();

    // The tab's switch, off by keyboard, rewrites the row in 12-hour form.
    // Save gave focus back to Add alarm, so the switch is a Tab or two on.
    await tabToEither(page, tabSwitch, { max: 10 });
    await page.keyboard.press("Space");
    await expect(tabSwitch).not.toBeChecked();
    await expect(clockFrame(page).getByText(time12, { exact: true })).toBeVisible();
    await capture(page, "clock-alarms-12-hour");

    // Edit opens on the 12-hour hour with AM or PM chosen.
    const editButton = clockFrame(page).getByRole("button", {
      name: `Edit ${time12}`,
      exact: true,
    });
    await tabToEither(page, editButton, { max: 30 });
    await page.keyboard.press("Enter");
    await expect(alarmForm(page, `Edit ${time12}`)).toBeVisible();
    // The title follows the hour cycle, so the steps below find the one open
    // dialog rather than its name.
    const edit = clockFrame(page).getByRole("dialog");
    const hour = edit.getByRole("spinbutton", { name: "Hour", exact: true });
    await expect(hour).toHaveValue(String(ALARM_HOUR % 12 === 0 ? 12 : ALARM_HOUR % 12));
    const meridiem = ALARM_HOUR < 12 ? "AM" : "PM";
    await expect(edit.getByRole("radio", { name: meridiem, exact: true })).toBeChecked();
    await capture(page, "clock-alarms-form-12-hour");

    // The editor's switch turns the 24-hour clock back on at once: the hour
    // converts, AM and PM go, and the tab's switch follows.
    const editorSwitch = edit.getByRole("switch", { name: "24-hour clock", exact: true });
    await tabToEither(page, editorSwitch, { max: 20 });
    await page.keyboard.press("Space");
    await expect(editorSwitch).toBeChecked();
    await expect(hour).toHaveValue(String(ALARM_HOUR).padStart(2, "0"));
    await expect(edit.getByRole("radio")).toHaveCount(0);
    await expect(alarmForm(page, `Edit ${time24}`)).toBeVisible();
    await expect(tabSwitch).toBeChecked();

    // Off again, then Escape: Cancel discards the edit, never the switch.
    await page.keyboard.press("Space");
    await expect(editorSwitch).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(clockFrame(page).getByRole("dialog")).toHaveCount(0);
    await expect(tabSwitch).not.toBeChecked();

    // Kept on this device: a reload reopens the tab still in 12-hour form.
    await page.reload();
    await expect(navOption(page, PLUGIN_NAME)).toBeVisible({ timeout: 20_000 });
    await openClockPage(page, "Alarms");
    await expect(tabSwitch).not.toBeChecked({ timeout: 15_000 });
    await expect(clockFrame(page).getByText(time12, { exact: true })).toBeVisible();

    // A narrow panel cannot hold the next-alarm line and the switch side by
    // side: the switch drops to its own line and keeps to the end edge.
    await page.setViewportSize({ width: 420, height: 800 });
    const nextAlarm = clockFrame(page).locator("#next-alarm");
    const format = clockFrame(page).locator(".alarms-format");
    const panel = tabPanel(page, "Alarms");
    await expect(nextAlarm).toBeVisible();
    await expect
      .poll(async () => {
        const [line, group] = await Promise.all([nextAlarm.boundingBox(), format.boundingBox()]);
        return line !== null && group !== null && group.y >= line.y + line.height - 1;
      })
      .toBe(true);
    const [group, box] = await Promise.all([format.boundingBox(), panel.boundingBox()]);
    expect(group).not.toBeNull();
    expect(box).not.toBeNull();
    if (group !== null && box !== null) {
      expect(Math.abs(group.x + group.width - (box.x + box.width))).toBeLessThanOrEqual(1);
    }
    await capture(page, "clock-alarms-12-hour-narrow");
  });
});

test.describe("Clock on a phone @touch @wf:plugins-clock-phone", () => {
  // A phone has no Settings outline to turn the Built-in on from, so the seed
  // writes the record turning it on would: the shipped copy pinned, its one
  // required Plugin Permission granted, and the Plugin already running.
  test.use({ pluginApprovals: [{ pluginId: PLUGIN_ID, granted: ["system-notifications"] }] });

  test("the Frame stacks its side card below the hero with thumb-sized targets @touch", async ({
    page,
  }) => {
    await page.goto("/");
    // A phone has no sidebar: the pages live behind the navigation menu.
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await expect(menu).toBeVisible({ timeout: 60_000 });
    await menu.tap();
    const navigation = page.getByRole("dialog", { name: "Primary navigation" });
    await navigation.getByRole("option", { name: /^Clock/ }).tap();
    await expect(page).toHaveURL(new RegExp(`/plugin/${PLUGIN_ID}/${PAGE_ID}$`));
    const tabs = clockFrame(page).getByRole("tablist", { name: "Clock sections" });
    await expect(tabs).toBeVisible({ timeout: 20_000 });

    // The Pomodoro tab draws a hero carrying the primary button and the two
    // round icon buttons, and a side card that desktop width puts beside it.
    await tabs.getByRole("tab", { name: "Pomodoro", exact: true }).tap();
    const pomodoro = tabPanel(page, "Pomodoro");
    await expect(pomodoro).toBeVisible({ timeout: 15_000 });
    const hero = await boxOf(pomodoro.locator(".hero"), "the hero");
    const side = await boxOf(pomodoro.locator(".side"), "the side card");
    // At phone width the layout stacks, so the side card starts below the hero.
    expect(side.y).toBeGreaterThan(hero.y + hero.height);

    // Every target is thumb-sized: the four section buttons, the hero's primary
    // button, and its two round icon buttons.
    for (const name of SECTIONS) {
      await expectThumbSized(tabs.getByRole("tab", { name, exact: true }), name);
    }
    await expectThumbSized(pomodoro.getByRole("button", { name: "Start", exact: true }), "Start");
    await expectThumbSized(
      pomodoro.getByRole("button", { name: "Reset Cycle", exact: true }),
      "Reset Cycle"
    );
    await expectThumbSized(pomodoro.getByRole("button", { name: "Skip", exact: true }), "Skip");
    await capture(page, "clock-phone-pomodoro");

    // A tap on the Stopwatch section selects it and draws its own panel.
    const stopwatchTab = tabs.getByRole("tab", { name: "Stopwatch", exact: true });
    await stopwatchTab.tap();
    await expect(tabPanel(page, "Stopwatch")).toBeVisible();
    await expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
    await expect(pomodoro).toBeHidden();
    await capture(page, "clock-phone-stopwatch");
  });
});
