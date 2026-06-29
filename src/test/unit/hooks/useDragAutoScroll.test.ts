import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDragAutoScroll } from "@/hooks/useDragAutoScroll";

function makeContainer(rect: { top: number; bottom: number }) {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTop", {
    value: 100,
    writable: true,
    configurable: true,
  });
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.bottom,
      left: 0,
      right: 0,
      width: 0,
      height: rect.bottom - rect.top,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

describe("useDragAutoScroll", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls up when the pointer is near the top edge", () => {
    const container = makeContainer({ top: 0, bottom: 500 });
    const ref = { current: container };
    const { result } = renderHook(() => useDragAutoScroll(ref));

    result.current.onDragOver(8); // within 48px of top
    expect(container.scrollTop).toBeLessThan(100);
    result.current.stop();
  });

  it("scrolls down when the pointer is near the bottom edge", () => {
    const container = makeContainer({ top: 0, bottom: 500 });
    const ref = { current: container };
    const { result } = renderHook(() => useDragAutoScroll(ref));

    result.current.onDragOver(495); // within 48px of bottom
    expect(container.scrollTop).toBeGreaterThan(100);
    result.current.stop();
  });

  it("does not scroll when the pointer is in the middle", () => {
    const container = makeContainer({ top: 0, bottom: 500 });
    const ref = { current: container };
    const { result } = renderHook(() => useDragAutoScroll(ref));

    result.current.onDragOver(250);
    expect(container.scrollTop).toBe(100);
    result.current.stop();
  });
});
