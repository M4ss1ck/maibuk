import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLUGIN_BLAME_WINDOW_MS } from "@/features/plugins/crash-containment";
import { runConformance } from "@/features/plugins/conformance/run";
import type { ConformanceLaunchPlan } from "@/features/plugins/conformance/types";

const ENGINE = { name: "android-webview", version: "v1", userAgent: "UA" };

const mocks = vi.hoisted(() => ({
  reporter: {
    launch: vi.fn(),
    progress: vi.fn(),
    result: vi.fn(),
    done: vi.fn(),
    heartbeat: vi.fn(),
    leaks: vi.fn(),
  },
  createRuntimeSeam: vi.fn(),
  runConformanceChecks: vi.fn(),
  getPluginLifecycle: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@/features/plugins/conformance/reporter", () => ({
  createReporter: () => mocks.reporter,
}));
vi.mock("@/features/plugins/conformance/seam", () => ({
  createRuntimeSeam: mocks.createRuntimeSeam,
  readPlatform: () => "android",
  readEngine: () => ENGINE,
}));
vi.mock("@/features/plugins/conformance/checks", () => ({
  runConformanceChecks: mocks.runConformanceChecks,
}));
vi.mock("@/features/plugins/lifecycle-instance", () => ({
  getPluginLifecycle: mocks.getPluginLifecycle,
}));
vi.mock("@/features/plugins/approvals", () => ({
  listPluginApprovals: () => [{ pluginId: "fixture-hostile", enabled: false }],
}));
vi.mock("@/components/ui/Toast", () => ({
  currentToastMessages: () => ["Maibuk ran out of memory and restarted."],
}));

function launchWith(plan: ConformanceLaunchPlan): void {
  mocks.reporter.launch.mockResolvedValue(plan);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.getPluginLifecycle.mockReturnValue({});
  mocks.createRuntimeSeam.mockResolvedValue({ engine: ENGINE, dispose: mocks.dispose });
  mocks.runConformanceChecks.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runConformance", () => {
  it("posts the launch report with the Plugins and notices the app launched with", async () => {
    launchWith("all");

    await runConformance();

    expect(mocks.reporter.launch).toHaveBeenCalledWith({
      plugins: [{ id: "fixture-hostile", enabled: false }],
      notices: ["Maibuk ran out of memory and restarted."],
    });
  });

  it("on a launch-only plan posts done without building the seam or running a check", async () => {
    launchWith("launch-only");

    const result = await runConformance();

    expect(mocks.createRuntimeSeam).not.toHaveBeenCalled();
    expect(mocks.runConformanceChecks).not.toHaveBeenCalled();
    expect(mocks.reporter.result).not.toHaveBeenCalled();
    expect(mocks.reporter.done).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ engine: ENGINE, checks: [] });
  });

  it.each([
    "all",
    "no-t8",
  ] as const)("on a %s plan runs the checks under that plan at once, then posts result and done", async (plan) => {
    launchWith(plan);

    await runConformance();

    expect(mocks.runConformanceChecks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      {
        plan,
      }
    );
    expect(mocks.reporter.result).toHaveBeenCalledWith({ engine: ENGINE, checks: [] });
    expect(mocks.reporter.done).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("on a t8-only plan runs T8 only after the blame window has passed", async () => {
    launchWith("t8-only");

    const run = runConformance();
    await vi.advanceTimersByTimeAsync(PLUGIN_BLAME_WINDOW_MS);
    expect(mocks.runConformanceChecks).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await run;
    expect(mocks.runConformanceChecks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      {
        plan: "t8-only",
      }
    );
  });

  it("waits for the app's Plugin lifecycle before posting the launch report", async () => {
    mocks.getPluginLifecycle.mockReturnValue(null);
    launchWith("launch-only");

    const run = runConformance();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.reporter.launch).not.toHaveBeenCalled();

    mocks.getPluginLifecycle.mockReturnValue({});
    await vi.advanceTimersByTimeAsync(100);
    await run;
    expect(mocks.reporter.launch).toHaveBeenCalledTimes(1);
  });

  it("posts the launch report anyway when the lifecycle never installs", async () => {
    mocks.getPluginLifecycle.mockReturnValue(null);
    launchWith("launch-only");

    const run = runConformance();
    await vi.runAllTimersAsync();
    await run;
    expect(mocks.reporter.launch).toHaveBeenCalledTimes(1);
  });
});
