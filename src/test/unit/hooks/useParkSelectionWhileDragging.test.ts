import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockPark } = vi.hoisted(() => ({ mockPark: vi.fn() }));
vi.mock("@/lib/park-selection", () => ({ parkInertSelection: mockPark }));

import { useParkSelectionWhileDragging } from "@/hooks/useParkSelectionWhileDragging";

let restores: ReturnType<typeof vi.fn>[];
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

beforeEach(() => {
  restores = [];
  mockPark.mockReset().mockImplementation(() => {
    const restore = vi.fn();
    restores.push(restore);
    return restore;
  });
});

describe("useParkSelectionWhileDragging()", () => {
  it("parks a frame after the drag starts and restores when it ends, calling the list's handlers", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { result } = renderHook(() => useParkSelectionWhileDragging({ onDragStart, onDragEnd }));
    result.current.onDragStart("start");
    expect(onDragStart).toHaveBeenCalledWith("start");
    expect(mockPark).not.toHaveBeenCalled();
    await nextFrame();
    await nextFrame();
    expect(mockPark).toHaveBeenCalledTimes(1);

    result.current.onDragEnd("end");
    expect(restores[0]).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith("end");
  });

  it("does not park a drag that ended before its first frame", async () => {
    const { result } = renderHook(() => useParkSelectionWhileDragging());
    result.current.onDragStart(undefined);
    result.current.onDragEnd(undefined);
    await nextFrame();
    await nextFrame();
    expect(mockPark).not.toHaveBeenCalled();
  });

  it("restores when the list unmounts mid-drag", async () => {
    const { result, unmount } = renderHook(() => useParkSelectionWhileDragging());
    result.current.onDragStart(undefined);
    await nextFrame();
    await nextFrame();
    unmount();
    expect(restores[0]).toHaveBeenCalledTimes(1);
  });

  it("calls the handlers of the latest render, with stable identity", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ handler }) => useParkSelectionWhileDragging({ onDragEnd: handler }),
      { initialProps: { handler: first } }
    );
    const handlers = result.current;
    rerender({ handler: second });
    expect(result.current).toBe(handlers);
    result.current.onDragEnd(undefined);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
