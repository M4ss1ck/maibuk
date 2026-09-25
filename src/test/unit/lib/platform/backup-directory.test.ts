import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveTauriBackupDir = vi.hoisted(() => vi.fn());
const mockCreateTauriBackup = vi.hoisted(() => vi.fn());
const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@/lib/platform/tauri/backup", () => ({
  resolveTauriBackupDir: mockResolveTauriBackupDir,
  createTauriBackup: mockCreateTauriBackup,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

async function loadPlatform(buildTarget: "web" | "tauri", platform = "linux") {
  vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
  vi.stubEnv("TAURI_ENV_PLATFORM", platform);
  vi.resetModules();
  return import("@/lib/platform");
}

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  mockResolveTauriBackupDir.mockReset().mockResolvedValue("/config/backups");
  mockCreateTauriBackup.mockReset().mockResolvedValue({});
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("getDefaultBackupDirectory()", () => {
  it("returns null on web because Backups live in IndexedDB", async () => {
    const { getDefaultBackupDirectory } = await loadPlatform("web");

    await expect(getDefaultBackupDirectory()).resolves.toBeNull();
    expect(mockResolveTauriBackupDir).not.toHaveBeenCalled();
  });

  it("resolves the default directory on desktop Tauri", async () => {
    const { getDefaultBackupDirectory } = await loadPlatform("tauri", "linux");

    await expect(getDefaultBackupDirectory()).resolves.toBe("/config/backups");
    expect(mockResolveTauriBackupDir).toHaveBeenCalledOnce();
  });
});

describe("createBackup()", () => {
  it("restores the approved custom directory before creating its adapter", async () => {
    const { createBackup } = await loadPlatform("tauri", "linux");

    await createBackup("/mnt/custom backups");

    expect(mockInvoke).toHaveBeenCalledWith("restore_backup_directory", {
      path: "/mnt/custom backups",
    });
    expect(mockCreateTauriBackup).toHaveBeenCalledWith("/mnt/custom backups");
    expect(mockInvoke.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateTauriBackup.mock.invocationCallOrder[0]
    );
  });

  it("fails without an adapter when the directory was never approved", async () => {
    mockInvoke.mockRejectedValue("BACKUP_DIRECTORY_NOT_APPROVED");
    const { createBackup, BACKUP_DIRECTORY_NOT_APPROVED } = await loadPlatform("tauri", "linux");

    await expect(createBackup("/home/author/.ssh")).rejects.toThrow(
      BACKUP_DIRECTORY_NOT_APPROVED
    );
    expect(mockCreateTauriBackup).not.toHaveBeenCalled();
  });

  it("does not touch the filesystem scope for the default directory", async () => {
    const { createBackup } = await loadPlatform("tauri", "linux");

    await createBackup(null);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockCreateTauriBackup).toHaveBeenCalledWith(undefined);
  });
});

describe("pickBackupDirectory()", () => {
  it("opens the native picker at the given folder and returns the approved pick", async () => {
    mockInvoke.mockResolvedValue("/mnt/picked");
    const { pickBackupDirectory } = await loadPlatform("tauri", "linux");

    await expect(pickBackupDirectory("/mnt/start")).resolves.toBe("/mnt/picked");
    expect(mockInvoke).toHaveBeenCalledWith("pick_backup_directory", {
      defaultPath: "/mnt/start",
    });
  });

  it("returns null when the picker is cancelled", async () => {
    mockInvoke.mockResolvedValue(null);
    const { pickBackupDirectory } = await loadPlatform("tauri", "linux");

    await expect(pickBackupDirectory()).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("pick_backup_directory", { defaultPath: null });
  });
});

describe("requestBackupDirectory()", () => {
  it("asks the Rust side to confirm the typed path in the app language", async () => {
    mockInvoke.mockResolvedValue(false);
    const { requestBackupDirectory } = await loadPlatform("tauri", "linux");

    await expect(requestBackupDirectory("/mnt/typed", "es")).resolves.toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("request_backup_directory", {
      path: "/mnt/typed",
      locale: "es",
    });
  });

  it("turns a string rejection into an Error", async () => {
    mockInvoke.mockRejectedValue("BACKUP_DIRECTORY_INVALID");
    const { requestBackupDirectory } = await loadPlatform("tauri", "linux");

    await expect(requestBackupDirectory("backups", "en")).rejects.toThrow(
      "BACKUP_DIRECTORY_INVALID"
    );
  });
});

describe("forgetBackupDirectory()", () => {
  it("drops the approval on desktop Tauri", async () => {
    const { forgetBackupDirectory } = await loadPlatform("tauri", "linux");

    await forgetBackupDirectory();

    expect(mockInvoke).toHaveBeenCalledWith("forget_backup_directory", undefined);
  });
});

describe.each([
  ["web", "linux"],
  ["tauri", "android"],
] as const)("outside the desktop app (%s, %s)", (target, platform) => {
  it("never invokes a Backup Directory command", async () => {
    const {
      forgetBackupDirectory,
      pickBackupDirectory,
      requestBackupDirectory,
      restoreBackupDirectory,
    } = await loadPlatform(target, platform);

    await expect(pickBackupDirectory("/mnt")).resolves.toBeNull();
    await expect(requestBackupDirectory("/mnt", "en")).resolves.toBe(true);
    await restoreBackupDirectory("/mnt");
    await forgetBackupDirectory();

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
