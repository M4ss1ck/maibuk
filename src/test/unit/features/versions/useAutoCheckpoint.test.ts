import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockCreateVersion = vi.fn();

vi.mock("../../../../features/versions/store", () => ({
  useVersionStore: {
    getState: () => ({
      createVersion: mockCreateVersion,
    }),
  },
}));

const { useAutoCheckpoint } = await import("../../../../features/versions/useAutoCheckpoint");

describe("useAutoCheckpoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateVersion.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not checkpoint before the word-change threshold is crossed", () => {
    mockCreateVersion.mockResolvedValue(null);
    renderHook(() =>
      useAutoCheckpoint({ bookId: "book-1", wordCount: 100, enabled: true })
    );

    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });

  it("fires checkpoint once the idle delay elapses after crossing the threshold", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    // Cross the threshold
    rerender({ wordCount: 300 });

    // Should not fire immediately
    expect(mockCreateVersion).not.toHaveBeenCalled();

    // Advance past idle time
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mockCreateVersion).toHaveBeenCalledTimes(1);
    expect(mockCreateVersion).toHaveBeenCalledWith({
      bookId: "book-1",
      triggerType: "auto-idle",
    });
  });

  it("re-arms the idle timer on further changes", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 300 });
    vi.advanceTimersByTime(1 * 60 * 1000); // 1 min in, timer should still be pending

    rerender({ wordCount: 350 });
    vi.advanceTimersByTime(1 * 60 * 1000); // now 2 min from first trigger, but only 1 min from second

    expect(mockCreateVersion).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1 * 60 * 1000); // 2 min from second trigger

    expect(mockCreateVersion).toHaveBeenCalledTimes(1);
  });

  it("blocks a second checkpoint with the min-interval floor", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    // First checkpoint
    rerender({ wordCount: 300 });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockCreateVersion).toHaveBeenCalledTimes(1);

    // Immediately try another
    rerender({ wordCount: 600 });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    // Still blocked by min-interval floor
    expect(mockCreateVersion).toHaveBeenCalledTimes(1);
  });

  it("calls createVersion with triggerType auto-idle", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 300 });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mockCreateVersion.mock.calls[0][0].triggerType).toBe("auto-idle");
  });

  it("does nothing when disabled", () => {
    mockCreateVersion.mockResolvedValue(null);
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: false }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 300 });
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });

  it("does nothing when bookId is undefined", () => {
    mockCreateVersion.mockResolvedValue(null);
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: undefined, wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 300 });
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });
});
