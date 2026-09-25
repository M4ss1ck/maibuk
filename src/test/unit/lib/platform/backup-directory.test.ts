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
  it("grants scope for a custom directory before creating its adapter", async () => {
    const { createBackup } = await loadPlatform("tauri", "linux");

    await createBackup("/mnt/custom backups");

    expect(mockInvoke).toHaveBeenCalledWith("allow_backup_directory", {
      path: "/mnt/custom backups",
    });
    expect(mockCreateTauriBackup).toHaveBeenCalledWith("/mnt/custom backups");
    expect(mockInvoke.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateTauriBackup.mock.invocationCallOrder[0]
    );
  });

  it("does not touch the filesystem scope for the default directory", async () => {
    const { createBackup } = await loadPlatform("tauri", "linux");

    await createBackup(null);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockCreateTauriBackup).toHaveBeenCalledWith(undefined);
  });
});

describe("allowBackupDirectory()", () => {
  it("grants the typed path to the filesystem scope on desktop Tauri", async () => {
    const { allowBackupDirectory } = await loadPlatform("tauri", "linux");

    await allowBackupDirectory("/mnt/custom backups");

    expect(mockInvoke).toHaveBeenCalledWith("allow_backup_directory", {
      path: "/mnt/custom backups",
    });
  });

  it("does nothing on web", async () => {
    const { allowBackupDirectory } = await loadPlatform("web");

    await allowBackupDirectory("/mnt/custom backups");

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does nothing on Android, which has no custom directory picker", async () => {
    const { allowBackupDirectory } = await loadPlatform("tauri", "android");

    await allowBackupDirectory("/mnt/custom backups");

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
