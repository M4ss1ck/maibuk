// @vitest-environment jsdom
/**
 * The Clock's open tab on its own: a device with nothing stored opens on
 * Pomodoro, a restart finds the tab picked before it, and a pick made before a
 * slow load resolves survives that load.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { CLOCK_TABS, createClockTab } from "./tab";
import { clockManifest } from "./test-support";

/** Every host a test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** The tab over `storage`, on a host the test stops later. Not loaded yet. */
function openTab(storage: Map<string, unknown>) {
  const host = createTestHost({ manifest: clockManifest(), storage });
  openHosts.push(host);
  const client = createPluginClient(host.port);
  return { client, tab: createClockTab(client) };
}

describe("Clock open tab", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const host of openHosts.splice(0)) await host.stop();
  });

  it("opens on Pomodoro when nothing is stored", async () => {
    const { tab } = openTab(new Map());
    expect(tab.snapshot()).toBe("pomodoro");
    await tab.load();
    expect(tab.snapshot()).toBe("pomodoro");
  });

  it("opens on Pomodoro when the stored value is not a tab", async () => {
    for (const value of ["calendar", 3, null, { tab: "timer" }, ["timer"]]) {
      const { tab } = openTab(new Map([["tab", value]]));
      await tab.load();
      expect(tab.snapshot()).toBe("pomodoro");
    }
  });

  it("reopens on every tab a restart finds stored", async () => {
    for (const stored of CLOCK_TABS) {
      const storage = new Map<string, unknown>();
      const first = openTab(storage);
      await first.tab.load();
      first.tab.select(stored);
      await vi.waitFor(() => expect(storage.get("tab")).toBe(stored));

      const second = openTab(storage);
      await second.tab.load();
      expect(second.tab.snapshot()).toBe(stored);
    }
  });

  it("tells its listeners about a loaded tab and a new pick, never a repeat", async () => {
    const { tab } = openTab(new Map([["tab", "timer"]]));
    const listener = vi.fn();
    tab.subscribe(listener);

    await tab.load();
    expect(listener).toHaveBeenCalledTimes(1);
    tab.select("timer");
    expect(listener).toHaveBeenCalledTimes(1);
    tab.select("alarms");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps a pick made before a slow load resolves, and stores it", async () => {
    const storage = new Map<string, unknown>([["tab", "timer"]]);
    const { tab } = openTab(storage);
    const loading = tab.load();
    // Picking the tab already on screen still has to overwrite the stored one.
    tab.select("pomodoro");
    await loading;

    expect(tab.snapshot()).toBe("pomodoro");
    await vi.waitFor(() => expect(storage.get("tab")).toBe("pomodoro"));
  });

  it("stays usable when storage refuses", async () => {
    const { client, tab } = openTab(new Map());
    vi.spyOn(client.storage, "get").mockRejectedValue(new Error("refused"));
    const set = vi.spyOn(client.storage, "set").mockRejectedValue(new Error("refused"));
    await tab.load();
    expect(tab.snapshot()).toBe("pomodoro");
    tab.select("stopwatch");
    expect(tab.snapshot()).toBe("stopwatch");
    expect(set).toHaveBeenCalledWith({ key: "tab", value: "stopwatch" });
  });
});
