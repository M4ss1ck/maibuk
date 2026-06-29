import { describe, it, expect, vi, beforeEach } from "vitest";

const mockHide = vi.fn().mockResolvedValue(undefined);
const mockExit = vi.fn().mockResolvedValue(undefined);
let captured: ((e: { preventDefault: () => void }) => Promise<void>) | null = null;

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide: mockHide,
    onCloseRequested: vi.fn(async (cb: (e: { preventDefault: () => void }) => Promise<void>) => {
      captured = cb;
      return () => {};
    }),
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({ exit: mockExit }));

vi.mock("../../../../lib/metrics/MetricsService", () => ({
  metricsService: {
    endSession: vi.fn(),
    flushNow: vi.fn().mockResolvedValue(undefined),
  },
}));

const closeToTrayRef = { value: false };
vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: { getState: () => ({ closeToTray: closeToTrayRef.value }) },
}));

describe("installWindowCloseHandler", () => {
  beforeEach(() => {
    mockHide.mockClear();
    mockExit.mockClear();
    captured = null;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    // Reset the module-level install guard so each test installs fresh.
    vi.resetModules();
  });

  async function installFresh(): Promise<void> {
    const { installWindowCloseHandler } = await import("@/lib/window/closeHandler");
    await installWindowCloseHandler();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("hides to tray when closeToTray is on", async () => {
    closeToTrayRef.value = true;
    await installFresh();

    expect(captured).not.toBeNull();
    await captured!({ preventDefault: vi.fn() });

    expect(mockHide).toHaveBeenCalledOnce();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits the process when closeToTray is off", async () => {
    closeToTrayRef.value = false;
    await installFresh();

    expect(captured).not.toBeNull();
    await captured!({ preventDefault: vi.fn() });

    expect(mockExit).toHaveBeenCalledWith(0);
    expect(mockHide).not.toHaveBeenCalled();
  });
});
