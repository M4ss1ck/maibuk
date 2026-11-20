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
 * tab, and the notification banner asks for permission. Every control is reached
 * with `user-event` key presses.
 */

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { CLOCK_PAGE_ID, OPEN_CLOCK, TOGGLE_TIMER, startClock } from "./runtime";
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

/** One stored Timer, as the Plugin writes it. */
interface StoredTimer {
  state: { status: string; length: number; endsAt?: number; remaining?: number; endedAt?: number };
  recent: number[];
}

/** The Timer storage holds, or none. */
function stored(storage: Map<string, unknown>): StoredTimer | undefined {
  const value = storage.get("timer");
  return typeof value === "object" && value !== null ? (value as StoredTimer) : undefined;
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
function startHost(options: { language?: string } = {}): {
  host: ReturnType<typeof createTestHost>;
  storage: Map<string, unknown>;
} {
  const storage = new Map<string, unknown>();
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
      expect(screen.getByRole("tabpanel")).toHaveTextContent(en.stopwatch);
      expect(screen.getByRole("tabpanel")).toHaveTextContent(en.comingSoon);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("renders every label in Spanish when the app language is Spanish", async () => {
    const host = createTestHost({ manifest: clockManifest(), language: "es" });
    try {
      startClock(createPluginClient(host.port), servePluginUi);
      const page = await host.renderPage(CLOCK_PAGE_ID);

      expect(await screen.findByRole("tablist", { name: es.tabs })).toBeInTheDocument();
      for (const label of [es.pomodoro, es.timer, es.stopwatch, es.alarms]) {
        expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
      }
      expect(screen.getByRole("textbox", { name: es.hours })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es.start })).toBeInTheDocument();

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
