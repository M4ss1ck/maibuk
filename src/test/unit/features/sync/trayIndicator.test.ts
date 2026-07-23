import { describe, it, expect, beforeEach, vi } from "vitest";

const { platformState, mockSetTraySyncing } = vi.hoisted(() => ({
  platformState: { isDesktop: true },
  mockSetTraySyncing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform", () => ({
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  setTraySyncing: mockSetTraySyncing,
}));

describe("installTraySyncIndicator", () => {
  let useSyncStore: typeof import("@/features/sync/store").useSyncStore;

  beforeEach(async () => {
    platformState.isDesktop = true;
    vi.resetModules();
    useSyncStore = (await import("@/features/sync/store")).useSyncStore;
    useSyncStore.setState({ syncStatus: "idle" });
    mockSetTraySyncing.mockClear();
  });

  async function installFresh(): Promise<void> {
    const { installTraySyncIndicator } = await import("@/features/sync/trayIndicator");
    installTraySyncIndicator();
  }

  it("signals true when sync starts", async () => {
    await installFresh();
    useSyncStore.setState({ syncStatus: "syncing" });
    expect(mockSetTraySyncing).toHaveBeenCalledTimes(1);
    expect(mockSetTraySyncing).toHaveBeenCalledWith(true);
  });

  it("signals false when sync finishes", async () => {
    await installFresh();
    useSyncStore.setState({ syncStatus: "syncing" });
    mockSetTraySyncing.mockClear();
    useSyncStore.setState({ syncStatus: "success" });
    expect(mockSetTraySyncing).toHaveBeenCalledTimes(1);
    expect(mockSetTraySyncing).toHaveBeenCalledWith(false);
  });

  it("signals false when sync errors", async () => {
    await installFresh();
    useSyncStore.setState({ syncStatus: "syncing" });
    mockSetTraySyncing.mockClear();
    useSyncStore.setState({ syncStatus: "error" });
    expect(mockSetTraySyncing).toHaveBeenCalledWith(false);
  });

  it("ignores transitions that do not involve syncing", async () => {
    await installFresh();
    useSyncStore.setState({ syncStatus: "success" });
    expect(mockSetTraySyncing).not.toHaveBeenCalled();
  });

  it("ignores store changes that do not change syncStatus", async () => {
    await installFresh();
    useSyncStore.setState({ syncError: "boom" });
    expect(mockSetTraySyncing).not.toHaveBeenCalled();
  });

  it("does not install on Android", async () => {
    platformState.isDesktop = false;
    await installFresh();
    useSyncStore.setState({ syncStatus: "syncing" });
    expect(mockSetTraySyncing).not.toHaveBeenCalled();
  });
});
