// @vitest-environment jsdom
/**
 * The Pomodoro Cycle core on its own: the behavior the page's suite cannot
 * reach with a page mounted. Storage that is not the shape `cycle.ts` writes
 * must not leave a broken Cycle behind, and the phase end must count the
 * Pomodoro, advance as the settings say, and keep the Alert in step.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { DEFAULT_POMODORO_SETTINGS, INITIAL_CYCLE } from "./cycle";
import { createPomodoro, POMODORO_NOTIFICATION_ID } from "./pomodoro";
import { clockManifest } from "./test-support";

/** The tag the host scopes the Pomodoro's Alert under. */
const POMODORO_TAG = `maibuk-clock/${POMODORO_NOTIFICATION_ID}`;

/** Every host a test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** The stored snapshot, or none. */
function storedSnapshot(storage: Map<string, unknown>): Record<string, unknown> | undefined {
  const value = storage.get("pomodoro");
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Takes the clock over so a phase end can be advanced to without waiting. */
function jumpTo(now: number): void {
  vi.useFakeTimers({
    now,
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "Date"],
  });
}

/** Starts a host over `storage`, remembering it for the teardown. */
function openHost(storage: Map<string, unknown>) {
  const host = createTestHost({ manifest: clockManifest(), storage });
  openHosts.push(host);
  return host;
}

/** The default Cycle a malformed or empty storage leaves in place. */
const DEFAULT_SNAPSHOT = {
  state: INITIAL_CYCLE,
  settings: DEFAULT_POMODORO_SETTINGS,
  today: { day: 0, count: 0 },
};

