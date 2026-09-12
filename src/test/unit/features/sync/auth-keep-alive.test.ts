import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockKeepSessionAlive } = vi.hoisted(() => ({
  mockKeepSessionAlive: vi.fn(),
}));

vi.mock("../../../../features/sync/store", () => ({
  useSyncStore: {
    getState: () => ({ keepSessionAlive: mockKeepSessionAlive }),
  },
}));

const { installAuthKeepAlive } = await import("@/features/sync/auth-keep-alive");
const { AUTH_CHECK_INTERVAL_MS } = await import("@/features/sync/auth-policy");

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("installAuthKeepAlive()", () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    mockKeepSessionAlive.mockReset().mockResolvedValue("skipped");
    uninstall = installAuthKeepAlive();
  });

  afterEach(() => {
    uninstall();
    setVisibility("visible");
    vi.useRealTimers();
  });

  it("re-evaluates the session on every check interval", () => {
    vi.advanceTimersByTime(AUTH_CHECK_INTERVAL_MS - 1);
    expect(mockKeepSessionAlive).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockKeepSessionAlive).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AUTH_CHECK_INTERVAL_MS);
    expect(mockKeepSessionAlive).toHaveBeenCalledTimes(2);
  });

  it("checks when the network comes back (offline launch)", () => {
    window.dispatchEvent(new Event("online"));
    expect(mockKeepSessionAlive).toHaveBeenCalledTimes(1);
  });

  it("checks when the window regains focus", () => {
    window.dispatchEvent(new Event("focus"));
    expect(mockKeepSessionAlive).toHaveBeenCalledTimes(1);
  });

  it("checks when the app becomes visible, not when it hides", () => {
    setVisibility("hidden");
    expect(mockKeepSessionAlive).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(mockKeepSessionAlive).toHaveBeenCalledTimes(1);
  });

  it("installs once; a second install returns the same uninstaller", () => {
    expect(installAuthKeepAlive()).toBe(uninstall);

    window.dispatchEvent(new Event("online"));
    expect(mockKeepSessionAlive).toHaveBeenCalledTimes(1);
  });

  it("stops listening after uninstall", () => {
    uninstall();

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(AUTH_CHECK_INTERVAL_MS * 2);

    expect(mockKeepSessionAlive).not.toHaveBeenCalled();
  });
});
