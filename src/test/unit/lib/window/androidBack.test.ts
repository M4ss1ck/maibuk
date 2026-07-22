import { beforeEach, describe, expect, it, vi } from "vitest";
import androidCapability from "../../../../../src-tauri/capabilities/android.json";

type BackHandler = (payload: { canGoBack: boolean }) => void | Promise<void>;

const { eventState, mockExit, mockOnBackButtonPress, mockRunTopBackDismiss, platformState } =
  vi.hoisted(() => ({
    eventState: { handler: null as BackHandler | null },
    mockExit: vi.fn().mockResolvedValue(undefined),
    mockOnBackButtonPress: vi.fn(),
    mockRunTopBackDismiss: vi.fn(),
    platformState: { isAndroid: true },
  }));

vi.mock("@/lib/platform", () => ({
  get IS_ANDROID() {
    return platformState.isAndroid;
  },
}));

vi.mock("@/lib/platform/backDismiss", () => ({
  runTopBackDismiss: mockRunTopBackDismiss,
}));

vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: mockOnBackButtonPress,
}));

vi.mock("@tauri-apps/plugin-process", () => ({ exit: mockExit }));

describe("installAndroidBackHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    eventState.handler = null;
    platformState.isAndroid = true;
    mockExit.mockClear();
    mockRunTopBackDismiss.mockReset();
    mockOnBackButtonPress.mockReset();
    mockOnBackButtonPress.mockImplementation(async (handler: BackHandler) => {
      eventState.handler = handler;
      return { unregister: vi.fn().mockResolvedValue(undefined) };
    });
    vi.spyOn(window.history, "back").mockImplementation(() => {});
  });

  async function installFresh(): Promise<void> {
    const { installAndroidBackHandler } = await import("@/lib/window/androidBack");
    await installAndroidBackHandler();
  }

  function getHandler(): BackHandler {
    if (!eventState.handler) throw new Error("Back handler was not installed");
    return eventState.handler;
  }

  it("stops after the top dismisser handles Back", async () => {
    mockRunTopBackDismiss.mockReturnValue(true);
    await installFresh();

    await getHandler()({ canGoBack: true });

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("navigates back when the native payload reports history", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();

    await getHandler()({ canGoBack: true });

    expect(window.history.back).toHaveBeenCalledOnce();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits at the root surface", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();

    await getHandler()({ canGoBack: false });

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("registers only once when installation is requested concurrently", async () => {
    let resolveListener: ((listener: { unregister: () => Promise<void> }) => void) | undefined;
    mockOnBackButtonPress.mockImplementationOnce((handler: BackHandler) => {
      eventState.handler = handler;
      return new Promise((resolve) => {
        resolveListener = resolve;
      });
    });
    const { installAndroidBackHandler } = await import("@/lib/window/androidBack");

    const first = installAndroidBackHandler();
    const second = installAndroidBackHandler();
    await vi.waitFor(() => expect(mockOnBackButtonPress).toHaveBeenCalledTimes(1));
    resolveListener?.({ unregister: vi.fn().mockResolvedValue(undefined) });
    await Promise.all([first, second]);

    expect(mockOnBackButtonPress).toHaveBeenCalledTimes(1);
  });

  it("allows installation to retry after setup fails", async () => {
    mockOnBackButtonPress.mockRejectedValueOnce(new Error("setup failed"));
    const { installAndroidBackHandler } = await import("@/lib/window/androidBack");

    await installAndroidBackHandler();
    await installAndroidBackHandler();

    expect(mockOnBackButtonPress).toHaveBeenCalledTimes(2);
  });
});

describe("Android capability", () => {
  it("allows process exit for root Back handling", () => {
    expect(androidCapability.permissions).toContain("process:allow-exit");
  });
});
