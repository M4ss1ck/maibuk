import { afterEach, describe, expect, it, vi } from "vitest";

async function loadFlags(buildTarget: "web" | "tauri", platform?: string) {
  vi.stubEnv("VITE_BUILD_TARGET", buildTarget);
  if (platform) vi.stubEnv("TAURI_ENV_PLATFORM", platform);
  else vi.stubEnv("TAURI_ENV_PLATFORM", "");
  vi.resetModules();
  return import("@/lib/platform");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("platform constants", () => {
  it("identifies web without treating it as desktop", async () => {
    const flags = await loadFlags("web", "android");
    expect(flags).toMatchObject({
      IS_WEB: true,
      IS_TAURI: false,
      IS_ANDROID: false,
      IS_MOBILE: false,
      IS_DESKTOP: false,
    });
  });

  it("identifies Android Tauri as mobile", async () => {
    const flags = await loadFlags("tauri", "android");
    expect(flags).toMatchObject({
      IS_WEB: false,
      IS_TAURI: true,
      IS_ANDROID: true,
      IS_MOBILE: true,
      IS_DESKTOP: false,
    });
  });

  it("identifies desktop Tauri", async () => {
    const flags = await loadFlags("tauri", "linux");
    expect(flags.IS_DESKTOP).toBe(true);
    expect(flags.IS_MOBILE).toBe(false);
  });

  it("defaults a platform-less Tauri build to desktop", async () => {
    const flags = await loadFlags("tauri");
    expect(flags.IS_DESKTOP).toBe(true);
  });
});
