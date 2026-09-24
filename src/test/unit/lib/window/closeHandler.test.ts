import { describe, it, expect, vi, beforeEach } from "vitest";

const mockHide = vi.fn().mockResolvedValue(undefined);
const mockExit = vi.fn().mockResolvedValue(undefined);
let captured: ((e: { preventDefault: () => void }) => Promise<void>) | null = null;

const { platformState } = vi.hoisted(() => ({ platformState: { isDesktop: true } }));

vi.mock("@/lib/platform", () => ({
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
}));

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

const { flushNow } = vi.hoisted(() => ({ flushNow: vi.fn() }));
vi.mock("../../../../lib/metrics/MetricsService", () => ({
  metricsService: {
    endSession: vi.fn(),
    flushNow,
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
    flushNow.mockReset().mockResolvedValue(undefined);
    captured = null;
    platformState.isDesktop = true;
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

  it("does not install on Android", async () => {
    platformState.isDesktop = false;
    await installFresh();
    expect(captured).toBeNull();
  });

  it("switches back to the author's Library before the close-time metrics flush", async () => {
    closeToTrayRef.value = false;
    await installFresh();
    const librarySwitch = await import("@/features/tutorial/library-switch");
    librarySwitch.activateTutorialDatabase({} as never);
    let activeDuringFlush: boolean | null = null;
    flushNow.mockImplementation(async () => {
      activeDuringFlush = librarySwitch.isTutorialLibraryActive();
    });

    await captured!({ preventDefault: vi.fn() });

    expect(activeDuringFlush).toBe(false);
    expect(librarySwitch.isTutorialLibraryActive()).toBe(false);
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
