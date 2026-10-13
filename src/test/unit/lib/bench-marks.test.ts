import { afterEach, describe, expect, it, vi } from "vitest";
import { benchMarksEnabled } from "@/lib/bench-marks";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("benchMarksEnabled()", () => {
  it("is on in development, whatever VITE_PLUGIN_BENCH says", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_PLUGIN_BENCH", undefined);
    expect(benchMarksEnabled()).toBe(true);

    vi.stubEnv("VITE_PLUGIN_BENCH", "0");
    expect(benchMarksEnabled()).toBe(true);
  });

  it("is on in a production build made with VITE_PLUGIN_BENCH=1", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PLUGIN_BENCH", "1");
    expect(benchMarksEnabled()).toBe(true);
  });

  it("is off in a shipped production build with no bench flag", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PLUGIN_BENCH", undefined);
    expect(benchMarksEnabled()).toBe(false);

    // Only exactly "1" turns it on; any other value stays off.
    vi.stubEnv("VITE_PLUGIN_BENCH", "true");
    expect(benchMarksEnabled()).toBe(false);
  });
});
