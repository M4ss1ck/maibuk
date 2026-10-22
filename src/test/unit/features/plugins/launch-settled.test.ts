import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { backup } = vi.hoisted(() => ({
  backup: { settled: true, listeners: new Set<() => void>() },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>();
  return { ...mod, waitForDatabaseReady: async () => undefined };
});

vi.mock("@/features/backup/lifecycle", () => ({
  hasLaunchBackupSettled: () => backup.settled,
  onLaunchBackupSettled: (listener: () => void) => {
    backup.listeners.add(listener);
    return () => backup.listeners.delete(listener);
  },
}));

import {
  LAUNCH_AUTO_SYNC_START_GRACE_MS,
  whenPluginLaunchSettled,
} from "@/features/plugins/lifecycle";
import { useSettingsStore } from "@/features/settings/store";
import { resetAutoSyncForTests, runAutoSync } from "@/features/sync/auto-sync";
import { useSyncStore } from "@/features/sync/store";

/** Whether the wait resolved after the timers and microtasks so far. */
function track(wait: Promise<void>): { settled: () => boolean } {
  let settled = false;
  void wait.then(() => {
    settled = true;
  });
  return { settled: () => settled };
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  backup.settled = true;
  backup.listeners.clear();
  resetAutoSyncForTests();
  useSettingsStore.setState({ autoSync: true });
  // A signed-in device whose session check has not answered yet.
  useSyncStore.setState({ authStatus: "logged-in", authVerified: false, passphrase: null });
});

afterEach(() => {
  resetAutoSyncForTests();
  useSyncStore.setState({ authStatus: "logged-out", authVerified: false });
  vi.useRealTimers();
});

describe("whenPluginLaunchSettled", () => {
  it("does not wait when automatic sync is off", async () => {
    useSettingsStore.setState({ autoSync: false });
    const wait = track(whenPluginLaunchSettled());
    await flush();
    expect(wait.settled()).toBe(true);
  });

  it("waits for a verified session's launch Auto Sync, past the grace period", async () => {
    useSyncStore.setState({ authVerified: true });
    const wait = track(whenPluginLaunchSettled());

    await flush(LAUNCH_AUTO_SYNC_START_GRACE_MS * 4);
    expect(wait.settled()).toBe(false);

    await runAutoSync("launch");
    await flush();
    expect(wait.settled()).toBe(true);
  });

  // The hang behind the empty Plugin sidebar: a session check that failed on
  // the network leaves `logged-in` with no verified session, so the launch Auto
  // Sync never runs and never settles.
  it("stops waiting after the grace period when the session never verified", async () => {
    const wait = track(whenPluginLaunchSettled());

    await flush(LAUNCH_AUTO_SYNC_START_GRACE_MS - 1);
    expect(wait.settled()).toBe(false);

    await flush(1);
    expect(wait.settled()).toBe(true);
  });

  it("does not wait on an offline launch, whose Auto Sync waits for the network", async () => {
    setOnline(false);
    const wait = track(whenPluginLaunchSettled());
    await flush();
    expect(wait.settled()).toBe(true);
  });

  it("stops waiting when the session expires and the device logs out", async () => {
    const wait = track(whenPluginLaunchSettled());
    await flush();
    expect(wait.settled()).toBe(false);

    useSyncStore.setState({ authStatus: "logged-out" });
    await flush();
    expect(wait.settled()).toBe(true);
  });

  it("still waits for the launch Backup after the Auto Sync settled", async () => {
    useSettingsStore.setState({ autoSync: false });
    backup.settled = false;
    const wait = track(whenPluginLaunchSettled());
    await flush(LAUNCH_AUTO_SYNC_START_GRACE_MS * 4);
    expect(wait.settled()).toBe(false);

    backup.settled = true;
    for (const listener of [...backup.listeners]) listener();
    await flush();
    expect(wait.settled()).toBe(true);
  });
});
