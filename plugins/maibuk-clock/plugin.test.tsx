/**
 * Clock's Plugin-level behavior through the supported Plugin test kit: the real
 * broker, method table, and Remote UI renderer. The runtime is driven over the
 * polyfill-free `@/plugin-sdk/ui-serve` entry, the same one the kit's jsdom
 * uses; `index.tsx` (the Worker bootstrap) is never imported.
 *
 * This unit proves the Clock page opens from the Open Clock Command, the tabs
 * switch with the keyboard alone, the labels follow the app language, and the
 * Timer works end to end: a typed length counts down, its end is scheduled as a
 * System Notification at the deadline, pause freezes it and cancels the Alert,
 * reset restores the length, the recent lengths come back newest first, the
 * Command toggles, the live region speaks on the minute and at the end on every
 * tab, and the notification banner asks for permission. The Pomodoro tab starts,
 * pauses, skips, and resets the Cycle, counts today's Pomodoros, and shows a
 * phase that ended before startup as ended. The Pomodoro Settings row changes
 * the lengths and auto-starts the next phase. The Pomodoro Commands start,
 * pause, and skip the cycle, and the Toggle Button stays pressed exactly while a
 * phase runs. Every control is reached with `user-event` key presses.
 */

import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import {
  CLOCK_PAGE_ID,
  LAP_STOPWATCH,
  OPEN_CLOCK,
  POMODORO_SETTINGS_ROW_ID,
  SKIP_POMODORO,
  TOGGLE_POMODORO,
  TOGGLE_STOPWATCH,
  TOGGLE_TIMER,
  startClock,
} from "./runtime";
import { dayNumber } from "./cycle";
import { clockManifest, tabTo, type User } from "./test-support";
import { formatDuration } from "./time";

/**
 * The fake clock every timed test starts at. It sits an hour ahead of the real
 * clock because the host's System Notification service compares a scheduled
 * `at` against the real `Date.now` it captured when the host was built; every
 * Alert stays in its future for the whole suite.
 */
const START = Date.now() + 3_600_000;

/** The tag the host scopes the Timer's Alert under. */
const TIMER_TAG = "maibuk-clock/timer";

/** The tag the host scopes the Pomodoro's Alert under. */
const POMODORO_TAG = "maibuk-clock/pomodoro";

/** One stored Timer, as the Plugin writes it. */
interface StoredTimer {
  state: { status: string; length: number; endsAt?: number; remaining?: number; endedAt?: number };
  recent: number[];
}

/** One stored Cycle, as the Plugin writes it. */
interface StoredCycle {
  state: { phase: string; pomodoro: number; status: string; endsAt?: number; remaining?: number };
}

/** The Timer storage holds, or none. */
function stored(storage: Map<string, unknown>): StoredTimer | undefined {
  const value = storage.get("timer");
  return typeof value === "object" && value !== null ? (value as StoredTimer) : undefined;
}

/** The Cycle storage holds, or none. */
function storedCycle(storage: Map<string, unknown>): StoredCycle | undefined {
  const value = storage.get("pomodoro");
  return typeof value === "object" && value !== null ? (value as StoredCycle) : undefined;
}

/** One stored Stopwatch, as the Plugin writes it. */
interface StoredStopwatch {
  status: string;
  startedAt?: number;
  banked?: number;
  laps?: { length: number; total: number }[];
}

/** The Stopwatch storage holds, or none. */
function storedStopwatch(storage: Map<string, unknown>): StoredStopwatch | undefined {
  const value = storage.get("stopwatch");
  return typeof value === "object" && value !== null ? (value as StoredStopwatch) : undefined;
}

/** The Cycle settings storage holds, or none. */
function storedSettings(storage: Map<string, unknown>): Record<string, unknown> | undefined {
  const value = storage.get("pomodoro");
  if (typeof value !== "object" || value === null) return undefined;
  const settings = (value as { settings?: unknown }).settings;
  return typeof settings === "object" && settings !== null
    ? (settings as Record<string, unknown>)
    : undefined;
}

