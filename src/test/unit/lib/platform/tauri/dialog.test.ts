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
  it("returns the first selection when multiple is set", async () => {
    mockOpen.mockResolvedValue(["/mnt/one.sql", "/mnt/two.sql"]);

    await expect(tauriDialog.open({ multiple: true })).resolves.toBe("/mnt/one.sql");
  });

  it("returns null when the picker is cancelled", async () => {
    mockOpen.mockResolvedValue(null);

    await expect(tauriDialog.open({ directory: true })).resolves.toBeNull();
  });
});

describe("tauriDialog.openMany()", () => {
  it("returns every selected path", async () => {
    mockOpen.mockResolvedValue(["/mnt/one.md", "/mnt/two.txt"]);

    await expect(tauriDialog.openMany({ filters: [] })).resolves.toEqual([
      "/mnt/one.md",
      "/mnt/two.txt",
    ]);
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ multiple: true }));
  });

  it("wraps a single path and returns [] when cancelled", async () => {
    mockOpen.mockResolvedValueOnce("/mnt/one.md").mockResolvedValueOnce(null);

    await expect(tauriDialog.openMany({})).resolves.toEqual(["/mnt/one.md"]);
    await expect(tauriDialog.openMany({})).resolves.toEqual([]);
  });
});
