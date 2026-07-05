import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockSetTraySyncing } = vi.hoisted(() => ({
  mockSetTraySyncing: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, setTraySyncing: mockSetTraySyncing };
});

import { useSyncStore } from "@/features/sync/store";
import { installTraySyncIndicator } from "@/features/sync/trayIndicator";

describe("installTraySyncIndicator", () => {
  beforeEach(() => {
    installTraySyncIndicator(); // idempotent: subscribes once
    useSyncStore.setState({ syncStatus: "idle" });
    mockSetTraySyncing.mockClear();
  });

  it("signals true when sync starts", () => {
    useSyncStore.setState({ syncStatus: "syncing" });
    expect(mockSetTraySyncing).toHaveBeenCalledTimes(1);
    expect(mockSetTraySyncing).toHaveBeenCalledWith(true);
  });

  it("signals false when sync finishes", () => {
    useSyncStore.setState({ syncStatus: "syncing" });
    mockSetTraySyncing.mockClear();
    useSyncStore.setState({ syncStatus: "success" });
    expect(mockSetTraySyncing).toHaveBeenCalledTimes(1);
    expect(mockSetTraySyncing).toHaveBeenCalledWith(false);
  });

  it("signals false when sync errors", () => {
    useSyncStore.setState({ syncStatus: "syncing" });
    mockSetTraySyncing.mockClear();
    useSyncStore.setState({ syncStatus: "error" });
    expect(mockSetTraySyncing).toHaveBeenCalledWith(false);
  });

  it("ignores transitions that do not involve syncing", () => {
    useSyncStore.setState({ syncStatus: "success" });
    expect(mockSetTraySyncing).not.toHaveBeenCalled();
  });

  it("ignores store changes that do not change syncStatus", () => {
    useSyncStore.setState({ syncError: "boom" });
    expect(mockSetTraySyncing).not.toHaveBeenCalled();
  });
});
