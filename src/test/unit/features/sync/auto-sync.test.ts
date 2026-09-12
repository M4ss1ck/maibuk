import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SyncState = {
  authStatus: "logged-in" | "logged-out";
  passphrase: string | null;
  syncStatus: string;
  authVerified: boolean;
  syncAll: ReturnType<typeof vi.fn>;
};
type Listener = (state: SyncState, previous: SyncState) => void;

const { settings, syncState, syncListeners, mockGetPassphrase, mockFlushPendingEdits } =
  vi.hoisted(() => ({
    settings: { autoSync: true },
    syncState: {} as SyncState,
    syncListeners: new Set<Listener>(),
    mockGetPassphrase: vi.fn(),
    mockFlushPendingEdits: vi.fn(),
  }));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: { getState: () => settings },
}));

vi.mock("../../../../features/sync/store", () => ({
  useSyncStore: {
    getState: () => syncState,
    subscribe: (listener: Listener) => {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
  },
}));

vi.mock("../../../../features/sync/crypto", () => ({
  getPassphrase: mockGetPassphrase,
}));

vi.mock("../../../../features/sync/pending-edits", () => ({
  flushPendingEdits: mockFlushPendingEdits,
}));

const { AUTO_SYNC_IDLE_DELAY_MS, installAutoSync, resetAutoSyncForTests, runAutoSync } =
  await import("@/features/sync/auto-sync");
const { notifyLocalChange } = await import("@/features/sync/local-changes");

function setSyncState(partial: Partial<SyncState>) {
  const previous = { ...syncState };
  Object.assign(syncState, partial);
  for (const listener of syncListeners) listener(syncState, previous);
}

async function flushMicrotasks() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("automatic sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAutoSyncForTests();
    syncListeners.clear();
    settings.autoSync = true;
    Object.assign(syncState, {
      authStatus: "logged-in",
      passphrase: null,
      syncStatus: "idle",
      authVerified: false,
      syncAll: vi.fn().mockResolvedValue(undefined),
    });
    mockGetPassphrase.mockReset().mockReturnValue("session-pass");
    mockFlushPendingEdits.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  afterEach(() => {
    resetAutoSyncForTests();
    vi.useRealTimers();
  });

  describe("runAutoSync()", () => {
    it("syncs everything with a non-prompting resolver after landing pending edits", async () => {
      const order: string[] = [];
      mockFlushPendingEdits.mockImplementation(async () => {
        order.push("flush");
      });
      syncState.syncAll.mockImplementation(async () => {
        order.push("sync");
      });

      await expect(runAutoSync("idle")).resolves.toBe("synced");

      expect(order).toEqual(["flush", "sync"]);
      expect(syncState.syncAll).toHaveBeenCalledWith("session-pass", expect.any(Function), {
        trigger: "auto",
      });
      const resolver = syncState.syncAll.mock.calls[0][1] as () => Promise<string>;
      await expect(resolver()).resolves.toBe("skip");
    });

    it("falls back to the stored passphrase", async () => {
      mockGetPassphrase.mockReturnValue(null);
      syncState.passphrase = "stored-pass";

      await runAutoSync("launch");

      expect(syncState.syncAll).toHaveBeenCalledWith("stored-pass", expect.any(Function), {
        trigger: "auto",
      });
    });

    it("does nothing when the setting is off", async () => {
      settings.autoSync = false;

      await expect(runAutoSync("idle")).resolves.toBe("disabled");
      expect(syncState.syncAll).not.toHaveBeenCalled();
    });

    it.each([
      ["logged out", () => setSyncState({ authStatus: "logged-out" })],
      ["no passphrase", () => mockGetPassphrase.mockReturnValue(null)],
      [
        "offline",
        () => Object.defineProperty(navigator, "onLine", { value: false, configurable: true }),
      ],
    ])("does nothing when %s", async (_label, arrange) => {
      arrange();

      await expect(runAutoSync("idle")).resolves.toBe("ineligible");
      expect(syncState.syncAll).not.toHaveBeenCalled();
    });

    it("retries after the idle delay instead of queueing behind a running sync", async () => {
      syncState.syncStatus = "syncing";

      await expect(runAutoSync("idle")).resolves.toBe("busy");
      expect(syncState.syncAll).not.toHaveBeenCalled();

      syncState.syncStatus = "success";
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_DELAY_MS);

      expect(syncState.syncAll).toHaveBeenCalledTimes(1);
    });

    it("never runs two automatic syncs at once", async () => {
      let finish!: () => void;
      syncState.syncAll.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );

      const first = runAutoSync("idle");
      await flushMicrotasks();
      await expect(runAutoSync("idle")).resolves.toBe("busy");
      finish();
      await first;

      expect(syncState.syncAll).toHaveBeenCalledTimes(1);
    });

    it("swallows a failed sync (the store already records it)", async () => {
      syncState.syncAll.mockRejectedValue(new Error("Network error"));

      await expect(runAutoSync("idle")).resolves.toBe("synced");
    });
  });

  describe("installAutoSync()", () => {
    it("syncs once, after the idle delay following the last local change", async () => {
      installAutoSync();

      notifyLocalChange();
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_DELAY_MS - 5_000);
      notifyLocalChange();
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_DELAY_MS - 1);
      expect(syncState.syncAll).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(syncState.syncAll).toHaveBeenCalledTimes(1);
    });

    it("runs the launch sync when the session becomes verified", async () => {
      installAutoSync();
      expect(syncState.syncAll).not.toHaveBeenCalled();

      setSyncState({ authVerified: true });
      await flushMicrotasks();

      expect(syncState.syncAll).toHaveBeenCalledTimes(1);

      // A later refresh that keeps it verified is not a new launch.
      setSyncState({ authVerified: true });
      await flushMicrotasks();
      expect(syncState.syncAll).toHaveBeenCalledTimes(1);
    });

    it("runs the launch sync immediately when already verified at install", async () => {
      syncState.authVerified = true;

      installAutoSync();
      await flushMicrotasks();

      expect(syncState.syncAll).toHaveBeenCalledTimes(1);
    });

    it("installs once and stops everything on uninstall", async () => {
      const uninstall = installAutoSync();
      expect(installAutoSync()).toBe(uninstall);

      notifyLocalChange();
      uninstall();
      setSyncState({ authVerified: true });
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_DELAY_MS * 2);

      expect(syncState.syncAll).not.toHaveBeenCalled();
    });
  });
});
