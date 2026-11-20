// @vitest-environment jsdom
/**
 * The Timer core on its own: the behavior the page's suite cannot reach with a
 * page mounted. Storage that is not the shape `time.ts` writes must not leave a
 * broken Timer behind, and a zero-length Timer must not start or schedule an
 * Alert.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { startClock } from "./runtime";
import { clockManifest } from "./test-support";
import { formatClockTime } from "./time";
import { createTimer } from "./timer";

/** The tag the host scopes the Timer's Alert under. */
const TIMER_TAG = "maibuk-clock/timer";

/** Every host a fake-clock test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** The stored Timer state, or none. */
function storedState(storage: Map<string, unknown>): Record<string, unknown> | undefined {
  const value = storage.get("timer");
  if (typeof value !== "object" || value === null) return undefined;
  const state = (value as { state?: unknown }).state;
  return typeof state === "object" && state !== null
    ? (state as Record<string, unknown>)
    : undefined;
}

/**
 * Takes the clock over only after the Timer ran, so its host is started and
 * stopped on real timers (a fake clock never runs the teardown's task).
 */
function jumpTo(now: number): void {
  vi.useFakeTimers({
    now,
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "Date"],
  });
}

/** Starts a one-minute Timer on its own host, over `storage`, then stops that host. */
async function runAndStopOneMinuteTimer(storage: Map<string, unknown>): Promise<void> {
  const host = createTestHost({ manifest: clockManifest(), storage });
  try {
    const timer = createTimer(createPluginClient(host.port));
    await timer.load();
    timer.setLength(60_000);
    timer.start();
    await vi.waitFor(() => expect(storedState(storage)?.status).toBe("running"));
  } finally {
    await host.stop();
  }
}

/** Starts the Clock runtime over `storage`, as Maibuk does when a Plugin starts. */
async function startHost(
  storage: Map<string, unknown>,
  options: {
    language?: string;
    canScheduleWhileClosed?: boolean;
    permission?: "granted" | "denied" | "default";
  } = {}
) {
  const { language, canScheduleWhileClosed, permission } = options;
  const host = createTestHost({
    manifest: clockManifest(),
    storage,
    ...(language === undefined ? {} : { language }),
  });
  if (canScheduleWhileClosed !== undefined) {
    host.systemNotifications.setCanScheduleWhileClosed(canScheduleWhileClosed);
  }
  if (permission !== undefined) host.systemNotifications.setPermission(permission);
  openHosts.push(host);
  // Resolves once startup reconciliation, and any toast it shows, is done.
  await startClock(createPluginClient(host.port), () => {});
  return host;
}

/** The default Timer a malformed or empty storage leaves in place. */
const DEFAULT_SNAPSHOT = {
  state: { status: "idle", length: 1_500_000 },
  recent: [],
};

describe("Clock Timer core", () => {
  afterEach(async () => {
    // The Plugin's teardown waits on a real task, which a fake clock never runs.
    vi.useRealTimers();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("falls back to the default Timer when storage is malformed", async () => {
    const values: unknown[] = [
      "nonsense",
      42,
      { state: { status: "running" } },
      { state: { status: "idle", length: -1 } },
      { state: { status: "paused", length: 1_000, remaining: "soon" } },
    ];

    for (const value of values) {
      const storage = new Map<string, unknown>([["timer", value]]);
      const host = createTestHost({ manifest: clockManifest(), storage });
      try {
        const timer = createTimer(createPluginClient(host.port));
        await timer.load();
        expect(timer.snapshot()).toEqual(DEFAULT_SNAPSHOT);
      } finally {
        await host.stop();
      }
    }
  });

  it("holds the end again when its timeout fires before the deadline", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(start);
    const timer = createTimer(createPluginClient(host.port));
    await timer.load();
    timer.setLength(60_000);
    timer.start();
    const started = timer.snapshot().state;
    if (started.status !== "running") throw new Error("the Timer should be running");

    // The clock steps two minutes back after the end was held, so the held
    // timeout fires while the deadline is still ahead of it.
    vi.setSystemTime(start - 120_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(timer.snapshot().state.status).toBe("running");

    // The end still lands once the clock reaches the deadline again.
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.waitFor(() => expect(storedState(storage)?.status).toBe("ended"));
    expect(timer.snapshot().state).toEqual({
      status: "ended",
      length: 60_000,
      endedAt: started.endsAt,
    });
  });

  it("does not start a zero-length Timer and schedules no Alert", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    try {
      const timer = createTimer(createPluginClient(host.port));
      await timer.load();
      timer.setLength(0);
      timer.start();

      expect(timer.snapshot()).toEqual({ state: { status: "idle", length: 0 }, recent: [] });
      expect(host.systemNotifications.scheduled.size).toBe(0);
    } finally {
      await host.stop();
    }
  });
});

describe("Clock Timer startup reconciliation", () => {
  it("toasts once when the Timer ended while Maibuk was closed, and never again", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    await runAndStopOneMinuteTimer(storage);
    const endsAt = storedState(storage)?.endsAt as number;

    jumpTo(start + 5 * 60_000);
    // Spanish, so the toast proves the language was read before load reconciled.
    const host = await startHost(storage, { language: "es" });
    await vi.waitFor(() => expect(host.notifications).toHaveLength(1));

    const time = formatClockTime(endsAt, new Date(endsAt).getTimezoneOffset(), 24);
    expect(host.notifications).toEqual([
      { variant: "info", message: `Tu temporizador terminó a las ${time}.` },
    ]);
    expect(storedState(storage)?.status).toBe("ended");

    // A later start finds the ended Timer already reconciled and says nothing.
    const nextHost = await startHost(storage, { language: "es" });
    expect(nextHost.notifications).toEqual([]);
    expect(host.notifications).toHaveLength(1);
  });

  it("re-sends the Alert when the Timer is still running, and toasts nothing", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    await runAndStopOneMinuteTimer(storage);
    const endsAt = storedState(storage)?.endsAt as number;

    jumpTo(start + 30_000);
    const host = await startHost(storage);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(TIMER_TAG)?.at).toBe(endsAt)
    );

    expect(host.notifications).toEqual([]);
    expect(storedState(storage)?.status).toBe("running");
  });

  it("keeps quiet when the device alerts while closed, and still stores the end", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    await runAndStopOneMinuteTimer(storage);

    jumpTo(start + 5 * 60_000);
    const host = await startHost(storage, { canScheduleWhileClosed: true, permission: "granted" });
    await vi.waitFor(() => expect(storedState(storage)?.status).toBe("ended"));

    expect(host.notifications).toEqual([]);
  });

  it("toasts when a device that schedules while closed never got the permission", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    await runAndStopOneMinuteTimer(storage);

    jumpTo(start + 5 * 60_000);
    // Android schedules while closed, but a refused permission means it never
    // posted the Alert, so the toast is the only word of the end.
    const host = await startHost(storage, { canScheduleWhileClosed: true, permission: "denied" });
    await vi.waitFor(() => expect(host.notifications).toHaveLength(1));

    expect(host.notifications[0]?.variant).toBe("info");
    expect(storedState(storage)?.status).toBe("ended");
  });
});
