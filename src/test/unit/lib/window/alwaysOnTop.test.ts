import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetAlwaysOnTop = vi.fn().mockResolvedValue(undefined);
let captured: ((e: { payload: boolean }) => void) | null = null;

const { platformState } = vi.hoisted(() => ({ platformState: { isDesktop: true } }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: vi.fn(async (cb: (e: { payload: boolean }) => void) => {
      captured = cb;
      return () => {};
    }),
  }),
}));

vi.mock("../../../../lib/platform", () => ({
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  setWindowAlwaysOnTop: mockSetAlwaysOnTop,
}));

const alwaysOnTopRef = { value: true };
vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: { getState: () => ({ alwaysOnTop: alwaysOnTopRef.value }) },
}));

describe("installAlwaysOnTopReapply", () => {
  beforeEach(() => {
    mockSetAlwaysOnTop.mockClear();
    captured = null;
    platformState.isDesktop = true;
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    // Reset the module-level install guard so each test installs fresh.
    vi.resetModules();
  });

  async function installFresh(): Promise<void> {
    const { installAlwaysOnTopReapply } = await import("@/lib/window/alwaysOnTop");
    await installAlwaysOnTopReapply();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("re-applies always-on-top when the window regains focus", async () => {
    alwaysOnTopRef.value = true;
    await installFresh();

    expect(captured).not.toBeNull();
    captured!({ payload: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("does nothing when always-on-top is disabled", async () => {
    alwaysOnTopRef.value = false;
    await installFresh();

    captured!({ payload: true });
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("does nothing when the window loses focus", async () => {
    alwaysOnTopRef.value = true;
    await installFresh();

    captured!({ payload: false });
    await new Promise((r) => setTimeout(r, 0));

    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("does not install on Android", async () => {
    platformState.isDesktop = false;
    await installFresh();
    expect(captured).toBeNull();
  });
});
