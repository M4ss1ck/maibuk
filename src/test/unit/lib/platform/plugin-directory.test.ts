import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

async function loadPlatform(buildTarget: "web" | "tauri") {
  vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
  vi.resetModules();
  return import("@/lib/platform");
}

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("getPluginDirectory()", () => {
  it("reads the web Plugin Directory from OPFS without any Rust command", async () => {
    const { getPluginDirectory } = await loadPlatform("web");
    const directory = await getPluginDirectory();

    await expect(directory.listFolders()).resolves.toEqual([]);
    await expect(directory.readFolder("tracer")).resolves.toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("reads the desktop and Android Plugin Directory through the Rust commands", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "list_plugin_folders") return ["tracer"];
      return {
        name: "tracer",
        hash: "h1:P6TsEygkciGHh0nUfbDHf4TRJail2OmZxMAlJyOCSCk=",
        files: [{ path: "manifest.json", bytes: btoa("{}") }],
      };
    });
    const { getPluginDirectory } = await loadPlatform("tauri");
    const directory = await getPluginDirectory();

    await expect(directory.listFolders()).resolves.toEqual(["tracer"]);
    const folder = await directory.readFolder("tracer");
    expect(folder?.hash).toBe("h1:P6TsEygkciGHh0nUfbDHf4TRJail2OmZxMAlJyOCSCk=");
    expect(mockInvoke).toHaveBeenCalledWith("read_plugin_folder", { name: "tracer" });
  });
});
