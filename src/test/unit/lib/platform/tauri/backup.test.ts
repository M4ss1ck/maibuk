import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadTextFile = vi.hoisted(() => vi.fn());
const mockWriteTextFile = vi.hoisted(() => vi.fn());
const mockReadDir = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());
const mockMkdir = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockAppConfigDir = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  readDir: mockReadDir,
  remove: mockRemove,
  mkdir: mockMkdir,
  stat: mockStat,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: mockAppConfigDir,
}));

const { createTauriBackup } = await import("../../../../../lib/platform/tauri/backup");

describe("TauriBackupAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppConfigDir.mockResolvedValue("/config/");
    mockMkdir.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockWriteTextFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 12, mtime: "2026-03-15T14:30:00.000Z" });
  });

  it("rejects unsafe filenames", async () => {
    const adapter = await createTauriBackup("/safe/backups");

    await expect(adapter.readBackup("../escape.sql")).rejects.toThrow(/invalid backup filename/i);
    await expect(adapter.deleteBackup("nested/file.sql")).rejects.toThrow(/invalid backup filename/i);
  });

  it("verifies checksum before returning SQL content", async () => {
    const adapter = await createTauriBackup("/safe/backups");
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".meta.json")) {
        return JSON.stringify({
          trigger: "manual",
          createdAt: "2026-03-15T14:30:00.000Z",
          sizeBytes: 12,
          checksum: "bad-checksum",
        });
      }
      return "INSERT INTO books VALUES ('1');";
    });

    await expect(adapter.readBackup("maibuk-backup-manual-2026-03-15T14-30-00.sql")).rejects.toThrow(/checksum/i);
  });

  it("repairs orphan sql metadata on first read", async () => {
    const adapter = await createTauriBackup("/safe/backups");
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".meta.json")) {
        throw new Error("missing meta");
      }
      return "INSERT INTO books VALUES ('1');";
    });

    const content = await adapter.readBackup("maibuk-backup-pre-sync-2026-03-15T14-30-00.sql");

    expect(content).toBe("INSERT INTO books VALUES ('1');");
    expect(mockWriteTextFile).toHaveBeenCalledWith(
      "/safe/backups/maibuk-backup-pre-sync-2026-03-15T14-30-00.meta.json",
      expect.stringContaining('"trigger":"pre-sync"'),
    );
  });

  it("skips invalid directory entries and only removes orphan metadata sidecars", async () => {
    const adapter = await createTauriBackup("/safe/backups");
    mockReadDir.mockResolvedValue([
      { name: undefined },
      { name: "maibuk-backup-launch-2026-03-15T14-30-00.sql" },
      { name: "maibuk-backup-launch-2026-03-15T14-30-00.meta.json" },
      { name: "orphan.meta.json" },
      { name: "notes.txt" },
    ]);
    mockReadTextFile.mockResolvedValue(JSON.stringify({
      trigger: "launch",
      createdAt: "2026-03-15T14:30:00.000Z",
      sizeBytes: 12,
      checksum: "abcd",
    }));

    const list = await adapter.listBackups();

    expect(list).toHaveLength(1);
    expect(mockRemove).not.toHaveBeenCalledWith("/safe/backups/notes.txt");
    expect(mockRemove).not.toHaveBeenCalledWith("/safe/backups/orphan.meta.json");
  });
});
