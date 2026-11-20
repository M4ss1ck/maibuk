// @vitest-environment jsdom
/**
 * The Stopwatch core on its own: the behavior the page's suite cannot reach
 * with a page mounted. Storage that is not the shape `time.ts` writes must not
 * leave a broken Stopwatch behind, a restart must find the one that ran before
 * it, and a change made before a slow load resolves must survive that load.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { createStopwatch } from "./stopwatch";
import { clockManifest } from "./test-support";
import { elapsedMs } from "./time";

/** Every host a test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** Pins the device clock the Stopwatch reads at `now`. */
function at(now: number): void {
  vi.spyOn(Date, "now").mockReturnValue(now);
}

/** Opens the Stopwatch over `storage` once loaded, on a host the test stops later. */
async function openStopwatch(storage: Map<string, unknown>) {
  const host = createTestHost({ manifest: clockManifest(), storage });
  openHosts.push(host);
  const stopwatch = createStopwatch(createPluginClient(host.port));
  await stopwatch.load();
  return { host, stopwatch };
}

/** The default Stopwatch a malformed or empty storage leaves in place. */
const IDLE = { status: "idle" };

describe("Clock Stopwatch core", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("leaves an idle Stopwatch when storage is malformed", async () => {
    const values: unknown[] = [
      "nonsense",
      42,
      { status: "running", banked: 0, laps: [] },
      { status: "paused", banked: -1, laps: [] },
      { status: "paused", banked: 0, laps: [{ length: "soon", total: 1 }] },
      { status: "ended" },
    ];

    for (const value of values) {
      const storage = new Map<string, unknown>([["stopwatch", value]]);
      const { stopwatch } = await openStopwatch(storage);
      expect(stopwatch.snapshot()).toEqual(IDLE);
    }
  });

  it("loads a stored running Stopwatch with its Laps, deriving time from startedAt", async () => {
    const state = {
      status: "running",
      startedAt: 1_000,
      banked: 500,
      laps: [{ length: 400, total: 400 }],
    };
    const storage = new Map<string, unknown>([["stopwatch", state]]);
    const { stopwatch } = await openStopwatch(storage);

    expect(stopwatch.snapshot()).toEqual(state);
    // The restart stored no count: the elapsed time still comes from startedAt.
    expect(elapsedMs(stopwatch.snapshot(), 3_000)).toBe(2_500);
  });

  it("writes start, each Lap, pause, and reset to storage, and notifies", async () => {
    at(10_000);
    const storage = new Map<string, unknown>();
    const { stopwatch } = await openStopwatch(storage);
    let changes = 0;
    stopwatch.subscribe(() => {
      changes += 1;
    });

    stopwatch.start();
    expect(changes).toBe(1);
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({
        status: "running",
        startedAt: 10_000,
        banked: 0,
        laps: [],
      })
    );

    at(12_000);
    stopwatch.lap();
    expect(changes).toBe(2);
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({
        status: "running",
        startedAt: 10_000,
        banked: 0,
        laps: [{ length: 2_000, total: 2_000 }],
      })
    );

    at(15_000);
    stopwatch.lap();
    expect(changes).toBe(3);
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({
        status: "running",
        startedAt: 10_000,
        banked: 0,
        laps: [
          { length: 2_000, total: 2_000 },
          { length: 3_000, total: 5_000 },
        ],
      })
    );

    at(17_000);
    stopwatch.pause();
    expect(changes).toBe(4);
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({
        status: "paused",
        banked: 7_000,
        laps: [
          { length: 2_000, total: 2_000 },
          { length: 3_000, total: 5_000 },
        ],
      })
    );

    stopwatch.reset();
    expect(changes).toBe(5);
    await vi.waitFor(() => expect(storage.get("stopwatch")).toEqual(IDLE));
    expect(stopwatch.snapshot()).toEqual(IDLE);
  });

  it("starts on the first toggle and pauses on the second", async () => {
    at(1_000);
    const storage = new Map<string, unknown>();
    const { stopwatch } = await openStopwatch(storage);

    stopwatch.toggle();
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({
        status: "running",
        startedAt: 1_000,
        banked: 0,
        laps: [],
      })
    );

    at(4_000);
    stopwatch.toggle();
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({ status: "paused", banked: 3_000, laps: [] })
    );
  });

  it("writes nothing new for a Lap while idle or paused", async () => {
    at(1_000);
    const storage = new Map<string, unknown>();
    const { stopwatch } = await openStopwatch(storage);
    let changes = 0;
    stopwatch.subscribe(() => {
      changes += 1;
    });

    stopwatch.lap();
    expect(changes).toBe(0);
    expect(storage.get("stopwatch")).toBeUndefined();

    stopwatch.start();
    at(3_000);
    stopwatch.pause();
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({ status: "paused", banked: 2_000, laps: [] })
    );
    const paused = storage.get("stopwatch");

    stopwatch.lap();
    expect(changes).toBe(2);
    expect(storage.get("stopwatch")).toBe(paused);
  });

  it("keeps a start made before a slow load resolves", async () => {
    at(50_000);
    const storage = new Map<string, unknown>([["stopwatch", IDLE]]);
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    const stopwatch = createStopwatch(createPluginClient(host.port));

    const loading = stopwatch.load();
    stopwatch.start();
    await loading;

    expect(stopwatch.snapshot()).toEqual({
      status: "running",
      startedAt: 50_000,
      banked: 0,
      laps: [],
    });
    await vi.waitFor(() =>
      expect(storage.get("stopwatch")).toEqual({
        status: "running",
        startedAt: 50_000,
        banked: 0,
        laps: [],
      })
    );
  });
});
