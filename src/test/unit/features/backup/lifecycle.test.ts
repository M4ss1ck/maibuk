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

vi.mock("../../../../lib/platform", () => ({
  createBackup: mockCreateBackupAdapter,
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

const {
  createDailyBackup,
  runDailyBackupOnce,
  resetBackupLifecycleForTests,
} = await import("../../../../features/backup/lifecycle");

describe("backup lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
