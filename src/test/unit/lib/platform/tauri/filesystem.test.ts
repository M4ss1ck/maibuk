import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadTextFile = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());
const mockAppDataDir = vi.hoisted(() => vi.fn());
const mockJoin = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mockReadTextFile,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  BaseDirectory: { AppConfig: 14, AppData: 15 },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: mockAppDataDir,
  join: mockJoin,
}));

const { tauriFileSystem } = await import("@/lib/platform/tauri/filesystem");

beforeEach(() => {
  vi.clearAllMocks();
  mockAppDataDir.mockResolvedValue("/home/author/data");
  mockJoin.mockImplementation(async (...parts: string[]) => parts.join("/"));
});

describe("tauriFileSystem.readAppConfigTextFile", () => {
  it("reads the app config dir first, the location the product's fs scope permits", async () => {
    mockReadTextFile.mockResolvedValueOnce('{"mode":"launch"}');
    await expect(tauriFileSystem.readAppConfigTextFile("seed.json")).resolves.toBe(
      '{"mode":"launch"}'
    );
    expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    expect(mockReadTextFile).toHaveBeenCalledWith("seed.json", { baseDir: 14 });
    // The app data dir is never touched once the config dir answered.
    expect(mockAppDataDir).not.toHaveBeenCalled();
  });

  it("falls back to the app data dir, then the AppData base dir", async () => {
    mockReadTextFile
      .mockRejectedValueOnce(new Error("no such file"))
      .mockResolvedValueOnce('{"mode":"launch"}');
    await expect(tauriFileSystem.readAppConfigTextFile("seed.json")).resolves.toBe(
      '{"mode":"launch"}'
    );
    expect(mockReadTextFile).toHaveBeenNthCalledWith(2, "/home/author/data/seed.json");

    mockReadTextFile.mockReset();
    mockReadTextFile
      .mockRejectedValueOnce(new Error("no such file"))
      .mockRejectedValueOnce(new Error("no such file"))
      .mockResolvedValueOnce('{"mode":"launch"}');
    await expect(tauriFileSystem.readAppConfigTextFile("seed.json")).resolves.toBe(
      '{"mode":"launch"}'
    );
    expect(mockReadTextFile).toHaveBeenNthCalledWith(3, "seed.json", { baseDir: 15 });
  });

  it("returns null when the file is missing at every location", async () => {
    mockReadTextFile.mockRejectedValue(new Error("no such file"));
    await expect(tauriFileSystem.readAppConfigTextFile("seed.json")).resolves.toBeNull();
    expect(mockReadTextFile).toHaveBeenCalledTimes(3);
  });
});
