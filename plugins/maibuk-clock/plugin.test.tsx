/**
 * Clock's Plugin-level behavior through the supported Plugin test kit: the real
 * broker, method table, and Remote UI renderer. The runtime is driven over the
 * polyfill-free `@/plugin-sdk/ui-serve` entry, the same one the kit's jsdom
 * uses; `index.tsx` (the Worker bootstrap) is never imported.
 *
 * The Clock page is a Frame (#886), so the kit's host draws nothing for it:
 * each test hands the runtime one Frame over a real `MessageChannel`, taken
 * through the handler `startClock` registers with `client.onFrame`, and then
 * drives the Plugin the way that Frame will — by posting its intents — or
 * through its Commands. What the Frame draws, and the keys it answers, live in
 * `frame.test.ts`; the wire between the two lives in `frame-protocol.test.ts`.
 *
 * This unit proves the Clock page opens from the Open Clock Command, and that
 * the Timer works end to end: a length counts down, its end is scheduled as a
 * System Notification at the deadline, pause freezes it and cancels the Alert,
 * reset restores the length, the recent lengths come back newest first, and the
 * Command toggles it. The Pomodoro Commands start, pause, and skip the Cycle, a
 * phase that ended before startup stays ended, the Pomodoro Settings row changes
 * the lengths and auto-starts the next phase, and the Toggle Button stays
 * pressed exactly while a phase runs.
 *
 * The Alarms add, edit, switch, and delete through the Frame's intents, with
 * each change shown as a scheduled System Notification, and a startup toast
 * names an Alarm missed while Maibuk was closed.
 */

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient, type PluginFrame } from "@/plugin-sdk";
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
import { alarmNotificationId, type Alarm } from "./alarms";
import type { FrameStateMessage, WorkerToFrameMessage } from "./frame-protocol";
import { clockManifest, tabTo } from "./test-support";
import { formatClockTime, hourCycleFor, localOffsetAt, nextAlarmAt } from "./time";

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

