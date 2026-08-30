import { describe, expect, it, vi, beforeEach } from "vitest";

const platformState = vi.hoisted(() => ({ isTauri: true, isDesktop: false }));
const tauriMocks = vi.hoisted(() => ({
  onOpenUrl: vi.fn(),
  getCurrent: vi.fn(async () => null as string[] | null),
  show: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
  unminimize: vi.fn(async () => {}),
}));

vi.mock("@/lib/platform", () => ({
  get IS_TAURI() {
    return platformState.isTauri;
  },
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  get IS_WEB() {
    return !platformState.isTauri;
  },
  get IS_ANDROID() {
    return false;
  },
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  get onOpenUrl() {
    return tauriMocks.onOpenUrl;
  },
  get getCurrent() {
    return tauriMocks.getCurrent;
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: tauriMocks.show,
    setFocus: tauriMocks.setFocus,
    unminimize: tauriMocks.unminimize,
  }),
}));

describe("deep-link bridge", () => {
  beforeEach(async () => {
    vi.resetModules();
    platformState.isTauri = true;
    platformState.isDesktop = false;
    tauriMocks.onOpenUrl.mockReset().mockImplementation(async () => async () => {});
    tauriMocks.getCurrent.mockReset().mockResolvedValue(null);
    tauriMocks.show.mockReset().mockResolvedValue(undefined);
    tauriMocks.setFocus.mockReset().mockResolvedValue(undefined);
    tauriMocks.unminimize.mockReset().mockResolvedValue(undefined);
  });

  it("web no-op: getDeepLinkBootstrap returns null", async () => {
    platformState.isTauri = false;
    vi.resetModules();
    const { getDeepLinkBootstrap } = await import("@/features/deep-link/bridge");
    await expect(getDeepLinkBootstrap()).resolves.toBeNull();
  });

  it("install is StrictMode-safe single installer", async () => {
    const { installDeepLinkBridge } = await import("@/features/deep-link/bridge");
    const h = vi.fn(async () => {});
    await installDeepLinkBridge(h);
    await installDeepLinkBridge(h);
    expect(tauriMocks.onOpenUrl).toHaveBeenCalledTimes(1);
  });

  it("suppresses only the buffered replay, not future identical", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockImplementation(
      () => new Promise<string[] | null>((res) => setTimeout(() => res(["maibuk://note/n1"]), 30))
    );
    const { installDeepLinkBridge, getDeepLinkBootstrap, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async () => {});
    const bootstrapPromise = getDeepLinkBootstrap();
    await new Promise((r) => setTimeout(r, 5));
    await captured(["maibuk://note/n1"]);
    await bootstrapPromise;
    await installDeepLinkBridge(handler);
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    await captured(["maibuk://note/n1"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("FIFO ordering", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockResolvedValue(null);
    const { installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const order: string[] = [];
    const handler = vi.fn(async (urls: string[]) => {
      const delay = urls[0].includes("first") ? 30 : 10;
      await new Promise((r) => setTimeout(r, delay));
      order.push(urls[0]);
    });
    await installDeepLinkBridge(handler);
    // Need to release to allow processing
    releaseDeepLinkQueue();
    await captured(["maibuk://note/first"]);
    await captured(["maibuk://note/second"]);
    await new Promise((r) => setTimeout(r, 120));
    expect(order).toEqual(["maibuk://note/first", "maibuk://note/second"]);
  });

  it("never permanently deduplicates", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockImplementation(
      () => new Promise<string[] | null>((res) => setTimeout(() => res(["maibuk://book/b1"]), 30))
    );
    const { installDeepLinkBridge, getDeepLinkBootstrap, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async () => {});
    const p = getDeepLinkBootstrap();
    await new Promise((r) => setTimeout(r, 5));
    await captured(["maibuk://book/b1"]);
    await p;
    await installDeepLinkBridge(handler);
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    await captured(["maibuk://book/b1"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledTimes(1);
    await captured(["maibuk://book/b1"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("event arriving while getCurrent pending is buffered until release", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockImplementation(
      () =>
        new Promise<string[] | null>((res) =>
          setTimeout(() => res(["maibuk://note/bootstrap"]), 50)
        )
    );
    const { getDeepLinkBootstrap, installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async () => {});
    const bootstrapPromise = getDeepLinkBootstrap();
    await new Promise((r) => setTimeout(r, 10));
    await captured(["maibuk://note/warm-while-pending"]);
    expect(handler).not.toHaveBeenCalled();
    await bootstrapPromise;
    await installDeepLinkBridge(handler);
    // Before release, handler should not have been called
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledWith(["maibuk://note/warm-while-pending"]);
  });

  it("StrictMode remount delivers to current handler exactly once", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    const { installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handlerA = vi.fn(async () => {});
    const handlerB = vi.fn(async () => {});
    await installDeepLinkBridge(handlerA);
    await installDeepLinkBridge(handlerB);
    releaseDeepLinkQueue();
    expect(tauriMocks.onOpenUrl).toHaveBeenCalledTimes(1);
    await captured(["maibuk://note/n1"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("cold A pending, warm B buffered, B not called before release and is final after release", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockImplementation(
      () =>
        new Promise<string[] | null>((res) => setTimeout(() => res(["maibuk://note/coldA"]), 40))
    );
    const { getDeepLinkBootstrap, installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async () => {});
    const bootstrapPromise = getDeepLinkBootstrap();
    await new Promise((r) => setTimeout(r, 10));
    await captured(["maibuk://note/warmB"]);
    await installDeepLinkBridge(handler);
    // Before release, handler should not be called even after bootstrap
    await bootstrapPromise;
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    // Simulate StartupRedirect handling cold A then releasing
    const coldBootstrap = await getDeepLinkBootstrap();
    expect(coldBootstrap).toEqual(["maibuk://note/coldA"]);
    // Release now
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledWith(["maibuk://note/warmB"]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unconsumed bootstrap is delivered via queue when gate released without getDeepLinkBootstrap", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockResolvedValue(["maibuk://note/coldUnconsumed"]);
    const { installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async () => {});
    await installDeepLinkBridge(handler);
    // bootstrap settled but never consumed via getDeepLinkBootstrap
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 20));
    expect(handler).toHaveBeenCalledWith(["maibuk://note/coldUnconsumed"]);
    // second release does not deliver again
    handler.mockClear();
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    void captured;
  });

  it("uninstalled handler leaves batches buffered until reinstall", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockResolvedValue(null);
    const { installDeepLinkBridge, uninstallDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handlerA = vi.fn(async () => {});
    await installDeepLinkBridge(handlerA);
    releaseDeepLinkQueue();
    await new Promise((r) => setTimeout(r, 10));
    // uninstall simulates DeepLinkHandler unmount
    uninstallDeepLinkBridge();
    await captured(["maibuk://note/buffered"]);
    await new Promise((r) => setTimeout(r, 10));
    expect(handlerA).not.toHaveBeenCalled();
    // reinstall with new handler should receive buffered batch
    const handlerB = vi.fn(async () => {});
    await installDeepLinkBridge(handlerB);
    await new Promise((r) => setTimeout(r, 10));
    expect(handlerB).toHaveBeenCalledWith(["maibuk://note/buffered"]);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("uninstall clears handlerRef so processQueue stops draining", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    tauriMocks.getCurrent.mockResolvedValue(null);
    const { installDeepLinkBridge, uninstallDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    let resolveFirst: () => void = () => {};
    const handlerA = vi.fn(
      () => new Promise<void>((res) => { resolveFirst = res; })
    );
    await installDeepLinkBridge(handlerA);
    releaseDeepLinkQueue();
    await captured(["maibuk://note/first"]);
    // handlerA now processing, uninstall during processing
    await new Promise((r) => setTimeout(r, 5));
    uninstallDeepLinkBridge();
    await captured(["maibuk://note/second"]);
    resolveFirst();
    await new Promise((r) => setTimeout(r, 20));
    expect(handlerA).toHaveBeenCalledTimes(1);
    // second batch should remain buffered
    const handlerB = vi.fn(async () => {});
    await installDeepLinkBridge(handlerB);
    await new Promise((r) => setTimeout(r, 20));
    expect(handlerB).toHaveBeenCalledWith(["maibuk://note/second"]);
  });
});
