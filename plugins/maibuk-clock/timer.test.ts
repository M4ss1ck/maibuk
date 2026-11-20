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

/** Lets pending host round trips through, which a fake clock never runs on its own. */
function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
function startHost(
  storage: Map<string, unknown>,
  options: { language?: string; canScheduleWhileClosed?: boolean } = {}
) {
  const { language, canScheduleWhileClosed } = options;
  const host = createTestHost({
    manifest: clockManifest(),
    storage,
    ...(language === undefined ? {} : { language }),
  });
  if (canScheduleWhileClosed !== undefined) {
    host.systemNotifications.setCanScheduleWhileClosed(canScheduleWhileClosed);
  }
  openHosts.push(host);
  startClock(createPluginClient(host.port), () => {});
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
    const host = startHost(storage, { language: "es" });
    await vi.waitFor(() => expect(host.notifications).toHaveLength(1));

    const time = formatClockTime(endsAt, new Date(endsAt).getTimezoneOffset(), 24);
    expect(host.notifications).toEqual([
      { variant: "info", message: `Tu temporizador terminó a las ${time}.` },
    ]);
    expect(storedState(storage)?.status).toBe("ended");

    // A later start finds the ended Timer already reconciled and says nothing.
    const nextHost = startHost(storage, { language: "es" });
    await settle();
    expect(nextHost.notifications).toEqual([]);
    expect(host.notifications).toHaveLength(1);
  });

  it("re-sends the Alert when the Timer is still running, and toasts nothing", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    await runAndStopOneMinuteTimer(storage);
    const endsAt = storedState(storage)?.endsAt as number;

    jumpTo(start + 30_000);
    const host = startHost(storage);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(TIMER_TAG)?.at).toBe(endsAt)
    );

    await settle();
    expect(host.notifications).toEqual([]);
    expect(storedState(storage)?.status).toBe("running");
  });

  it("keeps quiet when the device alerts while closed, and still stores the end", async () => {
    const start = Date.now();
    const storage = new Map<string, unknown>();
    await runAndStopOneMinuteTimer(storage);

    jumpTo(start + 5 * 60_000);
    const host = startHost(storage, { canScheduleWhileClosed: true });
    await vi.waitFor(() => expect(storedState(storage)?.status).toBe("ended"));

    await settle();
    expect(host.notifications).toEqual([]);
  });
});
