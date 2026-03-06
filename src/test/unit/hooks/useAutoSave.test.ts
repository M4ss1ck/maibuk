import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useDebouncedCallback,
  useAutoSave,
} from "../../../hooks/useAutoSave";

describe("useDebouncedCallback()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call callback immediately", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current("arg1");
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("calls callback after the delay", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current("arg1");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("arg1");
  });

  it("resets timer on subsequent calls", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(callback, 300));

    act(() => {
      result.current("first");
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      result.current("second");
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Should not have been called yet (200ms after second call)
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Now 300ms after second call
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("second");
  });

  it("cleans up timer on unmount", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(callback, 300)
    );

    act(() => {
      result.current("arg");
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("uses the latest callback reference", () => {
    let counter = 0;
    const { result, rerender } = renderHook(
      ({ cb }) => useDebouncedCallback(cb, 300),
      {
        initialProps: {
          cb: () => {
            counter = 1;
          },
        },
      }
    );

    // Update the callback
    rerender({
      cb: () => {
        counter = 2;
      },
    });

    act(() => {
      result.current();
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(counter).toBe(2);
  });
});

describe("useAutoSave()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns save function and getStatus", () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    expect(result.current.save).toBeDefined();
    expect(result.current.getStatus).toBeDefined();
    expect(result.current.getStatus()).toBe("idle");
  });

  it("debounces the save call", () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => {
      result.current.save("data1");
    });

    // Not yet called (debounced)
    expect(saveFn).not.toHaveBeenCalled();
  });

  it("calls save function after debounce delay", async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => {
      result.current.save("data1");
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(saveFn).toHaveBeenCalledWith("data1");
  });

  it("sets status to saved after successful save", async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => {
      result.current.save("data");
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Allow microtasks to complete
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.getStatus()).toBe("saved");
  });

  it("sets status to error on save failure", async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error("Save failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => {
      result.current.save("data");
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.getStatus()).toBe("error");
    consoleSpy.mockRestore();
  });
});
