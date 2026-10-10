import { afterEach, describe, expect, it, vi } from "vitest";

async function loadPlatform(buildTarget: "web" | "tauri") {
  vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
  vi.resetModules();
  return import("@/lib/platform");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getPluginDirectory()", () => {
  it("reports an empty Plugin Directory on the web build without OPFS", async () => {
    const { getPluginDirectory } = await loadPlatform("web");
    const directory = await getPluginDirectory();
    await expect(directory.listFolders()).resolves.toEqual([]);
    await expect(directory.readFolder("tracer")).resolves.toBeNull();
  });

  it("reports an empty Plugin Directory on Tauri until the Rust adapter lands (#435)", async () => {
    const { getPluginDirectory } = await loadPlatform("tauri");
    const directory = await getPluginDirectory();
    await expect(directory.listFolders()).resolves.toEqual([]);
    await expect(directory.readFolder("tracer")).resolves.toBeNull();
  });
});
