import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateBackupAdapter = vi.hoisted(() => vi.fn());
const mockCreateBackup = vi.hoisted(() => vi.fn());
const mockPruneBackups = vi.hoisted(() => vi.fn());
const mockHasBackupForToday = vi.hoisted(() => vi.fn());
const mockWaitForDatabaseReady = vi.hoisted(() => vi.fn());
const mockSettingsState = vi.hoisted(() => ({
  backupRetention: 12,
  backupDirectory: "/tmp/backups",
}));

const mockIsAndroid = vi.hoisted(() => ({ value: false }));

vi.mock("../../../../lib/platform", () => ({
  createBackup: mockCreateBackupAdapter,
  get IS_ANDROID() {
    return mockIsAndroid.value;
  },
}));

vi.mock("../../../../lib/db", () => ({
  waitForDatabaseReady: mockWaitForDatabaseReady,
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

vi.mock("../../../../features/backup/backup-service", () => ({
  BackupService: class {
    createBackup = mockCreateBackup;
    pruneBackups = mockPruneBackups;
    hasBackupForToday = mockHasBackupForToday;
  },
}));

const { createDailyBackup, runBackgroundBackup, runDailyBackupOnce, resetBackupLifecycleForTests, scheduleDailyBackup } =
  await import("@/features/backup/lifecycle");

describe("backup lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mockIsAndroid.value = false;
    resetBackupLifecycleForTests();
    mockWaitForDatabaseReady.mockResolvedValue(undefined);
    mockCreateBackupAdapter.mockResolvedValue({});
    mockCreateBackup.mockResolvedValue("backup.sql");
    mockPruneBackups.mockResolvedValue(undefined);
    mockHasBackupForToday.mockResolvedValue(false);
  });

  it("creates a daily backup using persisted settings", async () => {
    await createDailyBackup();

    expect(mockCreateBackupAdapter).toHaveBeenCalledWith("/tmp/backups");
    expect(mockHasBackupForToday).toHaveBeenCalledWith("daily");
    expect(mockCreateBackup).toHaveBeenCalledWith("daily");
    expect(mockPruneBackups).toHaveBeenCalledWith(12);
  });

  it("creates and prunes a close backup using persisted settings", async () => {
    await runBackgroundBackup();

    expect(mockCreateBackupAdapter).toHaveBeenCalledWith("/tmp/backups");
    expect(mockCreateBackup).toHaveBeenCalledWith("close");
    expect(mockPruneBackups).toHaveBeenCalledWith(12);
  });

  it("swallows a background backup creation failure without pruning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockCreateBackup.mockRejectedValueOnce(new Error("create failed"));

    await expect(runBackgroundBackup()).resolves.toBeUndefined();

    expect(mockPruneBackups).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Failed to create background backup:", expect.any(Error));
    warn.mockRestore();
  });

  it("swallows a background backup prune failure after creating the backup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockPruneBackups.mockRejectedValueOnce(new Error("prune failed"));

    await expect(runBackgroundBackup()).resolves.toBeUndefined();

    expect(mockCreateBackup).toHaveBeenCalledWith("close");
    expect(warn).toHaveBeenCalledWith("Failed to create background backup:", expect.any(Error));
    warn.mockRestore();
  });

  it("skips daily backup if one already exists for today", async () => {
    mockHasBackupForToday.mockResolvedValue(true);

    await createDailyBackup();

    expect(mockHasBackupForToday).toHaveBeenCalledWith("daily");
    expect(mockCreateBackup).not.toHaveBeenCalled();
    expect(mockPruneBackups).not.toHaveBeenCalled();
  });

  it("runs daily backup only once per session", async () => {
    await runDailyBackupOnce();
    await runDailyBackupOnce();

    expect(mockWaitForDatabaseReady).toHaveBeenCalledTimes(1);
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
    expect(mockCreateBackup).toHaveBeenCalledWith("daily");
  });

  it("scheduleDailyBackup runs the backup immediately when not on Android", async () => {
    mockIsAndroid.value = false;

    scheduleDailyBackup();

    await vi.waitFor(() => expect(mockCreateBackup).toHaveBeenCalledWith("daily"));
    expect(mockWaitForDatabaseReady).toHaveBeenCalledTimes(1);
  });

  it("scheduleDailyBackup defers via requestIdleCallback on Android", async () => {
    mockIsAndroid.value = true;
    let captured: (deadline: unknown) => void = () => undefined;
    const mockRequestIdleCallback = vi.fn((cb: (deadline: unknown) => void) => {
      captured = cb;
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", mockRequestIdleCallback);

    scheduleDailyBackup();

    expect(mockRequestIdleCallback).toHaveBeenCalledTimes(1);
    expect(mockRequestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
    expect(mockWaitForDatabaseReady).not.toHaveBeenCalled();
    expect(mockCreateBackup).not.toHaveBeenCalled();

    captured({ didTimeout: false, timeRemaining: () => 50 });

    await vi.waitFor(() => expect(mockCreateBackup).toHaveBeenCalledWith("daily"));
    expect(mockWaitForDatabaseReady).toHaveBeenCalledTimes(1);
  });

  it("scheduleDailyBackup falls back to setTimeout on Android without requestIdleCallback", async () => {
    mockIsAndroid.value = true;
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();

    scheduleDailyBackup();

    expect(mockWaitForDatabaseReady).not.toHaveBeenCalled();
    expect(mockCreateBackup).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10000);

    expect(mockWaitForDatabaseReady).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mockCreateBackup).toHaveBeenCalledWith("daily"));
  });
});
