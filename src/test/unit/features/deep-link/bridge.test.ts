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

/** A promise the test settles by hand, so the bridge's pending state is exact, not timed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Listeners the bridge registered through onOpenUrl, in registration order. */
let openUrlListeners: Array<(urls: string[]) => void> = [];

/** Waits until the bridge has registered its onOpenUrl listener, then returns it. */
async function openUrlListener(): Promise<(urls: string[]) => void> {
  await vi.waitFor(() => expect(openUrlListeners).toHaveLength(1));
  return openUrlListeners[0];
}

describe("deep-link bridge", () => {
  beforeEach(async () => {
    vi.resetModules();
    platformState.isTauri = true;
    platformState.isDesktop = false;
    openUrlListeners = [];
    tauriMocks.onOpenUrl.mockReset().mockImplementation(async (cb: (urls: string[]) => void) => {
      openUrlListeners.push(cb);
      return async () => {};
    });
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
    const current = deferred<string[] | null>();
    tauriMocks.getCurrent.mockImplementation(() => current.promise);
    const { installDeepLinkBridge, getDeepLinkBootstrap, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async (_urls: string[]) => {});
    const bootstrapPromise = getDeepLinkBootstrap();
    const emit = await openUrlListener();
    // Arrives while bootstrap is pending: buffered, then replayed once and suppressed.
    await emit(["maibuk://note/n1"]);
    current.resolve(["maibuk://note/n1"]);
    await bootstrapPromise;
    await installDeepLinkBridge(handler);
    releaseDeepLinkQueue();
    // A future identical batch must be delivered. The FIFO queue runs any
    // replayed batch before this one, so the exact call list below also proves
    // the replay was never delivered.
    await emit(["maibuk://note/n1"]);
    await emit(["maibuk://note/n2"]);
    await vi.waitFor(() => expect(handler).toHaveBeenLastCalledWith(["maibuk://note/n2"]));
    expect(handler.mock.calls).toEqual([[["maibuk://note/n1"]], [["maibuk://note/n2"]]]);
  });

  it("FIFO ordering", async () => {
    const events: string[] = [];
    const firstGate = deferred<void>();
    const handler = vi.fn(async (urls: string[]) => {
      const label = urls[0].endsWith("first") ? "first" : "second";
      events.push(`start:${label}`);
      if (label === "first") await firstGate.promise;
      events.push(`end:${label}`);
    });
    const { installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    await installDeepLinkBridge(handler);
    releaseDeepLinkQueue();
    const emit = await openUrlListener();
    await emit(["maibuk://note/first"]);
    await emit(["maibuk://note/second"]);
    await vi.waitFor(() => expect(events).toEqual(["start:first"]));
    firstGate.resolve();
    // Exact sequence: second must not start until first has ended.
    await vi.waitFor(() =>
      expect(events).toEqual(["start:first", "end:first", "start:second", "end:second"])
    );
  });

  it("never permanently deduplicates", async () => {
    const current = deferred<string[] | null>();
    tauriMocks.getCurrent.mockImplementation(() => current.promise);
    const { installDeepLinkBridge, getDeepLinkBootstrap, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async (_urls: string[]) => {});
    const bootstrapPromise = getDeepLinkBootstrap();
    const emit = await openUrlListener();
    await emit(["maibuk://book/b1"]);
    current.resolve(["maibuk://book/b1"]);
    await bootstrapPromise;
    await installDeepLinkBridge(handler);
    releaseDeepLinkQueue();
    // Three identical batches must all be delivered; the witness is FIFO-ordered
    // after them, so the exact list shows the replay was dropped and nothing was deduplicated.
    await emit(["maibuk://book/b1"]);
    await emit(["maibuk://book/b1"]);
    await emit(["maibuk://book/b1"]);
    await emit(["maibuk://book/b2"]);
    await vi.waitFor(() => expect(handler).toHaveBeenLastCalledWith(["maibuk://book/b2"]));
    expect(handler.mock.calls).toEqual([
      [["maibuk://book/b1"]],
      [["maibuk://book/b1"]],
      [["maibuk://book/b1"]],
      [["maibuk://book/b2"]],
    ]);
  });

  it("event arriving while getCurrent pending is buffered until release", async () => {
    const current = deferred<string[] | null>();
    tauriMocks.getCurrent.mockImplementation(() => current.promise);
    const { getDeepLinkBootstrap, installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    // Any delivery made before release is recorded as early; the witness below proves none happened.
    let released = false;
    const early: string[][] = [];
    const handler = vi.fn(async (urls: string[]) => {
      if (!released) early.push(urls);
    });
    const bootstrapPromise = getDeepLinkBootstrap();
    const emit = await openUrlListener();
    await emit(["maibuk://note/warm-while-pending"]);
    current.resolve(["maibuk://note/bootstrap"]);
    await bootstrapPromise;
    await installDeepLinkBridge(handler);
    await emit(["maibuk://note/witness"]);
    released = true;
    releaseDeepLinkQueue();
    // The witness is queued behind the buffered batch, so once it arrives the
    // buffered batch has been delivered and nothing was delivered before release.
    await vi.waitFor(() => expect(handler).toHaveBeenLastCalledWith(["maibuk://note/witness"]));
    expect(early).toEqual([]);
    expect(handler.mock.calls).toEqual([
      [["maibuk://note/warm-while-pending"]],
      [["maibuk://note/witness"]],
    ]);
  });

  it("StrictMode remount delivers to current handler exactly once", async () => {
    const { installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handlerA = vi.fn(async (_urls: string[]) => {});
    const handlerB = vi.fn(async (_urls: string[]) => {});
    await installDeepLinkBridge(handlerA);
    await installDeepLinkBridge(handlerB);
    releaseDeepLinkQueue();
    expect(tauriMocks.onOpenUrl).toHaveBeenCalledTimes(1);
    const emit = await openUrlListener();
    await emit(["maibuk://note/n1"]);
    await vi.waitFor(() => expect(handlerB).toHaveBeenCalledTimes(1));
    expect(handlerA).not.toHaveBeenCalled();
  });

  it("cold A pending, warm B buffered, B not called before release and is final after release", async () => {
    const current = deferred<string[] | null>();
    tauriMocks.getCurrent.mockImplementation(() => current.promise);
    const { getDeepLinkBootstrap, installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    let released = false;
    const early: string[][] = [];
    const handler = vi.fn(async (urls: string[]) => {
      if (!released) early.push(urls);
    });
    const bootstrapPromise = getDeepLinkBootstrap();
    const emit = await openUrlListener();
    await emit(["maibuk://note/warmB"]);
    const installPromise = installDeepLinkBridge(handler);
    current.resolve(["maibuk://note/coldA"]);
    await installPromise;
    await bootstrapPromise;
    // StartupRedirect consumes cold A, then the queue is released.
    const coldBootstrap = await getDeepLinkBootstrap();
    expect(coldBootstrap).toEqual(["maibuk://note/coldA"]);
    await emit(["maibuk://note/witness"]);
    released = true;
    releaseDeepLinkQueue();
    // The witness is queued after warm B, so its arrival proves warm B has been
    // delivered; early records any delivery that happened while the gate was closed.
    await vi.waitFor(() => expect(handler).toHaveBeenLastCalledWith(["maibuk://note/witness"]));
    expect(early).toEqual([]);
    expect(handler.mock.calls).toEqual([[["maibuk://note/warmB"]], [["maibuk://note/witness"]]]);
  });

  it("unconsumed bootstrap is delivered via queue when gate released without getDeepLinkBootstrap", async () => {
    tauriMocks.getCurrent.mockResolvedValue(["maibuk://note/coldUnconsumed"]);
    const { installDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handler = vi.fn(async (_urls: string[]) => {});
    await installDeepLinkBridge(handler);
    // Bootstrap has settled but was never consumed; the gate is still closed.
    expect(handler).not.toHaveBeenCalled();
    releaseDeepLinkQueue();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith(["maibuk://note/coldUnconsumed"]));
    // Second release must not deliver the bootstrap again. The witness batch is
    // sent after it, so the exact call list shows nothing was redelivered.
    handler.mockClear();
    releaseDeepLinkQueue();
    const emit = await openUrlListener();
    await emit(["maibuk://note/witness"]);
    await vi.waitFor(() => expect(handler).toHaveBeenLastCalledWith(["maibuk://note/witness"]));
    expect(handler.mock.calls).toEqual([[["maibuk://note/witness"]]]);
  });

  it("uninstalled handler leaves batches buffered until reinstall", async () => {
    tauriMocks.getCurrent.mockResolvedValue(null);
    const { installDeepLinkBridge, uninstallDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const handlerA = vi.fn(async (_urls: string[]) => {});
    await installDeepLinkBridge(handlerA);
    releaseDeepLinkQueue();
    // uninstall simulates DeepLinkHandler unmount
    uninstallDeepLinkBridge();
    const emit = await openUrlListener();
    await emit(["maibuk://note/buffered"]);
    // reinstall with new handler should receive buffered batch
    const handlerB = vi.fn(async (_urls: string[]) => {});
    await installDeepLinkBridge(handlerB);
    await vi.waitFor(() => expect(handlerB).toHaveBeenCalledTimes(1));
    expect(handlerB).toHaveBeenCalledWith(["maibuk://note/buffered"]);
    expect(handlerA).not.toHaveBeenCalled();
  });

  it("uninstall clears handlerRef so processQueue stops draining", async () => {
    tauriMocks.getCurrent.mockResolvedValue(null);
    const { installDeepLinkBridge, uninstallDeepLinkBridge, releaseDeepLinkQueue } = await import(
      "@/features/deep-link/bridge"
    );
    const firstDone = deferred<void>();
    const handlerA = vi.fn((_urls: string[]) => firstDone.promise);
    await installDeepLinkBridge(handlerA);
    releaseDeepLinkQueue();
    const emit = await openUrlListener();
    await emit(["maibuk://note/first"]);
    await vi.waitFor(() => expect(handlerA).toHaveBeenCalledTimes(1));
    // handlerA is still processing when the handler is uninstalled.
    uninstallDeepLinkBridge();
    await emit(["maibuk://note/second"]);
    firstDone.resolve();
    // The drain loop registered its continuation on this promise before the
    // test did, so the loop has checked handlerRef (now null) before we go on.
    await firstDone.promise;
    // second batch should remain buffered
    const handlerB = vi.fn(async (_urls: string[]) => {});
    await installDeepLinkBridge(handlerB);
    await vi.waitFor(() => expect(handlerB).toHaveBeenCalledWith(["maibuk://note/second"]));
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledTimes(1);
  });
});
