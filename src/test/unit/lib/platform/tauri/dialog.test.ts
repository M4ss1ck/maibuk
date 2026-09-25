import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOpen = vi.hoisted(() => vi.fn());
const mockSave = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mockOpen,
  save: mockSave,
}));

const { tauriDialog } = await import("@/lib/platform/tauri/dialog");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tauriDialog.open()", () => {
  it("passes the starting directory to the folder picker", async () => {
    mockOpen.mockResolvedValue("/mnt/backups");

    await expect(
      tauriDialog.open({ directory: true, defaultPath: "/mnt/backups" })
    ).resolves.toBe("/mnt/backups");
    expect(mockOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: undefined,
      defaultPath: "/mnt/backups",
      filters: undefined,
    });
  });

  it("returns the first selection when multiple is set", async () => {
    mockOpen.mockResolvedValue(["/mnt/one.sql", "/mnt/two.sql"]);

    await expect(tauriDialog.open({ multiple: true })).resolves.toBe("/mnt/one.sql");
  });

  it("returns null when the picker is cancelled", async () => {
    mockOpen.mockResolvedValue(null);

    await expect(tauriDialog.open({ directory: true })).resolves.toBeNull();
  });
});
