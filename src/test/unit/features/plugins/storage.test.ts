import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// Plugin storage is Library data (ADR 0023): JSON values in a per-Plugin
// namespace, plus the dataVersion that last wrote it. It is not a Synced Item,
// so nothing here may emit a Change or schedule Sync.

type SyncState = {
  authStatus: "logged-in" | "logged-out";
  passphrase: string | null;
  syncStatus: string;
  authVerified: boolean;
  syncAll: ReturnType<typeof vi.fn>;
};
type Listener = (state: SyncState, previous: SyncState) => void;

const { settings, syncState, syncListeners, mockGetPassphrase, mockGetDatabase } = vi.hoisted(() => ({
  settings: { autoSync: true },
  syncState: {} as SyncState,
  syncListeners: new Set<Listener>(),
  mockGetPassphrase: vi.fn(),
  mockGetDatabase: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: { getState: () => settings },
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: {
    getState: () => syncState,
    subscribe: (listener: Listener) => {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
  },
}));

vi.mock("@/features/sync/crypto", () => ({
  getPassphrase: mockGetPassphrase,
}));

const {
  clearPluginStorage,
  deletePluginStorageValue,
  getPluginDataSize,
  getPluginDataVersion,
  getPluginStorageValue,
  listPluginStorageKeys,
  setPluginDataVersion,
  setPluginStorageValue,
} = await import("@/features/plugins/storage");
const { AUTO_SYNC_IDLE_DELAY_MS, installAutoSync, resetAutoSyncForTests } = await import(
  "@/features/sync/auto-sync"
);
const { emitChange, onChange, resetChangeFeedForTests } = await import(
  "@/features/sync/change-feed"
);

describe("Plugin storage", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  it("keeps each Plugin's JSON values in its own namespace", async () => {
    const value = { ids: ["chapter-1"], nested: { enabled: true }, n: 7, nothing: null };

    await setPluginStorageValue("echoes", "ignored", value);
    await setPluginStorageValue("notes-tool", "ignored", [1, 2]);

    expect(await getPluginStorageValue("echoes", "ignored")).toEqual(value);
    expect(await getPluginStorageValue("notes-tool", "ignored")).toEqual([1, 2]);
  });

  it("reads a key no write stored as null", async () => {
    expect(await getPluginStorageValue("echoes", "missing")).toBeNull();
  });

  it("replaces the value of an existing key", async () => {
    await setPluginStorageValue("echoes", "ignored", ["a"]);
    await setPluginStorageValue("echoes", "ignored", ["b"]);

    expect(await getPluginStorageValue("echoes", "ignored")).toEqual(["b"]);
    const rows = await testDb.select<Record<string, unknown>[]>(
      `SELECT * FROM plugin_storage WHERE plugin_id = 'echoes'`
    );
    expect(rows).toHaveLength(1);
  });

  it("lists the namespace keys in a stable order", async () => {
    await setPluginStorageValue("echoes", "b", 1);
    await setPluginStorageValue("echoes", "a", 2);
    await setPluginStorageValue("other", "c", 3);

    expect(await listPluginStorageKeys("echoes")).toEqual(["a", "b"]);
  });

  it("deletes one key without touching the rest", async () => {
    await setPluginStorageValue("echoes", "a", 1);
    await setPluginStorageValue("echoes", "b", 2);

    await deletePluginStorageValue("echoes", "a");

    expect(await listPluginStorageKeys("echoes")).toEqual(["b"]);
  });

  it("clears one namespace and its dataVersion without touching another", async () => {
    await setPluginStorageValue("echoes", "a", 1);
    await setPluginDataVersion("echoes", 2);
    await setPluginStorageValue("notes-tool", "a", 1);
    await setPluginDataVersion("notes-tool", 3);

    await clearPluginStorage("echoes");

    expect(await listPluginStorageKeys("echoes")).toEqual([]);
    expect(await getPluginDataVersion("echoes")).toBeNull();
    expect(await listPluginStorageKeys("notes-tool")).toEqual(["a"]);
    expect(await getPluginDataVersion("notes-tool")).toBe(3);
  });

  it("records the dataVersion that last wrote the namespace", async () => {
    expect(await getPluginDataVersion("echoes")).toBeNull();

    await setPluginDataVersion("echoes", 1);
    expect(await getPluginDataVersion("echoes")).toBe(1);

    await setPluginDataVersion("echoes", 2);
    expect(await getPluginDataVersion("echoes")).toBe(2);
    expect(await getPluginDataVersion("other")).toBeNull();
  });

  it("reports the namespace's data size in bytes", async () => {
    // JSON.stringify("á") is 4 bytes in UTF-8; a character count would read 3.
    await setPluginStorageValue("echoes", "a", "á");
    await setPluginStorageValue("echoes", "b", "ab");

    expect(await getPluginDataSize("echoes")).toBe(8);
    expect(await getPluginDataSize("notes-tool")).toBe(0);
  });

  it("refuses a value JSON cannot store", async () => {
    await expect(setPluginStorageValue("echoes", "bad", undefined)).rejects.toThrow();
    await expect(setPluginStorageValue("echoes", "bad", () => {})).rejects.toThrow();
  });
});

describe("Plugin storage and Sync", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetAutoSyncForTests();
    resetChangeFeedForTests();
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
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
  });

  afterEach(() => {
    resetAutoSyncForTests();
    resetChangeFeedForTests();
    vi.useRealTimers();
  });

  it("a storage write emits no Change and schedules no Sync", async () => {
    installAutoSync();
    const signals: unknown[] = [];
    const off = onChange((signal) => {
      signals.push(signal);
    });
    try {
      await setPluginStorageValue("echoes", "ignored", ["chapter-1"]);
      await deletePluginStorageValue("echoes", "ignored");
      await setPluginDataVersion("echoes", 2);
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_DELAY_MS * 2);
    } finally {
      off();
    }

    expect(signals).toEqual([]);
    expect(syncState.syncAll).not.toHaveBeenCalled();
  });

  it("proves the harness: a local Change does schedule one", async () => {
    installAutoSync();

    await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" });
    await vi.advanceTimersByTimeAsync(AUTO_SYNC_IDLE_DELAY_MS);

    expect(syncState.syncAll).toHaveBeenCalledTimes(1);
  });
});
