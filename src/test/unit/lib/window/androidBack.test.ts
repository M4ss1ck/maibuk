import { beforeEach, describe, expect, it, vi } from "vitest";
import androidCapability from "../../../../../src-tauri/capabilities/android.json";

type BackHandler = (payload: { canGoBack: boolean }) => void | Promise<void>;

const { eventState, mockExit, mockInvoke, mockOnBackButtonPress, mockRunTopBackDismiss, platformState } =
  vi.hoisted(() => ({
    eventState: { handler: null as BackHandler | null },
    mockExit: vi.fn().mockResolvedValue(undefined),
    mockInvoke: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

vi.mock("@tauri-apps/plugin-process", () => ({ exit: mockExit }));

describe("installAndroidBackHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    eventState.handler = null;
    platformState.isAndroid = true;
    mockExit.mockClear();
    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue(undefined);
    mockRunTopBackDismiss.mockReset();
    mockOnBackButtonPress.mockReset();
    mockOnBackButtonPress.mockImplementation(async (handler: BackHandler) => {
      eventState.handler = handler;
      return { unregister: vi.fn().mockResolvedValue(undefined) };
    });
    window.history.replaceState({}, "", "/");
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
    expect(mockInvoke).toHaveBeenCalledWith("exit_app");
  });

  it("navigates up from a notes child when history is skippable", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();
    const { registerBackUpNavigator } = await import("@/lib/window/androidBack");
    const navigateTo = vi.fn();
    registerBackUpNavigator(navigateTo);
    window.history.replaceState({}, "", "/notes/abc");

    await getHandler()({ canGoBack: false });

    expect(navigateTo).toHaveBeenCalledWith("/notes");
    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("navigates up from a cover route when history is skippable", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();
    const { registerBackUpNavigator } = await import("@/lib/window/androidBack");
    const navigateTo = vi.fn();
    registerBackUpNavigator(navigateTo);
    window.history.replaceState({}, "", "/book/b1/cover");

    await getHandler()({ canGoBack: false });

    expect(navigateTo).toHaveBeenCalledWith("/book/b1");
    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("navigates up from a book route to the home route", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();
    const { registerBackUpNavigator } = await import("@/lib/window/androidBack");
    const navigateTo = vi.fn();
    registerBackUpNavigator(navigateTo);
    window.history.replaceState({}, "", "/book/b1");

    await getHandler()({ canGoBack: false });

    expect(navigateTo).toHaveBeenCalledWith("/");
    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits on a root route with no parent", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();
    const { registerBackUpNavigator } = await import("@/lib/window/androidBack");
    const navigateTo = vi.fn();
    registerBackUpNavigator(navigateTo);
    window.history.replaceState({}, "", "/settings");

    await getHandler()({ canGoBack: false });

    expect(navigateTo).not.toHaveBeenCalled();
    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("exit_app");
  });

  it("exits on a deep route when no up-navigator is registered", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();
    window.history.replaceState({}, "", "/notes/abc");

    await getHandler()({ canGoBack: false });

    expect(window.history.back).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("exit_app");
  });

  it("falls back to process exit when the exit command fails", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    mockInvoke.mockRejectedValueOnce(new Error("invoke failed"));
    await installFresh();

    await getHandler()({ canGoBack: false });

    expect(mockInvoke).toHaveBeenCalledWith("exit_app");
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("short-circuits everything when the top dismisser handles Back", async () => {
    mockRunTopBackDismiss.mockReturnValue(true);
    await installFresh();
    const { registerBackUpNavigator } = await import("@/lib/window/androidBack");
    const navigateTo = vi.fn();
    registerBackUpNavigator(navigateTo);
    window.history.replaceState({}, "", "/notes/abc");

    await getHandler()({ canGoBack: false });

    expect(window.history.back).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("only clears its own navigator on cleanup", async () => {
    mockRunTopBackDismiss.mockReturnValue(false);
    await installFresh();
    const { registerBackUpNavigator } = await import("@/lib/window/androidBack");
    const first = vi.fn();
    const second = vi.fn();
    const cleanupFirst = registerBackUpNavigator(first);
    registerBackUpNavigator(second);
    cleanupFirst();
    window.history.replaceState({}, "", "/notes/abc");

    await getHandler()({ canGoBack: false });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("/notes");
    expect(mockExit).not.toHaveBeenCalled();
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

describe("parentRouteOf", () => {
  async function loadParentRouteOf(): Promise<(path: string) => string | null> {
    const { parentRouteOf } = await import("@/lib/window/androidBack");
    return parentRouteOf;
  }

  it("maps a cover route to its book", async () => {
    expect((await loadParentRouteOf())("/book/b1/cover")).toBe("/book/b1");
  });

  it("maps a book route to home", async () => {
    expect((await loadParentRouteOf())("/book/b1")).toBe("/");
  });

  it("maps notes and canvas children to their galleries", async () => {
    const parentRouteOf = await loadParentRouteOf();
    expect(parentRouteOf("/notes/abc")).toBe("/notes");
    expect(parentRouteOf("/canvas/abc")).toBe("/canvas");
  });

  it("returns null for root routes", async () => {
    const parentRouteOf = await loadParentRouteOf();
    expect(parentRouteOf("/")).toBeNull();
    expect(parentRouteOf("/notes")).toBeNull();
    expect(parentRouteOf("/settings")).toBeNull();
  });
});

describe("Android capability", () => {
  it("allows process exit for root Back handling", () => {
    expect(androidCapability.permissions).toContain("process:allow-exit");
  });
});
