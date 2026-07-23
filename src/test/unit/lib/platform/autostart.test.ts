import { describe, it, expect, vi, beforeEach } from "vitest";

const enable = vi.fn().mockResolvedValue(undefined);
const disable = vi.fn().mockResolvedValue(undefined);
const isEnabled = vi.fn().mockResolvedValue(true);

vi.mock("@tauri-apps/plugin-autostart", () => ({ enable, disable, isEnabled }));

describe("launch-on-startup platform helpers", () => {
  beforeEach(() => {
    enable.mockClear();
    disable.mockClear();
    isEnabled.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.stubEnv("VITE_BUILD_TARGET", "tauri");
    vi.stubEnv("TAURI_ENV_PLATFORM", "linux");
    vi.resetModules();
  });

  it("enables autostart when true", async () => {
    const { setLaunchOnStartup } = await import("@/lib/platform");
    await setLaunchOnStartup(true);
    expect(enable).toHaveBeenCalledOnce();
    expect(disable).not.toHaveBeenCalled();
  });

  it("disables autostart when false", async () => {
    const { setLaunchOnStartup } = await import("@/lib/platform");
    await setLaunchOnStartup(false);
    expect(disable).toHaveBeenCalledOnce();
  });

  it("reads the current OS state", async () => {
    const { isLaunchOnStartupEnabled } = await import("@/lib/platform");
    await expect(isLaunchOnStartupEnabled()).resolves.toBe(true);
  });

  it("does not load or change autostart on Android", async () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "android");
    vi.resetModules();
    const { setLaunchOnStartup, isLaunchOnStartupEnabled } = await import("@/lib/platform");

    await setLaunchOnStartup(true);
    await expect(isLaunchOnStartupEnabled()).resolves.toBe(false);

    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
