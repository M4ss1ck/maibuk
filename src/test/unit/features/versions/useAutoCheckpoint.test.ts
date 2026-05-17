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

    // Chapters finish loading — this becomes the baseline, NOT an edit
    rerender({ wordCount: 1000 });

    // Now the user types 300 words on top of the loaded content
    rerender({ wordCount: 1300 });

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

  it("does not checkpoint when chapters load asynchronously and bump wordCount from 0 to a large value", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    // Async chapter load: 0 → 50000 words. Must NOT count as a user edit.
    rerender({ wordCount: 50000 });

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });

  it("resets the baseline when bookId changes so a book switch does not trigger a checkpoint", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ bookId, wordCount }) =>
        useAutoCheckpoint({ bookId, wordCount, enabled: true }),
      { initialProps: { bookId: "book-1", wordCount: 1000 } }
    );

    // Switch to a different book that happens to have a very different size.
    rerender({ bookId: "book-2", wordCount: 50000 });
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });

  it("re-arms the idle timer on further changes", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 1000 }); // baseline
    rerender({ wordCount: 1300 }); // +300 edit, arms timer
    vi.advanceTimersByTime(1 * 60 * 1000); // 1 min in, timer still pending

    rerender({ wordCount: 1350 }); // small further change, re-arms
    vi.advanceTimersByTime(1 * 60 * 1000); // 1 min from re-arm

    expect(mockCreateVersion).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1 * 60 * 1000); // 2 min from re-arm

    expect(mockCreateVersion).toHaveBeenCalledTimes(1);
  });

  it("blocks a second checkpoint with the min-interval floor", async () => {
    mockCreateVersion.mockResolvedValue({ id: "ver-1" });
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 1000 }); // baseline
    rerender({ wordCount: 1300 }); // first edit
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mockCreateVersion).toHaveBeenCalledTimes(1);

    // Immediately try another
    rerender({ wordCount: 1600 });
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

    rerender({ wordCount: 1000 }); // baseline
    rerender({ wordCount: 1300 }); // edit
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(mockCreateVersion.mock.calls[0][0].triggerType).toBe("auto-idle");
  });

  it("does nothing when disabled", () => {
    mockCreateVersion.mockResolvedValue(null);
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: "book-1", wordCount, enabled: false }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 1000 });
    rerender({ wordCount: 1300 });
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });

  it("does nothing when bookId is undefined", () => {
    mockCreateVersion.mockResolvedValue(null);
    const { rerender } = renderHook(
      ({ wordCount }) => useAutoCheckpoint({ bookId: undefined, wordCount, enabled: true }),
      { initialProps: { wordCount: 0 } }
    );

    rerender({ wordCount: 1000 });
    rerender({ wordCount: 1300 });
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(mockCreateVersion).not.toHaveBeenCalled();
  });
});