/** The Pomodoros today the Cycle storage counts, or none. */
function storedToday(storage: Map<string, unknown>): { count?: number } | undefined {
  const value = storage.get("pomodoro");
  if (typeof value !== "object" || value === null) return undefined;
  const today = (value as { today?: unknown }).today;
  return typeof today === "object" && today !== null ? (today as { count?: number }) : undefined;
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

/** The Alarms storage holds, or none. */
function storedAlarms(storage: Map<string, unknown>): Alarm[] {
  const value = storage.get("alarms");
  return Array.isArray(value) ? (value as Alarm[]) : [];
}

/** The tag the host scopes one Alarm's Alert under. */
function alarmTag(alarm: Alarm): string {
  return `maibuk-clock/${alarmNotificationId(alarm.id)}`;
}

/** An Alarm's time as the Plugin stores it, in the given language's clock. */
function shownTime(hour: number, minute: number, language = "en"): string {
  const at = new Date(2000, 0, 1, hour, minute).getTime();
  return formatClockTime(at, localOffsetAt(at), hourCycleFor(language));
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

/** Every Clock Frame a test mounted, told `closed` after the test. */
const openFrames: ClockFrame[] = [];

/**
 * One Clock Frame as the Worker sees it: the recording end of a real
 * `MessageChannel`, so a message the Worker posts and an intent the Frame posts
 * cross exactly as they do in the app.
 */
interface ClockFrame {
  /** Every message the Worker sent this Frame, in order. */
  messages: WorkerToFrameMessage[];
  /** Sends one Frame -> Worker message. */
  send(message: unknown): void;
  /** Tells the Worker the Frame closed, as the Frame's `pagehide` does. */
  close(): void;
}

/** Every whole-Clock state the Worker sent this Frame, in order. */
function states(frame: ClockFrame): FrameStateMessage[] {
  return frame.messages.filter((message): message is FrameStateMessage => message.kind === "state");
}

/** The latest whole-Clock state the Worker sent this Frame, or none yet. */
function lastState(frame: ClockFrame): FrameStateMessage | undefined {
  return states(frame).at(-1);
}

/** A host with the Clock manifest, its storage in memory, and the runtime wired. */
interface ClockHost {
  host: ReturnType<typeof createTestHost>;
  storage: Map<string, unknown>;
  /** Settles once the runtime's startup loads did, so an intent cannot race them. */
  ready: Promise<void>;
  /** Hands the runtime one Clock Frame, the way the host hands over a mounted one. */
  mountFrame(): ClockFrame;
}

/** Builds such a host, wiring the runtime and keeping its startup promise. */
function startHost(options: { language?: string; storage?: Map<string, unknown> } = {}): ClockHost {
  const storage = options.storage ?? new Map<string, unknown>();
  const host = createTestHost({
    manifest: clockManifest(),
    storage,
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  openHosts.push(host);

  // The kit's host renders no Frame (it serves only the Settings rows), so the
  // test keeps the handler `startClock` registers and hands it one Frame over a
  // real `MessageChannel`, which is the whole of what the host does.
  const client = createPluginClient(host.port);
  const handoff: { deliver: ((frame: PluginFrame) => void) | null } = { deliver: null };
  const realOnFrame = client.onFrame;
  client.onFrame = (handler) => {
    handoff.deliver = handler;
    return realOnFrame(handler);
  };
  const ready = startClock(client, servePluginUi);

  let mounted = 0;
  function mountFrame(): ClockFrame {
    const channel = new MessageChannel();
    const messages: WorkerToFrameMessage[] = [];
    channel.port2.onmessage = (event: MessageEvent) => {
      messages.push(event.data as WorkerToFrameMessage);
    };
    const frame: ClockFrame = {
      messages,
      send(message) {
        channel.port2.postMessage(message);
      },
      close() {
        channel.port2.postMessage({ kind: "closed" });
      },
    };
    const deliver = handoff.deliver;
    if (deliver === null) throw new Error("startClock registered no Frame handler");
    mounted += 1;
    deliver({ id: `frame-${mounted}`, src: "assets/ui/clock.html", port: channel.port1 });
    openFrames.push(frame);
    return frame;
  }

  return { host, storage, ready, mountFrame };
}

/**
 * Polls until what the test asserts holds, instead of guessing how many
 * event-loop turns a persisted write or a delivered message needs.
 */
async function eventually(check: () => void): Promise<void> {
  await vi.waitFor(check);
}

describe("Clock runtime", () => {
  afterEach(async () => {
    // The Plugin's teardown waits on a real task, which a fake clock never runs.
    vi.useRealTimers();
    for (const frame of openFrames.splice(0)) frame.close();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("opens the Clock page from the openClock Command", async () => {
    const host = createTestHost({ manifest: clockManifest() });
    try {
      startClock(createPluginClient(host.port), servePluginUi);

      await expect(
        host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_CLOCK })
      ).resolves.toBeNull();
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-clock", pageId: CLOCK_PAGE_ID }]);
    } finally {
      await host.stop();
    }
  });

  it("marks Laps while running, with each stretch and total, and keeps them for the next Frame", async () => {
    const { storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "stopwatch.start" });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    frame.send({ kind: "stopwatch.lap" });
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    frame.send({ kind: "stopwatch.lap" });
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(2));

    // Each Lap carries its own stretch, and the total from the start.
    const laps = storedStopwatch(storage)?.laps ?? [];
    expect(laps[0]?.length).toBeGreaterThanOrEqual(10_000);
    expect(laps[0]?.total).toBeGreaterThanOrEqual(10_000);
    expect(laps[1]?.length).toBeGreaterThanOrEqual(5_000);
    expect(laps[1]?.total).toBeGreaterThanOrEqual(15_000);

    // Leaving the page and coming back finds the same Laps: the Worker holds
    // them, not the Frame.
    frame.close();
    const again = mountFrame();
    await eventually(() => expect(lastState(again)?.stopwatch.status).toBe("running"));
    const running = lastState(again)?.stopwatch;
    if (running === undefined || running.status !== "running") {
      throw new Error("the Frame should have been told the running Stopwatch");
    }
    expect(running.laps).toHaveLength(2);
    expect(running.laps[0]?.length).toBeGreaterThanOrEqual(10_000);
    expect(running.laps[1]?.total).toBeGreaterThanOrEqual(15_000);
  });

  it("pauses to hold the time and resumes from where it stopped", async () => {
    const { storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "stopwatch.start" });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    frame.send({ kind: "stopwatch.pause" });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("paused"));
    const banked = storedStopwatch(storage)?.banked ?? -1;
    expect(banked).toBeGreaterThanOrEqual(10_000);

    // A minute passes while paused; the Stopwatch holds still.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(storedStopwatch(storage)?.banked).toBe(banked);

    frame.send({ kind: "stopwatch.start" });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));
    // The resume carries the held time forward instead of starting from zero.
    expect(storedStopwatch(storage)?.banked).toBe(banked);
  });

  it("resets to zero, drops the Laps, and stores an idle Stopwatch", async () => {
    const { storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "stopwatch.start" });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    frame.send({ kind: "stopwatch.lap" });
    await eventually(() => expect(storedStopwatch(storage)?.laps).toHaveLength(1));

    frame.send({ kind: "stopwatch.reset" });
    await eventually(() => expect(storedStopwatch(storage)).toEqual({ status: "idle" }));
  });

  it("stops sending to a Frame once the next one is handed over", async () => {
    const { mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const first = mountFrame();
    await eventually(() => expect(lastState(first)).toBeDefined());

    const second = mountFrame();
    await eventually(() => expect(lastState(second)).toBeDefined());

    // The first Frame's connection is disposed, so a module change reaches only
    // the Frame currently mounted.
    const before = states(first).length;
    second.send({ kind: "stopwatch.start" });
    await eventually(() => expect(lastState(second)?.stopwatch.status).toBe("running"));
    expect(states(first).length).toBe(before);
  });

  it("finds a running Stopwatch and its Laps after a restart", async () => {
    const laps = [
      { length: 30_000, total: 30_000 },
      { length: 30_000, total: 60_000 },
    ];
    const storage = new Map<string, unknown>([
      ["stopwatch", { status: "running", startedAt: START - 90_000, banked: 0, laps }],
    ]);
    const { mountFrame, ready } = startHost({ storage });
    freezeClock();
    await ready;

    // The Frame is told what the restart found, Laps and all, so its readout
    // carries on from there.
    const frame = mountFrame();
    await eventually(() =>
      expect(lastState(frame)?.stopwatch).toEqual({
        status: "running",
        startedAt: START - 90_000,
        banked: 0,
        laps,
      })
    );
  });

  it("starts and then pauses the Stopwatch from the toggleStopwatch Command", async () => {
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

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
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

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
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

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
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_STOPWATCH });
    await eventually(() => expect(storedStopwatch(storage)?.status).toBe("running"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(host.systemNotifications.scheduled.size).toBe(0);
    expect(host.systemNotifications.log).toEqual([]);
  });

  it("starts Pomodoro 1 of 4 and schedules its Alert", async () => {
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await eventually(() => expect(storedCycle(storage)?.state.status).toBe("running"));
    expect(storedCycle(storage)?.state).toMatchObject({ phase: "pomodoro", pomodoro: 1 });
    await eventually(() => {
      const state = storedCycle(storage)?.state;
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(state?.endsAt);
    });
    expect(host.systemNotifications.scheduled.get(POMODORO_TAG)).toMatchObject({
      title: `Clock: ${en.pomodoro}`,
    });
  });

  it("ends the Pomodoro into an idle Short Break, counts it, and leaves its Alert to fire", async () => {
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await eventually(() => expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60_000);
    });
    await eventually(() =>
      expect(storedCycle(storage)?.state).toEqual({
        phase: "shortBreak",
        pomodoro: 1,
        status: "idle",
      })
    );
    expect(storedToday(storage)?.count).toBe(1);
    // The ended Pomodoro's Alert is left to fire: nothing withdraws it.
    expect(
      host.systemNotifications.log.filter(
        (entry) => entry.kind === "cancelled" && entry.tag === POMODORO_TAG
      )
    ).toEqual([]);
  });

  it("skips to the next phase and resets to Pomodoro 1", async () => {
    const { storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "pomodoro.skip" });
    await eventually(() =>
      expect(storedCycle(storage)?.state).toEqual({
        phase: "shortBreak",
        pomodoro: 1,
        status: "idle",
      })
    );

    frame.send({ kind: "pomodoro.reset" });
    await eventually(() =>
      expect(storedCycle(storage)?.state).toEqual({
        phase: "pomodoro",
        pomodoro: 1,
        status: "idle",
      })
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
    const { host, ready } = startHost({ storage });
    freezeClock();
    await ready;

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60_000);
    });
    await eventually(() =>
      expect(storedCycle(storage)?.state).toEqual({
        phase: "longBreak",
        pomodoro: 4,
        status: "idle",
      })
    );
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
    const { mountFrame, ready } = startHost({ storage });
    freezeClock();
    await ready;

    // The Frame is told the phase ended where it stood; startup did not skip
    // ahead to a Short Break.
    const frame = mountFrame();
    await eventually(() =>
      expect(lastState(frame)?.pomodoro.state).toMatchObject({
        phase: "pomodoro",
        pomodoro: 2,
        status: "ended",
      })
    );
    expect(storedCycle(storage)?.state).toMatchObject({
      phase: "pomodoro",
      pomodoro: 2,
      status: "ended",
    });
    expect(storedCycle(storage)?.state.phase).not.toBe("shortBreak");
    expect(storedToday(storage)?.count).toBe(1);
  });

  it("changes the Pomodoro settings by keyboard and auto-starts the Short Break", async () => {
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;
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

    await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_POMODORO });
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
    expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(true);
  });

  it("stops the Pomodoro settings row's number fields at the shared maxima", async () => {
    const { host, storage } = startHost();
    const row = await host.renderSettingsRow(POMODORO_SETTINGS_ROW_ID);
    const user = userEvent.setup();

    const length = await screen.findByRole("textbox", { name: en.pomodoroMinutes });
    await tabTo(user, length);
    await user.keyboard("{Control>}a{/Control}100{Enter}");
    await eventually(() => expect(storedSettings(storage)?.pomodoroMinutes).toBe(99));

    const every = screen.getByRole("textbox", { name: en.longBreakEvery });
    await tabTo(user, every);
    await user.keyboard("{Control>}a{/Control}13{Enter}");
    await eventually(() => expect(storedSettings(storage)?.longBreakEvery).toBe(12));

    await row.unmount();
  });

  it("renders the Pomodoro settings row in Spanish when the app language is Spanish", async () => {
    const { host } = startHost({ language: "es" });

    const row = await host.renderSettingsRow(POMODORO_SETTINGS_ROW_ID);
    expect(await screen.findByRole("textbox", { name: es.pomodoroMinutes })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: es.shortBreakMinutes })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: es.longBreakMinutes })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: es.longBreakEvery })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: es.autoStartBreaks })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: es.autoStartPomodoros })).toBeInTheDocument();

    await row.unmount();
  });

  it("counts a typed length down and schedules the Alert at the stored deadline", async () => {
    const { host, storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "timer.setLength", length: 60_000 });
    await eventually(() =>
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 60_000 })
    );

    frame.send({ kind: "timer.start" });
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
    const { host, storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "timer.setLength", length: 60_000 });
    await eventually(() =>
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 60_000 })
    );
    frame.send({ kind: "timer.start" });
    await eventually(() => expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    frame.send({ kind: "timer.pause" });
    await eventually(() => expect(stored(storage)?.state.status).toBe("paused"));

    const pausedRemaining = stored(storage)?.state.remaining ?? -1;
    expect(pausedRemaining).toBeGreaterThan(0);
    await eventually(() => expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(false));
    expect(host.systemNotifications.log.at(-1)).toMatchObject({
      kind: "cancelled",
      tag: TIMER_TAG,
    });

    // Ten more seconds move neither the stored remaining time nor the Alert.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(stored(storage)?.state.remaining).toBe(pausedRemaining);

    frame.send({ kind: "timer.start" });
    await eventually(() => {
      const saved = stored(storage);
      expect(saved?.state.status).toBe("running");
      const scheduled = host.systemNotifications.scheduled.get(TIMER_TAG);
      expect(scheduled).toBeDefined();
      expect(scheduled?.at).toBe(saved?.state.endsAt);
    });
  });

  it("resets to the length and cancels the Alert", async () => {
    const { host, storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({ kind: "timer.setLength", length: 60_000 });
    await eventually(() =>
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 60_000 })
    );
    frame.send({ kind: "timer.start" });
    await eventually(() => expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    frame.send({ kind: "timer.reset" });
    await eventually(() => {
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 60_000 });
      expect(host.systemNotifications.scheduled.has(TIMER_TAG)).toBe(false);
    });
  });

  it("keeps the three most recent lengths newest first, and a length the author picks is taken", async () => {
    const { storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    for (const minutes of [1, 2, 3]) {
      frame.send({ kind: "timer.setLength", length: minutes * 60_000 });
      await eventually(() =>
        expect(stored(storage)?.state).toEqual({ status: "idle", length: minutes * 60_000 })
      );
      frame.send({ kind: "timer.start" });
      await eventually(() => expect(stored(storage)?.state.status).toBe("running"));
      frame.send({ kind: "timer.reset" });
      await eventually(() => expect(stored(storage)?.state.status).toBe("idle"));
    }

    await eventually(() => expect(stored(storage)?.recent).toEqual([180_000, 120_000, 60_000]));

    // Picking a recent is the same `setLength` intent the Frame posts.
    frame.send({ kind: "timer.setLength", length: 120_000 });
    await eventually(() =>
      expect(stored(storage)?.state).toEqual({ status: "idle", length: 120_000 })
    );
  });

  it("starts and then pauses the Timer from the toggleTimer Command", async () => {
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

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
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

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
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;

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
    const { host, storage, ready } = startHost();
    freezeClock();
    await ready;
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
});

describe("Clock Alarms", () => {
  afterEach(async () => {
    // The Plugin's teardown waits on a real task, which a fake clock never runs.
    vi.useRealTimers();
    for (const frame of openFrames.splice(0)) frame.close();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("adds, edits, switches, and deletes an Alarm, rescheduling its Alert", async () => {
    const { host, storage, mountFrame, ready } = startHost();
    freezeClock();
    await ready;
    const frame = mountFrame();

    frame.send({
      kind: "alarm.add",
      input: { hour: 13, minute: 30, label: "Write", weekdays: [1] },
    });
    await eventually(() => expect(storedAlarms(storage)).toHaveLength(1));
    const added = storedAlarms(storage)[0];
    if (added === undefined) throw new Error("the added Alarm should be stored");
    expect(added).toMatchObject({
      hour: 13,
      minute: 30,
      label: "Write",
      weekdays: [1],
      enabled: true,
    });
    const tag = alarmTag(added);
    const firstAt = nextAlarmAt({ hour: 13, minute: 30, weekdays: [1] }, START, localOffsetAt);
    await eventually(() => expect(host.systemNotifications.scheduled.get(tag)?.at).toBe(firstAt));
    expect(host.systemNotifications.scheduled.get(tag)?.title).toBe("Clock: Write");
    expect(host.systemNotifications.scheduled.get(tag)?.body).toBe(shownTime(13, 30));

    // Editing the time reschedules the Alert at the new occurrence.
    frame.send({
      kind: "alarm.edit",
      id: added.id,
      input: { hour: 14, minute: 0, label: "Write", weekdays: [1] },
    });
    await eventually(() =>
      expect(storedAlarms(storage)[0]).toMatchObject({ hour: 14, minute: 0, label: "Write" })
    );
    const secondAt = nextAlarmAt({ hour: 14, minute: 0, weekdays: [1] }, START, localOffsetAt);
    await eventually(() => expect(host.systemNotifications.scheduled.get(tag)?.at).toBe(secondAt));

    // Off cancels the Alert; on schedules it again.
    frame.send({ kind: "alarm.setEnabled", id: added.id, enabled: false });
    await eventually(() => expect(storedAlarms(storage)[0]?.enabled).toBe(false));
    await eventually(() => expect(host.systemNotifications.scheduled.has(tag)).toBe(false));
    expect(host.systemNotifications.log.at(-1)).toMatchObject({ kind: "cancelled", tag });

    frame.send({ kind: "alarm.setEnabled", id: added.id, enabled: true });
    await eventually(() => expect(storedAlarms(storage)[0]?.enabled).toBe(true));
    await eventually(() => expect(host.systemNotifications.scheduled.get(tag)?.at).toBe(secondAt));

    // Deleting cancels the Alert and empties the list.
    frame.send({ kind: "alarm.remove", id: added.id });
    await eventually(() => expect(storedAlarms(storage)).toEqual([]));
    await eventually(() => expect(host.systemNotifications.scheduled.has(tag)).toBe(false));
    expect(host.systemNotifications.log.at(-1)).toMatchObject({ kind: "cancelled", tag });
  });

  it("toasts once about an Alarm missed while closed, and shows it off", async () => {
    const passedAt = START - 3 * 3_600_000;
    const missed: Alarm = {
      id: "missed",
      hour: 9,
      minute: 0,
      label: "Write",
      weekdays: [],
      enabled: true,
      nextAt: passedAt,
    };
    const storage = new Map<string, unknown>([["alarms", [missed]]]);
    const { host, ready } = startHost({ storage });
    freezeClock();
    await ready;

    const missedTime = formatClockTime(passedAt, localOffsetAt(passedAt), hourCycleFor("en"));
    expect(host.notifications).toEqual([
      { variant: "info", message: en.alarmMissed.replace("{time}", missedTime) },
    ]);
    expect(host.notifications[0]?.message).toContain("Missed alarm");

    // The one-off Alarm is off, so the Frame draws its switch off and nothing
    // is scheduled.
    expect(storedAlarms(storage)[0]?.enabled).toBe(false);
    expect(host.systemNotifications.scheduled.size).toBe(0);
  });
});
