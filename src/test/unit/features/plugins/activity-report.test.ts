import { describe, expect, it, vi } from "vitest";
import {
  PLUGIN_ACTIVITY_THROTTLE_MS,
  createPluginActivityReporter,
} from "@/features/plugins/activity-report";

describe("Plugin activity reporter (#926)", () => {
  it("reports the id, version, and time through the bridge", () => {
    const report = vi.fn();
    const reporter = createPluginActivityReporter({
      bridge: () => ({ report }),
      now: () => 5_000,
    });

    reporter("alpha", "1.2.3");

    expect(report).toHaveBeenCalledExactlyOnceWith("alpha", "1.2.3", 5_000);
  });

  it("throttles one Plugin within the window and reports again at the boundary", () => {
    let now = 1_000;
    const report = vi.fn();
    const reporter = createPluginActivityReporter({ bridge: () => ({ report }), now: () => now });

    reporter("alpha", "1.0.0");
    expect(report).toHaveBeenCalledTimes(1);

    now = 1_000 + PLUGIN_ACTIVITY_THROTTLE_MS - 1;
    reporter("alpha", "1.0.0");
    expect(report).toHaveBeenCalledTimes(1);

    now = 1_000 + PLUGIN_ACTIVITY_THROTTLE_MS;
    reporter("alpha", "1.0.0");
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith("alpha", "1.0.0", now);
  });

  it("does not throttle a second Plugin behind the first", () => {
    const report = vi.fn();
    const reporter = createPluginActivityReporter({ bridge: () => ({ report }), now: () => 1_000 });

    reporter("alpha", "1.0.0");
    reporter("beta", "1.0.0");

    expect(report).toHaveBeenNthCalledWith(1, "alpha", "1.0.0", 1_000);
    expect(report).toHaveBeenNthCalledWith(2, "beta", "1.0.0", 1_000);
  });

  it("sends nothing and never throws without a bridge", () => {
    const reporter = createPluginActivityReporter({ bridge: () => undefined, now: () => 1_000 });

    expect(() => reporter("alpha", "1.0.0")).not.toThrow();
  });

  it("swallows a bridge that throws", () => {
    const report = vi.fn(() => {
      throw new Error("bridge exploded");
    });
    const reporter = createPluginActivityReporter({ bridge: () => ({ report }), now: () => 1_000 });

    expect(() => reporter("alpha", "1.0.0")).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
  });
});