describe("Clock Pomodoro core", () => {
  afterEach(async () => {
    // The Plugin's teardown waits on a real task, which a fake clock never runs.
    vi.useRealTimers();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("falls back to the default Cycle when storage is malformed", async () => {
    const values: unknown[] = [
      "nonsense",
      42,
      { state: { status: "running" } },
      { state: { phase: "pomodoro", pomodoro: 1, status: "running" } },
      { state: { phase: "nap", pomodoro: 1, status: "idle" } },
      { state: { phase: "pomodoro", pomodoro: 0, status: "idle" } },
      { state: { phase: "pomodoro", pomodoro: 1, status: "paused", remaining: "soon" } },
    ];

    for (const value of values) {
      const storage = new Map<string, unknown>([["pomodoro", value]]);
      const host = openHost(storage);
      const pomodoro = createPomodoro(createPluginClient(host.port));
      await pomodoro.load();
      expect(pomodoro.snapshot()).toEqual(DEFAULT_SNAPSHOT);
    }
  });

  it("keeps the valid settings and today fields when the others are malformed", async () => {
    const storage = new Map<string, unknown>([
      [
        "pomodoro",
        {
          state: { phase: "shortBreak", pomodoro: 2, status: "idle" },
          settings: {
            pomodoroMinutes: 50,
            shortBreakMinutes: -1,
            longBreakMinutes: 1.5,
            longBreakEvery: 0,
            autoStartBreaks: "yes",
            autoStartPomodoros: true,
          },
          today: { day: 12, count: 3 },
        },
      ],
    ]);
    const host = openHost(storage);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();

    expect(pomodoro.snapshot()).toEqual({
      state: { phase: "shortBreak", pomodoro: 2, status: "idle" },
      settings: { ...DEFAULT_POMODORO_SETTINGS, pomodoroMinutes: 50, autoStartPomodoros: true },
      today: { day: 12, count: 3 },
    });
  });

  it("schedules the end Alert under the Pomodoro id when a phase starts", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();
    pomodoro.start();

    const state = pomodoro.snapshot().state;
    if (state.status !== "running") throw new Error("the Cycle should be running");
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(state.endsAt)
    );
    expect(host.systemNotifications.scheduled.get(POMODORO_TAG)).toMatchObject({
      title: "Clock: Pomodoro",
      body: "Your Pomodoro ended. Time for a break.",
    });
  });

  it("cancels the Alert when paused", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();
    pomodoro.start();
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(true));

    pomodoro.pause();
    expect(pomodoro.snapshot().state.status).toBe("paused");
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(false)
    );
  });

  it("cancels the Alert and returns to Pomodoro 1 on reset", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();
    pomodoro.start();
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(true));

    pomodoro.reset();
    expect(pomodoro.snapshot().state).toEqual(INITIAL_CYCLE);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.has(POMODORO_TAG)).toBe(false)
    );
    expect(host.systemNotifications.active.has(POMODORO_TAG)).toBe(false);
  });

  it("counts the Pomodoro and idles on the Short Break when autoStartBreaks is off", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();
    pomodoro.setSettings({ pomodoroMinutes: 1 });
    pomodoro.start();
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(start + 60_000)
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(pomodoro.snapshot().state).toEqual({
        phase: "shortBreak",
        pomodoro: 1,
        status: "idle",
      })
    );
    expect(pomodoro.snapshot().today.count).toBe(1);
    // The ended phase's Alert is left to fire: nothing withdraws it.
    expect(
      host.systemNotifications.log.filter(
        (entry) => entry.kind === "cancelled" && entry.tag === POMODORO_TAG
      )
    ).toEqual([]);
  });

  it("starts the Short Break and resends the Alert when autoStartBreaks is on", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();
    pomodoro.setSettings({ pomodoroMinutes: 1, shortBreakMinutes: 1, autoStartBreaks: true });
    pomodoro.start();
    const breakEndsAt = start + 121_000;

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(pomodoro.snapshot().state).toEqual({
        phase: "shortBreak",
        pomodoro: 1,
        status: "running",
        endsAt: breakEndsAt,
      })
    );
    expect(pomodoro.snapshot().today.count).toBe(1);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(breakEndsAt)
    );
    expect(host.systemNotifications.scheduled.get(POMODORO_TAG)).toMatchObject({
      title: "Clock: Short break",
      body: "Your break ended. Time for the next Pomodoro.",
    });
    // Scheduling the break under the same id must not swallow the Pomodoro's
    // own Alert, which fires first.
    expect(host.systemNotifications.log).toContainEqual(
      expect.objectContaining({
        kind: "sent",
        tag: POMODORO_TAG,
        body: "Your Pomodoro ended. Time for a break.",
      })
    );
  });

  it("sends the last Pomodoro of the cycle to the Long Break", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const pomodoro = createPomodoro(createPluginClient(host.port));
    await pomodoro.load();
    pomodoro.setSettings({ pomodoroMinutes: 1, shortBreakMinutes: 1, longBreakEvery: 2 });

    pomodoro.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(pomodoro.snapshot().state).toEqual({
        phase: "shortBreak",
        pomodoro: 1,
        status: "idle",
      })
    );

    pomodoro.skip();
    expect(pomodoro.snapshot().state).toEqual({ phase: "pomodoro", pomodoro: 2, status: "idle" });

    pomodoro.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() =>
      expect(pomodoro.snapshot().state).toEqual({
        phase: "longBreak",
        pomodoro: 2,
        status: "idle",
      })
    );
    expect(pomodoro.snapshot().today.count).toBe(2);
  });

  it("reports a phase that ended while closed without advancing it", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const endsAt = start - 60_000;
    storage.set("pomodoro", {
      state: { phase: "pomodoro", pomodoro: 2, status: "running", endsAt },
      settings: DEFAULT_POMODORO_SETTINGS,
      today: { day: 0, count: 0 },
    });

    const pomodoro = createPomodoro(createPluginClient(host.port));
    const ended = await pomodoro.load();

    expect(ended).toEqual({ phase: "pomodoro", endedAt: endsAt });
    expect(pomodoro.snapshot().state).toEqual({
      phase: "pomodoro",
      pomodoro: 2,
      status: "ended",
      endedAt: endsAt,
    });
    expect(pomodoro.snapshot().today.count).toBe(1);
    expect(host.notifications).toEqual([]);
    await vi.waitFor(() =>
      expect(storedSnapshot(storage)?.state).toMatchObject({ status: "ended" })
    );
  });

  it("resends the Alert and holds the end when the phase is still running", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = openHost(storage);
    jumpTo(start);
    const endsAt = start + 60_000;
    storage.set("pomodoro", {
      state: { phase: "longBreak", pomodoro: 4, status: "running", endsAt },
      settings: { ...DEFAULT_POMODORO_SETTINGS, longBreakMinutes: 1 },
      today: { day: 0, count: 0 },
    });

    const pomodoro = createPomodoro(createPluginClient(host.port));
    const ended = await pomodoro.load();

    expect(ended).toBeNull();
    expect(pomodoro.snapshot().state.status).toBe("running");
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(POMODORO_TAG)?.at).toBe(endsAt)
    );
    expect(host.systemNotifications.scheduled.get(POMODORO_TAG)).toMatchObject({
      title: "Clock: Long break",
    });
    expect(host.notifications).toEqual([]);
  });

  it("persists settings across a new Cycle and load", async () => {
    const storage = new Map<string, unknown>();
    const first = openHost(storage);
    const one = createPomodoro(createPluginClient(first.port));
    await one.load();
    one.setSettings({ pomodoroMinutes: 50, autoStartBreaks: true });
    await vi.waitFor(() =>
      expect(storedSnapshot(storage)?.settings).toMatchObject({ pomodoroMinutes: 50 })
    );

    const second = openHost(storage);
    const two = createPomodoro(createPluginClient(second.port));
    await two.load();

    expect(two.snapshot().settings).toEqual({
      ...DEFAULT_POMODORO_SETTINGS,
      pomodoroMinutes: 50,
      autoStartBreaks: true,
    });
  });
});
