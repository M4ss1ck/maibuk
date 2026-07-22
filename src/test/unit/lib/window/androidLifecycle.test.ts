import { afterEach, describe, expect, it, vi } from "vitest";

const { endSession, flushNow, runBackgroundBackup } = vi.hoisted(() => ({
  endSession: vi.fn(),
  flushNow: vi.fn(async () => {}),
  runBackgroundBackup: vi.fn(async () => {}),
}));

vi.mock("@/lib/metrics/MetricsService", () => ({
  metricsService: { endSession, flushNow },
}));
vi.mock("@/features/backup/lifecycle", () => ({
  runBackgroundBackup,
}));

import {
  handleBackground,
  resetAndroidLifecycleForTests,
} from "@/lib/window/androidLifecycle";

afterEach(() => {
  vi.clearAllMocks();
  resetAndroidLifecycleForTests();
});

describe("android background lifecycle", () => {
  it("flushes metrics and runs a backup when backgrounded", async () => {
    await handleBackground(1000);
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(flushNow).toHaveBeenCalledTimes(1);
    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);
  });

  it("throttles repeated backgrounding within the interval", async () => {
    await handleBackground(1000);
    await handleBackground(1000 + 500);
    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);
    expect(flushNow).toHaveBeenCalledTimes(1);
  });

  it("allows a new backup after the throttle interval elapses", async () => {
    await handleBackground(1000);
    await handleBackground(1000 + 31_000);
    expect(runBackgroundBackup).toHaveBeenCalledTimes(2);
  });
});
