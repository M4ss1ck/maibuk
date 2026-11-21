// @vitest-environment jsdom
/**
 * The Clock's 24-Hour Clock setting on its own: a device with nothing stored
 * shows 24, a restart finds the hour cycle picked before it, and a pick made
 * before a slow load resolves survives that load.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { createHourCycle } from "./hour-cycle";
import { clockManifest } from "./test-support";

/** Every host a test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** The hour cycle over `storage`, on a host the test stops later. Not loaded yet. */
function openHourCycle(storage: Map<string, unknown>) {
  const host = createTestHost({ manifest: clockManifest(), storage });
  openHosts.push(host);
  const client = createPluginClient(host.port);
  return { client, hourCycle: createHourCycle(client) };
}

describe("Clock hour cycle", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const host of openHosts.splice(0)) await host.stop();
  });

  it("shows the 24-hour clock when nothing is stored", async () => {
    const { hourCycle } = openHourCycle(new Map());
    expect(hourCycle.snapshot()).toBe(24);
    await hourCycle.load();
    expect(hourCycle.snapshot()).toBe(24);
  });

  it("shows the 24-hour clock when the stored value is not an hour cycle", async () => {
    for (const value of [13, "12", null, true, 0, { hourCycle: 12 }, [12]]) {
      const { hourCycle } = openHourCycle(new Map([["hourCycle", value]]));
      await hourCycle.load();
      expect(hourCycle.snapshot()).toBe(24);
    }
  });

  it("reopens on every hour cycle a restart finds stored", async () => {
    for (const stored of [12, 24] as const) {
      const storage = new Map<string, unknown>();
      const first = openHourCycle(storage);
      await first.hourCycle.load();
      first.hourCycle.set(stored);
      await vi.waitFor(() => expect(storage.get("hourCycle")).toBe(stored));

      const second = openHourCycle(storage);
      await second.hourCycle.load();
      expect(second.hourCycle.snapshot()).toBe(stored);
    }
  });

  it("tells its listeners about a loaded hour cycle and a new pick, never a repeat", async () => {
    const { hourCycle } = openHourCycle(new Map([["hourCycle", 12]]));
    const listener = vi.fn();
    hourCycle.subscribe(listener);

    await hourCycle.load();
    expect(listener).toHaveBeenCalledTimes(1);
    hourCycle.set(12);
    expect(listener).toHaveBeenCalledTimes(1);
    hourCycle.set(24);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps a pick made before a slow load resolves, and stores it", async () => {
    const storage = new Map<string, unknown>([["hourCycle", 12]]);
    const { hourCycle } = openHourCycle(storage);
    const loading = hourCycle.load();
    // Picking the hour cycle already on screen still has to overwrite the stored one.
    hourCycle.set(24);
    await loading;

    expect(hourCycle.snapshot()).toBe(24);
    await vi.waitFor(() => expect(storage.get("hourCycle")).toBe(24));
  });

  it("stays usable when storage refuses", async () => {
    const { client, hourCycle } = openHourCycle(new Map());
    vi.spyOn(client.storage, "get").mockRejectedValue(new Error("refused"));
    const set = vi.spyOn(client.storage, "set").mockRejectedValue(new Error("refused"));
    await hourCycle.load();
    expect(hourCycle.snapshot()).toBe(24);
    hourCycle.set(12);
    expect(hourCycle.snapshot()).toBe(12);
    expect(set).toHaveBeenCalledWith({ key: "hourCycle", value: 12 });
  });
});
