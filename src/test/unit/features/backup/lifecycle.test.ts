import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateBackupAdapter = vi.hoisted(() => vi.fn());
const mockCreateBackup = vi.hoisted(() => vi.fn());
const mockPruneBackups = vi.hoisted(() => vi.fn());
const mockWaitForDatabaseReady = vi.hoisted(() => vi.fn());
const mockGetCurrentWindow = vi.hoisted(() => vi.fn());
const mockOnCloseRequested = vi.hoisted(() => vi.fn());
const mockDestroy = vi.hoisted(() => vi.fn());
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
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
}));

const {
  createLaunchBackup,
  createCloseBackup,
  runLaunchBackupOnce,
  registerCloseBackupHandlerOnce,
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
    mockOnCloseRequested.mockResolvedValue(() => undefined);
    mockDestroy.mockResolvedValue(undefined);
    mockGetCurrentWindow.mockReturnValue({
      onCloseRequested: mockOnCloseRequested,
      destroy: mockDestroy,
    });
  });

  it("creates a launch backup using persisted settings", async () => {
    await createLaunchBackup();

    expect(mockCreateBackupAdapter).toHaveBeenCalledWith("/tmp/backups");
    expect(mockCreateBackup).toHaveBeenCalledWith("launch");
    expect(mockPruneBackups).toHaveBeenCalledWith(12);
  });

  it("creates a close backup using persisted settings", async () => {
    await createCloseBackup();

    expect(mockCreateBackupAdapter).toHaveBeenCalledWith("/tmp/backups");
    expect(mockCreateBackup).toHaveBeenCalledWith("close");
    expect(mockPruneBackups).toHaveBeenCalledWith(12);
  });

  it("runs launch backup only once", async () => {
    await runLaunchBackupOnce();
    await runLaunchBackupOnce();

    expect(mockWaitForDatabaseReady).toHaveBeenCalledTimes(1);
    expect(mockCreateBackup).toHaveBeenCalledTimes(1);
    expect(mockCreateBackup).toHaveBeenCalledWith("launch");
  });

  it("registers the close handler only once and creates a close backup before destroy", async () => {
    await registerCloseBackupHandlerOnce();
    await registerCloseBackupHandlerOnce();

    expect(mockOnCloseRequested).toHaveBeenCalledTimes(1);

    const closeHandler = mockOnCloseRequested.mock.calls[0][0] as (event: { preventDefault: () => void }) => Promise<void>;
    const preventDefault = vi.fn();

    await closeHandler({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(mockCreateBackup).toHaveBeenCalledWith("close");
    expect(mockDestroy).toHaveBeenCalled();
  });
});