/** Takes over the clock and the Plugin's own timers for one test. */
function freezeClock(): void {
  vi.useFakeTimers({
    now: START,
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

/** Every host a timed test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** A host with the Clock manifest, its storage in memory, and the runtime wired. */
function startHost(options: { language?: string; storage?: Map<string, unknown> } = {}): {
  host: ReturnType<typeof createTestHost>;
  storage: Map<string, unknown>;
} {
  const storage = options.storage ?? new Map<string, unknown>();
  const host = createTestHost({
    manifest: clockManifest(),
    storage,
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  openHosts.push(host);
  startClock(createPluginClient(host.port), servePluginUi);
  return { host, storage };
}

/**
 * Polls until the page shows what the test asserts, instead of guessing how
 * many event-loop turns the Remote UI mount needs.
 */
async function eventually(check: () => void): Promise<void> {
  await vi.waitFor(check);
}

/** Types a length's minutes from the keyboard, and waits until the Timer took it. */
async function typeMinutes(
  user: User,
  minutes: number,
  storage: Map<string, unknown>
): Promise<void> {
  await eventually(() =>
    expect(screen.getByRole("textbox", { name: en.minutes })).toBeInTheDocument()
  );
  const field = screen.getByRole("textbox", { name: en.minutes });
  await user.clear(field);
  await user.type(field, String(minutes));
  await user.keyboard("{Enter}");
  await eventually(() => {
    const saved = stored(storage);
    expect(saved?.state.status).toBe("idle");
    expect(saved?.state.length).toBe(minutes * 60_000);
  });
}

/** Tabs to a named button, proves it holds focus, and presses it. */
async function press(user: User, name: string): Promise<void> {
  await eventually(() => expect(screen.getByRole("button", { name })).toBeInTheDocument());
  const button = screen.getByRole("button", { name });
  await tabTo(user, button);
  expect(button).toHaveFocus();
  await user.keyboard("{Enter}");
}

/** Focuses the selected Timer tab and moves left to the Pomodoro tab with the keyboard. */
async function openPomodoroTab(user: User): Promise<void> {
  const timerTab = await screen.findByRole("tab", { name: en.timer });
  await tabTo(user, timerTab);
  expect(timerTab).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  await eventually(() =>
    expect(screen.getByRole("heading", { name: en.pomodoro })).toBeInTheDocument()
  );
}

/** Focuses the selected Timer tab and moves right to the Stopwatch tab with the keyboard. */
async function openStopwatchTab(user: User): Promise<void> {
  const timerTab = await screen.findByRole("tab", { name: en.timer });
  await tabTo(user, timerTab);
  expect(timerTab).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: en.stopwatch })).toHaveFocus();
  // The Stopwatch panel draws a time and none of the Timer's length fields.
  await eventually(() => {
    expect(screen.queryByRole("textbox", { name: en.hours })).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/\d+:\d{2}/);
  });
}

/** Starts the Timer from the page and waits for the stored running state. */
async function startTimer(user: User, storage: Map<string, unknown>): Promise<void> {
  await press(user, en.start);
  await eventually(() => expect(stored(storage)?.state.status).toBe("running"));
}

describe("Clock runtime", () => {
  afterEach(async () => {
    // The Plugin's teardown waits on a real task, which a fake clock never runs.
    vi.useRealTimers();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("opens the Clock page from the openClock Command and draws its four tabs", async () => {
    const host = createTestHost({ manifest: clockManifest() });
    try {
      startClock(createPluginClient(host.port), servePluginUi);

      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_CLOCK });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-clock", pageId: CLOCK_PAGE_ID }]);

      const page = await host.renderPage(CLOCK_PAGE_ID);
      expect(await screen.findByRole("tablist", { name: en.tabs })).toBeInTheDocument();
      for (const label of [en.pomodoro, en.timer, en.stopwatch, en.alarms]) {
        expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
      }
      // The Timer is selected first, and its panel is the live Timer.
      expect(screen.getByRole("tab", { name: en.timer })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("textbox", { name: en.hours })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: en.minutes })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: en.seconds })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en.start })).toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("moves from Timer to Stopwatch with the keyboard alone", async () => {
    const host = createTestHost({ manifest: clockManifest() });
    try {
      startClock(createPluginClient(host.port), servePluginUi);
      const page = await host.renderPage(CLOCK_PAGE_ID);
      const user = userEvent.setup();

      const timerTab = await screen.findByRole("tab", { name: en.timer });
      await tabTo(user, timerTab);
      expect(timerTab).toHaveFocus();

      await user.keyboard("{ArrowRight}");

      await eventually(() =>
        expect(screen.getByRole("tab", { name: en.stopwatch })).toHaveAttribute(
          "aria-selected",
          "true"
        )
      );
      const stopwatchTab = screen.getByRole("tab", { name: en.stopwatch });
      expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
      expect(stopwatchTab).toHaveFocus();
      // The Stopwatch tab draws the Stopwatch itself now, not a placeholder.
      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByText("0:00")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: en.start })).toBeInTheDocument();
      expect(within(panel).queryByText(en.comingSoon)).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("marks Laps while running, newest first, with each stretch and total, kept across a page change", async () => {
    const { host, storage } = startHost();
    freezeClock();
    const page = await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openStopwatchTab(user);
    await press(user, en.start);
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await press(user, en.lap);
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await press(user, en.lap);
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(2));

    const table = await screen.findByRole("table", { name: en.laps });
    await eventually(() => expect(within(table).getAllByRole("row")).toHaveLength(3));
    const rows = within(table).getAllByRole("row");
    // Newest first: Lap 2 is the 5 s stretch ending at 0:15, Lap 1 the 10 s one.
    expect(rows[1]?.textContent).toContain("2");
    expect(rows[1]?.textContent).toContain("0:05");
    expect(rows[1]?.textContent).toContain("0:15");
    expect(rows[2]?.textContent).toContain("1");
    expect(rows[2]?.textContent).toContain("0:10");

    // Leaving the page and coming back finds the same Laps.
    await page.unmount();
    await host.renderPage(CLOCK_PAGE_ID);
    await openStopwatchTab(user);
    const again = await screen.findByRole("table", { name: en.laps });
    await eventually(() => expect(within(again).getAllByRole("row")).toHaveLength(3));
  });

  it("pauses to hold the time and resumes from where it stopped", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openStopwatchTab(user);
    await press(user, en.start);
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await press(user, en.pause);
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("paused"));
    await eventually(() => expect(screen.getByText("0:10")).toBeInTheDocument());

    // A minute passes while paused; the Stopwatch holds still.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("0:10")).toBeInTheDocument();

    await press(user, en.resume);
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await eventually(() => expect(screen.getByText("0:15")).toBeInTheDocument());
  });

  it("resets to zero, drops the Laps, and stores an idle Stopwatch", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openStopwatchTab(user);
    await press(user, en.start);
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await press(user, en.lap);
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(1));

    await press(user, en.reset);
    await eventually(() => expect(storedStopwatch(storage)).toEqual({ status: "idle" }));
    await eventually(() => expect(screen.getByText("0:00")).toBeInTheDocument());
    expect(screen.queryByRole("table", { name: en.laps })).toBeNull();
  });

  it("finds a running Stopwatch and its Laps after a restart", async () => {
    const storage = new Map<string, unknown>([
      [
        "stopwatch",
        {
          status: "running",
          startedAt: START - 90_000,
          banked: 0,
          laps: [
            { length: 30_000, total: 30_000 },
            { length: 30_000, total: 60_000 },
          ],
        },
      ],
    ]);
    const { host } = startHost({ storage });
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openStopwatchTab(user);
    await eventually(() => expect(screen.getByText("1:30")).toBeInTheDocument());
    const table = await screen.findByRole("table", { name: en.laps });
    await eventually(() => expect(within(table).getAllByRole("row")).toHaveLength(3));
    const rows = within(table).getAllByRole("row");
    // Newest first: Lap 2's 0:30 stretch ends at 1:00, Lap 1's ends at 0:30.
    expect(rows[1]?.textContent).toContain("2");
    expect(rows[1]?.textContent).toContain("0:30");
    expect(rows[1]?.textContent).toContain("1:00");
    expect(rows[2]?.textContent).toContain("1");
    expect(rows[2]?.textContent).toContain("0:30");
  });

  it("starts and then pauses the Stopwatch from the toggleStopwatch Command", async () => {
    const { host, storage } = startHost();
    freezeClock();

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_STOPWATCH })
    ).resolves.toBeNull();
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_STOPWATCH })
    ).resolves.toBeNull();
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("paused"));
    expect(host.pageNavigations).toEqual([]);
  });

  it("marks a Lap from the lapStopwatch Command while running", async () => {
    const { host, storage } = startHost();
    freezeClock();

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_STOPWATCH });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await vi.advanceTimersByTime(5_000);
    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: LAP_STOPWATCH })
    ).resolves.toBeNull();
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(1));
    expect(storedStopwatch(storage)?.laps?.[0]?.length).toBeGreaterThanOrEqual(5_000);
    expect(storedStopwatch(storage)?.laps?.[0]?.total).toBeGreaterThanOrEqual(5_000);
  });

  it("runs the Timer, the Pomodoro, and the Stopwatch all at once", async () => {
    const { host, storage } = startHost();
    freezeClock();

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_TIMER });
    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_STOPWATCH });

    await eventually(() => {
      expect(stored(storage)?.state.status).toBe("running");
      expect(storedCycle(storage)?.state.status).toBe("running");
      expect(storedStopwatch(storage)?.status).toBe("running");
    });
  });

  it("raises no Alert however long the Stopwatch runs", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openStopwatchTab(user);
    await press(user, en.start);
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(host.systemNotifications.scheduled.size).toBe(0);
    expect(host.systemNotifications.log).toEqual([]);
  });

  it("opens the Pomodoro tab by keyboard, and Start runs Pomodoro 1 of 4 with an Alert", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openPomodoroTab(user);

    expect(screen.getByRole("heading", { name: en.pomodoro })).toBeInTheDocument();
    expect(
      screen.getByText(en.pomodoroOfCycle.replace("{n}", "1").replace("{total}", "4"))
    ).toBeInTheDocument();
    expect(screen.getByText("25:00")).toBeInTheDocument();
    expect(screen.getByText(en.pomodorosToday.replace("{n}", "0"))).toBeInTheDocument();

    await press(user, en.start);
    await eventually(() => expect(storedCycle(storage)?.state.status).toBe("running"));
    await eventually(() => {
      const state = storedCycle(storage)?.state;
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(state?.endsAt);
    });
    expect(host.systemNotifications.scheduled.get(POMODORO_TAG)).toMatchObject({
      title: `Clock: ${en.pomodoro}`,
    });
  });

  it("ends the Pomodoro into an idle Short Break, counts it, and leaves its Alert to fire", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openPomodoroTab(user);
    await press(user, en.start);
    await eventually(() => expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60_000);
    });
    await eventually(() =>
      expect(screen.getByRole("heading", { name: en.shortBreak })).toBeInTheDocument()
    );
    expect(screen.getByText(en.pomodorosToday.replace("{n}", "1"))).toBeInTheDocument();
    expect(storedCycle(storage)?.state).toEqual({
      phase: "shortBreak",
      pomodoro: 1,
      status: "idle",
    });
    // The ended Pomodoro's Alert is left to fire: nothing withdraws it.
    expect(
      host.systemNotifications.log.filter(
        (entry) => entry.kind === "cancelled" && entry.tag === POMODORO_TAG
      )
    ).toEqual([]);
    expect(screen.getByRole("button", { name: en.start })).toBeInTheDocument();
  });

  it("skips to the next phase and resets to Pomodoro 1 by keyboard", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openPomodoroTab(user);
    await press(user, en.skip);
    await eventually(() =>
      expect(screen.getByRole("heading", { name: en.shortBreak })).toBeInTheDocument()
    );
    expect(storedCycle(storage)?.state).toEqual({
      phase: "shortBreak",
      pomodoro: 1,
      status: "idle",
    });

    await press(user, en.resetCycle);
    await eventually(() =>
      expect(screen.getByRole("heading", { name: en.pomodoro })).toBeInTheDocument()
    );
    expect(
      screen.getByText(en.pomodoroOfCycle.replace("{n}", "1").replace("{total}", "4"))
    ).toBeInTheDocument();
    expect(storedCycle(storage)?.state).toEqual({
      phase: "pomodoro",
      pomodoro: 1,
      status: "idle",
    });
  });

  it("resets Pomodoros today at local midnight while the page stays open on an idle Cycle", async () => {
    const lateEvening = new Date(2026, 10, 20, 23, 59, 0).getTime();
    const storage = new Map<string, unknown>([
      [
        "pomodoro",
        {
          state: { phase: "pomodoro", pomodoro: 3, status: "idle" },
          today: {
            day: dayNumber(lateEvening, new Date(lateEvening).getTimezoneOffset()),
            count: 2,
          },
        },
      ],
    ]);
    const { host } = startHost({ storage });
    vi.useFakeTimers({
      now: lateEvening,
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openPomodoroTab(user);
    await eventually(() =>
      expect(screen.getByText(en.pomodorosToday.replace("{n}", "2"))).toBeInTheDocument()
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    await eventually(() =>
      expect(screen.getByText(en.pomodorosToday.replace("{n}", "0"))).toBeInTheDocument()
    );
  });

  it("sends the fourth Pomodoro to the Long Break", async () => {
    const storage = new Map<string, unknown>([
      [
        "pomodoro",
        {
          state: { phase: "pomodoro", pomodoro: 4, status: "idle" },
          today: { day: 0, count: 3 },
        },
      ],
    ]);
    const { host } = startHost({ storage });
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openPomodoroTab(user);
    expect(
      screen.getByText(en.pomodoroOfCycle.replace("{n}", "4").replace("{total}", "4"))
    ).toBeInTheDocument();

    await press(user, en.start);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60_000);
    });
    await eventually(() =>
      expect(screen.getByRole("heading", { name: en.longBreak })).toBeInTheDocument()
    );
    expect(storedCycle(storage)?.state).toEqual({
      phase: "longBreak",
      pomodoro: 4,
      status: "idle",
    });
  });

  it("shows a phase that ended before startup as ended and does not advance", async () => {
    const storage = new Map<string, unknown>([
      [
        "pomodoro",
        {
          state: {
            phase: "pomodoro",
            pomodoro: 2,
            status: "running",
            endsAt: START - 60_000,
          },
          today: { day: 0, count: 0 },
        },
      ],
    ]);
    const { host } = startHost({ storage });
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await openPomodoroTab(user);

    await eventually(() =>
      expect(screen.getByText(en.phaseEnded.replace("{phase}", en.pomodoro))).toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: en.pomodoro })).toBeInTheDocument();
    expect(screen.getByText(en.pomodorosToday.replace("{n}", "1"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: en.shortBreak })).toBeNull();
    expect(storedCycle(storage)?.state).toMatchObject({
      phase: "pomodoro",
      pomodoro: 2,
      status: "ended",
    });
  });

  it("changes the Pomodoro settings by keyboard and auto-starts the Short Break", async () => {
    const { host, storage } = startHost();
    freezeClock();
    const row = await host.renderSettingsRow(POMODORO_SETTINGS_ROW_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const length = await screen.findByRole("textbox", { name: en.pomodoroMinutes });
    await tabTo(user, length);
    expect(length).toHaveFocus();
    await user.keyboard("{Control>}a{/Control}1{Enter}");
    await eventually(() => expect(storedSettings(storage)?.pomodoroMinutes).toBe(1));

    const autoStart = screen.getByRole("switch", { name: en.autoStartBreaks });
    await tabTo(user, autoStart);
    expect(autoStart).toHaveFocus();
    await user.keyboard(" ");
    await eventually(() => expect(storedSettings(storage)?.autoStartBreaks).toBe(true));

    await row.unmount();

    await host.renderPage(CLOCK_PAGE_ID);
    await openPomodoroTab(user);
    await press(user, en.start);
    await eventually(() => expect(storedCycle(storage)?.state.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await eventually(() =>
      expect(storedCycle(storage)?.state).toMatchObject({
        phase: "shortBreak",
        pomodoro: 1,
        status: "running",
      })
    );
    expect(screen.getByRole("heading", { name: en.shortBreak })).toBeInTheDocument();
    expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(true);
  });

  it("renders every label in Spanish when the app language is Spanish", async () => {
    const host = createTestHost({ manifest: clockManifest(), language: "es" });
    try {
      startClock(createPluginClient(host.port), servePluginUi);
      const page = await host.renderPage(CLOCK_PAGE_ID);
      const user = userEvent.setup();

      expect(await screen.findByRole("tablist", { name: es.tabs })).toBeInTheDocument();
      for (const label of [es.pomodoro, es.timer, es.stopwatch, es.alarms]) {
        expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
      }
      expect(screen.getByRole("textbox", { name: es.hours })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es.start })).toBeInTheDocument();

      const timerTab = screen.getByRole("tab", { name: es.timer });
      await tabTo(user, timerTab);
      expect(timerTab).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      await eventually(() =>
        expect(screen.getByRole("heading", { name: es.pomodoro })).toBeInTheDocument()
      );
      expect(
        screen.getByText(es.pomodoroOfCycle.replace("{n}", "1").replace("{total}", "4"))
      ).toBeInTheDocument();
      expect(screen.getByText(es.pomodorosToday.replace("{n}", "0"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es.skip })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es.resetCycle })).toBeInTheDocument();

      const row = await host.renderSettingsRow(POMODORO_SETTINGS_ROW_ID);
      expect(await screen.findByRole("textbox", { name: es.pomodoroMinutes })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: es.shortBreakMinutes })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: es.longBreakMinutes })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: es.longBreakEvery })).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: es.autoStartBreaks })).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: es.autoStartPomodoros })).toBeInTheDocument();
      await row.unmount();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("counts a typed length down and schedules the Alert at the stored deadline", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await typeMinutes(user, 1, storage);
    await startTimer(user, storage);

    await eventually(() => expect(screen.getByText("1:00")).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await eventually(() => expect(screen.getByText("0:59")).toBeInTheDocument());

    await eventually(() => {
      const saved = stored(storage);
      expect(saved?.state.status).toBe("running");
      expect(saved?.state.endsAt).toBeGreaterThan(START);
      const scheduled = host.systemNotifications.scheduled.get(TIMER_TAG);
      expect(scheduled).toBeDefined();
      expect(scheduled?.at).toBe(saved?.state.endsAt);
    });
    const scheduled = host.systemNotifications.scheduled.get(TIMER_TAG);
    expect(scheduled?.title).toBe(`Clock: ${en.timer}`);
    expect(scheduled?.body).toBe(en.timerEnded.replace("{length}", "1:00"));
  });

  it("pauses to keep the remaining time exact, cancels the Alert, and resumes at a new end", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await typeMinutes(user, 1, storage);
    await startTimer(user, storage);
    await eventually(() => expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await press(user, en.pause);
    await eventually(() => expect(stored(storage)?.state.status).toBe("paused"));

    const pausedRemaining = stored(storage)?.state.remaining ?? -1;
    expect(pausedRemaining).toBeGreaterThan(0);
    await eventually(() =>
      expect(screen.getByRole("button", { name: en.resume })).toBeInTheDocument()
    );
    expect(screen.getByText(formatDuration(pausedRemaining))).toBeInTheDocument();
    await eventually(() => expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(false));
    expect(host.systemNotifications.log.at(-1)).toMatchObject({
      kind: "cancelled",
      tag: TIMER_TAG,
    });

    // Ten more seconds move neither the stored remaining time nor the drawing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(stored(storage)?.state.remaining).toBe(pausedRemaining);
    expect(screen.getByText(formatDuration(pausedRemaining))).toBeInTheDocument();

    await press(user, en.resume);
    await eventually(() => {
      const saved = stored(storage);
      expect(saved?.state.status).toBe("running");
      const scheduled = host.systemNotifications.scheduled.get(TIMER_TAG);
      expect(scheduled).toBeDefined();
      expect(scheduled?.at).toBe(saved?.state.endsAt);
    });
  });

  it("resets to the length and cancels the Alert", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await typeMinutes(user, 1, storage);
    await startTimer(user, storage);
    await eventually(() => expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await press(user, en.reset);
    await eventually(() => {
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 60_000 });
      expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(false);
    });
    await eventually(() =>
      expect(screen.getByRole("button", { name: en.start })).toBeInTheDocument()
    );
    expect(screen.getByRole("textbox", { name: en.minutes })).toHaveValue("1");
  });

  it("keeps the three most recent lengths newest first, and a quick pick sets the length", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    for (const minutes of [1, 2, 3]) {
      await typeMinutes(user, minutes, storage);
      await startTimer(user, storage);
      await press(user, en.reset);
      await eventually(() => expect(stored(storage)?.state.status).toBe("idle"));
    }

    // The page redraws after the stored reset, so wait for the drawn picks.
    await eventually(() =>
      expect(
        screen
          .getAllByRole("button")
          .map((button) => button.textContent ?? "")
          .filter((label) => /^\d+:\d{2}$/.test(label))
      ).toEqual(["3:00", "2:00", "1:00"])
    );

    const pick = screen.getByRole("button", { name: "2:00" });
    await tabTo(user, pick);
    expect(pick).toHaveFocus();
    await user.keyboard("{Enter}");
    await eventually(() =>
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 120_000 })
    );
    expect(screen.getByRole("textbox", { name: en.minutes })).toHaveValue("2");
  });

  it("starts and then pauses the Timer from the toggleTimer Command", async () => {
    const { host, storage } = startHost();
    freezeClock();

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_TIMER })
    ).resolves.toBeNull();
    await eventually(() => expect(stored(storage)?.state.status).toBe("running"));

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_TIMER })
    ).resolves.toBeNull();
    await eventually(() => expect(stored(storage)?.state.status).toBe("paused"));
    expect(host.pageNavigations).toEqual([]);
  });

  it("starts and then pauses the Pomodoro from the togglePomodoro Command", async () => {
    const { host, storage } = startHost();
    freezeClock();

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO })
    ).resolves.toBeNull();
    await eventually(() => expect(storedCycle(storage)?.state.status).toBe("running"));
    await eventually(() => {
      const state = storedCycle(storage)?.state;
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(state?.endsAt);
    });

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO })
    ).resolves.toBeNull();
    await eventually(() => expect(storedCycle(storage)?.state.status).toBe("paused"));
    await eventually(() =>
      expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(false)
    );
    expect(host.systemNotifications.log.at(-1)).toMatchObject({
      kind: "cancelled",
      tag: POMODORO_TAG,
    });
    expect(host.pageNavigations).toEqual([]);
  });

  it("skips to the Short Break from the skipPomodoro Command", async () => {
    const { host, storage } = startHost();
    freezeClock();

    await expect(
      host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: SKIP_POMODORO })
    ).resolves.toBeNull();
    await eventually(() =>
      expect(storedCycle(storage)?.state).toEqual({
        phase: "shortBreak",
        pomodoro: 1,
        status: "idle",
      })
    );
    expect(host.pageNavigations).toEqual([]);
  });

  it("keeps the Toggle Button pressed while a phase runs, and released when it pauses or ends", async () => {
    const { host, storage } = startHost();
    freezeClock();
    expect(host.toolbarPressed(TOGGLE_POMODORO)).toBe(false);

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await eventually(() => expect(host.toolbarPressed(TOGGLE_POMODORO)).toBe(true));

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await eventually(() => expect(host.toolbarPressed(TOGGLE_POMODORO)).toBe(false));

    // A phase that ends in the app releases it too: auto-start is off by default.
    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await eventually(() => expect(host.toolbarPressed(TOGGLE_POMODORO)).toBe(true));
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    await eventually(() => expect(host.toolbarPressed(TOGGLE_POMODORO)).toBe(false));
    expect(storedCycle(storage)?.state).toEqual({
      phase: "shortBreak",
      pomodoro: 1,
      status: "idle",
    });
  });

  it("announces the whole minute and the end, never every second", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await typeMinutes(user, 2, storage);
    await startTimer(user, storage);

    const twoMinutes = en.minutesLeft.replace("{n}", "2");
    await eventually(() => expect(screen.getByText(twoMinutes)).toBeInTheDocument());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await eventually(() => expect(screen.getByText("1:59")).toBeInTheDocument());
    expect(screen.getByText(twoMinutes)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await eventually(() => expect(screen.getByText("1:58")).toBeInTheDocument());
    expect(screen.getByText(twoMinutes)).toBeInTheDocument();

    // Cross the whole minute: the live region moves, the drawing keeps ticking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(58_000);
    });
    await eventually(() => expect(screen.getByText(en.oneMinuteLeft)).toBeInTheDocument());
    expect(screen.queryByText(twoMinutes)).toBeNull();

    // The end.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await eventually(() => expect(screen.getByText(en.timerEndedAnnounce)).toBeInTheDocument());
    await eventually(() => expect(stored(storage)?.state.status).toBe("ended"));
  });

  it("announces the minute and the end from the live region on every tab", async () => {
    const { host, storage } = startHost();
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await typeMinutes(user, 1, storage);
    await startTimer(user, storage);
    await eventually(() => expect(screen.getByText(en.oneMinuteLeft)).toBeInTheDocument());

    // On the Stopwatch tab the live region, which sits below the tabs, speaks on.
    const timerTab = screen.getByRole("tab", { name: en.timer });
    await tabTo(user, timerTab);
    expect(timerTab).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    await eventually(() =>
      expect(screen.getByRole("tab", { name: en.stopwatch })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    );
    expect(screen.getByText(en.oneMinuteLeft)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await eventually(() => expect(screen.getByText(en.timerEndedAnnounce)).toBeInTheDocument());
    await eventually(() => expect(stored(storage)?.state.status).toBe("ended"));
    expect(screen.getByRole("tab", { name: en.stopwatch })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("offers Allow notifications when the OS has not answered, and asks on press", async () => {
    const { host } = startHost();
    host.systemNotifications.setPermission("default");
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    await eventually(() =>
      expect(screen.getByRole("button", { name: en.allowNotifications })).toBeInTheDocument()
    );
    const allow = screen.getByRole("button", { name: en.allowNotifications });
    expect(screen.getByText(en.alertsNeedOpen)).toBeInTheDocument();

    await tabTo(user, allow);
    expect(allow).toHaveFocus();
    await user.keyboard("{Enter}");

    await eventually(() =>
      expect(screen.queryByRole("button", { name: en.allowNotifications })).toBeNull()
    );
    expect(await host.systemNotifications.permission()).toBe("granted");
  });

  it("says Alerts may be late only when the device can schedule ahead but not exactly", async () => {
    const { host } = startHost();
    host.systemNotifications.setCanScheduleWhileClosed(true);
    host.systemNotifications.setExactTiming(false);
    freezeClock();
    await host.renderPage(CLOCK_PAGE_ID);

    await eventually(() => expect(screen.getByText(en.alertsMayBeLate)).toBeInTheDocument());
    expect(screen.queryByText(en.alertsNeedOpen)).toBeNull();
  });
});
