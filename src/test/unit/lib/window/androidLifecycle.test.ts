import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { endSession, flushNow, platformState, runBackgroundBackup } = vi.hoisted(() => ({
  endSession: vi.fn(),
  flushNow: vi.fn(async () => {}),
  platformState: { isAndroid: true },
  runBackgroundBackup: vi.fn(async () => {}),
}));

vi.mock("@/lib/platform", () => ({
  get IS_ANDROID() {
    return platformState.isAndroid;
  },
}));
vi.mock("@/lib/metrics/MetricsService", () => ({
  metricsService: { endSession, flushNow },
}));
vi.mock("@/features/backup/lifecycle", () => ({
  runBackgroundBackup,
}));

import {
  handleBackground,
  installAndroidLifecycleHandler,
  resetAndroidLifecycleForTests,
} from "@/lib/window/androidLifecycle";

function setVisibilityState(value: DocumentVisibilityState): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
  return () => {
    if (descriptor) Object.defineProperty(document, "visibilityState", descriptor);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  platformState.isAndroid = true;
  flushNow.mockResolvedValue(undefined);
  runBackgroundBackup.mockResolvedValue(undefined);
});

afterEach(() => {
  resetAndroidLifecycleForTests();
  vi.useRealTimers();
});

describe("android background lifecycle", () => {
  it("ends and flushes metrics once before running a backup", async () => {
    await handleBackground(1000);

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(flushNow).toHaveBeenCalledTimes(1);
    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);
    expect(endSession.mock.invocationCallOrder[0]).toBeLessThan(
      flushNow.mock.invocationCallOrder[0]
    );
    expect(flushNow.mock.invocationCallOrder[0]).toBeLessThan(
      runBackgroundBackup.mock.invocationCallOrder[0]
    );
  });

  it("throttles repeated backgrounding within the interval", async () => {
    await handleBackground(1000);
    await handleBackground(1500);

    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);
    expect(flushNow).toHaveBeenCalledTimes(1);
  });

  it("allows new work after the throttle interval elapses", async () => {
    await handleBackground(1000);
    await handleBackground(32_000);

    expect(runBackgroundBackup).toHaveBeenCalledTimes(2);
  });

  it("runs the backup after the metrics flush times out", async () => {
    vi.useFakeTimers();
    let rejectFlush!: (error: Error) => void;
    flushNow.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFlush = reject;
        })
    );

    const background = handleBackground(1000);
    expect(runBackgroundBackup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(199);
    expect(runBackgroundBackup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await background;

    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);
    rejectFlush(new Error("late flush failure"));
    await Promise.resolve();
  });

  it("runs the backup and resolves when the metrics flush rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    flushNow.mockRejectedValueOnce(new Error("flush failed"));

    await expect(handleBackground(1000)).resolves.toBeUndefined();

    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Failed to flush background metrics:", expect.any(Error));
    warn.mockRestore();
  });

  it("coalesces concurrent calls even after the throttle interval", async () => {
    let resolveFlush!: () => void;
    flushNow.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        })
    );

    const first = handleBackground(1000);
    const overlapping = handleBackground(32_000);
    await Promise.resolve();
    expect(flushNow).toHaveBeenCalledTimes(1);
    expect(runBackgroundBackup).not.toHaveBeenCalled();

    resolveFlush();
    await Promise.all([first, overlapping]);
    expect(runBackgroundBackup).toHaveBeenCalledTimes(1);

    flushNow.mockResolvedValue(undefined);
    await handleBackground(32_000);
    expect(runBackgroundBackup).toHaveBeenCalledTimes(2);
  });

  it("does not install a visibility listener outside Android", async () => {
    platformState.isAndroid = false;
    const addEventListener = vi.spyOn(document, "addEventListener");

    await installAndroidLifecycleHandler();

    expect(addEventListener).not.toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    addEventListener.mockRestore();
  });

  it("handles hidden events only and installs idempotently", async () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const restoreVisible = setVisibilityState("visible");
    await installAndroidLifecycleHandler();
    await installAndroidLifecycleHandler();

    expect(addEventListener).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(endSession).not.toHaveBeenCalled();

    restoreVisible();
    const restoreHidden = setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(runBackgroundBackup).toHaveBeenCalledTimes(1));

    restoreHidden();
    addEventListener.mockRestore();
  });

  it("removes the old listener on reset and installs one clean replacement", async () => {
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const restoreHidden = setVisibilityState("hidden");
    await installAndroidLifecycleHandler();
    resetAndroidLifecycleForTests();

    expect(removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(endSession).not.toHaveBeenCalled();

    await installAndroidLifecycleHandler();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(runBackgroundBackup).toHaveBeenCalledTimes(1));

    restoreHidden();
    removeEventListener.mockRestore();
  });
});
